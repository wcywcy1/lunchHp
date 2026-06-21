const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate
let XLSX = null
try { XLSX = require('xlsx') } catch (e) { }

let GROUP_ID = 'lunch_hp' // 默认值，main 入口会被 event.groupId 覆盖
const COL = {
    GROUPS: 'lunch_groups',
    MEMBERS: 'lunch_members',
    MENU: 'lunch_menu',
    ORDERS: 'lunch_orders',
    USER_STATS: 'lunch_user_menu_stats',
}
const ROLE = { CREATOR: 'creator', ADMIN: 'admin', MEMBER: 'member' }

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

exports.main = async (event, context) => {
    const { OPENID } = cloud.getWXContext()
    const { action } = event
    // 从前端传入 groupId，回退默认值，实现多组织切换
    GROUP_ID = event.groupId || 'lunch_hp'

    const handlers = {
        initGroup,
        joinGroup,
        getMembers,
        getDataTimestamps,
        updateMemberName,
        addVirtualMember,
        importMembers,
        setAdmin,
        agreePrivacy,
        linkVirtualMember,
        adminLinkVirtualMember,
        updateMemberProfile,
        deleteMember,
        getMenuList,
        addMenuItem,
        importMenuItems,
        updateMenuItem,
        deleteMenuItem,
        toggleVisible,
        batchToggleVisibleBySupplier,
        parseXlsx,
        setNotice,
        clearNotice,
        // 通用模式：选组/创建组
        createGroup,
        listJoinedGroups,
        joinGroupByName,
    }

    const fn = handlers[action]
    if (!fn) return { code: 400, msg: `unknown action: ${action}` }
    try {
        return await fn(event, OPENID)
    } catch (e) {
        console.error(`[lunch_menu] ${action} error:`, e)
        return { code: 500, msg: e.message || 'internal error' }
    }
}

async function updateGroupTimestamp(field) {
    try {
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({
            data: { [field]: db.serverDate() }
        })
    } catch (e) {
        console.error(`updateGroupTimestamp(${field}) error:`, e)
    }
}

async function getDataTimestamps(event, openid) {
    const { data } = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => ({ data: {} }))
    return {
        code: 0,
        data: {
            menuTimestamp: data.menuTimestamp || null,
            membersTimestamp: data.membersTimestamp || null,
            notice: data.notice || '',
            noticeUpdatedAt: data.noticeUpdatedAt || null,
        }
    }
}

// 集合初始化只需执行一次，云函数实例复用时跳过
let _collectionsEnsured = false
async function ensureCollections() {
    if (_collectionsEnsured) return
    const required = ['lunch_groups', 'lunch_members', 'lunch_menu', 'lunch_orders', 'lunch_monthly_stats', 'lunch_backups', 'lunch_user_menu_stats']
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

async function initGroup(event, openid) {
    await ensureCollections()
    const { data } = await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => ({ data: null }))
    if (data) return { code: 0, data: { exists: true, group: data } }

    const now = db.serverDate()
    const group = {
        _id: GROUP_ID,
        name: 'HP午饭',
        creatorId: openid,
        qrcode: '',
        createdAt: now,
    }
    await db.collection(COL.GROUPS).add({ data: group })
    return { code: 0, data: { exists: false, group } }
}

// 通用模式：创建新组（组名全局唯一，组ID系统生成）
async function createGroup(event, openid) {
    await ensureCollections()
    const { groupName } = event
    if (!groupName || !groupName.trim()) {
        return { code: 400, msg: '组名不能为空' }
    }
    const name = groupName.trim()

    // 组名全局唯一校验
    const dupCheck = await db.collection(COL.GROUPS)
        .where({ name })
        .get()
    if (dupCheck.data && dupCheck.data.length > 0) {
        return { code: 409, msg: `组名「${name}」已存在，请换一个` }
    }

    // 生成组ID：lunch_ + 时间戳 + 随机后缀
    const ts = Date.now()
    const suffix = Math.random().toString(36).substr(2, 4)
    const newGroupId = `lunch_${ts}_${suffix}`

    const now = db.serverDate()
    const group = {
        _id: newGroupId,
        name,
        creatorId: openid,
        qrcode: '',
        createdAt: now,
    }
    await db.collection(COL.GROUPS).add({ data: group })

    // 创建者自动成为该组成员（creator 角色）
    const member = {
        groupId: newGroupId,
        name: '',
        nickName: '',
        avatar: '',
        openid,
        role: ROLE.CREATOR,
        isVirtual: false,
        privacyAgreed: false,
        joinedAt: now,
    }
    const { _id } = await db.collection(COL.MEMBERS).add({ data: member })
    member._id = _id

    return { code: 0, data: { groupId: newGroupId, groupName: name, member } }
}

