const test = require('node:test')
const assert = require('node:assert/strict')
const { harness } = require('./cloudHarness.cjs')

test('batch confirm only transitions pending orders and derives rebuild months from the database', async () => {
    const h = harness()
    h.seed('lunch_orders', [
        { _id: 'pending', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: 'A', supplier: 'S', price: 10, status: 'pending', date: '2026-08-01' },
        { _id: 'cancelled', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: 'A', supplier: 'S', price: 10, status: 'cancelled', date: '2026-09-01' },
    ])
    const result = await h.invoke('lunch_order', {
        action: 'batchConfirm', groupId: 'a', orderIds: ['pending', 'cancelled'], date: '2099-12-01',
    }, 'admin-a')
    assert.equal(result.code, 0, result.msg)
    assert.deepEqual(Array.from(result.data, item => item.success), [true, false])
    assert.equal(h.rows('lunch_orders').find(o => o._id === 'pending').status, 'confirmed')
    assert.equal(h.rows('lunch_orders').find(o => o._id === 'cancelled').status, 'cancelled')
    assert.ok(h.rows('lunch_monthly_stats').some(s => s.year === 2026 && s.month === 8))
    assert.ok(!h.rows('lunch_monthly_stats').some(s => s.year === 2099))
})

test('append import deduplicates historical dates and duplicate rows inside the file', async () => {
    const h = harness()
    h.seed('lunch_orders', [
        { _id: 'existing', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: '同事', menuName: '午餐', price: 18.5, status: 'confirmed', date: '2026-01-01' },
        { _id: 'latest', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: '同事', menuName: '午餐', price: 18.5, status: 'confirmed', date: '2026-09-01' },
    ])
    const csv = 'date,menuName,memberName,price,supplier\n2026-01-01,午餐,同事,18.5,店家\n2026-02-01,午餐,同事,18.5,店家\n2026-02-01,午餐,同事,18.5,店家'
    const upload = await h.cloud.uploadFile({ cloudPath: 'lunch/imports/a/orders.csv', fileContent: Buffer.from(csv) })
    const result = await h.invoke('lunch_order', { action: 'importFromCsv', groupId: 'a', fileID: upload.fileID, mode: 'append' }, 'admin-a')
    assert.equal(result.code, 0, result.msg)
    assert.equal(result.data.count, 1)
    assert.equal(result.data.skipped, 2)
    assert.equal(h.rows('lunch_orders').filter(o => o.date === '2026-02-01').length, 1)
})

test('monthly stats sum duplicate display names and publish a deletion marker for an empty month', async () => {
    const h = harness()
    h.seed('lunch_orders', [
        { _id: 'one', groupId: 'a', memberId: 'member', memberName: '同名', menuId: 'dish', supplier: 'S', price: 10, status: 'confirmed', date: '2026-03-01' },
        { _id: 'two', groupId: 'a', memberId: 'virtual', memberName: '同名', menuId: 'dish', supplier: 'S', price: 12, status: 'confirmed', date: '2026-03-02' },
    ])
    let result = await h.invoke('lunch_order', { action: 'rebuildMonthStats', groupId: 'a', yearMonth: '2026-03' }, 'admin-a')
    assert.equal(result.code, 0, result.msg)
    let stat = h.rows('lunch_monthly_stats').find(s => s.year === 2026 && s.month === 3)
    assert.equal(stat.orderByMemberMap['同名'], 22)

    await h.db.collection('lunch_orders').where({ groupId: 'a' }).remove()
    result = await h.invoke('lunch_order', { action: 'rebuildMonthStats', groupId: 'a', yearMonth: '2026-03' }, 'admin-a')
    assert.equal(result.code, 0, result.msg)
    stat = h.rows('lunch_monthly_stats').find(s => s.year === 2026 && s.month === 3)
    assert.equal(stat.deleted, true)
    assert.equal(stat.orderCount, 0)
})

test('today order query is isolated from newer imported history', async () => {
    const h = harness()
    h.setNow('2026-09-16T01:00:00Z')
    h.seed('lunch_orders', [
        { _id: 'today', groupId: 'a', date: '2026-09-16', status: 'pending', createdAt: new Date('2026-09-16T01:00:00Z') },
        { _id: 'imported-history', groupId: 'a', date: '2020-01-01', status: 'confirmed', createdAt: new Date('2026-09-16T02:00:00Z') },
    ])
    const result = await h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'a' }, 'member-a')
    assert.equal(result.code, 0, result.msg)
    assert.deepEqual(Array.from(result.data, order => order._id), ['today'])
})

