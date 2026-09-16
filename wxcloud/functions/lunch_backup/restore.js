const { randomBytes, createHash } = require('crypto')
const { error, groupDoc, optionalDocument } = require('./requestGate')
const COLLECTIONS = { menu: 'lunch_menu', members: 'lunch_members', orders: 'lunch_orders', userStats: 'lunch_user_menu_stats' }
const CHUNK_SIZE = 15

function validateSnapshot(snapshot, groupId) {
    if (!snapshot || typeof snapshot !== 'object') throw error(400, '备份格式错误')
    if (snapshot.groupId && snapshot.groupId !== groupId) throw error(400, '备份组织不匹配')
    for (const key of ['orders', 'menu', 'members', 'userStats', 'monthlyStats', 'orderKeys']) {
        if (snapshot[key] === undefined && !['orders', 'menu', 'members'].includes(key)) continue
        if (!Array.isArray(snapshot[key])) throw error(400, '备份缺少数据列表: ' + key)
        const ids = new Set()
        for (const row of snapshot[key]) {
            if (!row || typeof row._id !== 'string' || !row._id || row.groupId !== groupId || ids.has(row._id)) {
                throw error(400, '备份中存在无效ID、重复ID或其他组织数据')
            }
            ids.add(row._id)
        }
    }
}

// 恢复成员资料，但角色由恢复开始时的真实微信账号决定。
function buildPlan(target, before, groupId, creatorId) {
    validateSnapshot(target, groupId)
    validateSnapshot(before, groupId)
    const roleByOpenid = new Map(before.members.filter(m => m.openid && !m.isVirtual).map(m => [m.openid, m.role]))
    const seenOpenids = new Set()
    const members = target.members.map(m => {
        if (m.openid) {
            if (seenOpenids.has(m.openid)) throw error(400, '备份存在重复微信账号')
            seenOpenids.add(m.openid)
        }
        const role = m.openid === creatorId ? 'creator' : roleByOpenid.get(m.openid) === 'admin' ? 'admin' : 'member'
        return { ...m, role, isVirtual: !m.openid }
    })
    // 旧备份未包含的现有微信账号继续保留，避免恢复把操作者或其他账号删除。
    for (const member of before.members) {
        if (member.openid && !seenOpenids.has(member.openid)) {
            if (members.some(m => m._id === member._id)) throw error(400, '备份成员ID与现有账号冲突')
            members.push({ ...member, role: member.openid === creatorId ? 'creator' : member.role === 'admin' ? 'admin' : 'member' })
            seenOpenids.add(member.openid)
        }
    }
    const data = { ...target, members, userStats: target.userStats || [] }
    const plan = []
    for (const [key, collection] of Object.entries(COLLECTIONS)) {
        const ids = new Set(data[key].map(row => row._id))
        for (const row of data[key]) {
            const { _id, _restoreTs, ...rest } = row
            plan.push({ collection, id: _id, data: rest })
        }
        for (const row of before[key] || []) {
            if (!ids.has(row._id)) plan.push({ collection, id: row._id, data: null })
        }
    }
    // 派生统计下次按恢复后的订单重建，旧下单锁不能引用被删除的订单。
    for (const row of before.monthlyStats || []) plan.push({ collection: 'lunch_monthly_stats', id: row._id, data: null })
    for (const row of before.orderKeys || []) plan.push({ collection: 'lunch_order_keys', id: row._id, data: null })
    return plan
}

function reviveDates(data) {
    const result = { ...data }
    for (const key of ['createdAt', 'updatedAt', 'joinedAt', 'lastOrderedAt', 'lastAt', 'expireAt']) {
        if (typeof result[key] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(result[key])) {
            const date = new Date(result[key])
            if (Number.isFinite(date.getTime())) result[key] = date
        }
    }
    return result
}

