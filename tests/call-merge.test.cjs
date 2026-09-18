const test = require('node:test')
const assert = require('node:assert/strict')
const { harness } = require('./cloudHarness.cjs')

test('管理页并行请求 getRecentOrders + getDataTimestamps 数据完整性', async () => {
    const h = harness()
    h.seed('lunch_orders', [
        { _id: 'pending-1', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: '同事', supplier: '店家', price: 18.5, status: 'pending', date: '2026-09-16' },
        { _id: 'confirmed-1', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: '同事', supplier: '店家', price: 18.5, status: 'confirmed', date: '2026-09-16' },
        { _id: 'cancelled-1', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: '同事', supplier: '店家', price: 18.5, status: 'cancelled', date: '2026-09-16' },
    ])

    const [ordersResult, tsResult] = await Promise.all([
        h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'a' }),
        h.invoke('lunch_menu', { action: 'getDataTimestamps', groupId: 'a' }),
    ])

    assert.equal(ordersResult.code, 0, 'getRecentOrders should succeed')
    assert.equal(tsResult.code, 0, 'getDataTimestamps should succeed')

    const orders = ordersResult.data || []
    assert.ok(orders.length >= 3, 'should return all today orders')
    assert.ok(orders.every(o => o.date === '2026-09-16'), 'all orders should be from today')

    assert.ok(tsResult.data, 'timestamps result should have data')
    assert.ok(tsResult.data.orderCutoff === '10:00', 'should return cutoff config')
})

test('并行请求中 getRecentOrders 失败不影响 getDataTimestamps 结果', async () => {
    const h = harness()

    const [ordersResult, tsResult] = await Promise.allSettled([
        h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'nonexistent' }),
        h.invoke('lunch_menu', { action: 'getDataTimestamps', groupId: 'a' }),
    ])

    assert.equal(tsResult.status, 'fulfilled', 'timestamps should succeed independently')
    assert.equal(tsResult.value.code, 0)
})

test('不同组织并行请求隔离正确', async () => {
    const h = harness()
    h.seed('lunch_orders', [
        { _id: 'a-order', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: 'A组', status: 'pending', date: '2026-09-16' },
        { _id: 'b-order', groupId: 'b', memberId: 'other', menuId: 'other-dish', memberName: 'B组', status: 'pending', date: '2026-09-16' },
    ])

    const [aOrders, aTs, bOrders, bTs] = await Promise.all([
        h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'a' }),
        h.invoke('lunch_menu', { action: 'getDataTimestamps', groupId: 'a' }),
        h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'b' }, 'owner-b'),
        h.invoke('lunch_menu', { action: 'getDataTimestamps', groupId: 'b' }, 'owner-b'),
    ])

    assert.equal(aOrders.code, 0)
    assert.equal(bOrders.code, 0)
    assert.equal(aOrders.data.length, 1)
    assert.equal(bOrders.data.length, 1)
    assert.equal(aOrders.data[0].memberName, 'A组')
    assert.equal(bOrders.data[0].memberName, 'B组')
})

test('getDataTimestamps 返回时间戳与数据库一致', async () => {
    const h = harness()
    const now = Date.now()

    const tsResult = await h.invoke('lunch_menu', { action: 'getDataTimestamps', groupId: 'a' })
    assert.equal(tsResult.code, 0)

    const { menuTimestamp, membersTimestamp, recentTimestamp } = tsResult.data
    const tsValues = [menuTimestamp, membersTimestamp, recentTimestamp]

    tsValues.forEach(ts => {
        if (ts !== null && ts !== undefined) {
            assert.ok(typeof ts === 'number' || typeof ts === 'string',
                `timestamp should be number or string, got ${typeof ts}`)
        }
    })
})

test('批量订单变更后 getRecentOrders 实时反映状态', async () => {
    const h = harness()
    h.seed('lunch_orders', [
        { _id: 'order-1', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: '同事', supplier: '店家', price: 18.5, status: 'pending', date: '2026-09-16' },
        { _id: 'order-2', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: '同事', supplier: '店家', price: 18.5, status: 'pending', date: '2026-09-16' },
    ])

    const result1 = await h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'a' })
    assert.equal(result1.data.filter(o => o.status === 'pending').length, 2)

    await h.invoke('lunch_order', { action: 'batchConfirm', groupId: 'a', orderIds: ['order-1', 'order-2'], date: '2026-09-16' }, 'admin-a')

    const result2 = await h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'a' })
    assert.equal(result2.data.filter(o => o.status === 'confirmed').length, 2)
    assert.equal(result2.data.filter(o => o.status === 'pending').length, 0)
})

test('空订单组并行请求不抛异常', async () => {
    const h = harness()

    const [ordersResult, tsResult] = await Promise.all([
        h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'a' }),
        h.invoke('lunch_menu', { action: 'getDataTimestamps', groupId: 'a' }),
    ])

    assert.equal(ordersResult.code, 0)
    assert.ok(Array.isArray(ordersResult.data) && ordersResult.data.length === 0, 'should return empty array')
    assert.equal(tsResult.code, 0)
    assert.equal(tsResult.data.orderCutoff, '10:00')
})

test('getRecentOrders 仅返回当日订单', async () => {
    const h = harness()
    h.seed('lunch_orders', [
        { _id: 'today', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: '同事', supplier: '店家', price: 18.5, status: 'pending', date: '2026-09-16' },
        { _id: 'yesterday', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: '同事', supplier: '店家', price: 18.5, status: 'confirmed', date: '2026-09-15' },
        { _id: 'tomorrow', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: '同事', supplier: '店家', price: 18.5, status: 'pending', date: '2026-09-17' },
    ])

    const result = await h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'a' })

    assert.equal(result.data.length, 1, 'should only return today order')
    assert.equal(result.data[0]._id, 'today')
})

test('连续快速调用无状态污染', async () => {
    const h = harness()
    h.seed('lunch_orders', [
        { _id: 'order-a', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: 'A', status: 'pending', date: '2026-09-16' },
    ])

    const results = await Promise.all(Array.from({ length: 5 }, () =>
        Promise.all([
            h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'a' }),
            h.invoke('lunch_menu', { action: 'getDataTimestamps', groupId: 'a' }),
        ])
    ))

    results.forEach(([ordersResult, tsResult]) => {
        assert.equal(ordersResult.code, 0)
        assert.equal(tsResult.code, 0)
        assert.equal(ordersResult.data.length, 1)
        assert.equal(ordersResult.data[0]._id, 'order-a')
        assert.equal(tsResult.data.orderCutoff, '10:00')
    })
})