const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate
let XLSX = null
try { XLSX = require('xlsx') } catch (e) { }

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
        importFromXlsx,
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

    await db.collection(COL.MONTHLY_STATS).where(statsWhere).remove()

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

    const now = db.serverDate()
    const toInsert = []
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

        toInsert.push({
            groupId: GROUP_ID,
            year: m.year,
            month: m.month,
            totalAmount: Math.round(m.totalAmount * 100) / 100,
            orderCount: m.count,
            orderByMember,
            orderBySupplier,
            orderByMemberMap,
            orderBySupplierMap,
            createdAt: now,
            updatedAt: now,
        })
    }

    if (toInsert.length > 0) {
        const BATCH_SIZE = 100
        for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
            await db.collection(COL.MONTHLY_STATS).add({ data: toInsert.slice(i, i + BATCH_SIZE) })
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

    // auto-create missing members and menu items
    const now = db.serverDate()
    const newMembers = {}
    const newMenuItems = {}

    for (const o of orders) {
        if (!o.memberName || memberMap[o.memberName] || newMembers[o.memberName]) continue
        const addRes = await db.collection(COL.MEMBERS).add({ data: {
            groupId: GROUP_ID, name: o.memberName, nickName: '', avatar: '', openid: '',
            role: ROLE.MEMBER, isVirtual: true, privacyAgreed: false, joinedAt: now,
        }})
        newMembers[o.memberName] = { _id: addRes._id, name: o.memberName }
    }
    Object.assign(memberMap, newMembers)

    for (const o of orders) {
        if (!o.menuName) continue
        const menuKey = (o.supplier || '') + '|' + o.menuName
        if (menuMap[menuKey] || menuMap[o.menuName] || newMenuItems[menuKey]) continue
        const addRes = await db.collection(COL.MENU).add({ data: {
            groupId: GROUP_ID, sortNo: (allMenu.length + Object.keys(newMenuItems).length + 1) * 10,
            supplier: o.supplier || '', name: o.menuName, price: Number(o.price) || 0,
            photo: '', visible: true, createdAt: now,
        }})
        newMenuItems[menuKey] = { _id: addRes._id, name: o.menuName, supplier: o.supplier || '' }
        if (!newMenuItems[o.menuName]) newMenuItems[o.menuName] = newMenuItems[menuKey]
    }
    Object.assign(menuMap, newMenuItems)

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

    const toInsert = []
    let errorCount = 0
    let skippedCount = 0

    for (const o of orders) {
        if (!o.date || !o.memberName || !o.menuName) {
            errorCount++
            continue
        }

        const member = memberMap[o.memberName]
        const menuKey = (o.supplier || '') + '|' + o.menuName
        const menuItem = menuMap[menuKey] || menuMap[o.menuName]

        if (!member) {
            errorCount++
            continue
        }
        if (!menuItem) {
            errorCount++
            continue
        }

        if (lastDaySet && lastDaySet.has(`${member._id}|${menuItem._id}`)) {
            skippedCount++
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
            await db.collection(COL.ORDERS).add({ data: toInsert.slice(i, i + BATCH_SIZE) })
        }
        await _resetDataTimestamp()
        await _updateOrdersTimestamp()
    }

    return { code: 0, data: { count: toInsert.length, errors: errorCount, skipped: skippedCount } }
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

async function importFromXlsx(event, openid) {
    if (!XLSX) return { code: 500, msg: 'xlsx库未安装' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { fileID, mode, importType } = event
    if (!fileID) return { code: 400, msg: 'missing fileID' }
    if (!importType) return { code: 400, msg: 'missing importType' }

    const downloadRes = await cloud.downloadFile({ fileID })
    const buffer = downloadRes.fileContent
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

    const rows = jsonData.map(row =>
        row.map(cell => {
            if (cell instanceof Date) {
                const y = cell.getFullYear()
                const m = String(cell.getMonth() + 1).padStart(2, '0')
                const d = String(cell.getDate()).padStart(2, '0')
                return `${y}-${m}-${d}`
            }
            return String(cell)
        })
    )

    try { await cloud.deleteFile({ fileList: [fileID] }) } catch (e) { }

    if (importType === 'orders') {
        return await _importOrdersFromRows(rows, mode, openid)
    } else if (importType === 'menu') {
        return await _importMenuFromRows(rows, mode)
    } else if (importType === 'members') {
        return await _importMembersFromRows(rows, mode)
    }
    return { code: 400, msg: `unknown importType: ${importType}` }
}

function _parseDate(val) {
    if (!val) return ''
    if (typeof val === 'number') {
        const epoch = new Date(Date.UTC(1899, 11, 30))
        const d = new Date(epoch.getTime() + val * 86400000)
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }
    const str = String(val).trim()
    let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
    return ''
}

const HEADER_ALIASES = {
    date: ['日期', 'date'],
    menuName: ['菜品', '菜品名', 'menuname', 'order', 'description'],
    memberName: ['姓名', 'membername', 'name list', '名单'],
    price: ['金额', '价格', 'price', 'rmb'],
    note: ['备注', 'note', 'comment', 'column1'],
    status: ['状态', 'status'],
    supplier: ['供应商', 'vendor'],
    supplier_menu: ['供应商', 'vendor'],
    menuName_menu: ['菜品名', '菜品', 'menuname', 'order', 'description'],
    price_menu: ['价格', '金额', 'price', 'rmb'],
    visible: ['可见', 'visible'],
    name_member: ['姓名', 'membername', 'name list', '名单'],
    nickName: ['昵称', 'nickname', 'nick name'],
    role: ['角色', 'role'],
    isVirtual: ['虚拟用户', 'virtual'],
}

function _mapHeader(header, fields) {
    const result = {}
    const lowerHeader = header.map(h => (h || '').trim().toLowerCase())
    // Pass 1: exact match
    for (const field of fields) {
        const aliases = HEADER_ALIASES[field] || [field]
        const lowerAliases = aliases.map(a => a.toLowerCase())
        const idx = lowerHeader.findIndex(h => lowerAliases.some(a => h === a))
        if (idx >= 0) result[field] = idx
    }
    // Pass 2: fuzzy match (only for fields not yet matched)
    for (const field of fields) {
        if (result[field] !== undefined) continue
        const aliases = HEADER_ALIASES[field] || [field]
        const lowerAliases = aliases.map(a => a.toLowerCase())
        const idx = lowerHeader.findIndex(h => lowerAliases.some(a => h.includes(a) || a.includes(h)))
        if (idx >= 0 && !Object.values(result).includes(idx)) result[field] = idx
    }
    return result
}

async function _importOrdersFromRows(rows, mode, openid) {
    if (rows.length < 2) return { code: 400, msg: '文件为空' }

    const header = rows[0]
    const idx = _mapHeader(header, ['date', 'menuName', 'memberName', 'price', 'note', 'status', 'supplier'])
    if (idx.date === undefined || idx.menuName === undefined || idx.memberName === undefined || idx.price === undefined) {
        return { code: 400, msg: '格式不正确，需包含日期/菜品/姓名/金额' }
    }

    const records = rows.slice(1)
        .filter(cols => cols[idx.date] && cols[idx.menuName] && cols[idx.memberName])
        .map(cols => {
            let statusVal = idx.status !== undefined && cols[idx.status] ? cols[idx.status] : 'confirmed'
            const statusMap = { '待确认': 'pending', '已确认': 'confirmed', '已取消': 'cancelled' }
            statusVal = statusMap[statusVal] || statusVal
            return {
                date: _parseDate(cols[idx.date]),
                menuName: cols[idx.menuName] || '',
                memberName: cols[idx.memberName] || '',
                price: Number(cols[idx.price]) || 0,
                note: idx.note !== undefined ? (cols[idx.note] || '') : '',
                status: statusVal,
                supplier: idx.supplier !== undefined ? (cols[idx.supplier] || '') : '',
            }
        })
        .filter(r => r.date)

    if (records.length === 0) return { code: 400, msg: '无有效数据' }

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

    // auto-create missing members and menu items
    const now = db.serverDate()
    const newMembers = {}
    const newMenuItems = {}

    for (const o of records) {
        if (!o.memberName || memberMap[o.memberName] || newMembers[o.memberName]) continue
        const addRes = await db.collection(COL.MEMBERS).add({ data: {
            groupId: GROUP_ID, name: o.memberName, nickName: '', avatar: '', openid: '',
            role: ROLE.MEMBER, isVirtual: true, privacyAgreed: false, joinedAt: now,
        }})
        newMembers[o.memberName] = { _id: addRes._id, name: o.memberName }
    }
    Object.assign(memberMap, newMembers)

    for (const o of records) {
        if (!o.menuName) continue
        const menuKey = (o.supplier || '') + '|' + o.menuName
        if (menuMap[menuKey] || menuMap[o.menuName] || newMenuItems[menuKey]) continue
        const addRes = await db.collection(COL.MENU).add({ data: {
            groupId: GROUP_ID, sortNo: (allMenu.length + Object.keys(newMenuItems).length + 1) * 10,
            supplier: o.supplier || '', name: o.menuName, price: Number(o.price) || 0,
            photo: '', visible: true, createdAt: now,
        }})
        newMenuItems[menuKey] = { _id: addRes._id, name: o.menuName, supplier: o.supplier || '' }
        if (!newMenuItems[o.menuName]) newMenuItems[o.menuName] = newMenuItems[menuKey]
    }
    Object.assign(menuMap, newMenuItems)

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

    const toInsert = []
    let errorCount = 0
    let skippedCount = 0

    for (const o of records) {
        const member = memberMap[o.memberName]
        const menuKey = (o.supplier || '') + '|' + o.menuName
        const menuItem = menuMap[menuKey] || menuMap[o.menuName]

        if (!member || !menuItem) {
            errorCount++
            continue
        }

        if (lastDaySet && lastDaySet.has(`${member._id}|${menuItem._id}`)) {
            skippedCount++
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
            await db.collection(COL.ORDERS).add({ data: toInsert.slice(i, i + BATCH_SIZE) })
        }
        await _resetDataTimestamp()
        await _updateOrdersTimestamp()
    }

    return { code: 0, data: { count: toInsert.length, errors: errorCount, skipped: skippedCount } }
}

async function _importMenuFromRows(rows, mode) {
    if (rows.length < 2) return { code: 400, msg: '文件为空' }

    const header = rows[0]
    const idx = _mapHeader(header, ['supplier_menu', 'menuName_menu', 'price_menu', 'visible'])
    if (idx.supplier_menu === undefined || idx.menuName_menu === undefined) {
        return { code: 400, msg: '格式不正确，需包含供应商/菜品名' }
    }

    const items = rows.slice(1)
        .filter(cols => cols[idx.supplier_menu] && cols[idx.menuName_menu])
        .map(cols => ({
            supplier: cols[idx.supplier_menu] || '',
            name: cols[idx.menuName_menu] || '',
            price: idx.price_menu !== undefined ? (Number(cols[idx.price_menu]) || 0) : 0,
            visible: idx.visible !== undefined ? cols[idx.visible] !== '否' : true,
        }))

    if (items.length === 0) return { code: 400, msg: '无有效数据' }

    if (mode === 'rewrite') {
        await db.collection(COL.MENU).where({ groupId: GROUP_ID }).remove()
    }

    const { data: existing } = await db.collection(COL.MENU)
        .where({ groupId: GROUP_ID })
        .orderBy('sortNo', 'desc')
        .limit(1)
        .get()
    let sortNo = existing.length > 0 ? existing[0].sortNo : 0

    const now = db.serverDate()
    const batch = items.filter(it => it.supplier && it.name).map(it => ({
        groupId: GROUP_ID,
        sortNo: sortNo += 10,
        supplier: it.supplier,
        name: it.name,
        price: Number(it.price) || 0,
        photo: '',
        visible: it.visible !== false,
        createdAt: now,
    }))

    if (batch.length === 0) return { code: 400, msg: 'no valid items' }

    const BATCH_SIZE = 100
    let inserted = 0
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        const chunk = batch.slice(i, i + BATCH_SIZE)
        await db.collection(COL.MENU).add({ data: chunk })
        inserted += chunk.length
    }

    return { code: 0, data: { count: inserted } }
}

async function _importMembersFromRows(rows, mode) {
    if (rows.length < 2) return { code: 400, msg: '文件为空' }

    const header = rows[0]
    const idx = _mapHeader(header, ['name_member', 'nickName', 'role', 'isVirtual'])
    if (idx.name_member === undefined) {
        return { code: 400, msg: '格式不正确，需包含姓名' }
    }

    const members = rows.slice(1)
        .filter(cols => cols[idx.name_member]?.trim())
        .map(cols => ({
            name: cols[idx.name_member].trim(),
            nickName: idx.nickName !== undefined ? (cols[idx.nickName] || '') : '',
            role: idx.role !== undefined ? (cols[idx.role] || 'member') : 'member',
            isVirtual: idx.isVirtual !== undefined ? cols[idx.isVirtual] !== '否' : true,
        }))

    if (members.length === 0) return { code: 400, msg: '无有效数据' }

    if (mode === 'rewrite') {
        const { OPENID } = cloud.getWXContext()
        await db.collection(COL.MEMBERS).where({ groupId: GROUP_ID, openid: _.neq(OPENID) }).remove()
    }

    const now = db.serverDate()
    const batch = members.filter(m => m.name && m.name.trim()).map(m => ({
        groupId: GROUP_ID,
        name: m.name.trim(),
        nickName: m.nickName || '',
        avatar: '',
        openid: '',
        role: m.role || ROLE.MEMBER,
        isVirtual: m.isVirtual !== undefined ? m.isVirtual : true,
        privacyAgreed: false,
        joinedAt: now,
    }))

    if (batch.length === 0) return { code: 400, msg: 'no valid members' }

    const BATCH_SIZE = 100
    let inserted = 0
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        const chunk = batch.slice(i, i + BATCH_SIZE)
        await db.collection(COL.MEMBERS).add({ data: chunk })
        inserted += chunk.length
    }

    return { code: 0, data: { count: inserted } }
}