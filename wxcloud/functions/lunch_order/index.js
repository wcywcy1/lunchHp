const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

const GROUP_ID = 'lunch_hp'
const COL = {
    ORDERS: 'lunch_orders',
    MENU: 'lunch_menu',
    MEMBERS: 'lunch_members',
    MONTHLY_STATS: 'lunch_monthly_stats',
    GROUPS: 'lunch_groups',
}
const ROLE = { CREATOR: 'creator', ADMIN: 'admin', MEMBER: 'member' }
const STATUS = { PENDING: 'pending', CONFIRMED: 'confirmed', CANCELLED: 'cancelled' }

async function getMemberByOpenid(openid) {
    const { data } = await db.collection(COL.MEMBERS)
        .where({ groupId: GROUP_ID, openid }).get()
    if (data[0]) return data[0]
    const groupData = (await db.collection(COL.GROUPS).doc(GROUP_ID).get()).data
    if (groupData && groupData.creatorId === openid) {
        return { _id: 'recovered', groupId: GROUP_ID, openid, role: ROLE.CREATOR, name: 'creator' }
    }
    return null
}

function checkRole(member, ...allowed) {
    if (!member) return false
    return allowed.includes(member.role)
}

function getToday() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function fetchAll(collection, where) {
    const all = []
    const limit = 1000
    let skip = 0
    while (true) {
        const { data } = await collection.where(where).skip(skip).limit(limit).get()
        all.push(...data)
        if (data.length < limit) break
        skip += limit
    }
    return all
}

exports.main = async (event, context) => {
    const { OPENID } = cloud.getWXContext()
    const { action } = event

    const handlers = {
        getInitData,
        getRecentOrders,
        getRecentTimestamp,
        getMonthSummary,
        submitOrder,
        batchConfirm,
        cancelOrder,
        updateOrder,
        getConfirmedBySupplier,
        getMonthlyStats,
        rebuildMonthStats,
        searchOrders,
        exportOrders,
        importOrders,
        downloadConfirmed,
        downloadMonthlyData,
        getHistoryOrderCount,
        getHistoryOrders,
    }

    const fn = handlers[action]
    if (!fn) return { code: 400, msg: `unknown action: ${action}` }
    try {
        return await fn(event, OPENID)
    } catch (e) {
        console.error(`[lunch_order] ${action} error:`, e)
        return { code: 500, msg: e.message || 'internal error' }
    }
}

async function getInitData(event, openid) {
    const today = getToday()
    const yearMonth = today.substring(0, 7)

    const [monthAggResult, todayCountResult, menuResult, membersResult, groupResult] = await Promise.all([
        db.collection(COL.ORDERS)
            .aggregate()
            .match({
                groupId: GROUP_ID,
                date: db.RegExp({ regexp: `^${yearMonth}` }),
                status: _.neq(STATUS.CANCELLED),
            })
            .group({
                _id: null,
                totalAmount: $.sum('$price'),
                count: $.sum(1),
            })
            .end(),
        db.collection(COL.ORDERS)
            .where({ groupId: GROUP_ID, date: today })
            .count(),
        db.collection(COL.MENU)
            .where({ groupId: GROUP_ID })
            .orderBy('sortNo', 'asc')
            .get(),
        db.collection(COL.MEMBERS)
            .where({ groupId: GROUP_ID })
            .orderBy('joinedAt', 'asc')
            .get(),
        db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => ({ data: {} })),
    ])

    const todayCount = todayCountResult.total || 0
    const limit = Math.max(100, todayCount)

    const { data: recentOrders } = await db.collection(COL.ORDERS)
        .where({ groupId: GROUP_ID })
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get()

    const monthSummary = monthAggResult.list.length > 0
        ? { totalAmount: monthAggResult.list[0].totalAmount, count: monthAggResult.list[0].count, yearMonth }
        : { totalAmount: 0, count: 0, yearMonth }

    const groupData = groupResult.data || {}

    return {
        code: 0,
        data: {
            monthSummary,
            recentOrders,
            menu: menuResult.data,
            members: membersResult.data,
            recentTimestamp: groupData.ordersTimestamp || null,
            menuTimestamp: groupData.menuTimestamp || null,
            membersTimestamp: groupData.membersTimestamp || null,
        },
    }
}

