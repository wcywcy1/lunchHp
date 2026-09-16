const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const requestGate = require('./requestGate')
const _rateMap = new Map()
let backupCollectionsEnsured = false

async function ensureBackupCollections() {
    if (backupCollectionsEnsured) return
    for (const name of ['lunch_orders', 'lunch_menu', 'lunch_members', 'lunch_backups', 'lunch_user_menu_stats', 'lunch_monthly_stats', 'lunch_order_keys']) {
        try { await db.createCollection(name) }
        catch (e) { if (!/exists|已存在/i.test(e.message || e.errMsg || '')) throw e }
    }
    backupCollectionsEnsured = true
}

// 每次调用创建独立组织上下文，避免复用实例并发请求时串组。
function createRequestHandlers(GROUP_ID) {
const COL = {
    GROUPS: 'lunch_groups',
    ORDERS: 'lunch_orders',
    MENU: 'lunch_menu',
    MEMBERS: 'lunch_members',
    BACKUPS: 'lunch_backups',
    MONTHLY_STATS: 'lunch_monthly_stats',
    USER_STATS: 'lunch_user_menu_stats',
    AUDIT_LOGS: 'lunch_audit_logs',
}
const ROLE = { CREATOR: 'creator', ADMIN: 'admin' }

const AUTO_MAX = 8
const MANUAL_MAX = 10
const BATCH_SIZE = 100

async function getMemberByOpenid(openid) {
    const { data } = await db.collection(COL.MEMBERS)
        .where({ groupId: GROUP_ID, openid }).get()
    if (data[0]) return data[0]
    const groupData = (await db.collection(COL.GROUPS).doc(GROUP_ID).get()).data
    if (groupData && groupData.creatorId === openid) {
        // 创建者无真实 member 记录时真实落库，避免幽灵用户
        const now = db.serverDate()
        const member = {
            groupId: GROUP_ID,
            openid,
            name: '',
            nickName: '',
            avatar: '',
            role: ROLE.CREATOR,
            isVirtual: false,
            privacyAgreed: false,
            joinedAt: now,
        }
        const { _id } = await db.collection(COL.MEMBERS).add({ data: member })
        return { ...member, _id }
    }
    return null
}

function checkRole(member, ...allowed) {
    if (!member) return false
    return allowed.includes(member.role)
}

async function fetchAll(collection, where) {
    const all = []
    const limit = 100
    let skip = 0
    while (true) {
        const { data } = await collection.where(where).orderBy('_id', 'asc').skip(skip).limit(limit).get()
        all.push(...data)
        if (data.length < limit) break
        skip += limit
    }
    return all
}

function formatTimestamp(d) {
    const dt = new Date(d)
    const y = dt.getFullYear()
    const m = String(dt.getMonth() + 1).padStart(2, '0')
    const day = String(dt.getDate()).padStart(2, '0')
    const h = String(dt.getHours()).padStart(2, '0')
    const min = String(dt.getMinutes()).padStart(2, '0')
    const sec = String(dt.getSeconds()).padStart(2, '0')
    return `${y}${m}${day}_${h}${min}${sec}`
}

// CSV 字段转义（RFC 4180）：含逗号/引号/换行时用双引号包裹
function csvEscape(field) {
    if (field === null || field === undefined) return ''
    const s = String(field)
    if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
}

function buildCsvLine(fields) {
    return fields.map(csvEscape).join(',')
}

async function doBackup(type, remark) {
    await ensureBackupCollections()
    const [orders, menu, members, userStats, monthlyStats, orderKeys] = await Promise.all([
        fetchAll(db.collection(COL.ORDERS), { groupId: GROUP_ID }),
        fetchAll(db.collection(COL.MENU), { groupId: GROUP_ID }),
        fetchAll(db.collection(COL.MEMBERS), { groupId: GROUP_ID }),
        fetchAll(db.collection(COL.USER_STATS), { groupId: GROUP_ID }),
        fetchAll(db.collection(COL.MONTHLY_STATS), { groupId: GROUP_ID }),
        fetchAll(db.collection('lunch_order_keys'), { groupId: GROUP_ID }),
    ])
    const dates = orders.map(o => o.date).filter(Boolean).sort()
    const dateRange = dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null
    const content = Buffer.from(JSON.stringify({ version: 2, groupId: GROUP_ID, orders, menu, members, userStats, monthlyStats, orderKeys }), 'utf8')
    const crypto = require('crypto')
    const path = 'lunch/backups/' + GROUP_ID + '/' + crypto.randomBytes(16).toString('hex') + '.json'
    const uploaded = await cloud.uploadFile({ cloudPath: path, fileContent: content })
    const backup = {
        groupId: GROUP_ID, version: 2, type, createdAt: db.serverDate(),
        orderCount: orders.length, menuCount: menu.length, memberCount: members.length,
        dateRange, remark: remark || '', fileID: uploaded.fileID,
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
    }
    const { _id } = await db.collection(COL.BACKUPS).add({ data: backup })
    // 恢复前安全快照独立保留，不受普通备份轮换影响。
    if (type === 'auto' || type === 'manual') {
        try { await cleanupOldBackups(type, type === 'auto' ? AUTO_MAX : MANUAL_MAX) }
        catch (e) { console.error('cleanup backups:', e.message) }
    }
    return { _id, ...backup }
}

async function loadBackup(backupId) {
    if (typeof backupId !== 'string' || !backupId) throw requestGate.error(400, '请选择备份')
    const { data } = await db.collection(COL.BACKUPS).where({ _id: backupId, groupId: GROUP_ID }).limit(1).get()
    if (!data.length) throw requestGate.error(404, '备份不存在或尚未确认组织归属')
    const meta = data[0]
    let content
    if (meta.fileID) {
        content = Buffer.from((await cloud.downloadFile({ fileID: meta.fileID })).fileContent)
        const hash = require('crypto').createHash('sha256').update(content).digest('hex')
        if (!meta.sha256 || hash !== meta.sha256) throw requestGate.error(400, '备份完整性校验失败')
    } else {
        content = Buffer.from(meta.data || '', 'utf8')
    }
    const snapshot = JSON.parse(content.toString('utf8'))
    require('./restore').validateSnapshot(snapshot, GROUP_ID)
    return snapshot
}

async function cleanupOldBackups(type, maxKeep) {
    const { data: all } = await db.collection(COL.BACKUPS)
        .where({ type, groupId: GROUP_ID })
        .orderBy('createdAt', 'desc')
        .limit(maxKeep + 5)
        .field({ _id: true })
        .get()

    if (all.length <= maxKeep) return

    const toDeleteIds = all.slice(maxKeep).map(item => item._id)
    const expired = await db.collection(COL.BACKUPS).where({ _id: _.in(toDeleteIds), groupId: GROUP_ID }).get()
    await db.collection(COL.BACKUPS).where({ _id: _.in(toDeleteIds), groupId: GROUP_ID }).remove()
    const fileList = expired.data.map(item => item.fileID).filter(Boolean)
    if (fileList.length) await cloud.deleteFile({ fileList })
}

// 简单速率限制：同一 openid 10 秒窗口内最多 30 次调用（实例级内存，防异常刷量）
// 速率记录保留在模块级，组织上下文仅属于本次请求。
function rateLimit(openid, limit = 30, windowMs = 10000) {
    if (!openid) return true
    const now = Date.now()
    const arr = (_rateMap.get(openid) || []).filter(t => now - t < windowMs)
    if (arr.length >= limit) return false
    arr.push(now)
    _rateMap.set(openid, arr)
    if (_rateMap.size > 10000) {
        for (const [k, v] of _rateMap) {
            if (v.every(t => now - t >= windowMs)) _rateMap.delete(k)
        }
    }
    return true
}

async function dispatch(event, context, trustedTimer = false) {
    const { OPENID } = cloud.getWXContext()
    const { action } = event
    // 从前端传入 groupId，回退默认值，实现多组织切换
    // GROUP_ID 来自本次调用的闭包，不使用可变全局变量。

    if (action !== 'restoreBackup' && !rateLimit(OPENID)) return { code: 429, msg: '请求过于频繁，请稍后再试' }

    const handlers = {
        backupAuto,
        backupManual,
        restoreBackup,
        getBackupList,
        getBackupCapabilities,
        deleteBackup,
        exportAllOrders,
        clearAllData,
    }

    const fn = handlers[action]
    if (!fn) return { code: 400, msg: `unknown action: ${action}` }
    try {
        if (!Object.prototype.hasOwnProperty.call(handlers, action)) return { code: 400, msg: 'unknown action' }
        if (!OPENID && !trustedTimer) return { code: 401, msg: '请先登录' }
        if (trustedTimer && action === 'backupAuto') return { code: 0, data: await doBackup('auto', '') }
        return await fn(event, OPENID)
    } catch (e) {
        console.error(`[lunch_backup] ${action} error:`, e)
        return { code: typeof e.code === 'number' ? e.code : 500, msg: e.message || 'internal error' }
    }
}

async function backupAuto(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }
    return { code: 0, data: await doBackup('auto', '') }
}

