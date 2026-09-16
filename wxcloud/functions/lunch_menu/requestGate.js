// 三个云函数独立部署，保持此文件一致；tests/security.test.cjs 校验副本。
// 配置中的云函数超时为 20 秒，租约保留 120 秒，超时调用结束后才能开始恢复。
const { randomBytes } = require('crypto')
const LEASE_MS = 120000
function error(code, message) { return Object.assign(new Error(message), { code }) }
async function groupDoc(db, groupId) {
    const result = await db.collection('lunch_groups').doc(groupId).get()
    if (!result.data) throw error(404, '组织不存在')
    return result.data
}

async function maintenanceMember(db, groupId, openid) {
    const group = await groupDoc(db, groupId)
    if (!group.restoreJob || !openid || ![group.creatorId, group.restoreJob.actorOpenid].includes(openid)) return null
    const { data } = await db.collection('lunch_members').where({ groupId, openid }).limit(1).get()
    return data[0] || (group.restoreJob.actorMember && group.restoreJob.actorMember.openid === openid ? group.restoreJob.actorMember : null)
}

async function optionalDocument(doc) {
    try { return (await doc.get()).data || null }
    catch (e) {
        const message = String(e.errMsg || e.message || '')
        if (/document.*(?:not exist|not found)|文档不存在/i.test(message)) return null
        throw e
    }
}
async function enter(db, groupId) {
    const token = randomBytes(16).toString('hex')
    await db.runTransaction(async tx => {
        const doc = tx.collection('lunch_groups').doc(groupId)
        const result = await doc.get()
        const group = result.data
        if (!group) throw error(404, '组织不存在')
        if (group.restoreJob) throw error(423, '组织正在恢复备份，请稍后重试')
        const leases = {}
        for (const [id, until] of Object.entries(group.activeRequests || {})) {
            if (until > Date.now()) leases[id] = until
        }
        leases[token] = Date.now() + LEASE_MS
        await doc.update({ data: { activeRequests: db.command.set(leases) } })
    })
    return async () => {
        await db.runTransaction(async tx => {
            const doc = tx.collection('lunch_groups').doc(groupId)
            const result = await doc.get()
            if (!result.data) return
            const leases = { ...(result.data.activeRequests || {}) }
            delete leases[token]
            await doc.update({ data: { activeRequests: db.command.set(leases) } })
        }).catch(e => console.error('release request lease:', e.message))
    }
}
function validGroupId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}
function validImportFile(fileID, groupId) {
    if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) return false
    const parts = fileID.split('/').slice(3)
    return parts.length === 4 && parts[0] === 'lunch' && parts[1] === 'imports' && parts[2] === groupId &&
        /^[a-zA-Z0-9_-]+\.(csv|xlsx)$/i.test(parts[3])
}
module.exports = { enter, groupDoc, maintenanceMember, optionalDocument, validImportFile, error, validGroupId, LEASE_MS }
