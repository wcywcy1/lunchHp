// 成员导入只管理未绑定微信的普通成员；已有账号及权限始终保留。
async function importMembers(db, groupId, rows, mode, retainedNames = []) {
    if (!Array.isArray(rows) || !rows.length) return { code: 400, msg: '成员文件为空' }
    const incoming = rows.filter(row => row && typeof row.name === 'string' && row.name.trim()).map(row => ({
        name: row.name.trim(), nickName: typeof row.nickName === 'string' ? row.nickName.trim() : '',
    }))
    if (!incoming.length) return { code: 400, msg: '无有效成员' }
    const existing = []
    for (let skip = 0; ; skip += 100) {
        const { data } = await db.collection('lunch_members').where({ groupId }).orderBy('_id', 'asc').skip(skip).limit(100).get()
        existing.push(...data)
        if (data.length < 100) break
    }
    const skippedDetails = []
    const seen = new Set()
    let count = 0
    for (const row of incoming) {
        if (seen.has(row.name)) { skippedDetails.push({ name: row.name, reason: '文件内姓名重复' }); continue }
        seen.add(row.name)
        const matches = existing.filter(m => m.name === row.name || (!m.name && m.nickName === row.name))
        if (matches.some(m => m.openid || m.role === 'creator' || m.role === 'admin')) {
            skippedDetails.push({ name: row.name, reason: '保留已有账号及角色' })
            continue
        }
        if (matches.length > 1) {
            skippedDetails.push({ name: row.name, reason: '存在多个同名成员，请先核对' })
            continue
        }
        if (matches.length) {
            const member = matches[0]
            const result = await db.collection('lunch_members').where({
                groupId, _id: member._id, isVirtual: true, role: 'member',
                openid: member.openid === undefined ? db.command.exists(false) : member.openid,
            }).update({ data: { name: row.name, nickName: row.nickName } })
            if (!result.stats || result.stats.updated !== 1) {
                skippedDetails.push({ name: row.name, reason: '成员已变更，未覆盖' })
                continue
            }
        } else {
            await db.collection('lunch_members').add({ data: {
                groupId, name: row.name, nickName: row.nickName, avatar: '', openid: '',
                role: 'member', isVirtual: true, privacyAgreed: false, joinedAt: db.serverDate(),
            } })
        }
        count++
    }
    if (mode === 'rewrite') {
        const retained = new Set([...seen, ...(Array.isArray(retainedNames) ? retainedNames.filter(n => typeof n === 'string').map(n => n.trim()) : [])])
        for (const member of existing) {
            if (member.openid || member.role !== 'member' || !member.isVirtual || retained.has(member.name)) continue
            await db.collection('lunch_members').where({
                _id: member._id, groupId, isVirtual: true, role: 'member',
                openid: member.openid === undefined ? db.command.exists(false) : member.openid,
            }).remove()
        }
    }
    return { code: 0, data: { count, skipped: skippedDetails.length, skippedDetails } }
}
module.exports = { importMembers }