async function backupManual(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { remark } = event
    const result = await doBackup('manual', remark || '')
    return { code: 0, data: result }
}

async function restoreBackup(event, openid) {
    return require('./restore').restore({
        db, cloud, groupId: GROUP_ID, openid, event,
        loadBackup, doBackup, getMemberByOpenid,
    })
}

async function getBackupCapabilities(event, openid) {
    const member = await requestGate.maintenanceMember(db, GROUP_ID, openid) || await getMemberByOpenid(openid)
    if (!checkRole(member, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }
    return { code: 0, data: { restoreProtocol: 2 } }
}

async function getBackupList(event, openid) {
    const group = await requestGate.groupDoc(db, GROUP_ID)
    if (group.restoreJob && [group.restoreJob.actorOpenid, group.creatorId].includes(openid)) {
        const result = await db.collection(COL.BACKUPS).where({ groupId: GROUP_ID, _id: group.restoreJob.backupId }).field({ data: false }).get()
        return { code: 0, data: result.data, restoring: true }
    }
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { data } = await db.collection(COL.BACKUPS)
        .where({ groupId: GROUP_ID })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .field({ data: false })
        .get()

    return { code: 0, data }
}

async function deleteBackup(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { backupId } = event
    if (!backupId) return { code: 400, msg: 'missing backupId' }

    const { data: bk } = await db.collection(COL.BACKUPS)
        .where({ _id: backupId, groupId: GROUP_ID }).limit(1).get()
    if (!bk || bk.length === 0) return { code: 404, msg: 'backup not found' }
    await db.collection(COL.BACKUPS).doc(backupId).remove()
    if (bk[0].fileID) await cloud.deleteFile({ fileList: [bk[0].fileID] })
    return { code: 0 }
}

async function exportAllOrders(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const allOrders = await fetchAll(db.collection(COL.ORDERS), { groupId: GROUP_ID })

    const statusMap = { pending: '待确认', confirmed: '已确认', cancelled: '已取消' }
    const header = '日期,菜品,姓名,金额,备注,状态,供应商'
    const rows = allOrders.map(o =>
        buildCsvLine([o.date, o.menuName, o.memberName, o.price, o.note || '', statusMap[o.status] || o.status, o.supplier || ''])
    )
    const csv = '\uFEFF' + header + '\r\n' + rows.join('\r\n')

    const ts = formatTimestamp(new Date())
    const cloudPath = 'lunch/exports/' + GROUP_ID + '/' + require('crypto').randomBytes(16).toString('hex') + '.csv'
    const uploadResult = await cloud.uploadFile({
        cloudPath,
        fileContent: Buffer.from(csv, 'utf-8'),
    })

    return { code: 0, data: { fileID: uploadResult.fileID, count: allOrders.length, fileName: `全量订单_${ts}.csv` } }
}

async function clearAllData(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.CREATOR)) return { code: 403, msg: 'creator only' }

    await db.collection(COL.ORDERS).where({ groupId: GROUP_ID }).remove()
    await db.collection(COL.MENU).where({ groupId: GROUP_ID }).remove()
    await db.collection(COL.MEMBERS).where({ groupId: GROUP_ID, role: _.neq('creator') }).remove()
    // 清理统计与审计数据，避免残留脏数据
    try { await db.collection(COL.MONTHLY_STATS).where({ groupId: GROUP_ID }).remove() } catch (e) { console.warn('clear stats error:', e.message) }
    try { await db.collection(COL.USER_STATS).where({ groupId: GROUP_ID }).remove() } catch (e) { console.warn('clear user stats error:', e.message) }
    try { await db.collection(COL.AUDIT_LOGS).where({ groupId: GROUP_ID }).remove() } catch (e) { console.warn('clear audit error:', e.message) }
    await db.collection('lunch_order_keys').where({ groupId: GROUP_ID }).remove()

    return { code: 0 }
}

