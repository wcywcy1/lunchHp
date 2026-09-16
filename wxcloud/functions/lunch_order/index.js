const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate
let XLSX = null
try { XLSX = require('xlsx') } catch (e) { }

const requestGate = require('./requestGate')
const _rateMap = new Map()
const autoCancelByGroup = new Map()
let _collectionsEnsured = false

// 每次调用创建独立组织上下文，避免复用实例并发请求时串组。
function createRequestHandlers(GROUP_ID) {
const COL = {
    ORDERS: 'lunch_orders',
    MENU: 'lunch_menu',
    MEMBERS: 'lunch_members',
    MONTHLY_STATS: 'lunch_monthly_stats',
    GROUPS: 'lunch_groups',
    USER_STATS: 'lunch_user_menu_stats',
    AUDIT_LOGS: 'lunch_audit_logs',
    ORDER_KEYS: 'lunch_order_keys',
}
const ROLE = { CREATOR: 'creator', ADMIN: 'admin', MEMBER: 'member' }
const STATUS = { PENDING: 'pending', CONFIRMED: 'confirmed', CANCELLED: 'cancelled' }

const AUDIT_ACTION = {
    ORDERS_IMPORT: 'importOrders',
    ORDERS_IMPORT_FROM_CSV: 'importFromCsv',
}

async function writeAuditLog(openid, action, targetType, targetId, oldValue, newValue, extra) {
    try {
        const now = new Date()
        const expireAt = new Date(now.getTime() + 2 * 365 * 24 * 60 * 60 * 1000)
        await db.collection(COL.AUDIT_LOGS).add({
            data: {
                groupId: GROUP_ID,
                operatorOpenid: openid || '',
                action,
                targetType,
                targetId: targetId || '',
                oldValue: oldValue || null,
                newValue: newValue || null,
                extra: extra || null,
                createdAt: now,
                expireAt,
            }
        })
    } catch (e) {
        console.error('writeAuditLog failed:', e && e.message)
    }
}

async function getMemberByOpenid(openid) {
    const { data } = await db.collection(COL.MEMBERS)
        .where({ groupId: GROUP_ID, openid }).get()
    if (data[0]) return data[0]
    const groupData = (await db.collection(COL.GROUPS).doc(GROUP_ID).get()).data
    if (groupData && groupData.creatorId === openid) {
        // 创建者无真实 member 记录时真实落库，避免幽灵用户
        const member = {
            groupId: GROUP_ID,
            openid,
            name: '',
            nickName: '',
            avatar: '',
            role: ROLE.CREATOR,
            isVirtual: false,
            privacyAgreed: false,
            joinedAt: db.serverDate(),
        }
        const { _id } = await db.collection(COL.MEMBERS).add({ data: member })
        return { ...member, _id }
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

// CSV 字段转义（RFC 4180）：含逗号/引号/换行时用双引号包裹
function csvEscape(field) {
    if (field === null || field === undefined) return ''
    const s = String(field)
    if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
}

function buildCsvLine(fields) {
    return fields.map(csvEscape).join(',')
}

// 集合初始化状态在模块级缓存。
async function ensureCollections() {
    if (_collectionsEnsured) return
    const required = [COL.ORDERS, COL.MENU, COL.MEMBERS, COL.MONTHLY_STATS, COL.GROUPS, COL.USER_STATS, COL.AUDIT_LOGS, COL.ORDER_KEYS]
    for (const name of required) {
        try {
            await db.createCollection(name)
        } catch (e) {
            if (!e.message || !e.message.includes('already exists')) {
                console.warn(`createCollection ${name}:`, e.message)
            }
        }
    }
    _collectionsEnsured = true
}

// 简单速率限制：同一 openid 10 秒窗口内最多 30 次调用（实例级内存，防异常刷量）
// 速率记录保留在模块级，组织上下文仅属于本次请求。
function rateLimit(openid, limit = 30, windowMs = 10000) {
    if (!openid) return true
    const now = Date.now()
    const arr = (_rateMap.get(openid) || []).filter(t => now - t < windowMs)
    if (arr.length >= limit) return false
    arr.push(now)
    _rateMap.set(openid, arr)
    if (_rateMap.size > 10000) {
        for (const [k, v] of _rateMap) {
            if (v.every(t => now - t >= windowMs)) _rateMap.delete(k)
        }
    }
    return true
}

async function dispatch(event, context) {
    const { OPENID } = cloud.getWXContext()
    const { action } = event
    // 从前端传入 groupId，回退默认值，实现多组织切换
    // GROUP_ID 来自本次调用的闭包，不使用可变全局变量。

    if (!rateLimit(OPENID)) return { code: 429, msg: '请求过于频繁，请稍后再试' }

    const handlers = {
        getInitData,
        getRecentOrders,
        getRecentTimestamp,
        getAllTimestamps,
        getRecentMenu,
        getRecentMembers,
        getMonthSummary,
        submitOrder,
        batchConfirm,
        cancelOrder,
        batchCancelOrders,
        cancelMyOrder,
        requestCancelOrder,
        getPendingCancelRequests,
        rejectCancelRequest,
        updateOrder,
        getConfirmedBySupplier,
        getMonthlyStats,
        rebuildMonthStats,
        searchOrders,
        exportOrders,
        downloadConfirmed,
        downloadMonthlyData,
        getHistoryOrderCount,
        getHistoryOrders,
        importFromXlsx,
        importFromCsv,
        getUserMenuStats,
        rebuildOrderRelations,
    }

    const fn = handlers[action]
    if (!fn) return { code: 400, msg: `unknown action: ${action}` }
    try {
        if (!Object.prototype.hasOwnProperty.call(handlers, action)) return { code: 400, msg: 'unknown action' }
        if (!OPENID) return { code: 401, msg: '请先登录' }
        if (action !== 'getInitData' && !await getMemberByOpenid(OPENID)) return { code: 403, msg: '请先加入当前组织' }
        const targetError = await validateTargetDocuments(action, event)
        if (targetError) return targetError
        if (['parseXlsx', 'parseCsv', 'importFromCsv', 'importFromXlsx'].includes(action) && event.fileID && !requestGate.validImportFile(event.fileID, GROUP_ID)) {
            return { code: 403, msg: '导入文件不属于当前组织，请重新上传' }
        }
        return await fn(event, OPENID)
    } catch (e) {
        console.error(`[lunch_order] ${action} error:`, e)
        return { code: typeof e.code === 'number' ? e.code : 500, msg: e.message || 'internal error' }
    }
}

async function validateTargetDocuments(action, event) {
    const targets = []
    if (['cancelOrder', 'cancelMyOrder', 'requestCancelOrder', 'rejectCancelRequest', 'updateOrder'].includes(action)) {
        targets.push([COL.ORDERS, event.orderId])
    }
    if (action === 'submitOrder') targets.push([COL.MEMBERS, event.memberId], [COL.MENU, event.menuId])
    if (action === 'updateOrder' && event.menuId !== undefined) targets.push([COL.MENU, event.menuId])
    if (['batchConfirm', 'batchCancelOrders'].includes(action)) {
        if (!Array.isArray(event.orderIds) || !event.orderIds.length) return { code: 400, msg: 'missing orderIds' }
        for (const id of new Set(event.orderIds)) targets.push([COL.ORDERS, id])
    }
    for (const [collection, id] of targets) {
        if (typeof id !== 'string' || !id.trim()) return { code: 400, msg: 'invalid document ID' }
        const { data } = await db.collection(collection).where({ _id: id, groupId: GROUP_ID }).limit(1).get()
        if (!data.length) return { code: 404, msg: '目标数据不存在或不属于当前组织' }
    }
    return null
}

async function getInitData(event, openid) {
    await ensureCollections()
    await _autoCancelExpiredPending()
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
    const limit = Math.min(Math.max(100, todayCount), 500)

    const { data: recentOrders } = await db.collection(COL.ORDERS)
        .where({ groupId: GROUP_ID })
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get()

    const monthSummary = monthAggResult.list.length > 0
        ? { totalAmount: monthAggResult.list[0].totalAmount, count: monthAggResult.list[0].count, yearMonth }
        : { totalAmount: 0, count: 0, yearMonth }

    const groupData = groupResult.data || {}

    // 内联 joinGroup: 根据 openid 查找或创建成员，返回给前端
    let currentMember = null
    let memberRole = ROLE.MEMBER
    let isNew = false
    try {
        const { data: existingMembers } = await db.collection(COL.MEMBERS)
            .where({ groupId: GROUP_ID, openid })
            .get()
        if (existingMembers.length > 0) {
            currentMember = existingMembers[0]
            memberRole = currentMember.role || ROLE.MEMBER
        } else {
            // 检查是否是组织创建者
            const creatorMatch = groupData && groupData.creatorId === openid
            if (creatorMatch) {
                memberRole = ROLE.CREATOR
            }
            if (openid) {
                // 新成员: 自动加入（与 joinGroup 行为一致），创建者同真实落库避免幽灵用户
                const now2 = db.serverDate()
                const newMember = {
                    groupId: GROUP_ID,
                    openid,
                    name: '',
                    nickName: '',
                    avatar: '',
                    role: creatorMatch ? ROLE.CREATOR : ROLE.MEMBER,
                    isVirtual: false,
                    privacyAgreed: false,
                    joinedAt: now2,
                }
                const addRes = await db.collection(COL.MEMBERS).add({ data: newMember })
                currentMember = { ...newMember, _id: addRes._id }
                membersResult.data.push(currentMember)
                isNew = true
                await _touchMenuAndMembersTimestamp()
            }
        }
    } catch (e) {
        console.error('joinGroup inline error:', e)
    }

    await _mergePublicStats(menuResult.data)
    const menuWithUserStats = await _mergeUserStats(menuResult.data, openid)

    return {
        code: 0,
        data: {
            monthSummary,
            recentOrders,
            menu: menuWithUserStats,
            members: membersResult.data,
            member: currentMember,
            role: memberRole,
            isNew,
            groupId: GROUP_ID,
            recentTimestamp: groupData.ordersTimestamp || null,
            menuTimestamp: groupData.menuTimestamp || null,
            membersTimestamp: groupData.membersTimestamp || null,
            notice: groupData.notice || '',
            noticeUpdatedAt: groupData.noticeUpdatedAt || null,
        },
    }
}

async function getRecentOrders(event, openid) {
    await _autoCancelExpiredPending()
    const { limit: reqLimit = 100 } = event
    const today = getToday()

    const { total: todayCount } = await db.collection(COL.ORDERS)
        .where({ groupId: GROUP_ID, date: today })
        .count()

    const actualLimit = Math.min(Math.max(reqLimit, todayCount), 500)

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

async function getAllTimestamps(event, openid) {
    const { data } = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => ({ data: {} }))
    const groupData = data || {}
    const getTs = (val) => {
        if (!val) return null
        if (val instanceof Date) return val.getTime()
        return new Date(val).getTime()
    }
    const ordersTs = getTs(groupData.ordersTimestamp)
    let notice = groupData.notice || ''
    let noticeUpdatedAt = getTs(groupData.noticeUpdatedAt) || null

    // 停止接单时间懒触发：北京时间已过截止时间且今天未发过，自动写群通知（幂等，任何成员调用都会触发）；已禁用则跳过
    const cutoff = groupData.orderCutoff || '10:00'
    const cutoffDisabled = !!groupData.cutoffDisabled
    const bj = new Date(Date.now() + 8 * 3600 * 1000)
    const today = `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, '0')}-${String(bj.getUTCDate()).padStart(2, '0')}`
    const hhmm = `${String(bj.getUTCHours()).padStart(2, '0')}:${String(bj.getUTCMinutes()).padStart(2, '0')}`
    if (!cutoffDisabled && groupData.cutoffNoticeDate !== today && hhmm >= cutoff) {
        notice = `每天${cutoff}停止接单，有需要请电话联系`
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({
            data: { notice, noticeUpdatedAt: db.serverDate(), cutoffNoticeDate: today }
        }).catch(() => { })
        noticeUpdatedAt = Date.now()
    }

    return {
        code: 0,
        data: {
            ordersTimestamp: ordersTs,
            recentTimestamp: ordersTs,
            menuTimestamp: getTs(groupData.menuTimestamp),
            membersTimestamp: getTs(groupData.membersTimestamp),
            notice,
            noticeUpdatedAt,
            orderCutoff: cutoff,
            cutoffDisabled,
        },
    }
}

async function getRecentMenu(event, openid) {
    const { data } = await db.collection(COL.MENU)
        .where({ groupId: GROUP_ID })
        .orderBy('sortNo', 'asc')
        .get()
    await _mergePublicStats(data)
    const result = await _mergeUserStats(data, openid)
    return { code: 0, data: result }
}

async function getRecentMembers(event, openid) {
    const { data } = await db.collection(COL.MEMBERS)
        .where({ groupId: GROUP_ID })
        .orderBy('joinedAt', 'asc')
        .get()
    return { code: 0, data }
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

// 触发菜单与成员的时间戳，前端 checkFreshness 感知后刷新排序
async function _touchMenuAndMembersTimestamp() {
    const now = db.serverDate()
    const existing = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => null)
    if (existing && existing.data) {
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({
            data: { menuTimestamp: now, membersTimestamp: now },
        })
    } else {
        await db.collection(COL.GROUPS).add({
            data: { _id: GROUP_ID, menuTimestamp: now, membersTimestamp: now, createdAt: now },
        })
    }
}

// 一次性更新 orders/data/menu/members 四个时间戳，替代分散的多次 get+update
async function _touchAllTimestamps() {
    const now = db.serverDate()
    const existing = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => null)
    if (existing && existing.data) {
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({
            data: {
                ordersTimestamp: now,
                dataTimestamp: now,
                menuTimestamp: now,
                membersTimestamp: now,
            },
        })
    } else {
        await db.collection(COL.GROUPS).add({
            data: {
                _id: GROUP_ID,
                ordersTimestamp: now,
                dataTimestamp: now,
                menuTimestamp: now,
                membersTimestamp: now,
                createdAt: now,
            },
        })
    }
}

// 合并大众点餐统计（orderCount/lastOrderedAt）到 menu
// orderCount/lastOrderedAt 由 submitOrder 时 _.inc(1) 维护到 menu 文档自身，无需 aggregate 全量订单
async function _mergePublicStats(menu) {
    menu.forEach(item => {
        if (item.orderCount === undefined) item.orderCount = 0
        if (item.lastOrderedAt === undefined) item.lastOrderedAt = null
    })
}

// 合并当前用户对每道菜的个人点餐统计（userCount/userLastAt），用于"最近点过"个人化排序
async function _mergeUserStats(menu, openid) {
    const caller = await getMemberByOpenid(openid).catch(() => null)
    if (!caller || !caller._id) return menu
    const { data: stats } = await db.collection(COL.USER_STATS)
        .where({ groupId: GROUP_ID, memberId: caller._id })
        .get()
    const statMap = {}
    stats.forEach(s => { statMap[s.menuId] = s })
    menu.forEach(item => {
        const s = statMap[item._id]
        if (s) {
            item.userCount = s.count || 0
            item.userLastAt = s.lastAt || null
        }
    })
    return menu
}

// upsert 当前用户对某道菜的个人点餐统计（确定性 _id 避免重复）
async function _upsertUserStat(memberId, menuId, now) {
    if (!memberId) return
    const statId = `${GROUP_ID}_${memberId}_${menuId}`
    const existing = await db.collection(COL.USER_STATS).doc(statId).get().catch(() => ({ data: null }))
    if (existing.data) {
        await db.collection(COL.USER_STATS).doc(statId).update({
            data: { count: _.inc(1), lastAt: now }
        })
    } else {
        await db.collection(COL.USER_STATS).doc(statId).set({
            data: { groupId: GROUP_ID, memberId, menuId, count: 1, lastAt: now }
        })
    }
}

// 自动取消过期待确认订单（date < today && status === pending）

async function _autoCancelExpiredPending() {
    const now = Date.now()
    if (now - (autoCancelByGroup.get(GROUP_ID) || 0) < 60 * 1000) return { cancelled: 0, throttled: true }
    autoCancelByGroup.set(GROUP_ID, now)
    const today = getToday()
    const expired = await fetchAll(db.collection(COL.ORDERS), {
        groupId: GROUP_ID,
        date: _.lt(today),
        status: STATUS.PENDING,
    })
    if (expired.length === 0) return { cancelled: 0 }

    const now2 = db.serverDate()
    const BATCH_SIZE = 100
    for (let i = 0; i < expired.length; i += BATCH_SIZE) {
        const chunk = expired.slice(i, i + BATCH_SIZE)
        await db.collection(COL.ORDERS)
            .where({ _id: _.in(chunk.map(o => o._id)) })
            .update({ data: { status: STATUS.CANCELLED, updatedAt: now2 } })
    }

    const months = new Set(expired.map(o => o.date.substring(0, 7)))
    for (const ym of months) {
        try { await doRebuildMonthStats(ym) } catch (e) { console.error('rebuild month stats error:', e) }
    }
    await _updateOrdersTimestamp()
    return { cancelled: expired.length }
}

async function submitOrder(event, openid) {
    const { date, memberId, menuId, note } = event
    if (!date || !memberId || !menuId) return { code: 400, msg: 'missing required fields' }

    const caller = await getMemberByOpenid(openid)
    if (!caller) return { code: 403, msg: '请先加入当前组织' }
    const bj = new Date(Date.now() + 8 * 3600000)
    const today = bj.toISOString().slice(0, 10)
    const hhmm = bj.toISOString().slice(11, 16)
    if (date !== today) return { code: 400, msg: '点餐仅支持北京时间当天，历史订单请使用导入' }
    const group = await requestGate.groupDoc(db, GROUP_ID)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR) && !group.cutoffDisabled && hhmm >= (group.orderCutoff || '10:00')) {
        return { code: 403, msg: '今日点餐已截止，如需点餐请联系管理员' }
    }
    const menu = (await db.collection(COL.MENU).doc(menuId).get()).data
    const member = (await db.collection(COL.MEMBERS).doc(memberId).get()).data
    if (!menu || menu.groupId !== GROUP_ID || !member || member.groupId !== GROUP_ID) {
        return { code: 404, msg: '菜品或成员不属于当前组织' }
    }
    if (menu.visible === false) return { code: 400, msg: '该菜品已下架，请重新选择' }
    if (typeof menu.price !== 'number' || !Number.isFinite(menu.price) || menu.price < 0) {
        return { code: 400, msg: '菜品价格无效，请联系管理员' }
    }
    if (note !== undefined && (typeof note !== 'string' || note.length > 500)) return { code: 400, msg: '备注格式无效或超过500字' }

    const now = db.serverDate()
    const order = {
        groupId: GROUP_ID,
        date,
        memberId,
        memberName: member.name || member.nickName || '',
        menuId,
        menuName: menu.name || '',
        supplier: menu.supplier || '',
        price: Math.round(menu.price * 100) / 100,
        note: note || '',
        status: STATUS.PENDING,
        createdBy: openid,
        createdAt: now,
        updatedAt: now,
    }

    // 同一组/日期/成员/菜品共用一个事务锁文档；事务中仅使用 doc 操作。
    const key = require('crypto').createHash('sha256').update(JSON.stringify([GROUP_ID, date, memberId, menuId])).digest('hex')
    const lockId = 'order_' + key
    await ensureCollections()
    const { data: existing } = await db.collection(COL.ORDERS)
        .where({ groupId: GROUP_ID, date, memberId, menuId, status: STATUS.PENDING }).limit(1).get()
    if (existing.length) return { code: 409, msg: '已提交相同订单' }
    const { data: lockRows } = await db.collection(COL.ORDER_KEYS).where({ _id: lockId }).limit(1).get()
    if (!lockRows.length) {
        try { await db.collection(COL.ORDER_KEYS).add({ data: { _id: lockId, groupId: GROUP_ID, orderId: '' } }) }
        catch (e) {
            const check = await db.collection(COL.ORDER_KEYS).where({ _id: lockId, groupId: GROUP_ID }).limit(1).get()
            if (!check.data.length) throw e
        }
    }
    let newId = null
    try {
        newId = await db.runTransaction(async transaction => {
            const keyDoc = transaction.collection(COL.ORDER_KEYS).doc(lockId)
            const keyData = (await keyDoc.get()).data
            if (!keyData || keyData.groupId !== GROUP_ID) throw new Error('订单锁归属异常')
            if (keyData.orderId) {
                const prior = await requestGate.optionalDocument(transaction.collection(COL.ORDERS).doc(keyData.orderId))
                if (prior && prior.status === STATUS.PENDING) throw new Error('EXISTING_ORDER')
            }
            const addRes = await transaction.collection(COL.ORDERS).add({ data: order })
            await keyDoc.update({ data: { orderId: addRes._id } })
            return addRes._id
        })
    } catch (e) {
        if (e.message === 'EXISTING_ORDER') return { code: 409, msg: '已提交相同订单' }
        throw e
    }
    order._id = newId

    // 更新菜单项/成员的最近点餐时间与次数，用于前端 LRU+频率排序
    // 同时 upsert 发起人的个人点餐统计（createdBy=我），用于"最近点过"个人化排序
    // 失败不阻断下单主流程
    const callerMemberId = caller && caller._id ? caller._id : null
    await Promise.all([
        db.collection(COL.MENU).doc(menuId).update({
            data: { lastOrderedAt: now, orderCount: _.inc(1) },
        }).catch(e => console.error('touch menu sort error:', e)),
        db.collection(COL.MEMBERS).doc(memberId).update({
            data: { lastOrderedAt: now },
        }).catch(e => console.error('touch member sort error:', e)),
        callerMemberId
            ? _upsertUserStat(callerMemberId, menuId, now).catch(e => console.error('upsert user stat error:', e))
            : Promise.resolve(),
    ])
    await _touchAllTimestamps()
    const [menuDoc, memberDoc] = await Promise.all([
        db.collection(COL.MENU).doc(menuId).get().catch(() => null),
        db.collection(COL.MEMBERS).doc(memberId).get().catch(() => null),
    ])
    return {
        code: 0,
        data: {
            order,
            updatedMenu: menuDoc && menuDoc.data ? menuDoc.data : null,
            updatedMember: memberDoc && memberDoc.data ? memberDoc.data : null,
        },
    }
}