// 通用模式：列出当前用户已加入的所有组
async function listJoinedGroups(event, openid) {
    const { data } = await db.collection(COL.MEMBERS)
        .where({ openid })
        .get()
    if (!data || data.length === 0) {
        return { code: 0, data: [] }
    }
    const groupIds = [...new Set(data.map(m => m.groupId))]
    const groups = []
    for (const gid of groupIds) {
        const g = (await db.collection(COL.GROUPS).doc(gid).get().catch(() => ({ data: null }))).data
        if (g) {
            const memberRecord = data.find(m => m.groupId === gid)
            groups.push({
                groupId: gid,
                groupName: g.name,
                role: memberRecord ? memberRecord.role : 'member',
                joinedAt: memberRecord ? memberRecord.joinedAt : null,
            })
        }
    }
    return { code: 0, data: groups }
}

// 通用模式：通过组名加入组（组名全局唯一，按名查找后加入）
async function joinGroupByName(event, openid) {
    const { groupName } = event
    if (!groupName || !groupName.trim()) return { code: 400, msg: '请输入组织名称' }
    const name = groupName.trim()

    // 按组名查找组（组名全局唯一）
    const found = await db.collection(COL.GROUPS)
        .where({ name })
        .get()
    if (!found.data || found.data.length === 0) {
        return { code: 404, msg: `组织「${name}」不存在，请检查名称` }
    }
    const targetGroupId = found.data[0]._id

    // 检查是否已加入
    const existing = await db.collection(COL.MEMBERS)
        .where({ groupId: targetGroupId, openid })
        .get()
    if (existing.data && existing.data.length > 0) {
        return { code: 0, data: { member: existing.data[0], groupId: targetGroupId, groupName: name, alreadyJoined: true } }
    }

    const now = db.serverDate()
    const member = {
        groupId: targetGroupId,
        name: '',
        nickName: '',
        avatar: '',
        openid,
        role: ROLE.MEMBER,
        isVirtual: false,
        privacyAgreed: false,
        joinedAt: now,
    }
    const { _id } = await db.collection(COL.MEMBERS).add({ data: member })
    member._id = _id

    return { code: 0, data: { member, groupId: targetGroupId, groupName: name, alreadyJoined: false } }
}

async function joinGroup(event, openid) {
    const { nickName, name } = event
    const existing = await getMemberByOpenid(openid)
    if (existing && existing._id !== 'recovered') {
        return { code: 0, data: { member: existing, isNew: false, virtualMatch: null } }
    }

    const virtualMatch = name
        ? (await db.collection(COL.MEMBERS)
            .where({ groupId: GROUP_ID, name, isVirtual: true, openid: _.exists(false) })
            .get()).data[0] || null
        : null

    const now = db.serverDate()
    const member = {
        groupId: GROUP_ID,
        name: name || '',
        nickName: nickName || '',
        avatar: '',
        openid,
        role: ROLE.MEMBER,
        isVirtual: false,
        privacyAgreed: false,
        joinedAt: now,
    }

    const { _id } = await db.collection(COL.MEMBERS).add({ data: member })
    member._id = _id

    const groupData = (await db.collection(COL.GROUPS).doc(GROUP_ID).get()).data
    if (groupData && groupData.creatorId === openid) {
        await db.collection(COL.MEMBERS).doc(_id).update({ data: { role: ROLE.CREATOR } })
        member.role = ROLE.CREATOR
    }

    await updateGroupTimestamp('membersTimestamp')
    return { code: 0, data: { member, isNew: true, virtualMatch } }
}

async function getMembers(event, openid) {
    const { data } = await db.collection(COL.MEMBERS)
        .where({ groupId: GROUP_ID })
        .orderBy('joinedAt', 'asc')
        .get()
    return { code: 0, data }
}

