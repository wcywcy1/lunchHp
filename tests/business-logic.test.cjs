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

test('月度统计导出按年份和月份筛选，并排除已删除月份', async () => {
    const h = harness()
    h.seed('lunch_monthly_stats', [
        { _id: 'a_2026_1', groupId: 'a', year: 2026, month: 1, totalAmount: 100, orderCount: 2, orderBySupplier: [{ supplier: 'S1', amount: 100, count: 2 }] },
        { _id: 'a_2026_2', groupId: 'a', year: 2026, month: 2, totalAmount: 50, orderCount: 1, orderBySupplier: [{ supplier: 'S1', amount: 50, count: 1 }] },
        { _id: 'a_2026_3', groupId: 'a', year: 2026, month: 3, totalAmount: 0, orderCount: 0, deleted: true, orderBySupplier: [] },
    ])
    const result = await h.invoke('lunch_order', {
        action: 'downloadMonthlyData', groupId: 'a', year: 2026, months: [2],
    }, 'admin-a')
    assert.equal(result.code, 0, result.msg)
    assert.equal(result.data.count, 1)
    const csv = h.files.get(result.data.fileID).toString('utf8')
    assert.ok(csv.includes('2026-02,50,1,50'))
    assert.ok(!csv.includes('2026-01'))
    assert.ok(!csv.includes('2026-03'))
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

test('joinGroupByName 新增成员后更新 membersTimestamp', async () => {
    const h = harness()
    h.seed('lunch_groups', [{ _id: 'named', name: '测试组织', creatorId: 'owner-named' }])
    assert.equal(h.rows('lunch_groups').find(g => g._id === 'named').membersTimestamp, undefined)

    const created = await h.invoke('lunch_menu', {
        action: 'joinGroupByName', groupId: 'named', groupName: '测试组织',
    }, 'new-member')
    assert.equal(created.code, 0, created.msg)
    assert.equal(created.data.alreadyJoined, false)
    assert.equal(created.data.member.groupId, 'named')
    assert.equal(created.data.member.role, 'member')
    assert.ok(h.rows('lunch_groups').find(g => g._id === 'named').membersTimestamp instanceof Date)
    assert.equal(h.rows('lunch_members').filter(m => m.groupId === 'named' && m.openid === 'new-member').length, 1)

    const again = await h.invoke('lunch_menu', {
        action: 'joinGroupByName', groupId: 'named', groupName: '测试组织',
    }, 'new-member')
    assert.equal(again.code, 0, again.msg)
    assert.equal(again.data.alreadyJoined, true)
    assert.equal(h.rows('lunch_members').filter(m => m.groupId === 'named' && m.openid === 'new-member').length, 1)
})

test('切组后按 groupId 顺序读取订单不会串组', async () => {
    const h = harness()
    h.setNow('2026-09-16T01:00:00Z')
    h.seed('lunch_orders', [
        { _id: 'a-order', groupId: 'a', memberId: 'member', menuId: 'dish', memberName: 'A组', status: 'pending', date: '2026-09-16', createdAt: new Date('2026-09-16T01:00:00Z') },
        { _id: 'b-order', groupId: 'b', memberId: 'other', menuId: 'other-dish', memberName: 'B组', status: 'pending', date: '2026-09-16', createdAt: new Date('2026-09-16T01:00:00Z') },
    ])

    const a1 = await h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'a' }, 'member-a')
    const b1 = await h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'b' }, 'owner-b')
    const a2 = await h.invoke('lunch_order', { action: 'getRecentOrders', groupId: 'a' }, 'member-a')

    assert.equal(a1.code, 0, a1.msg)
    assert.equal(b1.code, 0, b1.msg)
    assert.equal(a2.code, 0, a2.msg)
    assert.deepEqual(Array.from(a1.data, order => order._id), ['a-order'])
    assert.deepEqual(Array.from(b1.data, order => order._id), ['b-order'])
    assert.deepEqual(Array.from(a2.data, order => order._id), ['a-order'])
})