async function batchConfirm(event, openid) {
    const { orderIds, date } = event
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return { code: 400, msg: 'missing orderIds' }
    }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const now = db.serverDate()
    // 批量更新：用 where + _.in 一次更新，避免循环单条 update
    const updateRes = await db.collection(COL.ORDERS)
        .where({ _id: _.in(orderIds), groupId: GROUP_ID })
        .update({ data: { status: STATUS.CONFIRMED, updatedAt: now } })
    const results = orderIds.map(id => ({ orderId: id, success: true }))
    if (updateRes.stats && updateRes.stats.updated !== orderIds.length) {
        console.warn('batchConfirm partial update:', updateRes.stats.updated, '/', orderIds.length)
    }

    if (date) {
        await doRebuildMonthStats(date.substring(0, 7))
    }
    await _touchAllTimestamps()

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
        data: { status: STATUS.CANCELLED, cancelRequested: false, cancelRejected: false, updatedAt: db.serverDate() },
    })

    await doRebuildMonthStats(order.date.substring(0, 7))
    await _touchAllTimestamps()
    return { code: 0 }
}

// 批量取消订单：一次 where update + 仅对涉及月份 rebuild 一次
async function batchCancelOrders(event, openid) {
    const { orderIds } = event
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return { code: 400, msg: 'missing orderIds' }
    }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    // 1. 一次性查出订单（拿 date 用于按月 rebuild）
    const { data: orders } = await db.collection(COL.ORDERS)
        .where({ _id: _.in(orderIds), groupId: GROUP_ID })
        .get()

    // 2. 批量更新状态
    const now = db.serverDate()
    await db.collection(COL.ORDERS)
        .where({ _id: _.in(orderIds), groupId: GROUP_ID })
        .update({
            data: {
                status: STATUS.CANCELLED,
                cancelRequested: false,
                cancelRejected: false,
                updatedAt: now,
            },
        })

    // 3. 仅对涉及的每个月份 rebuild 一次（去重）
    const yearMonths = [...new Set(orders.map(o => o.date.substring(0, 7)))]
    for (const ym of yearMonths) {
        try { await doRebuildMonthStats(ym) } catch (e) { console.error('rebuild month stats error:', e) }
    }

    // 4. 时间戳只更新一次
    await _touchAllTimestamps()

    return { code: 0, data: { cancelled: orders.length } }
}

