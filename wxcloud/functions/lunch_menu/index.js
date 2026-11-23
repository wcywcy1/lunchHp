const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate
let XLSX = null
try { XLSX = require('xlsx') } catch (e) { }

const requestGate = require('./requestGate')
const _rateMap = new Map()
let _collectionsEnsured = false

// 每次调用创建独立组织上下文，避免复用实例并发请求时串组。
function createRequestHandlers(GROUP_ID) {
    const COL = {
        GROUPS: 'lunch_groups',
        MEMBERS: 'lunch_members',
        MENU: 'lunch_menu',
        ORDERS: 'lunch_orders',
        USER_STATS: 'lunch_user_menu_stats',
        AUDIT_LOGS: 'lunch_audit_logs',
    }
    const ROLE = { CREATOR: 'creator', ADMIN: 'admin', MEMBER: 'member' }
    const monthStats = require('./monthStats').createMonthStats({ db, groupId: GROUP_ID })

    const AUDIT_ACTION = {
        MEMBER_NAME: 'updateMemberName',
        MEMBER_PROFILE: 'updateMemberProfile',
        MEMBER_ADD: 'addMember',
        MEMBER_DELETE: 'deleteMember',
        MEMBER_IMPORT: 'importMembers',
        MEMBER_LINK: 'linkVirtualMember',
        MEMBER_LINK_ADMIN: 'adminLinkVirtualMember',
        MENU_UPDATE: 'updateMenuItem',
        MENU_DELETE: 'deleteMenuItem',
        MENU_ADD: 'addMenuItem',
        MENU_IMPORT: 'importMenuItems',
        MENU_VISIBLE: 'toggleMenuVisible',
        ORDERS_IMPORT: 'importOrders',
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
            const now = db.serverDate()
            const member = {
                groupId: GROUP_ID,
                openid,
                name: '',
                nickName: '',
                avatar: '',
                role: ROLE.CREATOR,
                isVirtual: false,
                privacyAgreed: false,
                joinedAt: now,
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
            parseCsv,
            setOrderCutoff,
            setCutoffDisabled,
            // 通用模式：选组/创建组
            createGroup,
            listJoinedGroups,
            joinGroupByName,
            deleteGroup,
        }

        const fn = handlers[action]
        if (!fn) return { code: 400, msg: `unknown action: ${action}` }
        try {
            if (!Object.prototype.hasOwnProperty.call(handlers, action)) return { code: 400, msg: 'unknown action' }
            if (!OPENID) return { code: 401, msg: '请先登录' }
            const publicActions = ['initGroup', 'createGroup', 'listJoinedGroups', 'joinGroup', 'joinGroupByName']
            if (!publicActions.includes(action)) {
                const caller = await getMemberByOpenid(OPENID)
                if (!caller) return { code: 403, msg: '请先加入当前组织' }
                if (['parseXlsx', 'parseCsv'].includes(action) && !checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) {
                    return { code: 403, msg: 'admin/creator only' }
                }
            }
            const targetError = await validateTargetDocuments(action, event)
            if (targetError) return targetError
            if (['parseXlsx', 'parseCsv', 'importFromCsv', 'importFromXlsx'].includes(action) && event.fileID && !requestGate.validImportFile(event.fileID, GROUP_ID)) {
                return { code: 403, msg: '导入文件不属于当前组织，请重新上传' }
            }
            return await fn(event, OPENID)
        } catch (e) {
            console.error(`[lunch_menu] ${action} error:`, e)
            return { code: typeof e.code === 'number' ? e.code : 500, msg: e.message || 'internal error' }
        }
    }

    async function validateTargetDocuments(action, event) {
        const targets = []
        if (['updateMemberName', 'deleteMember', 'setAdmin'].includes(action)) targets.push([COL.MEMBERS, event.memberId])
        if (['linkVirtualMember', 'adminLinkVirtualMember'].includes(action)) targets.push([COL.MEMBERS, event.virtualMemberId])
        if (['updateMenuItem', 'deleteMenuItem', 'toggleVisible'].includes(action)) targets.push([COL.MENU, event.menuId])
        for (const [collection, id] of targets) {
            if (typeof id !== 'string' || !id.trim()) return { code: 400, msg: 'invalid document ID' }
            const { data } = await db.collection(collection).where({ _id: id, groupId: GROUP_ID }).limit(1).get()
            if (!data.length) return { code: 404, msg: '目标数据不存在或不属于当前组织' }
        }
        return null
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
        const groupData = data || {}
        const getTs = (val) => {
            if (!val) return null
            if (val instanceof Date) return val.getTime()
            return new Date(val).getTime()
        }
        const cutoff = groupData.orderCutoff || '10:00'
        const cutoffDisabled = !!groupData.cutoffDisabled

        return {
            code: 0,
            data: {
                recentTimestamp: getTs(groupData.ordersTimestamp),
                menuTimestamp: getTs(groupData.menuTimestamp),
                membersTimestamp: getTs(groupData.membersTimestamp),
                orderCutoff: cutoff,
                cutoffDisabled,
            },
        }
    }

    // 集合初始化只需执行一次，云函数实例复用时跳过
    // 集合初始化状态在模块级缓存。
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
        if (data) return { code: 0, data: { exists: true } }

        // 组不存在（如被删除或失效）：返回 404，前端清除失效会话并引导回选组页。
        // 任何组织（含 hp 默认组）都不自动创建，建组统一走 createGroup
        return { code: 404, msg: 'group not found' }
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
        const release = await requestGate.enter(db, targetGroupId)
        try {

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
        } finally {
            await release()
        }
    }

    // 删除组织：业务数据 + 组织专属备份/下单锁，以及确认无其他组织引用的头像文件
    async function deleteGroup(event, openid) {
        const caller = await getMemberByOpenid(openid)
        if (!checkRole(caller, ROLE.CREATOR)) return { code: 403, msg: 'only creator can delete group' }

        // 删除前收集组织专属文件：备份 JSON 与成员头像
        const [backups, members] = await Promise.all([
            fetchAll(db.collection('lunch_backups'), { groupId: GROUP_ID }),
            fetchAll(db.collection(COL.MEMBERS), { groupId: GROUP_ID }),
        ])
        const backupFiles = backups.map(bk => bk.fileID).filter(Boolean)
        const avatarFiles = [...new Set(members
            .map(m => m.avatar)
            .filter(file => typeof file === 'string' && file.startsWith('cloud://')))]

        // 头像可能仍被其他组织/用户引用（如同时属于两个组织），只删除无引用的文件。
        // 该查询在任何删除动作之前执行，失败则终止，不改变任何数据。
        let referencedAvatars = new Set()
        if (avatarFiles.length > 0) {
            const holders = await fetchAll(db.collection(COL.MEMBERS), {
                groupId: _.neq(GROUP_ID),
                avatar: _.in(avatarFiles),
            })
            referencedAvatars = new Set(holders.map(m => m.avatar))
        }

        // 彻底清除本组织全部数据
        await db.collection(COL.ORDERS).where({ groupId: GROUP_ID }).remove()
        await db.collection(COL.MENU).where({ groupId: GROUP_ID }).remove()
        await db.collection(COL.MEMBERS).where({ groupId: GROUP_ID }).remove()
        await db.collection(COL.USER_STATS).where({ groupId: GROUP_ID }).remove()
        try { await db.collection('lunch_monthly_stats').where({ groupId: GROUP_ID }).remove() } catch (e) { console.warn('clear monthly_stats error:', e.message) }
        try { await db.collection(COL.AUDIT_LOGS).where({ groupId: GROUP_ID }).remove() } catch (e) { console.warn('clear audit_logs error:', e.message) }
        try { await db.collection('lunch_backups').where({ groupId: GROUP_ID }).remove() } catch (e) { console.warn('clear backups error:', e.message) }
        try { await db.collection('lunch_order_keys').where({ groupId: GROUP_ID }).remove() } catch (e) { console.warn('clear order_keys error:', e.message) }

        const filesToDelete = [...new Set([
            ...backupFiles,
            ...avatarFiles.filter(file => !referencedAvatars.has(file)),
        ])]
        for (let i = 0; i < filesToDelete.length; i += 50) {
            const batch = filesToDelete.slice(i, i + 50)
            try {
                const res = await cloud.deleteFile({ fileList: batch })
                const failed = (res && Array.isArray(res.fileList) ? res.fileList : [])
                    .filter(item => item && item.status !== 0)
                if (failed.length > 0) {
                    console.warn('clear group files failed:',
                        failed.map(item => `${item.fileID}:${item.errMsg || item.status}`).join(', '))
                }
            } catch (e) {
                // 文件删除失败不阻断组织删除，但需记录完整批次用于事后清理
                console.warn('clear group files error:', e.message, batch.join(','))
            }
        }

        await db.collection(COL.GROUPS).doc(GROUP_ID).remove()

        return { code: 0 }
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

        await updateGroupTimestamp('membersTimestamp')
        return { code: 0, data: { member, isNew: true, virtualMatch } }
    }

    async function getMembers(event, openid) {
        const data = await fetchAll(db.collection(COL.MEMBERS), { groupId: GROUP_ID })
        data.sort((a, b) => new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0))
        return { code: 0, data }
    }

    async function updateMemberName(event, openid) {
        const { memberId, name } = event
        if (!memberId || name === undefined) return { code: 400, msg: 'missing memberId or name' }
        if (!String(name).trim()) return { code: 400, msg: '姓名不能为空' }
        if (String(name).trim().length > 20) return { code: 400, msg: '姓名不能超过20个字符' }

        const caller = await getMemberByOpenid(openid)
        if (!caller) return { code: 403, msg: 'not a member' }

        const target = (await db.collection(COL.MEMBERS).doc(memberId).get()).data
        if (!target) return { code: 404, msg: 'member not found' }

        const isSelf = target.openid === openid
        const isAdminOrCreator = checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)
        if (!isSelf && !isAdminOrCreator) return { code: 403, msg: 'no permission' }

        const newName = String(name).trim()
        await db.collection(COL.MEMBERS).doc(memberId).update({ data: { name: newName } })
        await writeAuditLog(openid, AUDIT_ACTION.MEMBER_NAME, 'member', memberId, { name: target.name }, { name: newName }, null)
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
        await writeAuditLog(openid, AUDIT_ACTION.MEMBER_ADD, 'member', _id, null, { name: member.name }, null)
        await updateGroupTimestamp('membersTimestamp')
        return { code: 0, data: member }
    }

    async function importMembers(event, openid) {
        const caller = await getMemberByOpenid(openid)
        if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }
        const pendingMerge = await db.collection(COL.MEMBERS)
            .where({ groupId: GROUP_ID, mergeFromMemberId: _.exists(true) })
            .limit(1)
            .get()
        if (pendingMerge.data.length) return { code: 409, msg: '存在未完成合账，请先完成后再导入成员' }
        const result = await require('./importMembers').importMembers(db, GROUP_ID, event.members, event.mode, event.retainedNames)
        if (result.code === 0) {
            await writeAuditLog(openid, AUDIT_ACTION.MEMBER_IMPORT, 'member', '', null, result.data, null)
            await updateGroupTimestamp('membersTimestamp')
        }
        return result
    }

    async function agreePrivacy(event, openid) {
        const member = await getMemberByOpenid(openid)
        if (!member) return { code: 403, msg: 'not a member' }
        await db.collection(COL.MEMBERS).doc(member._id).update({ data: { privacyAgreed: true } })
        return { code: 0 }
    }

    function latestTime(a, b) {
        if (!a) return b || null
        if (!b) return a
        return new Date(a) > new Date(b) ? a : b
    }

    function mergeProfileFields(virtual, source, mode) {
        const fields = {
            openid: source.openid,
            mergeFromMemberId: source._id,
            role: source.role || ROLE.MEMBER,
            privacyAgreed: source.privacyAgreed || false,
        }
        if (mode === 'admin') {
            fields.nickName = source.nickName || virtual.nickName || ''
            fields.avatar = source.avatar || virtual.avatar || ''
        } else {
            fields.nickName = source.nickName || ''
            fields.avatar = virtual.avatar || source.avatar || ''
        }
        return fields
    }

    // 认领事务：同时更新 virtual 和删除 source，保证同一 openid 只保留一个成员。
    async function claimVirtualMember(virtualMemberId, sourceMemberId, expectedOpenid, mode) {
        await db.runTransaction(async tx => {
            const vRef = tx.collection(COL.MEMBERS).doc(virtualMemberId)
            const sRef = tx.collection(COL.MEMBERS).doc(sourceMemberId)
            const virtual = await requestGate.optionalDocument(vRef)
            const source = await requestGate.optionalDocument(sRef)

            if (!virtual || virtual.groupId !== GROUP_ID || virtual.isVirtual !== true || virtual.openid || virtual.mergeFromMemberId) {
                throw requestGate.error(409, '该记录已被认领或合账状态已变化，请刷新后重试')
            }
            if (!source || source.groupId !== GROUP_ID || source.isVirtual || source.openid !== expectedOpenid || sourceMemberId === virtualMemberId) {
                throw requestGate.error(409, '目标微信成员状态已变化，请刷新后重试')
            }
            if (mode === 'admin' && source.role === ROLE.CREATOR) {
                throw requestGate.error(403, '创建者不能作为合账目标')
            }

            await vRef.update({ data: { ...mergeProfileFields(virtual, source, mode), mergeFromMemberId: sourceMemberId } })
            await sRef.remove()
            // 立即通知所有客户端成员身份已变化，旧设备按 openid 解析到新 memberId
            await tx.collection(COL.GROUPS).doc(GROUP_ID).update({ data: { membersTimestamp: db.serverDate() } })
        })
    }

    async function completeMemberMerge({ virtualMemberId, virtual, sourceId, mode, actorOpenid, sourceSnapshot, entryDataTimestamp }) {
        const virtualName = virtual.name || virtual.nickName || ''
        const affectedMonths = new Set()
        let migratedOrders = 0

        async function moveSourceOrders() {
            const orders = await fetchAll(db.collection(COL.ORDERS), { groupId: GROUP_ID, memberId: sourceId })
            if (orders.length === 0) return
            const BATCH = 100
            for (let i = 0; i < orders.length; i += BATCH) {
                const chunk = orders.slice(i, i + BATCH)
                await db.collection(COL.ORDERS)
                    .where({ _id: _.in(chunk.map(o => o._id)), groupId: GROUP_ID })
                    .update({ data: { memberId: virtualMemberId, memberName: virtualName } })
            }
            for (const order of orders) {
                migratedOrders++
                if (order.status === 'confirmed' && order.date) affectedMonths.add(order.date.substring(0, 7))
            }
        }

        // 1. 迁移 source 订单；2. 归一 virtual 历史订单姓名；3. 再次扫描 source 残留
        await moveSourceOrders()

        const virtualOrders = await fetchAll(db.collection(COL.ORDERS), { groupId: GROUP_ID, memberId: virtualMemberId })
        const renameOrders = virtualOrders.filter(o => (o.memberName || '') !== virtualName)
        if (renameOrders.length > 0) {
            const BATCH = 100
            for (let i = 0; i < renameOrders.length; i += BATCH) {
                const chunk = renameOrders.slice(i, i + BATCH)
                await db.collection(COL.ORDERS)
                    .where({ _id: _.in(chunk.map(o => o._id)), groupId: GROUP_ID })
                    .update({ data: { memberName: virtualName } })
            }
            for (const order of renameOrders) {
                if (order.status === 'confirmed' && order.date) affectedMonths.add(order.date.substring(0, 7))
            }
        }

        await moveSourceOrders()

        // 4. 个人统计：逐菜单两文档事务，保证重试不重复累计
        const sourceStats = await fetchAll(db.collection(COL.USER_STATS), { groupId: GROUP_ID, memberId: sourceId })
        for (const stat of sourceStats) {
            if (!stat.menuId) continue
            const newId = `${GROUP_ID}_${virtualMemberId}_${stat.menuId}`
            await db.runTransaction(async tx => {
                const oldRef = tx.collection(COL.USER_STATS).doc(stat._id)
                const newRef = tx.collection(COL.USER_STATS).doc(newId)
                const oldStat = await requestGate.optionalDocument(oldRef)
                if (!oldStat) return
                const existing = await requestGate.optionalDocument(newRef)
                if (existing) {
                    await newRef.update({
                        data: {
                            count: (existing.count || 0) + (oldStat.count || 0),
                            lastAt: latestTime(existing.lastAt, oldStat.lastAt),
                        },
                    })
                } else {
                    await newRef.set({
                        data: {
                            groupId: GROUP_ID,
                            memberId: virtualMemberId,
                            menuId: stat.menuId,
                            count: oldStat.count || 0,
                            lastAt: oldStat.lastAt || null,
                        },
                    })
                }
                await oldRef.remove()
            })
        }

        // 5. 服务端重建受影响月份（或全量），复用 monthStats 模块
        const needsFullRebuild = !entryDataTimestamp || entryDataTimestamp === 0
        const isRetry = !!virtual.mergeFromMemberId
        let months = [...affectedMonths]
        if (!needsFullRebuild && isRetry) {
            const confirmed = await fetchAll(db.collection(COL.ORDERS), {
                groupId: GROUP_ID,
                memberId: virtualMemberId,
                status: 'confirmed',
            })
            months = [...new Set(confirmed.map(o => o.date && o.date.substring(0, 7)).filter(Boolean))]
        }

        const didRebuild = needsFullRebuild || months.length > 0
        if (needsFullRebuild) {
            await monthStats.rebuildMonth(null)
        } else if (months.length > 0) {
            await monthStats.rebuildMonths(months)
        }

        // 6. 时间戳
        const now = db.serverDate()
        const groupUpdate = { membersTimestamp: now, ordersTimestamp: now }
        if (didRebuild) groupUpdate.dataTimestamp = now
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({ data: groupUpdate })

        // 7. finalize：所有迁移和统计重建成功后才清除指针
        await db.collection(COL.MEMBERS).doc(virtualMemberId).update({
            data: { isVirtual: false, mergeFromMemberId: _.remove() },
        })

        const updated = (await db.collection(COL.MEMBERS).doc(virtualMemberId).get()).data

        // 8. 审计日志为附属记录，失败不影响合账成功
        try {
            if (mode === 'admin') {
                await writeAuditLog(actorOpenid, AUDIT_ACTION.MEMBER_LINK_ADMIN, 'member', virtualMemberId,
                    { targetSnapshot: sourceSnapshot || { _id: sourceId }, virtualSnapshot: virtual },
                    { memberId: virtualMemberId },
                    { ordersMoved: migratedOrders, statsMoved: sourceStats.length, rebuiltMonths: didRebuild ? months : [] })
            } else {
                await writeAuditLog(actorOpenid, AUDIT_ACTION.MEMBER_LINK, 'member', virtualMemberId,
                    {
                        callerId: sourceId,
                        callerName: sourceSnapshot ? sourceSnapshot.name : '',
                        callerAvatar: sourceSnapshot ? sourceSnapshot.avatar : '',
                        virtualSnapshot: virtual,
                    },
                    { memberId: virtualMemberId },
                    { ordersMoved: migratedOrders, statsMoved: sourceStats.length, rebuiltMonths: didRebuild ? months : [] })
            }
        } catch (e) {
            console.error('merge audit log error:', e)
        }

        return { member: updated, mergedOrders: migratedOrders, mergedStats: sourceStats.length, rebuiltMonths: didRebuild ? months : [] }
    }

    async function linkVirtualMember(event, openid) {
        const { virtualMemberId } = event
        if (!virtualMemberId) return { code: 400, msg: 'missing virtualMemberId' }

        const virtual = (await db.collection(COL.MEMBERS).doc(virtualMemberId).get()).data
        if (!virtual || virtual.groupId !== GROUP_ID) return { code: 404, msg: 'virtual member not found' }

        const entryGroup = (await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => ({ data: {} }))).data || {}
        const entryDataTimestamp = entryGroup.dataTimestamp

        // 进行中：按指针继续完成，不再要求 source 成员存在
        if (virtual.mergeFromMemberId) {
            if (virtual.openid !== openid) return { code: 409, msg: '该记录已被其他微信账号认领' }
            return {
                code: 0,
                data: await completeMemberMerge({
                    virtualMemberId,
                    virtual,
                    sourceId: virtual.mergeFromMemberId,
                    mode: 'self',
                    actorOpenid: openid,
                    sourceSnapshot: null,
                    entryDataTimestamp,
                }),
            }
        }

        if (!virtual.isVirtual) {
            if (virtual.openid === openid) {
                return { code: 0, data: { member: virtual, mergedOrders: 0, mergedStats: 0, rebuiltMonths: [] } }
            }
            return { code: 404, msg: 'virtual member not found' }
        }
        if (virtual.openid) return { code: 409, msg: '该成员已关联微信账号' }

        const caller = await getMemberByOpenid(openid)
        if (!caller) return { code: 403, msg: 'not a member' }
        if (caller._id === virtualMemberId) return { code: 409, msg: '合账状态异常，请刷新后重试' }
        if (caller.mergeFromMemberId) return { code: 409, msg: '当前成员有未完成合账，请先完成后再关联' }

        await claimVirtualMember(virtualMemberId, caller._id, caller.openid || openid, 'self')
        return {
            code: 0,
            data: await completeMemberMerge({
                virtualMemberId,
                virtual,
                sourceId: caller._id,
                mode: 'self',
                actorOpenid: openid,
                sourceSnapshot: caller,
                entryDataTimestamp,
            }),
        }
    }

    // 管理员代关联：把已登录微信成员的数据转移到指定的虚拟成员，保留虚拟成员（带着历史订单），
    // 挂上微信 openid，删除微信成员记录。结果名字为虚拟成员的名字。
    // 参数: { virtualMemberId, targetMemberId }
    async function adminLinkVirtualMember(event, openid) {
        const { virtualMemberId, targetMemberId } = event
        if (!virtualMemberId || !targetMemberId) return { code: 400, msg: 'missing virtualMemberId or targetMemberId' }
        if (virtualMemberId === targetMemberId) return { code: 400, msg: '不能关联到自己' }

        const caller = await getMemberByOpenid(openid)
        if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

        const virtual = (await db.collection(COL.MEMBERS).doc(virtualMemberId).get()).data
        if (!virtual || virtual.groupId !== GROUP_ID) return { code: 404, msg: '虚拟成员不存在' }

        const entryGroup = (await db.collection(COL.GROUPS).doc(GROUP_ID).get().catch(() => ({ data: {} }))).data || {}
        const entryDataTimestamp = entryGroup.dataTimestamp

        // 进行中：按指针继续完成；target 已被认领事务删除，不再要求 target 存在
        if (virtual.mergeFromMemberId) {
            if (virtual.mergeFromMemberId !== targetMemberId) {
                return { code: 409, msg: '该记录存在另一笔未完成合账，请刷新后重试' }
            }
            return {
                code: 0,
                data: await completeMemberMerge({
                    virtualMemberId,
                    virtual,
                    sourceId: virtual.mergeFromMemberId,
                    mode: 'admin',
                    actorOpenid: openid,
                    sourceSnapshot: null,
                    entryDataTimestamp,
                }),
            }
        }

        if (!virtual.isVirtual) return { code: 409, msg: '目标虚拟成员已被关联或已完成合账' }
        if (virtual.openid) return { code: 409, msg: '该成员已被其他微信账号认领' }

        const targetRes = await db.collection(COL.MEMBERS)
            .where({ _id: targetMemberId, groupId: GROUP_ID })
            .limit(1)
            .get()
        const target = targetRes.data[0]
        if (!target) return { code: 404, msg: '目标成员不存在' }
        if (target.isVirtual) return { code: 400, msg: '目标成员必须为已登录微信成员' }
        if (!target.openid) return { code: 400, msg: '目标成员未绑定微信' }
        if (target.role === ROLE.CREATOR) return { code: 403, msg: '创建者不能作为合账目标' }
        if (target.mergeFromMemberId) return { code: 409, msg: '目标成员存在未完成合账' }

        await claimVirtualMember(virtualMemberId, targetMemberId, target.openid, 'admin')
        return {
            code: 0,
            data: await completeMemberMerge({
                virtualMemberId,
                virtual,
                sourceId: targetMemberId,
                mode: 'admin',
                actorOpenid: openid,
                sourceSnapshot: target,
                entryDataTimestamp,
            }),
        }
    }

    // 用户更新自己的头像和昵称（微信平台限制：必须用户主动设置）
    // 参数: { avatar, nickName }，只能更新自己
    async function updateMemberProfile(event, openid) {
        const { avatar, nickName } = event
        if (avatar === undefined && nickName === undefined) return { code: 400, msg: 'nothing to update' }

        const caller = await getMemberByOpenid(openid)
        if (!caller) return { code: 403, msg: 'not a member' }

        const update = {}
        if (avatar !== undefined) update.avatar = avatar
        if (nickName !== undefined) update.nickName = String(nickName).trim()
        if (Object.keys(update).length === 0) return { code: 400, msg: 'nothing to update' }

        const oldSnapshot = { avatar: caller.avatar, nickName: caller.nickName }
        await db.collection(COL.MEMBERS).doc(caller._id).update({ data: update })
        await writeAuditLog(openid, AUDIT_ACTION.MEMBER_PROFILE, 'member', caller._id, oldSnapshot, update, null)
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
        if (target.mergeFromMemberId) return { code: 409, msg: '合账未完成，请先继续完成后再删除' }

        await writeAuditLog(openid, AUDIT_ACTION.MEMBER_DELETE, 'member', memberId, target, null, null)
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
        const data = await fetchAll(db.collection(COL.MENU), { groupId: GROUP_ID })
        data.sort((a, b) => (a.sortNo || 0) - (b.sortNo || 0))
        // orderCount/lastOrderedAt 由 submitOrder 时 _.inc(1) 维护到 menu 文档自身，
        // 无需 aggregate 全量订单。给旧数据补默认值。
        data.forEach(item => {
            if (item.orderCount === undefined) item.orderCount = 0
            if (item.lastOrderedAt === undefined) item.lastOrderedAt = null
        })
        // 合并当前用户的个人点餐统计，用于"最近点过"个人化排序
        const caller = await getMemberByOpenid(openid).catch(() => null)
        if (caller && caller._id) {
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
        await writeAuditLog(openid, AUDIT_ACTION.MENU_ADD, 'menu', _id, null, item, null)
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

        await writeAuditLog(openid, AUDIT_ACTION.MENU_IMPORT, 'menu', '', null, { count: inserted, mode }, null)
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

        const oldItem = (await db.collection(COL.MENU).doc(menuId).get()).data
        await db.collection(COL.MENU).doc(menuId).update({ data: update })
        await writeAuditLog(openid, AUDIT_ACTION.MENU_UPDATE, 'menu', menuId, oldItem, update, null)
        await updateGroupTimestamp('menuTimestamp')
        return { code: 0 }
    }

    async function deleteMenuItem(event, openid) {
        const { menuId } = event
        if (!menuId) return { code: 400, msg: 'missing menuId' }

        const caller = await getMemberByOpenid(openid)
        if (!checkRole(caller, ROLE.ADMIN, ROLE.CREATOR)) return { code: 403, msg: 'admin/creator only' }

        const oldItem = (await db.collection(COL.MENU).doc(menuId).get()).data
        if (!oldItem) return { code: 404, msg: 'menu item not found' }
        await writeAuditLog(openid, AUDIT_ACTION.MENU_DELETE, 'menu', menuId, oldItem, null, null)
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

        await writeAuditLog(openid, AUDIT_ACTION.MENU_VISIBLE, 'menu', menuId,
            { visible: target.visible, sortNo: target.sortNo }, { visible: newVisible }, null)
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

    async function parseCsv(event, openid) {
        const { fileID } = event
        if (!fileID) return { code: 400, msg: 'missing fileID' }

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
            return { code: 0, data: { rows: filtered } }
        } catch (e) {
            return { code: 500, msg: `CSV 解析失败: ${e.message || e}` }
        }
    }

    async function setOrderCutoff(event, openid) {
        const { time } = event
        if (!/^\d{2}:\d{2}$/.test(time || '')) {
            return { code: 400, msg: '时间格式不正确' }
        }
        const [h, m] = time.split(':').map(Number)
        if (h > 23 || m > 59) {
            return { code: 400, msg: '时间格式不正确' }
        }

        const member = await getMemberByOpenid(openid)
        if (!checkRole(member, ROLE.CREATOR, ROLE.ADMIN)) {
            return { code: 403, msg: '无权限' }
        }

        // 保存新时间视为启用（自动解除禁用）
        await db.collection(COL.GROUPS).doc(GROUP_ID).update({
            data: { orderCutoff: time, cutoffDisabled: false }
        })

        return { code: 0, data: { orderCutoff: time, cutoffDisabled: false } }
    }

    async function setCutoffDisabled(event, openid) {
        const { disabled } = event
        if (typeof disabled !== 'boolean') return { code: 400, msg: '参数错误' }

        const member = await getMemberByOpenid(openid)
        if (!checkRole(member, ROLE.CREATOR, ROLE.ADMIN)) {
            return { code: 403, msg: '无权限' }
        }

        await db.collection(COL.GROUPS).doc(GROUP_ID).update({ data: { cutoffDisabled: disabled } })

        return { code: 0, data: { cutoffDisabled: disabled } }
    }

    return dispatch
}