async function getRecentOrders(event, openid) {
    const { limit: reqLimit = 100 } = event
    const today = getToday()

    const { total: todayCount } = await db.collection(COL.ORDERS)
        .where({ groupId: GROUP_ID, date: today })
        .count()

    const actualLimit = Math.max(reqLimit, todayCount)

    const { data } = await db.collection(COL.ORDERS)
        .where({ groupId: GROUP_ID })
        .orderBy('createdAt', 'desc')
        .limit(actualLimit)
        .get()

    return { code: 0, data }
}

async function getRecentTimestamp(event, openid) {
    const { data } = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => ({ data: {} }))
    const recentTimestamp = data.ordersTimestamp || null
    return { code: 0, data: { recentTimestamp } }
}

async function getMonthSummary(event, openid) {
    const today = getToday()
    const yearMonth = today.substring(0, 7)

    const { list } = await db.collection(COL.ORDERS)
        .aggregate()
        .match({
            groupId: GROUP_ID,
            date: db.RegExp({ regexp: `^${yearMonth}` }),
            status: _.neq(STATUS.CANCELLED),
        })
        .group({
            _id: null,
            totalAmount: $.sum('$price'),
            count: $.sum(1),
        })
        .end()

    const monthSummary = list.length > 0
        ? { totalAmount: list[0].totalAmount, count: list[0].count, yearMonth }
        : { totalAmount: 0, count: 0, yearMonth }

    return { code: 0, data: monthSummary }
}

async function _updateDataTimestamp() {
    const now = db.serverDate()
    const existing = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => null)
    if (existing && existing.data) {
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({
            data: { dataTimestamp: now },
        })
    } else {
        await db.collection(COL.GROUPS).add({
            data: { _id: GROUP_ID, dataTimestamp: now, createdAt: now },
        })
    }
}

async function _updateOrdersTimestamp() {
    const now = db.serverDate()
    const existing = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => null)
    if (existing && existing.data) {
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({
            data: { ordersTimestamp: now },
        })
    } else {
        await db.collection(COL.GROUPS).add({
            data: { _id: GROUP_ID, ordersTimestamp: now, createdAt: now },
        })
    }
}

async function _resetDataTimestamp() {
    const existing = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => null)
    if (existing && existing.data) {
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({
            data: { dataTimestamp: 0 },
        })
    }
}

async function submitOrder(event, openid) {
    const { date, memberId, memberName, menuId, menuName, supplier, price, note } = event
    if (!date || !memberId || !menuId) return { code: 400, msg: 'missing required fields' }

    const { data: existing } = await db.collection(COL.ORDERS)
        .where({
            groupId: GROUP_ID,
            date,
            memberId,
            menuId,
            status: STATUS.PENDING,
        })
        .get()

    if (existing.length > 0) return { code: 409, msg: '已提交相同订单' }

    const now = db.serverDate()
    const order = {
        groupId: GROUP_ID,
        date,
        memberId,
        memberName: memberName || '',
        menuId,
        menuName: menuName || '',
        supplier: supplier || '',
        price: Number(price),
        note: note || '',
        status: STATUS.PENDING,
        createdBy: openid,
        createdAt: now,
        updatedAt: now,
    }

    const { _id } = await db.collection(COL.ORDERS).add({ data: order })
    order._id = _id
    await _updateOrdersTimestamp()
    await _updateDataTimestamp()
    return { code: 0, data: order }
}