// 普通成员对已确认订单申请取消
async function requestCancelOrder(event, openid) {
    const { orderId } = event
    if (!orderId) return { code: 400, msg: 'missing orderId' }

    const caller = await getMemberByOpenid(openid)
    if (!caller) return { code: 403, msg: 'member only' }

    const order = (await db.collection(COL.ORDERS).doc(orderId).get()).data
    if (!order) return { code: 404, msg: 'order not found' }
    if (order.memberId !== caller._id) return { code: 403, msg: '只能申请取消自己的订单' }
    if (order.status !== STATUS.CONFIRMED) return { code: 400, msg: '只能对已确认订单申请取消' }
    if (order.cancelRequested) return { code: 409, msg: '已申请取消，请等待管理员处理' }

    await db.collection(COL.ORDERS).doc(orderId).update({
        data: { cancelRequested: true, cancelRejected: false, updatedAt: db.serverDate() },
    })
    await _updateOrdersTimestamp()
    return { code: 0 }
}

// 普通成员取消自己的待确认订单（直接取消）
async function cancelMyOrder(event, openid) {
    const { orderId } = event
    if (!orderId) return { code: 400, msg: 'missing orderId' }

    const caller = await getMemberByOpenid(openid)
    if (!caller) return { code: 403, msg: 'member only' }

    const order = (await db.collection(COL.ORDERS).doc(orderId).get()).data
    if (!order) return { code: 404, msg: 'order not found' }
    if (order.memberId !== caller._id) return { code: 403, msg: '只能取消自己的订单' }
    if (order.status !== STATUS.PENDING) return { code: 400, msg: '只能取消待确认订单' }

    await db.collection(COL.ORDERS).doc(orderId).update({
        data: { status: STATUS.CANCELLED, updatedAt: db.serverDate() },
    })
    await _updateOrdersTimestamp()
    return { code: 0 }
}

