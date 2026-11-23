const test = require('node:test')
const assert = require('node:assert/strict')
const { harness } = require('./cloudHarness.cjs')

function groupA(dataTimestamp) {
    return { _id: 'a', creatorId: 'owner-a', orderCutoff: '10:00', dataTimestamp }
}

function order(id, memberId, memberName, date, status, price = 10) {
    return {
        _id: id,
        groupId: 'a',
        date,
        memberId,
        memberName,
        menuId: 'dish',
        menuName: '午餐',
        supplier: '店家',
        price,
        status,
        createdAt: new Date(`${date}T01:00:00Z`),
        updatedAt: new Date(`${date}T01:00:00Z`),
    }
}

function mergeAdmin(h, target = 'member') {
    return h.invoke('lunch_menu', {
        action: 'adminLinkVirtualMember',
        groupId: 'a',
        virtualMemberId: 'virtual',
        targetMemberId: target,
    }, 'admin-a')
}

test('A 有订单、B 无订单：保留 A 的 memberId 和姓名，绑定 B 的 openid', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_orders', [order('a1', 'virtual', '虚拟同事', '2026-09-10', 'confirmed', 10)])
    h.seed('lunch_monthly_stats', [{
        _id: 'a_2026_9', groupId: 'a', year: 2026, month: 9,
        totalAmount: 10, orderCount: 1,
        orderByMember: [{ memberId: 'virtual', memberName: '虚拟同事', amount: 10, count: 1 }],
        orderBySupplier: [{ supplier: '店家', amount: 10, count: 1 }],
        orderByMemberMap: { '虚拟同事': 10 }, orderBySupplierMap: { '店家': 10 }, deleted: false,
    }])

    const result = await mergeAdmin(h)
    assert.equal(result.code, 0, result.msg)

    const members = h.rows('lunch_members')
    const virtual = members.find(m => m._id === 'virtual')
    assert.equal(virtual.isVirtual, false)
    assert.equal(virtual.openid, 'member-a')
    assert.equal(virtual.name, '虚拟同事')
    assert.equal(virtual.mergeFromMemberId, undefined)
    assert.ok(!members.some(m => m._id === 'member'))

    const orders = h.rows('lunch_orders')
    assert.equal(orders.length, 1)
    assert.equal(orders[0].memberId, 'virtual')
    assert.equal(orders[0].memberName, '虚拟同事')
    assert.equal(h.rows('lunch_monthly_stats').find(s => s._id === 'a_2026_9').orderByMemberMap['虚拟同事'], 10)
})

test('A/B 都有订单：全部状态迁移，个人统计合并，月度统计只保留合并后身份', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_orders', [
        order('a-confirmed', 'virtual', '虚拟同事', '2026-09-10', 'confirmed', 10),
        order('a-pending', 'virtual', '虚拟同事', '2026-09-11', 'pending', 5),
        order('a-cancelled', 'virtual', '虚拟同事', '2026-09-12', 'cancelled', 1),
        order('b-confirmed', 'member', '同事', '2026-09-10', 'confirmed', 20),
        order('b-pending', 'member', '同事', '2026-09-11', 'pending', 6),
        order('b-cancelled', 'member', '同事', '2026-09-12', 'cancelled', 2),
    ])
    h.seed('lunch_user_menu_stats', [
        { _id: 'a_virtual_dish', groupId: 'a', memberId: 'virtual', menuId: 'dish', count: 1, lastAt: new Date('2026-09-10T01:00:00Z') },
        { _id: 'a_member_dish', groupId: 'a', memberId: 'member', menuId: 'dish', count: 2, lastAt: new Date('2026-09-11T01:00:00Z') },
    ])

    const result = await mergeAdmin(h)
    assert.equal(result.code, 0, result.msg)

    const orders = h.rows('lunch_orders')
    assert.equal(orders.length, 6)
    for (const o of orders) {
        assert.equal(o.memberId, 'virtual')
        assert.equal(o.memberName, '虚拟同事')
    }

    const stats = h.rows('lunch_user_menu_stats')
    const mergedStat = stats.find(s => s._id === 'a_virtual_dish')
    assert.equal(mergedStat.count, 3)
    assert.equal(new Date(mergedStat.lastAt).toISOString(), '2026-09-11T01:00:00.000Z')
    assert.ok(!stats.some(s => s._id === 'a_member_dish'))

    const month = h.rows('lunch_monthly_stats').find(s => s._id === 'a_2026_9')
    assert.equal(month.totalAmount, 30)
    assert.equal(month.orderCount, 2)
    assert.deepEqual(Object.keys(month.orderByMemberMap), ['虚拟同事'])
    assert.equal(month.orderByMemberMap['虚拟同事'], 30)
})