async function batchConfirm(event, openid) {
    const { orderIds, date } = event
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return { code: 400, msg: 'missing orderIds' }
    }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const now = db.serverDate()
    const results = []

    for (const orderId of orderIds) {
        try {
            await db.collection(COL.ORDERS).doc(orderId).update({
                data: { status: STATUS.CONFIRMED, updatedAt: now },
            })
            results.push({ orderId, success: true })
        } catch (e) {
            results.push({ orderId, success: false, error: e.message })
        }
    }

    if (date) {
        await doRebuildMonthStats(date.substring(0, 7))
    }
    await _updateDataTimestamp()
    await _updateOrdersTimestamp()

    return { code: 0, data: results }
}

async function cancelOrder(event, openid) {
    const { orderId } = event
    if (!orderId) return { code: 400, msg: 'missing orderId' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const order = (await db.collection(COL.ORDERS).doc(orderId).get()).data
    if (!order) return { code: 404, msg: 'order not found' }

    await db.collection(COL.ORDERS).doc(orderId).update({
        data: { status: STATUS.CANCELLED, updatedAt: db.serverDate() },
    })

    await doRebuildMonthStats(order.date.substring(0, 7))
    await _updateDataTimestamp()
    await _updateOrdersTimestamp()
    return { code: 0 }
}

async function updateOrder(event, openid) {
    const { orderId, menuId, menuName, supplier, price, note } = event
    if (!orderId) return { code: 400, msg: 'missing orderId' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const priceChanged = price !== undefined
    const order = priceChanged
        ? (await db.collection(COL.ORDERS).doc(orderId).get()).data
        : null

    const update = { updatedAt: db.serverDate() }
    if (menuId !== undefined) update.menuId = menuId
    if (menuName !== undefined) update.menuName = menuName
    if (supplier !== undefined) update.supplier = supplier
    if (price !== undefined) update.price = Number(price)
    if (note !== undefined) update.note = note

    await db.collection(COL.ORDERS).doc(orderId).update({ data: update })

    if (priceChanged && order) {
        await doRebuildMonthStats(order.date.substring(0, 7))
        await _updateDataTimestamp()
    }
    await _updateOrdersTimestamp()
    return { code: 0 }
}

async function getConfirmedBySupplier(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { date } = event
    if (!date) return { code: 400, msg: 'missing date' }

    const { data: orders } = await db.collection(COL.ORDERS)
        .where({ groupId: GROUP_ID, date, status: STATUS.CONFIRMED })
        .orderBy('supplier', 'asc')
        .orderBy('memberName', 'asc')
        .get()

    const bySupplier = {}
    for (const o of orders) {
        if (!bySupplier[o.supplier]) bySupplier[o.supplier] = []
        bySupplier[o.supplier].push(o)
    }

    return { code: 0, data: bySupplier }
}

async function getMonthlyStats(event, openid) {
    const { year, since } = event
    const where = { groupId: GROUP_ID }
    if (year) where.year = Number(year)

    const groupRes = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => ({ data: {} }))
    const serverTs = groupRes.data && groupRes.data.dataTimestamp
        ? (groupRes.data.dataTimestamp instanceof Date ? groupRes.data.dataTimestamp.getTime() : new Date(groupRes.data.dataTimestamp).getTime())
        : 0

    if (serverTs === 0) {
        await doRebuildMonthStats(null)
        await _updateDataTimestamp()
        const { data } = await db.collection(COL.MONTHLY_STATS)
            .where(where)
            .orderBy('year', 'asc')
            .orderBy('month', 'asc')
            .get()
        const result = data.map(doc => _formatStatDoc(doc))
        const newGroupRes = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => ({ data: {} }))
        const newTs = newGroupRes.data && newGroupRes.data.dataTimestamp
            ? (newGroupRes.data.dataTimestamp instanceof Date ? newGroupRes.data.dataTimestamp.getTime() : new Date(newGroupRes.data.dataTimestamp).getTime())
            : Date.now()
        return { code: 0, data: result, dataTimestamp: newTs, incremental: false }
    }

    if (since) {
        const changedWhere = { groupId: GROUP_ID, updatedAt: _.gt(new Date(since)) }
        if (year) changedWhere.year = Number(year)
        let { data: changedStats } = await db.collection(COL.MONTHLY_STATS)
            .where(changedWhere)
            .orderBy('year', 'asc')
            .orderBy('month', 'asc')
            .get()

        if (changedStats.length === 0) {
            const { total } = await db.collection(COL.MONTHLY_STATS)
                .where(where)
                .count()
            if (total === 0) {
                await doRebuildMonthStats(null)
                const { data: rebuilt } = await db.collection(COL.MONTHLY_STATS)
                    .where(where)
                    .orderBy('year', 'asc')
                    .orderBy('month', 'asc')
                    .get()
                const result = rebuilt.map(doc => _formatStatDoc(doc))
                return { code: 0, data: result, dataTimestamp: serverTs, incremental: false }
            }
            return { code: 0, data: [], dataTimestamp: serverTs, incremental: true }
        }

        const needRebuild = []
        for (const stat of changedStats) {
            const statTs = stat.updatedAt
                ? (stat.updatedAt instanceof Date ? stat.updatedAt.getTime() : new Date(stat.updatedAt).getTime())
                : 0
            if (statTs < serverTs) {
                needRebuild.push(stat)
            }
        }

        for (const m of needRebuild) {
            await doRebuildMonthStats(`${m.year}-${String(m.month).padStart(2, '0')}`)
        }

        if (needRebuild.length > 0) {
            const reQueryWhere = { groupId: GROUP_ID, updatedAt: _.gt(new Date(since)) }
            if (year) reQueryWhere.year = Number(year)
            changedStats = (await db.collection(COL.MONTHLY_STATS)
                .where(reQueryWhere)
                .orderBy('year', 'asc')
                .orderBy('month', 'asc')
                .get()).data
        }

        const result = changedStats.map(doc => _formatStatDoc(doc))
        return { code: 0, data: result, dataTimestamp: serverTs, incremental: true }
    }

    let { data } = await db.collection(COL.MONTHLY_STATS)
        .where(where)
        .orderBy('year', 'asc')
        .orderBy('month', 'asc')
        .get()

    if (data.length === 0) {
        await doRebuildMonthStats(null)
        const result = await db.collection(COL.MONTHLY_STATS)
            .where(where)
            .orderBy('year', 'asc')
            .orderBy('month', 'asc')
            .get()
        data = result.data
    } else {
        const needRebuild = []
        for (const stat of data) {
            const statTs = stat.updatedAt
                ? (stat.updatedAt instanceof Date ? stat.updatedAt.getTime() : new Date(stat.updatedAt).getTime())
                : 0
            if (statTs < serverTs) {
                needRebuild.push(stat)
            }
        }
        if (needRebuild.length > 0) {
            for (const m of needRebuild) {
                await doRebuildMonthStats(`${m.year}-${String(m.month).padStart(2, '0')}`)
            }
            data = (await db.collection(COL.MONTHLY_STATS)
                .where(where)
                .orderBy('year', 'asc')
                .orderBy('month', 'asc')
                .get()).data
        }
    }

    const result = data.map(doc => _formatStatDoc(doc))
    return { code: 0, data: result, dataTimestamp: serverTs, incremental: false }
}