async function updateMemberName(event, openid) {
    const { memberId, name } = event
    if (!memberId || name === undefined) return { code: 400, msg: 'missing memberId or name' }

    const caller = await getMemberByOpenid(openid)
    if (!caller) return { code: 403, msg: 'not a member' }

    const target = (await db.collection(COL.MEMBERS).doc(memberId).get()).data
    if (!target) return { code: 404, msg: 'member not found' }

    const isSelf = target.openid === openid
    const isAdminOrCreator = checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)
    if (!isSelf && !isAdminOrCreator) return { code: 403, msg: 'no permission' }

    await db.collection(COL.MEMBERS).doc(memberId).update({ data: { name } })
    await updateGroupTimestamp('membersTimestamp')
    return { code: 0 }
}

async function addVirtualMember(event, openid) {
    const { name } = event
    if (!name) return { code: 400, msg: 'missing name' }

    const caller = await getMemberByOpenid(openid)
    if (!caller) return { code: 403, msg: 'not a member' }

    const now = db.serverDate()
    const member = {
        groupId: GROUP_ID,
        name,
        nickName: '',
        avatar: '',
        openid: '',
        role: ROLE.MEMBER,
        isVirtual: true,
        privacyAgreed: false,
        joinedAt: now,
    }
    const { _id } = await db.collection(COL.MEMBERS).add({ data: member })
    member._id = _id
    await updateGroupTimestamp('membersTimestamp')
    return { code: 0, data: member }
}

