const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

let GROUP_ID = 'lunch_hp' // 默认值，main 入口会被 event.groupId 覆盖
const COL = {
    ORDERS: 'lunch_orders',
    MENU: 'lunch_menu',
    MEMBERS: 'lunch_members',
    BACKUPS: 'lunch_backups',
    GROUPS: 'lunch_groups',
    MONTHLY_STATS: 'lunch_monthly_stats',
    USER_STATS: 'lunch_user_menu_stats',
}
const ROLE = { CREATOR: 'creator', ADMIN: 'admin' }

const AUTO_MAX = 8
const MANUAL_MAX = 10
const BATCH_SIZE = 100

async function touchAllTimestamps() {
    const now = db.serverDate()
    await db.collection(COL.GROUPS).doc(GROUP_ID).update({
        data: { ordersTimestamp: now, menuTimestamp: now, membersTimestamp: now, dataTimestamp: now },
    }).catch(async () => {
        await db.collection(COL.GROUPS).add({
            data: { _id: GROUP_ID, ordersTimestamp: now, menuTimestamp: now, membersTimestamp: now, dataTimestamp: now, createdAt: now },
        })
    })
}

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

function formatTimestamp(d) {
    const dt = new Date(d)
    const y = dt.getFullYear()
    const m = String(dt.getMonth() + 1).padStart(2, '0')
    const day = String(dt.getDate()).padStart(2, '0')
    const h = String(dt.getHours()).padStart(2, '0')
    const min = String(dt.getMinutes()).padStart(2, '0')
    const sec = String(dt.getSeconds()).padStart(2, '0')
    return `${y}${m}${day}_${h}${min}${sec}`
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

async function doBackup(type, remark) {
    const [orders, menu, members] = await Promise.all([
        fetchAll(db.collection(COL.ORDERS), { groupId: GROUP_ID }),
        fetchAll(db.collection(COL.MENU), { groupId: GROUP_ID }),
        fetchAll(db.collection(COL.MEMBERS), { groupId: GROUP_ID }),
    ])

    const dates = orders.map(o => o.date).filter(Boolean).sort()
    const dateRange = dates.length > 0
        ? { start: dates[0], end: dates[dates.length - 1] }
        : null

    const data = JSON.stringify({ orders, menu, members })
    const DATA_SIZE_LIMIT = 10 * 1024 * 1024

    const now = db.serverDate()
    let dataRef = null

    if (data.length > DATA_SIZE_LIMIT) {
        const ts = Date.now()
        const cloudPath = `lunch/backups/${GROUP_ID}_${ts}.json`
        const uploadRes = await cloud.uploadFile({
            cloudPath,
            fileContent: Buffer.from(data, 'utf-8'),
        })
        dataRef = uploadRes.fileID
    }

    const backup = {
        type,
        createdAt: now,
        orderCount: orders.length,
        menuCount: menu.length,
        memberCount: members.length,
        dateRange,
        remark: remark || '',
    }

    if (dataRef) {
        backup.dataRef = dataRef
    } else {
        backup.data = data
    }

    const { _id } = await db.collection(COL.BACKUPS).add({ data: backup })

    if (type === 'auto') {
        await cleanupOldBackups('auto', AUTO_MAX)
    } else {
        await cleanupOldBackups('manual', MANUAL_MAX)
    }

    return {
        _id,
        type,
        orderCount: orders.length,
        menuCount: menu.length,
        memberCount: members.length,
        dateRange,
    }
}

async function cleanupOldBackups(type, maxKeep) {
    const { data: all } = await db.collection(COL.BACKUPS)
        .where({ type })
        .orderBy('createdAt', 'desc')
        .limit(maxKeep + 5)
        .field({ _id: true, dataRef: true })
        .get()

    if (all.length <= maxKeep) return

    const toDelete = all.slice(maxKeep)
    const cloudFiles = toDelete.filter(item => item.dataRef).map(item => item.dataRef)
    if (cloudFiles.length > 0) {
        try { await cloud.deleteFile({ fileList: cloudFiles }) } catch (e) { }
    }
    const toDeleteIds = toDelete.map(item => item._id)
    await db.collection(COL.BACKUPS).where({ _id: _.in(toDeleteIds) }).remove()
}

exports.main = async (event, context) => {
    const { OPENID } = cloud.getWXContext()
    const { action } = event
    // 从前端传入 groupId，回退默认值，实现多组织切换
    GROUP_ID = event.groupId || 'lunch_hp'

    const handlers = {
        backupAuto,
        backupManual,
        restoreBackup,
        getBackupList,
        deleteBackup,
        exportAllOrders,
        clearAllData,
    }

    const fn = handlers[action]
    if (!fn) return { code: 400, msg: `unknown action: ${action}` }
    try {
        return await fn(event, OPENID)
    } catch (e) {
        console.error(`[lunch_backup] ${action} error:`, e)
        return { code: 500, msg: e.message || 'internal error' }
    }
}

async function backupAuto(event, openid) {
    return await doBackup('auto', '')
}

async function backupManual(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { remark } = event
    const result = await doBackup('manual', remark || '')
    return { code: 0, data: result }
}

async function restoreBackup(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { backupId } = event
    if (!backupId) return { code: 400, msg: 'missing backupId' }

    await doBackup('manual', '恢复前自动备份')

    const { data: backupDoc } = await db.collection(COL.BACKUPS).doc(backupId).get()
    if (!backupDoc) return { code: 404, msg: 'backup not found' }

    let backupDataStr
    if (backupDoc.dataRef) {
        const downloadRes = await cloud.downloadFile({ fileID: backupDoc.dataRef })
        const buf = Buffer.isBuffer(downloadRes.fileContent) ? downloadRes.fileContent : Buffer.from(downloadRes.fileContent)
        backupDataStr = buf.toString('utf-8')
    } else {
        backupDataStr = backupDoc.data
    }

    const backupData = JSON.parse(backupDataStr)
    const { orders = [], menu = [], members = [] } = backupData

    await db.collection(COL.ORDERS).where({ groupId: GROUP_ID }).remove()
    await db.collection(COL.MENU).where({ groupId: GROUP_ID }).remove()
    await db.collection(COL.MEMBERS).where({ groupId: GROUP_ID }).remove()
    await db.collection(COL.MONTHLY_STATS).where({ groupId: GROUP_ID }).remove()
    await db.collection(COL.USER_STATS).where({ groupId: GROUP_ID }).remove()

    const now = db.serverDate()

    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map(o => {
            const { _id, ...rest } = o
            return db.collection(COL.ORDERS).doc(_id).set({
                data: { ...rest, createdAt: now, updatedAt: now },
            }).catch(() => db.collection(COL.ORDERS).add({
                data: { ...rest, createdAt: now, updatedAt: now },
            }))
        }))
    }

    for (let i = 0; i < menu.length; i += BATCH_SIZE) {
        const batch = menu.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map(m => {
            const { _id, ...rest } = m
            return db.collection(COL.MENU).doc(_id).set({
                data: { ...rest, createdAt: now, updatedAt: now },
            }).catch(() => db.collection(COL.MENU).add({
                data: { ...rest, createdAt: now, updatedAt: now },
            }))
        }))
    }

    for (let i = 0; i < members.length; i += BATCH_SIZE) {
        const batch = members.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map(m => {
            const { _id, ...rest } = m
            return db.collection(COL.MEMBERS).doc(_id).set({
                data: { ...rest, joinedAt: now },
            }).catch(() => db.collection(COL.MEMBERS).add({
                data: { ...rest, joinedAt: now },
            }))
        }))
    }

    await touchAllTimestamps()

    return { code: 0, data: { orderCount: orders.length, menuCount: menu.length, memberCount: members.length, timestampsUpdated: true } }
}

