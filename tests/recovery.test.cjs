const test = require('node:test')
const assert = require('node:assert/strict')
const { harness } = require('./cloudHarness.cjs')
const gate = require('../wxcloud/functions/lunch_backup/requestGate')

test('同一云函数实例并发处理不同组织，资料不会串组', async () => {
    const h = harness()
    const [a, b] = await Promise.all([
        h.invoke('lunch_menu', { action: 'updateMenuItem', groupId: 'a', menuId: 'dish', name: 'A餐' }, 'owner-a'),
        h.invoke('lunch_menu', { action: 'updateMenuItem', groupId: 'b', menuId: 'other-dish', name: 'B餐' }, 'owner-b'),
    ])
    assert.equal(a.code, 0, a.msg)
    assert.equal(b.code, 0, b.msg)
    assert.equal(h.rows('lunch_menu').find(row => row._id === 'dish').name, 'A餐')
    assert.equal(h.rows('lunch_menu').find(row => row._id === 'other-dish').name, 'B餐')
    assert.equal(h.rows('lunch_audit_logs').find(row => row.targetId === 'dish').groupId, 'a')
    assert.equal(h.rows('lunch_audit_logs').find(row => row.targetId === 'other-dish').groupId, 'b')
})

test('混入其他组织订单的批量请求整体拒绝', async () => {
    const h = harness()
    h.seed('lunch_orders', [{ _id: 'local', groupId: 'a', status: 'pending' }, { _id: 'foreign', groupId: 'b', status: 'pending' }])
    for (const action of ['batchConfirm', 'batchCancelOrders']) {
        const result = await h.invoke('lunch_order', { action, groupId: 'a', orderIds: ['local', 'foreign'] })
        assert.equal(result.code, 404)
        assert.ok(h.rows('lunch_orders').every(row => row.status === 'pending'))
    }
})

test('导入文件必须处于当前组织的导入目录，不能指定其他组织备份文件', async () => {
    const h = harness()
    for (const fileID of ['cloud://test/lunch/imports/b/file.csv', 'cloud://test/lunch/backups/a/file.json', 'cloud://test/lunch/imports/a/../b/file.csv']) {
        assert.equal((await h.invoke('lunch_menu', { action: 'parseCsv', groupId: 'a', fileID })).code, 403)
    }
    h.files.set('cloud://test/lunch/imports/a/file.csv', Buffer.from('姓名,角色\n新成员,admin', 'utf8'))
    const result = await h.invoke('lunch_menu', { action: 'parseCsv', groupId: 'a', fileID: 'cloud://test/lunch/imports/a/file.csv' })
    assert.equal(result.code, 0, result.msg)
    assert.equal(result.data.rows[1][0], '新成员')
})

test('备份轮换不删除其他组织和历史无归属备份', async () => {
    const h = harness()
    const records = []
    for (const groupId of ['a', 'b']) {
        for (let i = 0; i < 11; i++) records.push({ _id: groupId + i, groupId, type: 'manual', createdAt: new Date(2020, 0, i + 1), data: '{}' })
    }
    records.push({ _id: 'legacy', type: 'manual', createdAt: new Date(2020, 0, 1), data: '{}' })
    h.seed('lunch_backups', records)
    assert.equal((await h.invoke('lunch_backup', { action: 'backupManual', groupId: 'a' })).code, 0)
    assert.equal(h.rows('lunch_backups').filter(row => row.groupId === 'a').length, 10)
    assert.equal(h.rows('lunch_backups').filter(row => row.groupId === 'b').length, 11)
    assert.ok(h.rows('lunch_backups').find(row => row._id === 'legacy'))
})

test('恢复等已有请求结束后再进入维护状态，租约释放不残留', async () => {
    const h = harness()
    const backup = await h.invoke('lunch_backup', { action: 'backupManual', groupId: 'a' })
    const release = await gate.enter(h.db, 'a')
    const request = { action: 'restoreBackup', restoreProtocol: 2, groupId: 'a', backupId: backup.data._id }
    assert.equal((await h.invoke('lunch_backup', request)).code, 409)
    assert.ok(!h.rows('lunch_groups').find(row => row._id === 'a').restoreJob)
    await release()
    assert.equal(Object.keys(h.rows('lunch_groups').find(row => row._id === 'a').activeRequests).length, 0)
    assert.equal((await h.invoke('lunch_backup', request)).code, 0)
})