test('stats reads do not rebuild every historical month after a global timestamp change', async () => {
    const h = harness()
    h.seed('lunch_groups', [{ _id: 'a', creatorId: 'owner-a', dataTimestamp: new Date('2026-09-16T01:00:00Z') }])
    h.seed('lunch_monthly_stats', [{
        _id: 'a_2025_1', groupId: 'a', year: 2025, month: 1, totalAmount: 88,
        orderCount: 2, orderByMemberMap: { A: 88 }, orderBySupplierMap: {},
        updatedAt: new Date('2025-02-01T00:00:00Z'), sentinel: 'keep',
    }])
    const result = await h.invoke('lunch_order', { action: 'getMonthlyStats', groupId: 'a' }, 'member-a')
    assert.equal(result.code, 0, result.msg)
    assert.equal(result.data[0].totalAmount, 88)
    assert.equal(h.rows('lunch_monthly_stats')[0].sentinel, 'keep')
})

test('菜单与成员超过默认查询上限时不被截断', async () => {
    const h = harness()
    h.seed('lunch_groups', [{ _id: 'big', creatorId: 'owner-big' }])
    h.seed('lunch_members', [{
        _id: 'big-owner', groupId: 'big', openid: 'owner-big', role: 'creator', name: '创建者', isVirtual: false,
    }])
    h.seed('lunch_menu', Array.from({ length: 120 }, (_, i) => ({
        _id: 'big-dish-' + i, groupId: 'big', name: '菜品' + i, supplier: '店家',
        price: 10, visible: true, sortNo: i + 1,
    })))
    h.seed('lunch_members', Array.from({ length: 120 }, (_, i) => ({
        _id: 'big-member-' + i, groupId: 'big', openid: '', name: '成员' + i, role: 'member',
        isVirtual: true, joinedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    })))

    const menuRes = await h.invoke('lunch_menu', { action: 'getMenuList', groupId: 'big' }, 'owner-big')
    assert.equal(menuRes.code, 0, menuRes.msg)
    assert.equal(menuRes.data.length, 120)
    assert.deepEqual(Array.from(menuRes.data, item => item.sortNo), Array.from({ length: 120 }, (_, i) => i + 1))

    const memberRes = await h.invoke('lunch_menu', { action: 'getMembers', groupId: 'big' }, 'owner-big')
    assert.equal(memberRes.code, 0, memberRes.msg)
    assert.equal(memberRes.data.length, 121)
    assert.equal(memberRes.data[0]._id, 'big-owner')
    assert.equal(memberRes.data[memberRes.data.length - 1]._id, 'big-member-119')

    const recentMenu = await h.invoke('lunch_order', { action: 'getRecentMenu', groupId: 'big' }, 'owner-big')
    assert.equal(recentMenu.code, 0, recentMenu.msg)
    assert.equal(recentMenu.data.length, 120)

    const recentMembers = await h.invoke('lunch_order', { action: 'getRecentMembers', groupId: 'big' }, 'owner-big')
    assert.equal(recentMembers.code, 0, recentMembers.msg)
    assert.equal(recentMembers.data.length, 121)
})

test('历史订单计数与分页只包含今天之前的订单', async () => {
    const h = harness()
    h.seed('lunch_orders', [
        { _id: 'old-pending', groupId: 'a', memberId: 'member', date: '2026-09-14', status: 'pending', price: 10, createdAt: new Date('2026-09-14T01:00:00Z') },
        { _id: 'old-confirmed', groupId: 'a', memberId: 'member', date: '2026-09-15', status: 'confirmed', price: 12, createdAt: new Date('2026-09-15T01:00:00Z') },
        { _id: 'today', groupId: 'a', memberId: 'member', date: '2026-09-16', status: 'confirmed', price: 8, createdAt: new Date('2026-09-16T01:00:00Z') },
    ])
    const count = await h.invoke('lunch_order', { action: 'getHistoryOrderCount', groupId: 'a' }, 'admin-a')
    assert.equal(count.code, 0, count.msg)
    assert.equal(count.data.pendingCount, 1)
    assert.equal(count.data.confirmedCount, 1)

    const confirmed = await h.invoke('lunch_order', {
        action: 'getHistoryOrders', groupId: 'a', status: 'confirmed', page: 1, pageSize: 10,
    }, 'admin-a')
    assert.equal(confirmed.code, 0, confirmed.msg)
    assert.deepEqual(Array.from(confirmed.data.list, order => order._id), ['old-confirmed'])

    const pending = await h.invoke('lunch_order', {
        action: 'getHistoryOrders', groupId: 'a', status: 'pending', page: 1, pageSize: 10,
    }, 'admin-a')
    assert.equal(pending.code, 0, pending.msg)
    assert.deepEqual(Array.from(pending.data.list, order => order._id), ['old-pending'])
})