async function importMembers(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { members, mode } = event
    if (!Array.isArray(members) || members.length === 0) return { code: 400, msg: 'missing members' }

    if (mode === 'rewrite') {
        await db.collection(COL.MEMBERS).where({ groupId: GROUP_ID, openid: _.neq(openid) }).remove()
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

    await updateGroupTimestamp('membersTimestamp')
    if (mode === 'rewrite') {
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({
            data: { dataTimestamp: 0 },
        }).catch(() => { })
    }
    return { code: 0, data: { count: inserted } }
}

async function agreePrivacy(event, openid) {
    const member = await getMemberByOpenid(openid)
    if (!member) return { code: 403, msg: 'not a member' }
    await db.collection(COL.MEMBERS).doc(member._id).update({ data: { privacyAgreed: true } })
    return { code: 0 }
}

async function linkVirtualMember(event, openid) {
    const { virtualMemberId } = event
    if (!virtualMemberId) return { code: 400, msg: 'missing virtualMemberId' }

    const caller = await getMemberByOpenid(openid)
    if (!caller) return { code: 403, msg: 'not a member' }

    const virtual = (await db.collection(COL.MEMBERS).doc(virtualMemberId).get()).data
    if (!virtual || !virtual.isVirtual) return { code: 404, msg: 'virtual member not found' }

    await db.collection(COL.MEMBERS).doc(virtualMemberId).update({
        data: { openid, isVirtual: false, nickName: caller.nickName || '', privacyAgreed: caller.privacyAgreed || false }
    })

    if (caller.role !== ROLE.MEMBER) {
        await db.collection(COL.MEMBERS).doc(virtualMemberId).update({ data: { role: caller.role } })
    }

    if (caller._id !== 'recovered') {
        await db.collection(COL.MEMBERS).doc(caller._id).remove()
    }

    await updateGroupTimestamp('membersTimestamp')
    const updated = (await db.collection(COL.MEMBERS).doc(virtualMemberId).get()).data
    return { code: 0, data: { member: updated } }
}

// 管理员代关联：把虚拟成员的数据转移到指定的已登录微信成员，并删除虚拟成员
// 参数: { virtualMemberId, targetMemberId }
async function adminLinkVirtualMember(event, openid) {
    const { virtualMemberId, targetMemberId } = event
    if (!virtualMemberId || !targetMemberId) return { code: 400, msg: 'missing virtualMemberId or targetMemberId' }
    if (virtualMemberId === targetMemberId) return { code: 400, msg: '不能关联到自己' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const virtual = (await db.collection(COL.MEMBERS).doc(virtualMemberId).get()).data
    if (!virtual || !virtual.isVirtual) return { code: 404, msg: '虚拟成员不存在' }

    const target = (await db.collection(COL.MEMBERS).doc(targetMemberId).get()).data
    if (!target) return { code: 404, msg: '目标成员不存在' }
    if (target.isVirtual) return { code: 400, msg: '目标成员必须为已登录微信成员' }
    if (!target.openid) return { code: 400, msg: '目标成员未绑定微信' }

    // 1. 转移订单：把虚拟成员的订单 memberId/memberName 改到目标成员
    const virtualOrders = await fetchAll(db.collection(COL.ORDERS), { groupId: GROUP_ID, memberId: virtualMemberId })
    if (virtualOrders.length > 0) {
        const targetName = target.name || target.nickName || ''
        const BATCH = 100
        for (let i = 0; i < virtualOrders.length; i += BATCH) {
            const chunkIds = virtualOrders.slice(i, i + BATCH).map(o => o._id)
            await db.collection(COL.ORDERS)
                .where({ _id: _.in(chunkIds) })
                .update({ data: { memberId: targetMemberId, memberName: targetName } })
        }
    }

    // 2. 合并个人点餐统计（lunch_user_menu_stats，_id 格式: groupId_memberId_menuId）
    const virtualStats = await fetchAll(db.collection(COL.USER_STATS), { groupId: GROUP_ID, memberId: virtualMemberId })
    for (const vs of virtualStats) {
        const newId = `${GROUP_ID}_${targetMemberId}_${vs.menuId}`
        const existing = await db.collection(COL.USER_STATS).doc(newId).get().catch(() => ({ data: null }))
        if (existing.data) {
            // 合并：count 累加，lastAt 取较大值
            const mergedCount = (existing.data.count || 0) + (vs.count || 0)
            const mergedLastAt = (vs.lastAt && existing.data.lastAt)
                ? (new Date(vs.lastAt) > new Date(existing.data.lastAt) ? vs.lastAt : existing.data.lastAt)
                : (vs.lastAt || existing.data.lastAt)
            await db.collection(COL.USER_STATS).doc(newId).update({
                data: { count: mergedCount, lastAt: mergedLastAt }
            })
            await db.collection(COL.USER_STATS).doc(vs._id).remove()
        } else {
            // 直接改 _id 和 memberId：删旧建新
            await db.collection(COL.USER_STATS).doc(newId).set({
                data: {
                    groupId: GROUP_ID,
                    memberId: targetMemberId,
                    menuId: vs.menuId,
                    count: vs.count || 0,
                    lastAt: vs.lastAt || null,
                }
            })
            await db.collection(COL.USER_STATS).doc(vs._id).remove()
        }
    }

    // 3. 删除虚拟成员
    await db.collection(COL.MEMBERS).doc(virtualMemberId).remove()

    // 4. 触发成员时间戳 + 订单时间戳（订单 memberId 变了）
    await updateGroupTimestamp('membersTimestamp')
    try {
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({ data: { ordersTimestamp: db.serverDate() } })
    } catch (e) { console.error('touch ordersTimestamp error:', e) }

    return { code: 0, data: { mergedOrders: virtualOrders.length, mergedStats: virtualStats.length } }
}

// 用户更新自己的头像和昵称（微信平台限制：必须用户主动设置）
// 参数: { avatar, nickName }，只能更新自己
async function updateMemberProfile(event, openid) {
    const { avatar, nickName } = event
    if (avatar === undefined && nickName === undefined) return { code: 400, msg: 'nothing to update' }

    const caller = await getMemberByOpenid(openid)
    if (!caller || caller._id === 'recovered') return { code: 403, msg: 'not a member' }

    const update = {}
    if (avatar !== undefined) update.avatar = avatar
    if (nickName !== undefined) update.nickName = String(nickName).trim()
    if (Object.keys(update).length === 0) return { code: 400, msg: 'nothing to update' }

    await db.collection(COL.MEMBERS).doc(caller._id).update({ data: update })
    await updateGroupTimestamp('membersTimestamp')

    const updated = (await db.collection(COL.MEMBERS).doc(caller._id).get()).data
    return { code: 0, data: { member: updated } }
}

async function deleteMember(event, openid) {
    const { memberId } = event
    if (!memberId) return { code: 400, msg: 'missing memberId' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const target = (await db.collection(COL.MEMBERS).doc(memberId).get()).data
    if (!target) return { code: 404, msg: 'member not found' }
    if (target.role === ROLE.CREATOR) return { code: 400, msg: 'cannot delete creator' }

    await db.collection(COL.MEMBERS).doc(memberId).remove()
    await updateGroupTimestamp('membersTimestamp')
    return { code: 0 }
}

async function setAdmin(event, openid) {
    const { memberId, isAdmin } = event
    if (!memberId || isAdmin === undefined) return { code: 400, msg: 'missing memberId or isAdmin' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.CREATOR)) return { code: 403, msg: 'only creator can set admin' }

    const target = (await db.collection(COL.MEMBERS).doc(memberId).get()).data
    if (!target) return { code: 404, msg: 'member not found' }
    if (target.role === ROLE.CREATOR) return { code: 400, msg: 'cannot change creator role' }

    const newRole = isAdmin ? ROLE.ADMIN : ROLE.MEMBER
    await db.collection(COL.MEMBERS).doc(memberId).update({ data: { role: newRole } })
    await updateGroupTimestamp('membersTimestamp')
    return { code: 0 }
}

async function getMenuList(event, openid) {
    const { data } = await db.collection(COL.MENU)
        .where({ groupId: GROUP_ID })
        .orderBy('sortNo', 'asc')
        .get()
    // orderCount/lastOrderedAt 由 submitOrder 时 _.inc(1) 维护到 menu 文档自身，
    // 无需 aggregate 全量订单。给旧数据补默认值。
    data.forEach(item => {
        if (item.orderCount === undefined) item.orderCount = 0
        if (item.lastOrderedAt === undefined) item.lastOrderedAt = null
    })
    // 合并当前用户的个人点餐统计，用于"最近点过"个人化排序
    const caller = await getMemberByOpenid(openid).catch(() => null)
    if (caller && caller._id && caller._id !== 'recovered') {
        const { data: stats } = await db.collection(COL.USER_STATS)
            .where({ groupId: GROUP_ID, memberId: caller._id })
            .get()
        const statMap = {}
        stats.forEach(s => { statMap[s.menuId] = s })
        data.forEach(item => {
            const s = statMap[item._id]
            if (s) {
                item.userCount = s.count || 0
                item.userLastAt = s.lastAt || null
            }
        })
    }
    return { code: 0, data }
}

async function addMenuItem(event, openid) {
    const { supplier, name, price, photo, visible } = event
    if (!supplier || !name || price === undefined) return { code: 400, msg: 'missing required fields' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { data: existing } = await db.collection(COL.MENU)
        .where({ groupId: GROUP_ID })
        .orderBy('sortNo', 'desc')
        .limit(1)
        .get()
    const maxSortNo = existing.length > 0 ? existing[0].sortNo : 0

    const now = db.serverDate()
    const item = {
        groupId: GROUP_ID,
        sortNo: maxSortNo + 10,
        supplier,
        name,
        price: Number(price),
        photo: photo || '',
        visible: visible !== false,
        createdAt: now,
    }
    const { _id } = await db.collection(COL.MENU).add({ data: item })
    item._id = _id
    await updateGroupTimestamp('menuTimestamp')
    return { code: 0, data: item }
}

async function importMenuItems(event, openid) {
    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const { items, mode } = event
    if (!Array.isArray(items) || items.length === 0) return { code: 400, msg: 'missing items' }

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
    const batch = items.filter(it => it.supplier && it.name && it.price !== undefined).map(it => ({
        groupId: GROUP_ID,
        sortNo: sortNo += 10,
        supplier: it.supplier,
        name: it.name,
        price: Number(it.price) || 0,
        photo: it.photo || '',
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

    await updateGroupTimestamp('menuTimestamp')
    return { code: 0, data: { count: inserted } }
}

async function updateMenuItem(event, openid) {
    const { menuId, supplier, name, price, photo } = event
    if (!menuId) return { code: 400, msg: 'missing menuId' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const update = {}
    if (supplier !== undefined) update.supplier = supplier
    if (name !== undefined) update.name = name
    if (price !== undefined) update.price = Number(price)
    if (photo !== undefined) update.photo = photo
    if (Object.keys(update).length === 0) return { code: 400, msg: 'nothing to update' }

    await db.collection(COL.MENU).doc(menuId).update({ data: update })
    await updateGroupTimestamp('menuTimestamp')
    return { code: 0 }
}

async function deleteMenuItem(event, openid) {
    const { menuId } = event
    if (!menuId) return { code: 400, msg: 'missing menuId' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    await db.collection(COL.MENU).doc(menuId).remove()
    await updateGroupTimestamp('menuTimestamp')
    return { code: 0 }
}

async function toggleVisible(event, openid) {
    const { menuId } = event
    if (!menuId) return { code: 400, msg: 'missing menuId' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const target = (await db.collection(COL.MENU).doc(menuId).get()).data
    if (!target) return { code: 404, msg: 'menu item not found' }

    // visible 为 undefined（老数据）时视为可见，与前端 visible !== false 判断一致
    const newVisible = target.visible === false

    if (newVisible) {
        const { data: visibleItems } = await db.collection(COL.MENU)
            .where({ groupId: GROUP_ID, visible: true })
            .orderBy('sortNo', 'desc')
            .limit(1)
            .get()
        const maxSortNo = visibleItems.length > 0 ? visibleItems[0].sortNo : 0
        await db.collection(COL.MENU).doc(menuId).update({ data: { visible: true, sortNo: maxSortNo + 10 } })
    } else {
        const { data: hiddenItems } = await db.collection(COL.MENU)
            .where({ groupId: GROUP_ID, visible: false })
            .orderBy('sortNo', 'desc')
            .limit(1)
            .get()
        const maxSortNo = hiddenItems.length > 0 ? hiddenItems[0].sortNo : 0
        await db.collection(COL.MENU).doc(menuId).update({ data: { visible: false, sortNo: maxSortNo + 10 } })
    }

    await updateGroupTimestamp('menuTimestamp')
    return { code: 0, data: { visible: newVisible } }
}

async function batchToggleVisibleBySupplier(event, openid) {
    const { supplier, visible } = event
    if (!supplier || visible === undefined) return { code: 400, msg: 'missing supplier or visible' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const newVisible = !!visible

    const { data: items } = await db.collection(COL.MENU)
        .where({ groupId: GROUP_ID, supplier })
        .get()

    if (items.length === 0) return { code: 404, msg: 'no items found for supplier' }

    let maxSortNo = 0
    if (newVisible) {
        const { data: visibleItems } = await db.collection(COL.MENU)
            .where({ groupId: GROUP_ID, visible: true })
            .orderBy('sortNo', 'desc')
            .limit(1)
            .get()
        maxSortNo = visibleItems.length > 0 ? visibleItems[0].sortNo : 0
    } else {
        const { data: hiddenItems } = await db.collection(COL.MENU)
            .where({ groupId: GROUP_ID, visible: false })
            .orderBy('sortNo', 'desc')
            .limit(1)
            .get()
        maxSortNo = hiddenItems.length > 0 ? hiddenItems[0].sortNo : 0
    }

    for (let i = 0; i < items.length; i++) {
        maxSortNo += 10
        await db.collection(COL.MENU).doc(items[i]._id).update({
            data: { visible: newVisible, sortNo: maxSortNo }
        })
    }

    await updateGroupTimestamp('menuTimestamp')
    return { code: 0, data: { supplier, visible: newVisible, count: items.length } }
}

async function parseXlsx(event) {
    if (!XLSX) return { code: 500, msg: 'xlsx库未安装' }
    const { fileID } = event
    if (!fileID) return { code: 400, msg: 'missing fileID' }

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

    return { code: 0, data: { rows } }
}

async function setNotice(event, openid) {
    const { content } = event
    if (!content || !content.trim()) return { code: 400, msg: '通知内容不能为空' }

    const member = await getMemberByOpenid(openid)
    if (!checkRole(member, ROLE.CREATOR, ROLE.ADMIN)) {
        return { code: 403, msg: '无权限' }
    }

    const now = db.serverDate()
    await db.collection(COL.GROUPS).doc(GROUP_ID).update({
        data: {
            notice: content.trim(),
            noticeUpdatedAt: now,
        }
    })

    return { code: 0, data: { notice: content.trim() } }
}

async function clearNotice(event, openid) {
    const member = await getMemberByOpenid(openid)
    if (!checkRole(member, ROLE.CREATOR, ROLE.ADMIN)) {
        return { code: 403, msg: '无权限' }
    }

    await db.collection(COL.GROUPS).doc(GROUP_ID).update({
        data: {
            notice: '',
            noticeUpdatedAt: db.serverDate(),
        }
    })

    return { code: 0 }
}