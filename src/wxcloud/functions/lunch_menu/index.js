const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const GROUP_ID = 'lunch_hp'
const COL = {
    GROUPS: 'lunch_groups',
    MEMBERS: 'lunch_members',
    MENU: 'lunch_menu',
}
const ROLE = { CREATOR: 'creator', ADMIN: 'admin', MEMBER: 'member' }

async function getMemberByOpenid(openid) {
    const { data } = await db.collection(COL.MEMBERS)
        .where({ groupId: GROUP_ID, openid }).get()
    return data[0] || null
}

function checkRole(member, ...allowed) {
    if (!member) return false
    return allowed.includes(member.role)
}

exports.main = async (event, context) => {
    const { OPENID } = cloud.getWXContext()
    const { action } = event

    const handlers = {
        initGroup,
        joinGroup,
        getMembers,
        updateMemberName,
        addVirtualMember,
        setAdmin,
        getMenuList,
        addMenuItem,
        updateMenuItem,
        deleteMenuItem,
        moveMenuItem,
        toggleVisible,
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

async function initGroup(event, openid) {
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

async function joinGroup(event, openid) {
    const { nickName, name } = event
    const existing = await getMemberByOpenid(openid)
    if (existing) {
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
    return { code: 0, data: member }
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
    return { code: 0 }
}

async function getMenuList(event, openid) {
    const { data } = await db.collection(COL.MENU)
        .where({ groupId: GROUP_ID })
        .orderBy('sortNo', 'asc')
        .get()
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
    return { code: 0, data: item }
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
    return { code: 0 }
}

async function deleteMenuItem(event, openid) {
    const { menuId } = event
    if (!menuId) return { code: 400, msg: 'missing menuId' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    await db.collection(COL.MENU).doc(menuId).remove()
    return { code: 0 }
}

async function moveMenuItem(event, openid) {
    const { menuId, direction } = event
    if (!menuId || !direction) return { code: 400, msg: 'missing menuId or direction' }
    if (!['up', 'down'].includes(direction)) return { code: 400, msg: 'direction must be up or down' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const target = (await db.collection(COL.MENU).doc(menuId).get()).data
    if (!target) return { code: 404, msg: 'menu item not found' }

    const { data: items } = await db.collection(COL.MENU)
        .where({ groupId: GROUP_ID, visible: target.visible })
        .orderBy('sortNo', 'asc')
        .get()

    const idx = items.findIndex(i => i._id === menuId)
    if (idx === -1) return { code: 404, msg: 'item not found in visible group' }

    if (direction === 'up' && idx === 0) return { code: 0, msg: 'already at top' }
    if (direction === 'down' && idx === items.length - 1) return { code: 0, msg: 'already at bottom' }

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const swapItem = items[swapIdx]

    await db.collection(COL.MENU).doc(menuId).update({ data: { sortNo: swapItem.sortNo } })
    await db.collection(COL.MENU).doc(swapItem._id).update({ data: { sortNo: target.sortNo } })

    return { code: 0 }
}

async function toggleVisible(event, openid) {
    const { menuId } = event
    if (!menuId) return { code: 400, msg: 'missing menuId' }

    const caller = await getMemberByOpenid(openid)
    if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

    const target = (await db.collection(COL.MENU).doc(menuId).get()).data
    if (!target) return { code: 404, msg: 'menu item not found' }

    const newVisible = !target.visible

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

    return { code: 0, data: { visible: newVisible } }
}