// 管理员查询待处理的取消申请
async function getPendingCancelRequests(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { data } = await db.collection(COL.ORDERS)
        .where({ groupId: GROUP_ID, status: STATUS.CONFIRMED, cancelRequested: true })
        .orderBy('updatedAt', 'asc')
        .get()
    return { code: 0, data }
}

// 管理员拒绝取消申请
async function rejectCancelRequest(event, openid) {
    const { orderId } = event
    if (!orderId) return { code: 400, msg: 'missing orderId' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const order = (await db.collection(COL.ORDERS).doc(orderId).get()).data
    if (!order) return { code: 404, msg: 'order not found' }

    await db.collection(COL.ORDERS).doc(orderId).update({
        data: { cancelRequested: false, cancelRejected: true, updatedAt: db.serverDate() },
    })
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
        // 立即占位，防止并发请求也触发 rebuild
        await _updateDataTimestamp()
        try {
            await doRebuildMonthStats(null)
        } catch (e) {
            await _resetDataTimestamp()
            throw e
        }
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
    // orderByMember/orderBySupplier 在库里存了完整数组（带 count），
    // orderByMemberMap/orderBySupplierMap 是前端用的金额 map
    const byMemberAmount = doc.orderByMemberMap || arrayToRecord(doc.orderByMember, 'memberName')
    const bySupplierAmount = doc.orderBySupplierMap || arrayToRecord(doc.orderBySupplier, 'supplier')

    const byMemberCount = {}
    if (Array.isArray(doc.orderByMember)) {
        for (const item of doc.orderByMember) {
            byMemberCount[item.memberName || '未定义'] = item.count || 0
        }
    }
    const bySupplierCount = {}
    if (Array.isArray(doc.orderBySupplier)) {
        for (const item of doc.orderBySupplier) {
            bySupplierCount[item.supplier || '未定义'] = item.count || 0
        }
    }

    return {
        _id: doc._id,
        year: doc.year,
        month: doc.month,
        totalAmount: doc.totalAmount || 0,
        orderCount: doc.orderCount || doc.count || 0,
        orderByMember: byMemberAmount,
        orderBySupplier: bySupplierAmount,
        orderByMemberCount: byMemberCount,
        orderBySupplierCount: bySupplierCount,
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
            orderByMemberMap[item.memberName || '未定义'] = Math.round(item.amount * 100) / 100
        }
        const orderBySupplierMap = {}
        for (const item of orderBySupplier) {
            orderBySupplierMap[item.supplier || '未定义'] = Math.round(item.amount * 100) / 100
        }

        // 用确定性 _id 写入，并发 rebuild 写同一个 _id 不会产生重复
        const docId = `${GROUP_ID}_${m.year}_${m.month}`
        await db.collection(COL.MONTHLY_STATS).doc(docId).set({
            data: {
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
            },
        })
    }

    return { rebuiltMonths: Object.keys(monthMap) }
}