return dispatch
}

async function runForGroup(event, context, trustedTimer = false) {
    const groupId = event.groupId || 'lunch_hp'
    if (!requestGate.validGroupId(groupId)) return { code: 400, msg: 'invalid groupId' }
    let release
    try {
        if (!trustedTimer && !cloud.getWXContext().OPENID) return { code: 401, msg: '请先登录' }
        if (!['restoreBackup', 'getBackupList', 'getBackupCapabilities'].includes(event.action)) release = await requestGate.enter(db, groupId)
        return await createRequestHandlers(groupId)(event, context, trustedTimer)
    } catch (e) {
        return { code: typeof e.code === 'number' ? e.code : 500, msg: e.message }
    } finally {
        if (release) await release()
    }
}

exports.main = async (event = {}, context) => {
    // 定时触发不携带微信身份；客户端伪造 Timer 字段不能绕过身份检查。
    if (cloud.getWXContext().SOURCE === 'wx_trigger' && event.Type === 'Timer' && event.TriggerName === 'weeklyBackup') {
        const results = []
        let skip = 0
        while (true) {
            const { data } = await db.collection('lunch_groups').skip(skip).limit(100).get()
            for (const group of data) {
                results.push({ groupId: group._id, result: await runForGroup({ action: 'backupAuto', groupId: group._id }, context, true) })
            }
            if (data.length < 100) break
            skip += 100
        }
        return { code: results.some(item => item.result.code !== 0) ? 500 : 0, data: results }
    }
    return runForGroup(event, context)
}