test('virtual 历史订单姓名归一，dataTimestamp=0 时全量重建', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(0)])
    h.seed('lunch_orders', [
        order('a-old-name', 'virtual', '旧名字', '2026-08-10', 'confirmed', 10),
        order('b-confirmed', 'member', '同事', '2026-09-10', 'confirmed', 20),
    ])

    const result = await mergeAdmin(h)
    assert.equal(result.code, 0, result.msg)

    const orders = h.rows('lunch_orders')
    assert.ok(orders.every(o => o.memberId === 'virtual' || o.memberId === 'member'))
    assert.equal(orders.find(o => o._id === 'a-old-name').memberName, '虚拟同事')

    const august = h.rows('lunch_monthly_stats').find(s => s._id === 'a_2026_8')
    const september = h.rows('lunch_monthly_stats').find(s => s._id === 'a_2026_9')
    assert.equal(august.orderByMemberMap['虚拟同事'], 10)
    assert.equal(september.orderByMemberMap['虚拟同事'], 20)

    const group = h.rows('lunch_groups').find(g => g._id === 'a')
    assert.notEqual(group.dataTimestamp, 0)
    assert.ok(group.dataTimestamp instanceof Date)
})

test('认领后订单迁移失败，再次调用可完成', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_orders', [
        order('a1', 'virtual', '虚拟同事', '2026-09-10', 'confirmed', 10),
        order('b1', 'member', '同事', '2026-09-10', 'confirmed', 20),
    ])

    h.db.failOp = (name, op) => name === 'lunch_orders' && op === 'update'
    const first = await mergeAdmin(h)
    assert.equal(first.code, 500)
    let virtual = h.rows('lunch_members').find(m => m._id === 'virtual')
    assert.equal(virtual.mergeFromMemberId, 'member')
    assert.equal(virtual.isVirtual, true)
    assert.ok(!h.rows('lunch_members').some(m => m._id === 'member'))

    h.db.failOp = null
    const second = await mergeAdmin(h)
    assert.equal(second.code, 0, second.msg)
    virtual = h.rows('lunch_members').find(m => m._id === 'virtual')
    assert.equal(virtual.isVirtual, false)
    assert.equal(virtual.mergeFromMemberId, undefined)
    assert.equal(h.rows('lunch_orders').filter(o => o.memberId === 'virtual').length, 2)
    assert.equal(h.rows('lunch_monthly_stats').find(s => s._id === 'a_2026_9').totalAmount, 30)
})

test('个人统计迁移失败后重试不重复累计', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_orders', [order('b1', 'member', '同事', '2026-09-10', 'confirmed', 20)])
    h.seed('lunch_user_menu_stats', [
        { _id: 'a_member_dish', groupId: 'a', memberId: 'member', menuId: 'dish', count: 2, lastAt: new Date('2026-09-10T01:00:00Z') },
    ])

    h.db.failWrite = name => name === 'lunch_user_menu_stats'
    const first = await mergeAdmin(h)
    assert.equal(first.code, 500)
    assert.equal(h.rows('lunch_members').find(m => m._id === 'virtual').mergeFromMemberId, 'member')

    h.db.failWrite = null
    const second = await mergeAdmin(h)
    assert.equal(second.code, 0, second.msg)
    const stats = h.rows('lunch_user_menu_stats')
    assert.equal(stats.find(s => s._id === 'a_virtual_dish').count, 2)
    assert.ok(!stats.some(s => s._id === 'a_member_dish'))
})