async function searchOrders(event, openid) {
    const { startDate, endDate, memberId, supplier, status, members, suppliers, year, months, page = 1, pageSize = 50, aggregateBy } = event

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

    // 聚合模式：按筛选条件实时聚合（与清单同一 where，保证口径一致）
    // 用于筛选后的汇总卡 / 柱状图 / 饼图
    // 注意：只用 match + group($.sum) —— 项目内已验证的聚合写法；
    // 不使用 project/substrCP 等操作符（云开发聚合管道兼容性风险）
    if (aggregateBy === 'supplier') {
        const [byDateRes, bySupplierRes] = await Promise.all([
            db.collection(COL.ORDERS)
                .aggregate()
                .match(where)
                .group({ _id: '$date', totalAmount: $.sum('$price'), count: $.sum(1) })
                .limit(1000)
                .end(),
            db.collection(COL.ORDERS)
                .aggregate()
                .match(where)
                .group({ _id: '$supplier', totalAmount: $.sum('$price'), count: $.sum(1) })
                .limit(100)
                .end(),
        ])

        // 按日期分组的结果在云函数内合并为月份
        const monthMap = {}
        let totalAmount = 0
        let totalCount = 0
        for (const item of byDateRes.list) {
            const [year, month] = String(item._id || '').substring(0, 7).split('-').map(Number)
            if (!year || !month) continue
            const ym = `${year}-${month}`
            if (!monthMap[ym]) monthMap[ym] = { year, month, totalAmount: 0, orderCount: 0 }
            monthMap[ym].totalAmount += item.totalAmount || 0
            monthMap[ym].orderCount += item.count || 0
            totalAmount += item.totalAmount || 0
            totalCount += item.count || 0
        }
        const byMonth = Object.values(monthMap)
            .map(m => ({ ...m, totalAmount: Math.round(m.totalAmount * 100) / 100 }))
            .sort((a, b) => (a.year - b.year) || (a.month - b.month))

        const aggregate = bySupplierRes.list.map(item => ({
            name: item._id || '未定义',
            totalAmount: Math.round((item.totalAmount || 0) * 100) / 100,
            count: item.count || 0,
        })).sort((a, b) => b.totalAmount - a.totalAmount)

        return {
            code: 0,
            data: {
                aggregate,
                totals: { totalAmount: Math.round(totalAmount * 100) / 100, totalCount },
                byMonth,
                list: [],
                total: 0,
            },
        }
    }

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
        buildCsvLine([o.date, o.menuName, o.memberName, o.price, o.note || '', statusMap[o.status] || o.status, o.supplier])
    )
    const csv = '\uFEFF' + header + '\r\n' + rows.join('\r\n')

    const ts = Date.now()
    const cloudPath = 'lunch/exports/' + GROUP_ID + '/' + require('crypto').randomBytes(16).toString('hex') + '.csv'
    const uploadResult = await cloud.uploadFile({
        cloudPath,
        fileContent: Buffer.from(csv, 'utf-8'),
    })

    return { code: 0, data: { fileID: uploadResult.fileID, count: allOrders.length, fileName: `清单_${new Date().toISOString().slice(0, 10)}.csv` } }
}

