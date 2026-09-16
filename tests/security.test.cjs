const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { harness } = require('./cloudHarness.cjs')
const { buildPlan, validateSnapshot } = require('../wxcloud/functions/lunch_backup/restore')
const order = { action: 'submitOrder', groupId: 'a', date: '2026-09-16', memberId: 'member', menuId: 'dish', price: -100, memberName: '伪造', menuName: '伪造', supplier: '伪造' }

test('独立部署的公共安全模块保持一致', () => {
    const source = name => fs.readFileSync(path.join(__dirname, '../wxcloud/functions', name, 'requestGate.js'), 'utf8')
    assert.equal(source('lunch_order'), source('lunch_menu'))
    assert.equal(source('lunch_order'), source('lunch_backup'))
    assert.equal(fs.readFileSync(path.join(__dirname, '../wxcloud/functions/lunch_order/importMembers.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, '../wxcloud/functions/lunch_menu/importMembers.js'), 'utf8'))
})

test('其他组织的订单、菜品、成员不可修改或授权', async () => {
    const h = harness()
    h.seed('lunch_orders', [{ _id: 'foreign-order', groupId: 'b', status: 'pending', date: '2026-09-16' }])
    for (const action of ['cancelOrder', 'updateOrder', 'rejectCancelRequest']) {
        const result = await h.invoke('lunch_order', { action, groupId: 'a', orderId: 'foreign-order', note: 'tamper' })
        assert.equal(result.code, 404, action)
    }
    for (const action of ['updateMenuItem', 'deleteMenuItem', 'toggleVisible']) {
        assert.equal((await h.invoke('lunch_menu', { action, groupId: 'a', menuId: 'other-dish', price: 0 })).code, 404)
    }
    for (const action of ['updateMemberName', 'deleteMember', 'setAdmin']) {
        assert.equal((await h.invoke('lunch_menu', { action, groupId: 'a', memberId: 'other', name: 'tamper', isAdmin: true }, 'owner-a')).code, 404)
    }
    assert.equal(h.rows('lunch_members').find(m => m._id === 'other').name, '其他组织')
    assert.equal(h.rows('lunch_orders')[0].status, 'pending')
})

test('未入组读取、空身份和原型方法调用被拒绝', async () => {
    const h = harness()
    assert.equal((await h.invoke('lunch_menu', { action: 'getMembers', groupId: 'a' }, 'outsider')).code, 403)
    assert.equal((await h.invoke('lunch_order', { action: 'getRecentMembers', groupId: 'a' }, 'outsider')).code, 403)
    assert.equal((await h.invoke('lunch_menu', { action: 'getMembers', groupId: 'a' }, '')).code, 401)
    assert.equal((await h.invoke('lunch_menu', { action: 'toString', groupId: 'a' })).code, 400)
})

test('下单采用数据库价格及资料，普通成员可以代点', async () => {
    const h = harness()
    const result = await h.invoke('lunch_order', { ...order, memberId: 'virtual' }, 'member-a')
    assert.equal(result.code, 0, result.msg)
    const saved = h.rows('lunch_orders')[0]
    assert.equal(saved.price, 18.5)
    assert.equal(saved.menuName, '午餐')
    assert.equal(saved.supplier, '店家')
    assert.equal(saved.memberName, '虚拟同事')
})

test('拒绝跨组、下架、无效价格、非当天和非成员下单', async () => {
    for (const changes of [{ menuId: 'other-dish' }, { memberId: 'other' }, { date: '2026-09-15' }]) {
        const h = harness()
        assert.notEqual((await h.invoke('lunch_order', { ...order, ...changes }, 'member-a')).code, 0)
        assert.equal(h.rows('lunch_orders').length, 0)
    }
    for (const changes of [{ visible: false }, { price: -1 }, { price: NaN }, { price: Infinity }]) {
        const h = harness()
        h.seed('lunch_menu', [{ ...h.rows('lunch_menu')[0], ...changes }])
        assert.notEqual((await h.invoke('lunch_order', order, 'member-a')).code, 0)
    }
    const h = harness()
    assert.equal((await h.invoke('lunch_order', order, 'outsider')).code, 403)
})

test('北京时间截止点拒绝普通成员，管理员或关闭截止仍可下单', async () => {
    for (const who of ['member-a', 'admin-a', 'owner-a']) {
        const h = harness()
        h.setNow('2026-09-16T02:00:00Z')
        assert.equal((await h.invoke('lunch_order', order, who)).code, who === 'member-a' ? 403 : 0)
    }
    const h = harness()
    h.setNow('2026-09-16T03:00:00Z')
    h.seed('lunch_groups', [{ _id: 'a', creatorId: 'owner-a', cutoffDisabled: true }])
    assert.equal((await h.invoke('lunch_order', order, 'member-a')).code, 0)
})

test('并发重复下单只产生一个订单', async () => {
    const h = harness()
    const results = await Promise.all([
        h.invoke('lunch_order', order, 'member-a'), h.invoke('lunch_order', order, 'member-a'),
    ])
    assert.equal(results.filter(r => r.code === 0).length, 1, JSON.stringify(results))
    assert.equal(results.filter(r => r.code === 409).length, 1)
    assert.equal(h.rows('lunch_orders').length, 1)
})

test('覆盖导入保留所有微信账号及角色，跳过同名账号并忽略新成员角色', async () => {
    const h = harness()
    const result = await h.invoke('lunch_menu', { action: 'importMembers', groupId: 'a', mode: 'rewrite', members: [
        { name: '管理员', role: 'member' }, { name: '创建者', role: 'member' }, { name: '新同事', role: 'creator', isVirtual: false },
    ] })
    assert.equal(result.code, 0)
    const members = h.rows('lunch_members')
    assert.equal(members.find(m => m._id === 'owner').role, 'creator')
    assert.equal(members.find(m => m._id === 'admin').role, 'admin')
    assert.ok(members.find(m => m._id === 'member'))
    assert.equal(members.find(m => m.name === '新同事').role, 'member')
    assert.equal(members.find(m => m.name === '新同事').isVirtual, true)
    assert.equal(result.data.skipped, 2)
    assert.equal((await h.invoke('lunch_menu', { action: 'importMembers', groupId: 'a', members: [{ name: 'x' }] }, 'member-a')).code, 403)
})

test('自助关联不继承虚拟成员的历史管理员角色且不能跨组', async () => {
    const h = harness()
    h.seed('lunch_members', [{ _id: 'virtual', groupId: 'a', openid: '', role: 'admin', name: '虚拟同事', isVirtual: true }])
    assert.equal((await h.invoke('lunch_menu', { action: 'linkVirtualMember', groupId: 'a', virtualMemberId: 'other' }, 'member-a')).code, 404)
    const result = await h.invoke('lunch_menu', { action: 'linkVirtualMember', groupId: 'a', virtualMemberId: 'virtual' }, 'member-a')
    assert.equal(result.code, 0, result.msg)
    assert.equal(h.rows('lunch_members').find(m => m._id === 'virtual').role, 'member')
})

test('备份按组织隔离，旧无归属备份不显示不可恢复，普通成员不能自动备份', async () => {
    const h = harness()
    h.seed('lunch_backups', [{ _id: 'legacy', type: 'manual', data: '{}' }, { _id: 'foreign', groupId: 'b', type: 'manual', data: '{}' }])
    assert.equal((await h.invoke('lunch_backup', { action: 'backupAuto', groupId: 'a' }, 'member-a')).code, 403)
    const created = await h.invoke('lunch_backup', { action: 'backupManual', groupId: 'a' })
    assert.equal(created.code, 0, created.msg)
    assert.equal(created.data.groupId, 'a')
    assert.ok(created.data.fileID)
    const list = await h.invoke('lunch_backup', { action: 'getBackupList', groupId: 'a' })
    assert.equal(list.data.length, 1)
    assert.equal((await h.invoke('lunch_backup', { action: 'restoreBackup', groupId: 'a', backupId: 'legacy' })).code, 404)
    assert.ok(!h.rows('lunch_groups').find(g => g._id === 'a').restoreJob)
})

test('恢复保留ID和关联、不提权，失败回滚当前批次并可继续，其他组织不受影响', async () => {
    const h = harness()
    h.seed('lunch_orders', [{ _id: 'saved-order', groupId: 'a', memberId: 'member', menuId: 'dish', price: 18.5, status: 'confirmed', date: '2026-09-16' }])
    const backup = await h.invoke('lunch_backup', { action: 'backupManual', groupId: 'a' })
    h.seed('lunch_members', [{ ...h.rows('lunch_members').find(m => m._id === 'admin'), role: 'member' }])
    h.seed('lunch_menu', [{ ...h.rows('lunch_menu')[0], price: 999 }])
    h.seed('lunch_orders', [{ _id: 'new-order', groupId: 'a', memberId: 'member', menuId: 'dish', price: 999, date: '2026-09-16' }])
    const request = { action: 'restoreBackup', groupId: 'a', backupId: backup.data._id }
    const started = await h.invoke('lunch_backup', request, 'owner-a')
    assert.equal(started.code, 0, started.msg)
    assert.equal(started.data.done, false)
    assert.equal((await h.invoke('lunch_order', order, 'member-a')).code, 423)
    assert.equal((await h.invoke('lunch_menu', { action: 'updateMenuItem', groupId: 'a', menuId: 'dish', price: 1 })).code, 423)
    assert.equal((await h.invoke('lunch_menu', { action: 'getMenuList', groupId: 'b' }, 'owner-b')).code, 0)
    h.db.failWrite = (name, id) => name === 'lunch_members' && id === 'member'
    assert.equal((await h.invoke('lunch_backup', { ...request, jobId: started.data.jobId }, 'owner-a')).code, 500)
    assert.equal(h.rows('lunch_menu').find(m => m._id === 'dish').price, 999)
    assert.ok(h.rows('lunch_groups').find(g => g._id === 'a').restoreJob)
    h.db.failWrite = null
    let result
    for (let i = 0; i < 20; i++) {
        result = await h.invoke('lunch_backup', { ...request, jobId: started.data.jobId }, 'owner-a')
        assert.equal(result.code, 0, result.msg)
        if (result.data.done) break
    }
    assert.equal(result.data.done, true)
    assert.equal(h.rows('lunch_menu').find(m => m._id === 'dish').price, 18.5)
    assert.equal(h.rows('lunch_orders').length, 1)
    assert.equal(h.rows('lunch_orders')[0].memberId, 'member')
    assert.equal(h.rows('lunch_members').find(m => m._id === 'admin').role, 'member')
    assert.ok(!h.rows('lunch_groups').find(g => g._id === 'a').restoreJob)
    const replay = await h.invoke('lunch_backup', { ...request, jobId: started.data.jobId }, 'owner-a')
    assert.equal(replay.data.done, true)
})

test('备份内容混入其他组织数据在写入前拒绝', () => {
    assert.throws(() => validateSnapshot({ orders: [], menu: [{ _id: 'x', groupId: 'b' }], members: [] }, 'a'))
    const snapshot = { orders: [], menu: [], members: [{ _id: 'm', groupId: 'a', openid: 'm', role: 'creator' }] }
    const before = { orders: [], menu: [], members: [{ _id: 'm', groupId: 'a', openid: 'm', role: 'member' }] }
    assert.equal(buildPlan(snapshot, before, 'a', 'owner-a')[0].data.role, 'member')
})