function _formatStatDoc(doc) {
    return {
        _id: doc._id,
        year: doc.year,
        month: doc.month,
        totalAmount: doc.totalAmount || 0,
        orderCount: doc.orderCount || doc.count || 0,
        orderByMember: doc.orderByMemberMap || arrayToRecord(doc.orderByMember, 'memberName'),
        orderBySupplier: doc.orderBySupplierMap || arrayToRecord(doc.orderBySupplier, 'supplier'),
    }
}

function arrayToRecord(arr, keyField) {
    if (!arr || !Array.isArray(arr)) return arr || {}
    if (arr.length === 0) return {}
    if (typeof arr[0] !== 'object') return arr
    const record = {}
    for (const item of arr) {
        const key = item[keyField] || '未定义'
        record[key] = item.amount || 0
    }
    return record
}

async function rebuildMonthStats(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { yearMonth } = event
    const result = await doRebuildMonthStats(yearMonth || null)
    return { code: 0, data: result }
}

async function doRebuildMonthStats(targetYearMonth) {
    const where = { groupId: GROUP_ID, status: STATUS.CONFIRMED }
    const statsWhere = { groupId: GROUP_ID }
    if (targetYearMonth) {
        where.date = db.RegExp({ regexp: `^${targetYearMonth}` })
        statsWhere.year = Number(targetYearMonth.split('-')[0])
        statsWhere.month = Number(targetYearMonth.split('-')[1])
    }

    const oldStats = await fetchAll(db.collection(COL.MONTHLY_STATS), statsWhere)
    for (const old of oldStats) {
        await db.collection(COL.MONTHLY_STATS).doc(old._id).remove()
    }

    const allOrders = await fetchAll(db.collection(COL.ORDERS), where)

    const monthMap = {}
    for (const order of allOrders) {
        const ym = order.date.substring(0, 7)
        const [year, month] = ym.split('-').map(Number)
        if (!monthMap[ym]) {
            monthMap[ym] = { year, month, totalAmount: 0, count: 0, byMember: {}, bySupplier: {} }
        }
        const m = monthMap[ym]
        m.totalAmount += order.price
        m.count += 1

        if (!m.byMember[order.memberId]) {
            m.byMember[order.memberId] = { memberId: order.memberId, memberName: order.memberName, amount: 0, count: 0 }
        }
        m.byMember[order.memberId].amount += order.price
        m.byMember[order.memberId].count += 1

        if (!m.bySupplier[order.supplier]) {
            m.bySupplier[order.supplier] = { supplier: order.supplier, amount: 0, count: 0 }
        }
        m.bySupplier[order.supplier].amount += order.price
        m.bySupplier[order.supplier].count += 1
    }

    for (const [ym, m] of Object.entries(monthMap)) {
        const orderByMember = Object.values(m.byMember)
        const orderBySupplier = Object.values(m.bySupplier)

        const orderByMemberMap = {}
        for (const item of orderByMember) {
            orderByMemberMap[item.memberName || '未定义'] = Math.round(item.amount * 100) / 100
        }
        const orderBySupplierMap = {}
        for (const item of orderBySupplier) {
            orderBySupplierMap[item.supplier || '未定义'] = Math.round(item.amount * 100) / 100
        }

        const doc = {
            groupId: GROUP_ID,
            year: m.year,
            month: m.month,
            totalAmount: Math.round(m.totalAmount * 100) / 100,
            orderCount: m.count,
            orderByMember,
            orderBySupplier,
            orderByMemberMap,
            orderBySupplierMap,
            updatedAt: db.serverDate(),
        }

        const existing = await db.collection(COL.MONTHLY_STATS)
            .where({ groupId: GROUP_ID, year: m.year, month: m.month })
            .get()

        if (existing.data.length > 0) {
            await db.collection(COL.MONTHLY_STATS).doc(existing.data[0]._id).update({ data: doc })
        } else {
            doc.createdAt = db.serverDate()
            await db.collection(COL.MONTHLY_STATS).add({ data: doc })
        }
    }

    return { rebuiltMonths: Object.keys(monthMap) }
}