test('月度统计重建失败后重试可完成', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_orders', [order('b1', 'member', '同事', '2026-09-10', 'confirmed', 20)])

    h.db.failWrite = name => name === 'lunch_monthly_stats'
    const first = await mergeAdmin(h)
    assert.equal(first.code, 500)
    const pending = h.rows('lunch_members').find(m => m._id === 'virtual')
    assert.equal(pending.mergeFromMemberId, 'member')
    assert.equal(pending.isVirtual, true)

    h.db.failWrite = null
    const second = await mergeAdmin(h)
    assert.equal(second.code, 0, second.msg)
    const month = h.rows('lunch_monthly_stats').find(s => s._id === 'a_2026_9')
    assert.equal(month.totalAmount, 20)
    assert.deepEqual(Object.keys(month.orderByMemberMap), ['虚拟同事'])
})

test('两个微信用户并发认领同一虚拟成员，只有一个成功', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_orders', [
        order('b1', 'member', '同事', '2026-09-10', 'confirmed', 10),
        order('c1', 'admin', '管理员', '2026-09-10', 'confirmed', 20),
    ])

    const [r1, r2] = await Promise.all([
        mergeAdmin(h, 'member'),
        mergeAdmin(h, 'admin'),
    ])
    const codes = [r1.code, r2.code].sort()
    assert.deepEqual(codes, [0, 409])

    const virtual = h.rows('lunch_members').find(m => m._id === 'virtual')
    const winner = r1.code === 0 ? 'member' : 'admin'
    const loser = winner === 'member' ? 'admin' : 'member'
    assert.equal(virtual.openid, winner === 'member' ? 'member-a' : 'admin-a')
    assert.ok(h.rows('lunch_members').some(m => m._id === loser))
    assert.ok(h.rows('lunch_orders').some(o => o.memberId === loser))
    assert.equal(h.rows('lunch_orders').filter(o => o.memberId === 'virtual').length, 1)
})

test('自助关联迁移双方订单与统计', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_orders', [
        order('a1', 'virtual', '虚拟同事', '2026-09-10', 'confirmed', 10),
        order('b1', 'member', '同事', '2026-09-10', 'confirmed', 20),
    ])
    h.seed('lunch_user_menu_stats', [
        { _id: 'a_virtual_dish', groupId: 'a', memberId: 'virtual', menuId: 'dish', count: 1, lastAt: new Date('2026-09-10T01:00:00Z') },
        { _id: 'a_member_dish', groupId: 'a', memberId: 'member', menuId: 'dish', count: 2, lastAt: new Date('2026-09-11T01:00:00Z') },
    ])

    const result = await h.invoke('lunch_menu', {
        action: 'linkVirtualMember',
        groupId: 'a',
        virtualMemberId: 'virtual',
    }, 'member-a')
    assert.equal(result.code, 0, result.msg)
    const virtual = h.rows('lunch_members').find(m => m._id === 'virtual')
    assert.equal(virtual.openid, 'member-a')
    assert.equal(virtual.role, 'member')
    assert.ok(!h.rows('lunch_members').some(m => m._id === 'member'))
    assert.equal(h.rows('lunch_orders').filter(o => o.memberId === 'virtual').length, 2)
    assert.equal(h.rows('lunch_user_menu_stats').find(s => s._id === 'a_virtual_dish').count, 3)
    assert.equal(h.rows('lunch_monthly_stats').find(s => s._id === 'a_2026_9').totalAmount, 30)
})