async function restore({ db, cloud, groupId, openid, event, loadBackup, doBackup, getMemberByOpenid }) {
    if (!openid) throw error(401, '请先登录')
    if (event.restoreProtocol !== 2) throw error(426, '恢复功能已升级，请更新小程序后重试')
    let group = await groupDoc(db, groupId)
    let job = group.restoreJob
    if (!job && event.jobId && group.lastRestore && group.lastRestore.id === event.jobId &&
        group.lastRestore.actorOpenid === openid && group.lastRestore.backupId === event.backupId) {
        return { code: 0, data: { done: true, jobId: event.jobId } }
    }
    if (job) {
        if (openid !== job.actorOpenid && openid !== group.creatorId) throw error(403, '仅恢复发起者或创建者可继续恢复')
        if (job.backupId !== event.backupId || (event.jobId && job.id !== event.jobId)) {
            throw error(409, '已有恢复任务，请选择正在恢复的备份继续')
        }
    } else {
        if (event.jobId) throw error(409, '恢复任务已失效，请重新选择备份')
        const caller = await getMemberByOpenid(openid)
        if (!caller || !['admin', 'creator'].includes(caller.role)) throw error(403, 'admin/creator only')
        // 在维护锁之前验证备份，错误备份不会使组织进入维护状态。
        await loadBackup(event.backupId)
        job = { id: randomBytes(16).toString('hex'), backupId: event.backupId, actorOpenid: openid, actorMember: caller, phase: 'prepare', index: 0 }
        await db.runTransaction(async tx => {
            const ref = tx.collection('lunch_groups').doc(groupId)
            const current = (await ref.get()).data
            if (current.restoreJob) throw error(409, '已有恢复任务')
            if (Object.values(current.activeRequests || {}).some(until => until > Date.now())) {
                throw error(409, '组织仍有请求执行中，请稍后重试恢复')
            }
            const member = (await tx.collection('lunch_members').doc(caller._id).get()).data
            if (!member || member.groupId !== groupId || member.openid !== openid || !['admin', 'creator'].includes(member.role)) {
                throw error(403, '恢复权限已变更')
            }
            await ref.update({ data: { restoreJob: db.command.set(job) } })
        })
    }

    if (job.phase === 'prepare') {
        // 准备工作不改变业务数据，失败保留维护锁，可安全重试。
        const safety = await doBackup('safety', '恢复前安全快照 ' + job.id)
        const [target, before] = await Promise.all([loadBackup(job.backupId), loadBackup(safety._id)])
        const plan = buildPlan(target, before, groupId, group.creatorId)
        const bytes = Buffer.from(JSON.stringify(plan), 'utf8')
        const uploaded = await cloud.uploadFile({
            cloudPath: 'lunch/restore/' + groupId + '/' + job.id + '_' + randomBytes(8).toString('hex') + '.json',
            fileContent: bytes,
        })
        const next = { ...job, phase: 'apply', safetyBackupId: safety._id, planFileID: uploaded.fileID,
            sha256: createHash('sha256').update(bytes).digest('hex'), total: plan.length, index: 0 }
        await db.runTransaction(async tx => {
            const ref = tx.collection('lunch_groups').doc(groupId)
            const current = (await ref.get()).data.restoreJob
            if (!current || current.id !== job.id) throw error(409, '恢复任务已变更')
            if (current.phase === 'prepare') await ref.update({ data: { restoreJob: db.command.set(next) } })
        })
        return { code: 0, data: { done: false, jobId: job.id, processed: 0, total: plan.length } }
    }

    const bytes = Buffer.from((await cloud.downloadFile({ fileID: job.planFileID })).fileContent)
    if (createHash('sha256').update(bytes).digest('hex') !== job.sha256) throw error(400, '恢复计划完整性校验失败')
    const plan = JSON.parse(bytes.toString('utf8'))
    const end = Math.min(job.index + CHUNK_SIZE, plan.length)
    const result = await db.runTransaction(async tx => {
        const ref = tx.collection('lunch_groups').doc(groupId)
        const current = (await ref.get()).data.restoreJob
        if (!current || current.id !== job.id || current.index !== job.index) {
            return { done: false, jobId: job.id, processed: current ? current.index : end, total: plan.length }
        }
        for (const step of plan.slice(job.index, end)) {
            const doc = tx.collection(step.collection).doc(step.id)
            const found = await optionalDocument(doc)
            if (found && found.groupId !== groupId) throw error(403, '目标ID已属于其他组织，已停止恢复')
            if (step.data === null) {
                if (found) await doc.remove()
            } else {
                if (step.data.groupId !== groupId) throw error(403, '恢复数据组织不匹配')
                await doc.set({ data: reviveDates(step.data) })
            }
        }
        if (end === plan.length) {
            const now = db.serverDate()
            await ref.update({ data: {
                restoreJob: db.command.remove(),
                lastRestore: { id: job.id, backupId: job.backupId, actorOpenid: job.actorOpenid, safetyBackupId: job.safetyBackupId },
                activeRequests: db.command.set({}), ordersTimestamp: now, menuTimestamp: now, membersTimestamp: now, dataTimestamp: 0,
            } })
        } else {
            await ref.update({ data: { restoreJob: db.command.set({ ...current, index: end }) } })
        }
        return { done: end === plan.length, jobId: job.id, processed: end, total: plan.length }
    })
    return { code: 0, data: result }
}
module.exports = { restore, validateSnapshot, buildPlan, reviveDates }