test('确认单与个人点餐统计超过默认查询上限时不被截断', async () => {
    const h = harness()
    h.seed('lunch_orders', Array.from({ length: 150 }, (_, i) => ({
        _id: 'confirmed-' + i, groupId: 'a', date: '2026-09-16', status: 'confirmed',
        memberId: 'member', memberName: '成员' + String(i).padStart(3, '0'),
        menuId: 'dish', menuName: '午餐', supplier: i % 2 === 0 ? 'A店' : 'B店', price: 10, note: '',
    })))
    h.seed('lunch_user_menu_stats', Array.from({ length: 120 }, (_, i) => ({
        _id: 'stat-' + i, groupId: 'a', memberId: 'member', menuId: 'dish-' + i, count: i + 1,
    })))

    const bySupplier = await h.invoke('lunch_order', { action: 'getConfirmedBySupplier', groupId: 'a', date: '2026-09-16' })
    assert.equal(bySupplier.code, 0, bySupplier.msg)
    const total = Object.values(bySupplier.data).reduce((sum, list) => sum + list.length, 0)
    assert.equal(total, 150)

    const download = await h.invoke('lunch_order', { action: 'downloadConfirmed', groupId: 'a', date: '2026-09-16' })
    assert.equal(download.code, 0, download.msg)
    const csv = h.files.get(download.data.fileID).toString('utf8')
    assert.ok(csv.includes('成员000'))
    assert.ok(csv.includes('成员149'))

    const stats = await h.invoke('lunch_order', { action: 'getUserMenuStats', groupId: 'a', memberId: 'member' }, 'member-a')
    assert.equal(stats.code, 0, stats.msg)
    assert.equal(Object.keys(stats.data.stats).length, 120)
})

test('批量确认超过 100 条时全部生效', async () => {
    const h = harness()
    const ids = Array.from({ length: 150 }, (_, i) => 'pending-' + i)
    h.seed('lunch_orders', ids.map(id => ({
        _id: id, groupId: 'a', date: '2026-09-16', status: 'pending',
        memberId: 'member', menuId: 'dish', price: 10, supplier: 'S',
    })))

    const result = await h.invoke('lunch_order', { action: 'batchConfirm', groupId: 'a', orderIds: ids })
    assert.equal(result.code, 0, result.msg)
    assert.equal(result.data.filter(item => item.success).length, 150)
    assert.equal(h.rows('lunch_orders').filter(row => row.status === 'confirmed').length, 150)
})

test('菜单价格拒绝负数、NaN、Infinity，导入也整体拒绝', async () => {
    const h = harness()
    for (const price of [-1, NaN, Infinity, null]) {
        assert.equal((await h.invoke('lunch_menu', { action: 'addMenuItem', groupId: 'a', supplier: 'S', name: 'X', price })).code, 400, String(price))
    }
    assert.equal((await h.invoke('lunch_menu', { action: 'updateMenuItem', groupId: 'a', menuId: 'dish', price: -5 })).code, 400)
    assert.equal((await h.invoke('lunch_menu', {
        action: 'importMenuItems', groupId: 'a', mode: 'append', items: [{ supplier: 'S', name: 'X', price: -1 }],
    })).code, 400)
    h.seed('lunch_orders', [{ _id: 'order-price', groupId: 'a', date: '2026-09-16', status: 'pending', memberId: 'member', menuId: 'dish', price: 10 }])
    assert.equal((await h.invoke('lunch_order', {
        action: 'updateOrder', groupId: 'a', orderId: 'order-price', price: -5,
    })).code, 400)
    assert.equal(h.rows('lunch_menu').find(row => row._id === 'dish').price, 18.5)
})

test('语音识别：空身份拒绝、配额原子递增、异常 fail-closed', async () => {
    const h = harness()
    assert.equal((await h.invoke('lunch_voice', { action: 'speechRecognize', audioBase64: 'YQ==' }, '')).code, 401)

    h.seed('lunch_voice_usage', [{ _id: 'member-a_2026-09-16', count: 29, date: '2026-09-16' }])
    const nearLimit = await h.invoke('lunch_voice', { action: 'speechRecognize', audioBase64: 'YQ==' }, 'member-a')
    assert.equal(nearLimit.success, false)
    assert.equal(h.rows('lunch_voice_usage').find(row => row._id === 'member-a_2026-09-16').count, 30)

    const exhausted = await h.invoke('lunch_voice', { action: 'speechRecognize', audioBase64: 'YQ==' }, 'member-a')
    assert.match(exhausted.message, /次数已用完/)

    const first = await h.invoke('lunch_voice', { action: 'speechRecognize', audioBase64: 'YQ==' }, 'new-user')
    assert.equal(first.success, false)
    assert.equal(h.rows('lunch_voice_usage').find(row => row._id === 'new-user_2026-09-16').count, 1)

    h.db.failOp = (name, op) => name === 'lunch_voice_usage' && op === 'update'
    const failed = await h.invoke('lunch_voice', { action: 'speechRecognize', audioBase64: 'YQ==' }, 'member-a')
    h.db.failOp = null
    assert.match(failed.message, /次数已用完/)
    assert.equal(h.rows('lunch_voice_usage').find(row => row._id === 'member-a_2026-09-16').count, 30)
})