test('跨组拒绝，creator 不得作为管理员代关联 target', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_members', [{ _id: 'b-virtual', groupId: 'b', openid: '', role: 'member', name: 'B虚拟', isVirtual: true }])

    const crossVirtual = await h.invoke('lunch_menu', {
        action: 'adminLinkVirtualMember', groupId: 'a', virtualMemberId: 'b-virtual', targetMemberId: 'member',
    }, 'admin-a')
    assert.equal(crossVirtual.code, 404)

    const crossTarget = await h.invoke('lunch_menu', {
        action: 'adminLinkVirtualMember', groupId: 'a', virtualMemberId: 'virtual', targetMemberId: 'other',
    }, 'admin-a')
    assert.equal(crossTarget.code, 404)

    const creatorTarget = await mergeAdmin(h, 'owner')
    assert.equal(creatorTarget.code, 403)
    assert.ok(h.rows('lunch_members').some(m => m._id === 'owner'))
    const virtual = h.rows('lunch_members').find(m => m._id === 'virtual')
    assert.equal(virtual.isVirtual, true)
    assert.equal(virtual.openid, '')
    assert.equal(virtual.mergeFromMemberId, undefined)
})

test('重复执行不重复订单或统计', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_orders', [order('b1', 'member', '同事', '2026-09-10', 'confirmed', 20)])
    h.seed('lunch_user_menu_stats', [
        { _id: 'a_member_dish', groupId: 'a', memberId: 'member', menuId: 'dish', count: 2, lastAt: new Date('2026-09-10T01:00:00Z') },
    ])

    const first = await mergeAdmin(h)
    assert.equal(first.code, 0, first.msg)
    const orderCount = h.rows('lunch_orders').length
    const stats = h.rows('lunch_user_menu_stats')
    const statCount = stats.find(s => s._id === 'a_virtual_dish').count

    const second = await mergeAdmin(h)
    assert.equal(second.code, 409)
    assert.equal(h.rows('lunch_orders').length, orderCount)
    assert.equal(h.rows('lunch_user_menu_stats').find(s => s._id === 'a_virtual_dish').count, statCount)
})

test('进行中合账阻止 deleteMember/importMembers/rebuildOrderRelations', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_members', [{
        _id: 'virtual', groupId: 'a', openid: 'member-a', role: 'member',
        name: '虚拟同事', isVirtual: true, mergeFromMemberId: 'member',
    }])

    const del = await h.invoke('lunch_menu', { action: 'deleteMember', groupId: 'a', memberId: 'virtual' }, 'admin-a')
    assert.equal(del.code, 409)

    const imp = await h.invoke('lunch_menu', {
        action: 'importMembers', groupId: 'a', mode: 'append', members: [{ name: '新同事' }],
    }, 'admin-a')
    assert.equal(imp.code, 409)
    assert.ok(!h.rows('lunch_members').some(m => m.name === '新同事'))

    const rebuild = await h.invoke('lunch_order', { action: 'rebuildOrderRelations', groupId: 'a' }, 'admin-a')
    assert.equal(rebuild.code, 409)
    assert.equal(h.rows('lunch_members').find(m => m._id === 'virtual').mergeFromMemberId, 'member')
})

test('审计日志失败不改变已完成合账的成功结果', async () => {
    const h = harness()
    h.seed('lunch_groups', [groupA(new Date('2026-09-01T00:00:00Z'))])
    h.seed('lunch_orders', [order('b1', 'member', '同事', '2026-09-10', 'confirmed', 20)])

    h.db.failOp = (name, op) => name === 'lunch_audit_logs' && op === 'add'
    const result = await mergeAdmin(h)
    assert.equal(result.code, 0, result.msg)

    const virtual = h.rows('lunch_members').find(m => m._id === 'virtual')
    assert.equal(virtual.isVirtual, false)
    assert.equal(virtual.mergeFromMemberId, undefined)
    assert.equal(h.rows('lunch_monthly_stats').find(s => s._id === 'a_2026_9').totalAmount, 20)
})