async function searchOrders(event, openid) {
    const { startDate, endDate, memberId, supplier, status, members, suppliers, year, months, page = 1, pageSize = 50 } = event

    const where = { groupId: GROUP_ID }

    if (year) {
        if (months && months.length > 0) {
            const patterns = months.map(m => `^${year}-${String(m).padStart(2, '0')}`)
            if (patterns.length === 1) {
                where.date = db.RegExp({ regexp: patterns[0] })
            } else {
                where.date = _.in(patterns.map(p => db.RegExp({ regexp: p })))
            }
        } else {
            where.date = db.RegExp({ regexp: `^${year}-` })
        }
    } else if (startDate && endDate) {
        where.date = _.gte(startDate).and(_.lte(endDate))
    } else if (startDate) {
        where.date = _.gte(startDate)
    } else if (endDate) {
        where.date = _.lte(endDate)
    }

    if (memberId) where.memberId = memberId
    if (supplier) where.supplier = supplier
    if (members && members.length > 0) where.memberName = _.in(members)
    if (suppliers && suppliers.length > 0) where.supplier = _.in(suppliers)
    if (status) where.status = status

    const skip = (page - 1) * pageSize
    const [countResult, { data }] = await Promise.all([
        db.collection(COL.ORDERS).where(where).count(),
        db.collection(COL.ORDERS)
            .where(where)
            .orderBy('date', 'desc')
            .orderBy('createdAt', 'desc')
            .skip(skip)
            .limit(Math.min(pageSize, 100))
            .get(),
    ])

    return { code: 0, data: { list: data, total: countResult.total, page, pageSize } }
}