// 只读操作无需获取租约，避免并发事务冲突。
const READ_ACTIONS = new Set([
    'getMembers', 'getDataTimestamps', 'getMenuList',
    'parseXlsx', 'parseCsv', 'listJoinedGroups',
])

exports.main = async (event = {}, context) => {
    const groupId = event.groupId || 'lunch_hp'
    if (!requestGate.validGroupId(groupId)) return { code: 400, msg: 'invalid groupId' }
    let release
    try {
        if (!cloud.getWXContext().OPENID) return { code: 401, msg: '请先登录' }
        if (event.action === 'joinGroup') {
            const member = await requestGate.maintenanceMember(db, groupId, cloud.getWXContext().OPENID)
            if (member) return { code: 0, data: { member, isNew: false, virtualMatch: null } }
        }
        // 读操作和选组/建组跳过租约，防止并发事务冲突
        if (!READ_ACTIONS.has(event.action) && !['initGroup', 'createGroup', 'listJoinedGroups', 'joinGroupByName'].includes(event.action)) {
            release = await requestGate.enter(db, groupId)
        }
        return await createRequestHandlers(groupId)(event, context)
    } catch (e) {
        return { code: typeof e.code === 'number' ? e.code : 500, msg: e.message }
    } finally {
        if (release) await release()
    }
}
