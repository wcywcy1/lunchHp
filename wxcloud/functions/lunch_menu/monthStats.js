'use strict'

// 月度统计重建（lunch_order / lunch_menu 独立部署，保留相同副本；测试校验一致性）
const COL = { ORDERS: 'lunch_orders', MONTHLY_STATS: 'lunch_monthly_stats' }
const STATUS = { CONFIRMED: 'confirmed' }

function createMonthStats({ db, groupId }) {
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

    async function rebuildMonth(targetYearMonth) {
        const where = { groupId, status: STATUS.CONFIRMED }
        const statsWhere = { groupId }
        if (targetYearMonth) {
            where.date = db.RegExp({ regexp: `^${targetYearMonth}` })
            statsWhere.year = Number(targetYearMonth.split('-')[0])
            statsWhere.month = Number(targetYearMonth.split('-')[1])
        }

        // 清除旧记录（包括自动生成_id的旧格式）
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
        for (const [ym, m] of Object.entries(monthMap)) {
            const orderByMember = Object.values(m.byMember)
            const orderBySupplier = Object.values(m.bySupplier)

            const orderByMemberMap = {}
            for (const item of orderByMember) {
                const key = item.memberName || '未定义'
                orderByMemberMap[key] = Math.round(((orderByMemberMap[key] || 0) + item.amount) * 100) / 100
            }
            const orderBySupplierMap = {}
            for (const item of orderBySupplier) {
                orderBySupplierMap[item.supplier || '未定义'] = Math.round(item.amount * 100) / 100
            }

            // 用确定性 _id 写入，并发 rebuild 写同一个 _id 不会产生重复
            const docId = `${groupId}_${m.year}_${m.month}`
            await db.collection(COL.MONTHLY_STATS).doc(docId).set({
                data: {
                    groupId,
                    year: m.year,
                    month: m.month,
                    totalAmount: Math.round(m.totalAmount * 100) / 100,
                    orderCount: m.count,
                    orderByMember,
                    orderBySupplier,
                    orderByMemberMap,
                    orderBySupplierMap,
                    deleted: false,
                    createdAt: now,
                    updatedAt: now,
                },
            })
        }

        // Targeted rebuilds retain a deletion marker so incremental clients can
        // remove a cached month after its last confirmed order disappears.
        if (targetYearMonth && Object.keys(monthMap).length === 0) {
            const [year, month] = targetYearMonth.split('-').map(Number)
            const docId = `${groupId}_${year}_${month}`
            await db.collection(COL.MONTHLY_STATS).doc(docId).set({
                data: {
                    groupId,
                    year,
                    month,
                    totalAmount: 0,
                    orderCount: 0,
                    orderByMember: [],
                    orderBySupplier: [],
                    orderByMemberMap: {},
                    orderBySupplierMap: {},
                    deleted: true,
                    createdAt: now,
                    updatedAt: now,
                },
            })
        }

        return { rebuiltMonths: Object.keys(monthMap) }
    }

    async function rebuildMonths(months) {
        const rebuilt = []
        for (const yearMonth of months || []) {
            if (!/^\d{4}-\d{2}$/.test(yearMonth)) continue
            const result = await rebuildMonth(yearMonth)
            rebuilt.push(...result.rebuiltMonths)
        }
        return { rebuiltMonths: rebuilt }
    }

    return { rebuildMonth, rebuildMonths }
}

module.exports = { createMonthStats }