async function exportOrders(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { startDate, endDate, memberId, supplier, status } = event
    const where = { groupId: GROUP_ID }
    if (startDate && endDate) where.date = _.gte(startDate).and(_.lte(endDate))
    else if (startDate) where.date = _.gte(startDate)
    else if (endDate) where.date = _.lte(endDate)
    if (memberId) where.memberId = memberId
    if (supplier) where.supplier = supplier
    if (status) where.status = status

    const allOrders = await fetchAll(db.collection(COL.ORDERS), where)

    const statusMap = { [STATUS.PENDING]: '待确认', [STATUS.CONFIRMED]: '已确认', [STATUS.CANCELLED]: '已取消' }
    const header = '日期,菜品,姓名,金额,备注,状态,供应商'
    const rows = allOrders.map(o =>
        `${o.date},${o.menuName},${o.memberName},${o.price},${o.note || ''},${statusMap[o.status] || o.status},${o.supplier}`
    )
    const csv = '\uFEFF' + header + '\n' + rows.join('\n')

    const ts = Date.now()
    const cloudPath = `lunch/exports/orders_${ts}.csv`
    const uploadResult = await cloud.uploadFile({
        cloudPath,
        fileContent: Buffer.from(csv, 'utf-8'),
    })

    return { code: 0, data: { fileID: uploadResult.fileID, count: allOrders.length, fileName: `清单_${new Date().toISOString().slice(0, 10)}.csv` } }
}