async function getBackupList(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { data } = await db.collection(COL.BACKUPS)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .field({ data: false })
        .get()

    return { code: 0, data }
}

async function deleteBackup(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { backupId } = event
    if (!backupId) return { code: 400, msg: 'missing backupId' }

    const { data: doc } = await db.collection(COL.BACKUPS).doc(backupId).get().catch(() => ({ data: null }))
    if (doc && doc.dataRef) {
        try { await cloud.deleteFile({ fileList: [doc.dataRef] }) } catch (e) { }
    }

    await db.collection(COL.BACKUPS).doc(backupId).remove()
    return { code: 0 }
}

async function exportAllOrders(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const allOrders = await fetchAll(db.collection(COL.ORDERS), { groupId: GROUP_ID })

    const statusMap = { pending: '待确认', confirmed: '已确认', cancelled: '已取消' }
    const header = '日期,菜品,姓名,金额,备注,状态,供应商'
    const rows = allOrders.map(o =>
        buildCsvLine([o.date, o.menuName, o.memberName, o.price, o.note || '', statusMap[o.status] || o.status, o.supplier || ''])
    )
    const csv = '\uFEFF' + header + '\r\n' + rows.join('\r\n')

    const ts = formatTimestamp(new Date())
    const cloudPath = `lunch/exports/all_orders_${ts}.csv`
    const uploadResult = await cloud.uploadFile({
        cloudPath,
        fileContent: Buffer.from(csv, 'utf-8'),
    })

    return { code: 0, data: { fileID: uploadResult.fileID, count: allOrders.length, fileName: `全量订单_${ts}.csv` } }
}

async function clearAllData(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.CREATOR)) return { code: 403, msg: 'creator only' }

    await db.collection(COL.ORDERS).where({ groupId: GROUP_ID }).remove()
    await db.collection(COL.MENU).where({ groupId: GROUP_ID }).remove()
    await db.collection(COL.MEMBERS).where({ groupId: GROUP_ID, role: _.neq('creator') }).remove()
    await db.collection(COL.MONTHLY_STATS).where({ groupId: GROUP_ID }).remove()
    await db.collection(COL.USER_STATS).where({ groupId: GROUP_ID }).remove()
    await touchAllTimestamps()

    return { code: 0 }
}