test('FlashRecognition 超时后不再调用 SentenceRecognition', async () => {
    const h = harness()
    let sentenceCalls = 0
    h.setEnv({ TENCENT_SECRET_ID: 'id', TENCENT_SECRET_KEY: 'key' })
    h.setTencentCloud({
        asr: {
            v20190614: {
                Client: class {
                    FlashRecognition() { return new Promise(() => {}) }
                    SentenceRecognition() { sentenceCalls += 1; return Promise.resolve({ Result: 'fallback' }) }
                },
            },
        },
    })
    const result = await h.invoke('lunch_voice', { action: 'speechRecognize', audioBase64: 'YQ==' }, 'member-a')
    assert.equal(result.success, false)
    assert.match(result.message, /超时/)
    assert.equal(sentenceCalls, 0)
})

test('并发创建同名组织只成功一个，删除后名称可复用', async () => {
    const h = harness()
    const [first, second] = await Promise.all([
        h.invoke('lunch_menu', { action: 'createGroup', groupName: '并发组' }, 'user-1'),
        h.invoke('lunch_menu', { action: 'createGroup', groupName: '并发组' }, 'user-2'),
    ])
    const codes = [first.code, second.code].sort((a, b) => a - b)
    assert.deepEqual(codes, [0, 409])
    const created = first.code === 0 ? first : second
    const creator = first.code === 0 ? 'user-1' : 'user-2'
    assert.equal(h.rows('lunch_groups').filter(row => row.name === '并发组').length, 1)
    assert.equal(h.rows('lunch_group_names').filter(row => row.groupId === created.data.groupId).length, 1)

    const removed = await h.invoke('lunch_menu', { action: 'deleteGroup', groupId: created.data.groupId }, creator)
    assert.equal(removed.code, 0, removed.msg)
    assert.equal(h.rows('lunch_group_names').filter(row => row.groupId === created.data.groupId).length, 0)

    const again = await h.invoke('lunch_menu', { action: 'createGroup', groupName: '并发组' }, 'user-3')
    assert.equal(again.code, 0, again.msg)
})

test('并发统计重建只保留一份结果并释放重建锁', async () => {
    const h = harness()
    h.seed('lunch_orders', [
        { _id: 'stat-aug', groupId: 'a', date: '2026-08-01', status: 'confirmed', memberId: 'member', memberName: '同事', menuId: 'dish', supplier: '店家', price: 10 },
        { _id: 'stat-sep', groupId: 'a', date: '2026-09-01', status: 'confirmed', memberId: 'member', memberName: '同事', menuId: 'dish', supplier: '店家', price: 12 },
    ])
    const [first, second] = await Promise.all([
        h.invoke('lunch_order', { action: 'getMonthlyStats', groupId: 'a' }, 'member-a'),
        h.invoke('lunch_order', { action: 'getMonthlyStats', groupId: 'a' }, 'member-a'),
    ])
    assert.equal(first.code, 0, first.msg)
    assert.equal(second.code, 0, second.msg)
    assert.equal(h.rows('lunch_monthly_stats').length, 2)
    assert.equal(h.rows('lunch_order_keys').filter(row => String(row._id).startsWith('stats_')).length, 0)
})

test('未预期异常对外脱敏并返回 requestId', async () => {
    const h = harness()
    h.seed('lunch_orders', [{ _id: 'order-error', groupId: 'a', date: '2026-09-16', status: 'pending', memberId: 'member', price: 10 }])
    h.db.failOp = (name, op) => name === 'lunch_orders' && op === 'doc.update'
    const result = await h.invoke('lunch_order', {
        action: 'updateOrder', groupId: 'a', orderId: 'order-error', note: 'x',
    })
    h.db.failOp = null
    assert.equal(result.code, 500)
    assert.ok(!result.msg.includes('injected write failure'))
    assert.match(result.msg, /服务暂时不可用/)
    assert.match(result.msg, /（[0-9a-f]{12}）/)
})