async function importOrders(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { orders, mode } = event
    if (!Array.isArray(orders) || orders.length === 0) return { code: 400, msg: 'missing orders' }

    if (mode === 'rewrite') {
        await db.collection(COL.ORDERS).where({ groupId: GROUP_ID }).remove()
    }

    const allMembers = await fetchAll(db.collection(COL.MEMBERS), { groupId: GROUP_ID })
    const memberMap = {}
    allMembers.forEach(m => { memberMap[m.name] = m })

    const allMenu = await fetchAll(db.collection(COL.MENU), { groupId: GROUP_ID })
    const menuMap = {}
    allMenu.forEach(it => {
        const key = (it.supplier || '') + '|' + it.name
        menuMap[key] = it
        if (!menuMap[it.name]) menuMap[it.name] = it
    })

    let lastDaySet = null
    if (mode === 'append') {
        const allOrders = await fetchAll(db.collection(COL.ORDERS), { groupId: GROUP_ID })
        if (allOrders.length > 0) {
            const lastDate = allOrders.reduce((max, o) => o.date > max ? o.date : max, '')
            lastDaySet = new Set(
                allOrders.filter(o => o.date === lastDate)
                    .map(o => `${o.memberId}|${o.menuId}`)
            )
        }
    }

    const now = db.serverDate()
    const toInsert = []
    const results = []

    for (const o of orders) {
        if (!o.date || !o.memberName || !o.menuName) {
            results.push({ error: 'missing required fields', order: o })
            continue
        }

        const member = memberMap[o.memberName]
        const menuKey = (o.supplier || '') + '|' + o.menuName
        const menuItem = menuMap[menuKey] || menuMap[o.menuName]

        if (!member) {
            results.push({ error: `成员"${o.memberName}"不存在`, order: o })
            continue
        }
        if (!menuItem) {
            results.push({ error: `菜品"${o.menuName}"不存在`, order: o })
            continue
        }

        if (lastDaySet && lastDaySet.has(`${member._id}|${menuItem._id}`)) {
            results.push({ skipped: true, date: o.date, menuName: o.menuName, reason: 'duplicate on last day' })
            continue
        }

        toInsert.push({
            groupId: GROUP_ID,
            date: o.date,
            memberId: member._id,
            memberName: member.name,
            menuId: menuItem._id,
            menuName: menuItem.name,
            supplier: o.supplier || '',
            price: Number(o.price) || 0,
            note: o.note || '',
            status: o.status || STATUS.CONFIRMED,
            createdBy: openid,
            createdAt: now,
            updatedAt: now,
        })
    }

    if (toInsert.length > 0) {
        const BATCH_SIZE = 100
        for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
            const chunk = toInsert.slice(i, i + BATCH_SIZE)
            try {
                const addResults = await db.collection(COL.ORDERS).add({ data: chunk })
                if (Array.isArray(addResults.data)) {
                    addResults.data.forEach((r, idx) => {
                        results.push({ _id: r._id, date: chunk[idx].date, menuName: chunk[idx].menuName })
                    })
                } else if (addResults._id) {
                    results.push({ _id: addResults._id, date: chunk[0].date, menuName: chunk[0].menuName })
                } else {
                    chunk.forEach(item => {
                        results.push({ _id: 'batch_inserted', date: item.date, menuName: item.menuName })
                    })
                }
            } catch (addErr) {
                chunk.forEach(item => {
                    results.push({ error: `插入失败: ${addErr.message || addErr}`, order: item })
                })
            }
        }
    }

    const successCount = results.filter(r => r._id).length
    const errorCount = results.filter(r => r.error).length
    const skippedCount = results.filter(r => r.skipped).length
    if (successCount > 0) {
        await _resetDataTimestamp()
        await _updateOrdersTimestamp()
    }
    return { code: 0, data: { results, count: successCount, errors: errorCount, skipped: skippedCount } }
}

async function downloadConfirmed(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { date, supplier } = event
    if (!date) return { code: 400, msg: 'missing date' }

    const where = { groupId: GROUP_ID, date, status: STATUS.CONFIRMED }
    if (supplier) where.supplier = supplier

    const { data: orders } = await db.collection(COL.ORDERS)
        .where(where)
        .orderBy('supplier', 'asc')
        .orderBy('memberName', 'asc')
        .get()

    if (orders.length === 0) return { code: 0, data: { fileID: null, msg: '无已确认订单' } }

    let csv
    let fileName

    if (supplier) {
        const header = '姓名,餐品,金额,备注'
        const rows = orders.map(o => `${o.memberName},${o.menuName},${o.price},${o.note || ''}`)
        const total = orders.reduce((s, o) => s + o.price, 0)
        rows.push(`合计,,${Math.round(total * 100) / 100},`)
        csv = '\uFEFF' + header + '\n' + rows.join('\n')
        fileName = `确认单_${supplier}_${date}.csv`
    } else {
        const bySupplier = {}
        for (const o of orders) {
            if (!bySupplier[o.supplier]) bySupplier[o.supplier] = []
            bySupplier[o.supplier].push(o)
        }

        const header = '供应商,姓名,餐品,金额,备注'
        const rows = []
        let grandTotal = 0
        for (const [sup, supOrders] of Object.entries(bySupplier)) {
            for (const o of supOrders) {
                rows.push(`${sup},${o.memberName},${o.menuName},${o.price},${o.note || ''}`)
            }
            const subTotal = supOrders.reduce((s, o) => s + o.price, 0)
            rows.push(`${sup},小计,,${Math.round(subTotal * 100) / 100},`)
            grandTotal += subTotal
        }
        rows.push(`全部,合计,,${Math.round(grandTotal * 100) / 100},`)
        csv = '\uFEFF' + header + '\n' + rows.join('\n')
        fileName = `确认单_全部_${date}.csv`
    }

    const ts = Date.now()
    const cloudPath = `lunch/exports/confirmed_${ts}.csv`
    const uploadResult = await cloud.uploadFile({
        cloudPath,
        fileContent: Buffer.from(csv, 'utf-8'),
    })

    return { code: 0, data: { fileID: uploadResult.fileID, count: orders.length, fileName } }
}