async function importFromCsv(event, openid) {
    const { fileID, mode } = event
    if (!fileID) return { code: 400, msg: 'missing fileID' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    try {
        const downloadRes = await cloud.downloadFile({ fileID })
        const buf = Buffer.isBuffer(downloadRes.fileContent)
            ? downloadRes.fileContent
            : Buffer.from(downloadRes.fileContent)

        let text = ''
        if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
            text = buf.slice(3).toString('utf-8')
        } else if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
            text = buf.slice(2).toString('utf-16le')
        } else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
            text = buf.slice(2).toString('utf-16be')
        } else {
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
            } catch (utf8Err) {
                try {
                    text = new TextDecoder('gbk').decode(buf)
                } catch (gbkErr) {
                    text = buf.toString('utf-8')
                }
            }
        }

        const rows = []
        let row = []
        let field = ''
        let inQuotes = false
        for (let i = 0; i < text.length; i++) {
            const ch = text[i]
            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < text.length && text[i + 1] === '"') {
                        field += '"'; i++
                    } else {
                        inQuotes = false
                    }
                } else {
                    field += ch
                }
            } else {
                if (ch === '"') { inQuotes = true }
                else if (ch === ',') { row.push(field); field = '' }
                else if (ch === '\r' || ch === '\n') {
                    if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') { i++ }
                    row.push(field); rows.push(row); row = []; field = ''
                } else {
                    field += ch
                }
            }
        }
        if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
        const filtered = rows.filter(r => r.some(cell => cell && String(cell).trim()))

        const result = await _importOrdersFromRows(filtered, mode || 'append', openid)
        await writeAuditLog(openid, AUDIT_ACTION.ORDERS_IMPORT_FROM_CSV, 'order', '', null,
            { count: (result.data && result.data.count) || 0, mode }, null)
        return result
    } catch (e) {
        return { code: 500, msg: `CSV 导入失败: ${e.message || e}` }
    }
}