test('备份校验失败不进入维护状态、不改变当前业务数据', async () => {
    const h = harness()
    const backup = await h.invoke('lunch_backup', { action: 'backupManual', groupId: 'a' })
    h.files.set(backup.data.fileID, Buffer.from('{}'))
    const result = await h.invoke('lunch_backup', { action: 'restoreBackup', restoreProtocol: 2, groupId: 'a', backupId: backup.data._id })
    assert.equal(result.code, 400)
    assert.ok(!h.rows('lunch_groups').find(row => row._id === 'a').restoreJob)
    assert.equal(h.rows('lunch_menu').find(row => row._id === 'dish').price, 18.5)
})

test('跨多个事务批次恢复：中断后继续、保留已有账号、新读取入口可进入恢复管理', async () => {
    const h = harness()
    h.seed('lunch_orders', Array.from({ length: 35 }, (_, i) => ({
        _id: 'saved' + i, groupId: 'a', memberId: 'member', menuId: 'dish', price: 18.5, date: '2026-09-16', status: 'confirmed',
    })))
    const backup = await h.invoke('lunch_backup', { action: 'backupManual', groupId: 'a' })
    h.seed('lunch_members', [{ _id: 'new-admin', groupId: 'a', openid: 'new-admin', role: 'admin', isVirtual: false, name: '后来加入' }])
    const req = { action: 'restoreBackup', restoreProtocol: 2, groupId: 'a', backupId: backup.data._id }
    const start = await h.invoke('lunch_backup', req)
    assert.equal(start.code, 0, start.msg)
    const session = await h.invoke('lunch_order', { action: 'getInitData', groupId: 'a' })
    assert.equal(session.code, 0, session.msg)
    assert.equal(session.data.role, 'admin')
    assert.equal((await h.invoke('lunch_menu', { action: 'joinGroup', groupId: 'a' })).code, 0)
    assert.equal((await h.invoke('lunch_backup', { action: 'getBackupList', groupId: 'a' })).data.length, 1)
    assert.equal((await h.invoke('lunch_backup', req, 'new-admin')).code, 403)
    const chunk = await h.invoke('lunch_backup', { ...req, jobId: start.data.jobId })
    assert.equal(chunk.data.done, false)
    assert.ok(chunk.data.processed > 0)
    // 模拟页面关闭后再次选择同一备份，不要求客户端保留 jobId。
    let result
    for (let i = 0; i < 10; i++) {
        result = await h.invoke('lunch_backup', req)
        assert.equal(result.code, 0, result.msg)
        if (result.data.done) break
    }
    assert.equal(result.data.done, true)
    assert.equal(h.rows('lunch_orders').length, 35)
    assert.equal(h.rows('lunch_members').find(row => row._id === 'new-admin').role, 'admin')
    assert.equal(h.rows('lunch_groups').find(row => row._id === 'a').dataTimestamp, 0)
})

test('分批覆盖导入不会删除后续批次要更新的原成员ID', async () => {
    const h = harness()
    const result = await h.invoke('lunch_menu', { action: 'importMembers', groupId: 'a', mode: 'rewrite',
        members: [{ name: '先导入的人' }], retainedNames: ['先导入的人', '虚拟同事'] })
    assert.equal(result.code, 0)
    assert.ok(h.rows('lunch_members').find(row => row._id === 'virtual'))
    const next = await h.invoke('lunch_menu', { action: 'importMembers', groupId: 'a', mode: 'rewrite_continue',
        members: [{ name: '虚拟同事', nickName: '已更新', role: 'creator' }] })
    assert.equal(next.code, 0)
    const virtual = h.rows('lunch_members').find(row => row._id === 'virtual')
    assert.equal(virtual.nickName, '已更新')
    assert.equal(virtual.role, 'member')
})

test('只将明确的文档不存在视为缺失，数据库故障不能被吞掉', async () => {
    assert.equal(await gate.optionalDocument({ get: async () => { throw new Error('document does not exist') } }), null)
    await assert.rejects(gate.optionalDocument({ get: async () => { throw new Error('network timeout') } }), /network timeout/)
})