async function downloadMonthlyData(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { year } = event
    const where = { groupId: GROUP_ID }
    if (year) where.year = Number(year)

    const { data: stats } = await db.collection(COL.MONTHLY_STATS)
        .where(where)
        .orderBy('year', 'asc')
        .orderBy('month', 'asc')
        .get()

    if (stats.length === 0) return { code: 0, data: { fileID: null, msg: '无统计数据' } }

    const supplierSet = new Set()
    for (const s of stats) {
        for (const sup of (s.orderBySupplier || [])) {
            supplierSet.add(sup.supplier)
        }
    }
    const suppliers = [...supplierSet].sort()

    const header = ['月份', '总金额', '订单数', ...suppliers].join(',')
    const rows = stats.map(s => {
        const ym = `${s.year}-${String(s.month).padStart(2, '0')}`
        const supMap = {}
        for (const sup of (s.orderBySupplier || [])) {
            supMap[sup.supplier] = sup.amount
        }
        const supValues = suppliers.map(sup => Math.round((supMap[sup] || 0) * 100) / 100)
        return [ym, Math.round(s.totalAmount * 100) / 100, s.count, ...supValues].join(',')
    })

    const csv = '\uFEFF' + header + '\n' + rows.join('\n')
    const ts = Date.now()
    const yearSuffix = year || 'all'
    const cloudPath = `lunch/exports/monthly_${yearSuffix}_${ts}.csv`
    const uploadResult = await cloud.uploadFile({
        cloudPath,
        fileContent: Buffer.from(csv, 'utf-8'),
    })

    return { code: 0, data: { fileID: uploadResult.fileID, count: stats.length, fileName: `月度统计_${yearSuffix}.csv` } }
}

async function getHistoryOrderCount(event, openid) {
    const today = getToday()
    const baseWhere = { groupId: GROUP_ID, date: _.lt(today) }

    const [pendingResult, confirmedResult] = await Promise.all([
        db.collection(COL.ORDERS).where({ ...baseWhere, status: STATUS.PENDING }).count(),
        db.collection(COL.ORDERS).where({ ...baseWhere, status: STATUS.CONFIRMED }).count(),
    ])

    return {
        code: 0,
        data: {
            pendingCount: pendingResult.total,
            confirmedCount: confirmedResult.total,
        }
    }
}

async function getHistoryOrders(event, openid) {
    const { status, page = 1, pageSize = 10 } = event
    const today = getToday()
    const where = { groupId: GROUP_ID, date: _.lt(today) }
    if (status) where.status = status

    const skip = (page - 1) * pageSize
    const [countResult, { data }] = await Promise.all([
        db.collection(COL.ORDERS).where(where).count(),
        db.collection(COL.ORDERS)
            .where(where)
            .orderBy('date', 'desc')
            .orderBy('createdAt', 'desc')
            .skip(skip)
            .limit(Math.min(pageSize, 100))
            .get(),
    ])

    return { code: 0, data: { list: data, total: countResult.total, page, pageSize } }
}