async function rebuildOrderRelations(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const allMembers = await fetchAll(db.collection(COL.MEMBERS), { groupId: GROUP_ID })
    const memberByName = {}
    allMembers.forEach(m => { memberByName[m.name] = m._id })

    const allMenu = await fetchAll(db.collection(COL.MENU), { groupId: GROUP_ID })
    const menuByKey = {}
    const menuByName = {}
    allMenu.forEach(it => {
        const key = (it.supplier || '') + '|' + it.name
        menuByKey[key] = it._id
        if (!menuByName[it.name]) menuByName[it.name] = it._id
    })

    const allOrders = await fetchAll(db.collection(COL.ORDERS), { groupId: GROUP_ID })
    const toUpdate = []
    let memberFixed = 0
    let menuFixed = 0
    let memberNotFound = 0
    let menuNotFound = 0

    for (const order of allOrders) {
        const update = {}
        let changed = false

        const matchedMemberId = memberByName[order.memberName]
        if (matchedMemberId && order.memberId !== matchedMemberId) {
            update.memberId = matchedMemberId
            memberFixed++
            changed = true
        } else if (!matchedMemberId && order.memberName) {
            memberNotFound++
        }

        const menuKey = (order.supplier || '') + '|' + order.menuName
        const matchedMenuId = menuByKey[menuKey] || menuByName[order.menuName]
        if (matchedMenuId && order.menuId !== matchedMenuId) {
            update.menuId = matchedMenuId
            menuFixed++
            changed = true
        } else if (!matchedMenuId && order.menuName) {
            menuNotFound++
        }

        if (changed) toUpdate.push({ orderId: order._id, update })
    }

    for (let i = 0; i < toUpdate.length; i += 100) {
        const batch = toUpdate.slice(i, i + 100)
        await Promise.all(batch.map(u =>
            db.collection(COL.ORDERS).doc(u.orderId).update({ data: u.update })
        ))
    }

    await db.collection(COL.USER_STATS).where({ groupId: GROUP_ID }).remove()
    await _updateOrdersTimestamp()

    return {
        code: 0,
        data: {
            totalOrders: allOrders.length,
            memberFixed,
            menuFixed,
            memberNotFound,
            menuNotFound,
            updated: toUpdate.length,
        }
    }
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
        const rows = orders.map(o => buildCsvLine([o.memberName, o.menuName, o.price, o.note || '']))
        const total = orders.reduce((s, o) => s + o.price, 0)
        rows.push(buildCsvLine(['合计', '', Math.round(total * 100) / 100, '']))
        csv = '\uFEFF' + header + '\r\n' + rows.join('\r\n')
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
                rows.push(buildCsvLine([sup, o.memberName, o.menuName, o.price, o.note || '']))
            }
            const subTotal = supOrders.reduce((s, o) => s + o.price, 0)
            rows.push(buildCsvLine([sup, '小计', '', Math.round(subTotal * 100) / 100, '']))
            grandTotal += subTotal
        }
        rows.push(buildCsvLine(['全部', '合计', '', Math.round(grandTotal * 100) / 100, '']))
        csv = '\uFEFF' + header + '\r\n' + rows.join('\r\n')
        fileName = `确认单_全部_${date}.csv`
    }

    const ts = Date.now()
    const cloudPath = 'lunch/exports/' + GROUP_ID + '/' + require('crypto').randomBytes(16).toString('hex') + '.csv'
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

    const header = ['月份', '总金额', '订单数', ...suppliers].map(csvEscape).join(',')
    const rows = stats.map(s => {
        const ym = `${s.year}-${String(s.month).padStart(2, '0')}`
        const supMap = {}
        for (const sup of (s.orderBySupplier || [])) {
            supMap[sup.supplier] = sup.amount
        }
        const supValues = suppliers.map(sup => Math.round((supMap[sup] || 0) * 100) / 100)
        return buildCsvLine([ym, Math.round(s.totalAmount * 100) / 100, s.count, ...supValues])
    })

    const csv = '\uFEFF' + header + '\r\n' + rows.join('\r\n')
    const ts = Date.now()
    const yearSuffix = year || 'all'
    const cloudPath = 'lunch/exports/' + GROUP_ID + '/' + require('crypto').randomBytes(16).toString('hex') + '.csv'
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
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })

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
    // 2-digit year: M/D/YY or MM/DD/YY → assume 20XX
    m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/)
    if (m) {
        const yr = Number(m[3]) + 2000
        return `${yr}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
    }
    return ''
}

const HEADER_ALIASES = {
    date: ['日期', 'date'],
    menuName: ['菜品', '菜品名', 'menuname', 'order', 'description'],
    memberName: ['姓名', 'membername', 'name', 'name list', '名单'],
    price: ['金额', '价格', 'price', 'rmb'],
    note: ['备注', 'note', 'comment', 'column1'],
    status: ['状态', 'status'],
    supplier: ['供应商', 'vendor'],
    supplier_menu: ['供应商', 'vendor'],
    menuName_menu: ['菜品名', '菜品', 'menuname', 'order', 'description'],
    price_menu: ['价格', '金额', 'price', 'rmb'],
    visible: ['可见', 'visible'],
    name_member: ['姓名', 'membername', 'name', 'name list', '名单'],
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

async function _importOrdersFromRows(rows, mode, openid, isLastBatch = true) {
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

    // auto-create missing members and menu items（批量 add，避免循环单条写入）
    const now = db.serverDate()
    const newMembers = {}
    const newMenuItems = {}

    const membersToCreate = []
    for (const o of records) {
        if (!o.memberName || memberMap[o.memberName] || newMembers[o.memberName]) continue
        newMembers[o.memberName] = { _id: null, name: o.memberName }
        membersToCreate.push({
            groupId: GROUP_ID, name: o.memberName, nickName: '', avatar: '', openid: '',
            role: ROLE.MEMBER, isVirtual: true, privacyAgreed: false, joinedAt: now,
        })
    }
    for (let i = 0; i < membersToCreate.length; i += 100) {
        const chunk = membersToCreate.slice(i, i + 100)
        const addRes = await db.collection(COL.MEMBERS).add({ data: chunk })
        addRes._ids.forEach((id, idx) => {
            newMembers[chunk[idx].name]._id = id
        })
    }
    Object.assign(memberMap, newMembers)

    const menuToCreate = []
    for (const o of records) {
        if (!o.menuName) continue
        const menuKey = (o.supplier || '') + '|' + o.menuName
        if (menuMap[menuKey] || menuMap[o.menuName] || newMenuItems[menuKey]) continue
        newMenuItems[menuKey] = { _id: null, name: o.menuName, supplier: o.supplier || '' }
        if (!newMenuItems[o.menuName]) newMenuItems[o.menuName] = newMenuItems[menuKey]
        menuToCreate.push({
            groupId: GROUP_ID, sortNo: (allMenu.length + menuToCreate.length + 1) * 10,
            supplier: o.supplier || '', name: o.menuName, price: Number(o.price) || 0,
            photo: '', visible: true, createdAt: now,
        })
    }
    for (let i = 0; i < menuToCreate.length; i += 100) {
        const chunk = menuToCreate.slice(i, i + 100)
        const addRes = await db.collection(COL.MENU).add({ data: chunk })
        addRes._ids.forEach((id, idx) => {
            const item = chunk[idx]
            const key = (item.supplier || '') + '|' + item.name
            newMenuItems[key]._id = id
            if (newMenuItems[item.name]) newMenuItems[item.name]._id = id
        })
    }
    Object.assign(menuMap, newMenuItems)

    let lastDaySet = null
    if (mode === 'append') {
        // 只查最近一天的订单用于去重，避免 fetchAll 全量订单
        const { list: lastDateAgg } = await db.collection(COL.ORDERS)
            .aggregate()
            .match({ groupId: GROUP_ID })
            .group({ _id: null, lastDate: $.max('$date') })
            .end()
        if (lastDateAgg.length > 0) {
            const lastDate = lastDateAgg[0].lastDate
            const { data: lastDayOrders } = await db.collection(COL.ORDERS)
                .where({ groupId: GROUP_ID, date: lastDate })
                .get()
            lastDaySet = new Set(lastDayOrders.map(o => `${o.memberId}|${o.menuId}`))
        }
    }

    const toInsert = []
    let errorCount = 0
    let skippedCount = 0
    const skippedDetails = []

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
            skippedDetails.push({
                memberName: o.memberName,
                menuName: o.menuName,
                date: o.date,
                price: Number(o.price) || 0,
            })
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
        await _updateOrdersTimestamp()
        if (isLastBatch) {
            await _resetDataTimestamp()
        }
    }

    return { code: 0, data: { count: toInsert.length, errors: errorCount, skipped: skippedCount, skippedDetails } }
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
    if (!Array.isArray(rows) || rows.length < 2) return { code: 400, msg: '文件为空' }
    const idx = _mapHeader(rows[0], ['name_member', 'nickName'])
    if (idx.name_member === undefined) return { code: 400, msg: '需包含姓名列' }
    const members = rows.slice(1).map(cols => ({ name: cols[idx.name_member], nickName: idx.nickName !== undefined ? cols[idx.nickName] : '' }))
    const result = await require('./importMembers').importMembers(db, GROUP_ID, members, mode)
    if (result.code === 0) await _touchMenuAndMembersTimestamp()
    return result
}

// 查询指定成员的个人点餐统计，用于帮他人点餐时"最近点过"按被帮人频率排序
async function getUserMenuStats(event, openid) {
    const { memberId } = event
    if (!memberId) return { code: 400, msg: 'missing memberId' }

    const caller = await getMemberByOpenid(openid).catch(() => null)
    if (!caller) return { code: 403, msg: 'member only' }

    const { data: stats } = await db.collection(COL.USER_STATS)
        .where({ groupId: GROUP_ID, memberId })
        .get()
    const map = {}
    stats.forEach(s => {
        map[s.menuId] = { count: s.count || 0, lastAt: s.lastAt || null }
    })
    return { code: 0, data: { stats: map } }
}

return dispatch
}

exports.main = async (event = {}, context) => {
    const groupId = event.groupId || 'lunch_hp'
    if (!requestGate.validGroupId(groupId)) return { code: 400, msg: 'invalid groupId' }
    let release
    try {
        if (!cloud.getWXContext().OPENID) return { code: 401, msg: '请先登录' }
        if (event.action === 'getInitData') {
            const member = await requestGate.maintenanceMember(db, groupId, cloud.getWXContext().OPENID)
            if (member) return { code: 0, data: { groupId, member, role: member.role, isNew: false,
                menu: [], members: [member], recentOrders: [], monthSummary: { totalAmount: 0, count: 0 },
                notice: '组织正在恢复备份，请到管理页选择同一备份继续恢复', noticeUpdatedAt: new Date(),
                recentTimestamp: null, menuTimestamp: null, membersTimestamp: null } }
        }
        release = await requestGate.enter(db, groupId)
        return await createRequestHandlers(groupId)(event, context)
    } catch (e) {
        return { code: typeof e.code === 'number' ? e.code : 500, msg: e.message }
    } finally {
        if (release) await release()
    }
}
