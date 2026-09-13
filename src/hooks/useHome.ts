import { ref, computed } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { useStore, setStore, getCache, setCache, saveSession, getRecentLoadTime, setRecentLoadTime, flushCache } from '../services/store'
import { menuAction, orderAction } from '../services/repositories/baseRepository'
import { waitForInit } from '../services/appInit'
import { CACHE_KEYS, CACHE_TTL } from '../constants/cacheConfig'
import { useRealtimeWatch } from './useRealtimeWatch'
import { APP_MODE } from '../constants/appConfig'
import { getTodayString } from '../utils/date'

export function useHome() {
    const store = useStore()
    const loading = ref(false)
    const showPrivacyDialog = ref(false)
    const showNameDialog = ref(false)
    const showWelcomeDialog = ref(false)
    const editingName = ref('')
    const editingAvatar = ref('')
    const avatarChanged = ref(false)
    const showLinkDialog = ref(false)
    const selectedVirtualId = ref('')
    const saving = ref(false)
    const noticeContent = ref('')
    const realtime = useRealtimeWatch()

    const currentAvatar = computed(() => store.member?.avatar || '')

    let lastFreshnessCheck: number = 0
    const FRESHNESS_THROTTLE_MS = 10 * 1000

    // 判断通知是否是今天的（0点自动过期）
    function isNoticeToday(noticeTime: any): boolean {
        if (!noticeTime) return false
        const t = noticeTime instanceof Date ? noticeTime : new Date(noticeTime)
        if (isNaN(t.getTime())) return false
        const today = new Date()
        return t.getFullYear() === today.getFullYear()
            && t.getMonth() === today.getMonth()
            && t.getDate() === today.getDate()
    }

    const memberLoading = ref(false)

    const displayName = computed(() => {
        const m = store.member
        if (!m) return memberLoading.value ? '加载中...' : ''
        return m.name || m.nickName || '未命名'
    })

    const currentMemberId = computed(() => store.member?._id || '')

    const todayDate = computed(() => {
        const d = new Date()
        return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`
    })

    const todayOrders = computed(() => {
        const today = getTodayString()
        return (store.recentOrders || [])
            .filter((o: any) => o.date === today)
    })

    const todayCount = computed(() =>
        todayOrders.value.filter((o: any) => o.status !== 'cancelled').length
    )

    const monthCount = computed(() => store.monthSummary?.count || 0)

    const virtualMembers = computed(() =>
        (store.members || []).filter((m: any) => m.isVirtual === true)
    )

    async function initApp() {
        loading.value = true
        memberLoading.value = true
        try {
            const res = await orderAction('getInitData')
            if (res.result.code === 0) {
                const { member, isNew, monthSummary, recentOrders, menu, members,
                    recentTimestamp, menuTimestamp, membersTimestamp, notice, noticeUpdatedAt } = res.result.data
                if (member) {
                    setStore({ member, role: member.role, groupId: member.groupId })
                    saveSession({ groupId: member.groupId, role: member.role, member })
                }
                setStore({ monthSummary, recentOrders, menu, members,
                    recentTimestamp, menuTimestamp, membersTimestamp, initialized: true })
                setCache(CACHE_KEYS.RECENT_ORDERS, recentOrders)
                setCache(CACHE_KEYS.MENU, menu)
                setCache(CACHE_KEYS.MEMBERS, members)
                setCache(CACHE_KEYS.RECENT_TIMESTAMP, recentTimestamp)
                setCache(CACHE_KEYS.MENU_TIMESTAMP, menuTimestamp)
                setCache(CACHE_KEYS.MEMBERS_TIMESTAMP, membersTimestamp)
                setCache(CACHE_KEYS.MONTH_SUMMARY, monthSummary)
                setRecentLoadTime(Date.now())
                noticeContent.value = notice && isNoticeToday(noticeUpdatedAt) ? notice : ''
                if (member && !member.privacyAgreed) {
                    showPrivacyDialog.value = true
                } else if (isNew && member && !member.name) {
                    showWelcomeDialog.value = true
                }
            }
        } catch (e) {
            console.error('initApp error:', e)
            // 提供重试入口，避免用户必须杀进程重启
            uni.showModal({
                title: '初始化失败',
                content: '加载数据失败，是否重试？',
                confirmText: '重试',
                cancelText: '取消',
                success: (res) => {
                    if (res.confirm) initApp()
                }
            })
        } finally {
            loading.value = false
            memberLoading.value = false
        }
    }

    async function loadInitData() {
        await waitForInit()
        try {
            const res = await orderAction('getInitData')
            if (res.result.code === 0) {
                const { monthSummary, recentOrders, menu, members, recentTimestamp, menuTimestamp, membersTimestamp, notice, noticeUpdatedAt } = res.result.data
                setStore({ monthSummary, recentOrders, menu, members, recentTimestamp, menuTimestamp, membersTimestamp, initialized: true })
                setCache(CACHE_KEYS.RECENT_ORDERS, recentOrders)
                setCache(CACHE_KEYS.MENU, menu)
                setCache(CACHE_KEYS.MEMBERS, members)
                setCache(CACHE_KEYS.RECENT_TIMESTAMP, recentTimestamp)
                setCache(CACHE_KEYS.MENU_TIMESTAMP, menuTimestamp)
                setCache(CACHE_KEYS.MEMBERS_TIMESTAMP, membersTimestamp)
                setCache(CACHE_KEYS.MONTH_SUMMARY, monthSummary)
                setRecentLoadTime(Date.now())
                noticeContent.value = notice && isNoticeToday(noticeUpdatedAt) ? notice : ''
            }
        } catch (e) {
            console.error('loadInitData error:', e)
        }
    }

    async function onShow() {
        if (APP_MODE === 'general' && !uni.getStorageSync('lunch_session')) {
            uni.reLaunch({ url: '/pages/group-select/index' })
            return
        }
        if (store.isSwitchingGroup) return
        if (!store.member) {
            await initApp()
            return
        }
        if (!store.member.privacyAgreed) {
            showPrivacyDialog.value = true
            return
        }
        startRealtimeWatch()
        const now = Date.now()
        if (now - lastFreshnessCheck < FRESHNESS_THROTTLE_MS) return
        lastFreshnessCheck = now
        await checkFreshness()
    }

    function startRealtimeWatch() {
        realtime.watchTodayOrders({
            onInit: () => {},
            onPatch: (changes: any[]) => {
                if (!changes || changes.length === 0) return
                const orders = [...(store.recentOrders || [])]
                for (const c of changes) {
                    const idx = orders.findIndex((o: any) => o._id === c.doc._id)
                    if (c.queueType === 'add' || c.queueType === 'init') {
                        if (idx < 0) orders.unshift(c.doc)
                    } else if (c.queueType === 'update' || c.queueType === 'replace') {
                        if (idx >= 0) orders[idx] = c.doc
                    } else if (c.queueType === 'remove') {
                        if (idx >= 0) orders.splice(idx, 1)
                    }
                }
                setStore({ recentOrders: orders })
                setCache(CACHE_KEYS.RECENT_ORDERS, orders)
                refreshMonthSummary()
            },
            onError: () => { fetchRecentOrders() }
        })
        realtime.watchGroupNotice((snapshot: any) => {
            if (snapshot.type === 'init') {
                const docs = snapshot.docs
                const d = docs && docs[0]
                noticeContent.value = d && d.notice && isNoticeToday(d.noticeUpdatedAt) ? d.notice : ''
                return
            }
            const docChanges = snapshot.docChanges || []
            for (const change of docChanges) {
                if (change.dataType === 'update' || change.dataType === 'replace') {
                    const uf = change.updatedFields || {}
                    const doc = change.doc || {}
                    const notice = uf.notice !== undefined ? uf.notice : doc.notice
                    const noticeTime = uf.noticeUpdatedAt !== undefined ? uf.noticeUpdatedAt : doc.noticeUpdatedAt || 0
                    noticeContent.value = notice && isNoticeToday(noticeTime) ? notice : ''
                }
            }
        })
    }

    const showNoticeBanner = computed(() => noticeContent.value.length > 0)

    async function checkFreshness() {
        try {
            const res = await orderAction('getAllTimestamps')
            if (res.result.code === 0) {
                const { recentTimestamp, menuTimestamp, membersTimestamp, notice, noticeUpdatedAt, orderCutoff, cutoffDisabled } = res.result.data
                setStore({ groupCutoff: orderCutoff || '10:00', cutoffDisabled: !!cutoffDisabled })
                if (notice && isNoticeToday(noticeUpdatedAt)) {
                    noticeContent.value = notice
                } else {
                    noticeContent.value = ''
                }
                if (recentTimestamp !== store.recentTimestamp) {
                    await fetchRecentOrders(recentTimestamp)
                } else {
                    setRecentLoadTime(Date.now())
                }
                if (menuTimestamp !== store.menuTimestamp) {
                    try {
                        const menuRes = await orderAction('getRecentMenu')
                        if (menuRes.result.code === 0) {
                            const menu = menuRes.result.data
                            setStore({ menu, menuTimestamp })
                            setCache(CACHE_KEYS.MENU, menu)
                            setCache(CACHE_KEYS.MENU_TIMESTAMP, menuTimestamp)
                        }
                    } catch (e) { console.error('checkFreshness menu error:', e) }
                }
                if (membersTimestamp !== store.membersTimestamp) {
                    try {
                        const membersRes = await orderAction('getRecentMembers')
                        if (membersRes.result.code === 0) {
                            const members = membersRes.result.data
                            setStore({ members, membersTimestamp })
                            setCache(CACHE_KEYS.MEMBERS, members)
                            setCache(CACHE_KEYS.MEMBERS_TIMESTAMP, membersTimestamp)
                            // 同步本人角色变更（如被设/撤管理员），使 TabBar/权限立即生效
                            if (store.member?._id) {
                                const me = members.find((m: any) => m._id === store.member._id)
                                if (me && me.role !== store.member.role) {
                                    setStore({ member: me, role: me.role })
                                    saveSession({ groupId: me.groupId, role: me.role, member: me })
                                }
                            }
                        }
                    } catch (e) { console.error('checkFreshness members error:', e) }
                }
            }
        } catch (e) {
            console.error('checkFreshness error:', e)
        }
    }

    async function fetchRecentOrders(newTimestamp?: any) {
        try {
            const res = await orderAction('getRecentOrders')
            if (res.result.code === 0) {
                const orders = res.result.data
                setStore({ recentOrders: orders })
                setCache(CACHE_KEYS.RECENT_ORDERS, orders)
                if (newTimestamp !== undefined) {
                    setStore({ recentTimestamp: newTimestamp })
                    setCache(CACHE_KEYS.RECENT_TIMESTAMP, newTimestamp)
                }
                setRecentLoadTime(Date.now())
                await refreshMonthSummary()
            }
        } catch (e) {
            console.error('fetchRecentOrders error:', e)
        }
    }

    async function refreshMonthSummary() {
        try {
            const res = await orderAction('getMonthSummary')
            if (res.result.code === 0) {
                const monthSummary = res.result.data
                setStore({ monthSummary })
                setCache(CACHE_KEYS.MONTH_SUMMARY, monthSummary)
            }
        } catch (e) {
            console.error('refreshMonthSummary error:', e)
        }
    }

    async function refreshData() {
        loading.value = true
        try {
            await fetchRecentOrders()
        } finally {
            loading.value = false
            uni.stopPullDownRefresh()
        }
    }

    // 普通成员取消自己的待确认订单（直接取消）
    async function cancelMyOrder(orderId: string) {
        const { confirm } = await uni.showModal({ title: '确认取消', content: '取消后订单将变为已取消状态，确定？' })
        if (!confirm) return
        try {
            const res = await orderAction('cancelMyOrder', { orderId })
            if (res.result.code === 0) {
                uni.showToast({ title: '已取消', icon: 'success' })
                await fetchRecentOrders()
            } else {
                throw new Error(res.result.msg || '取消失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '取消失败', icon: 'none' })
        }
    }

    // 普通成员对已确认订单申请取消
    async function requestCancelOrder(orderId: string) {
        const { confirm } = await uni.showModal({ title: '申请取消', content: '将向管理员发送取消申请，确定？' })
        if (!confirm) return
        try {
            const res = await orderAction('requestCancelOrder', { orderId })
            if (res.result.code === 0) {
                uni.showToast({ title: '申请已发送', icon: 'success' })
                await fetchRecentOrders()
            } else {
                throw new Error(res.result.msg || '申请失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '申请失败', icon: 'none' })
        }
    }

    async function agreePrivacy() {
        if (!store.member) return
        try {
            await menuAction('agreePrivacy')
            store.member.privacyAgreed = true
            saveSession({ groupId: store.member.groupId, role: store.member.role, member: store.member })
            showPrivacyDialog.value = false
            if (!store.member.name) {
                showWelcomeDialog.value = true
            }
        } catch (e) {
            console.error('agreePrivacy error:', e)
        }
    }

    function disagreePrivacy() {
        ;(wx as any).exitMiniProgram()
    }

    async function saveName() {
        if (saving.value) return
        const name = editingName.value.trim()
        if (!name) {
            uni.showToast({ title: '姓名不能为空', icon: 'none' })
            return
        }
        if (!store.member) return
        saving.value = true
        const oldName = store.member.name
        try {
            store.member.name = name
            await menuAction('updateMemberName', { memberId: store.member._id, name })
            if (avatarChanged.value && editingAvatar.value) {
                const cloudPath = `lunch/avatar_${store.member._id}_${Date.now()}.jpg`
                const uploadRes = await wx.cloud.uploadFile({
                    cloudPath,
                    filePath: editingAvatar.value,
                })
                const profileRes = await menuAction('updateMemberProfile', { avatar: uploadRes.fileID })
                if (profileRes.result.code === 0) {
                    store.member.avatar = uploadRes.fileID
                }
            }
            saveSession({ groupId: store.member.groupId, role: store.member.role, member: store.member })
            editingName.value = ''
            editingAvatar.value = ''
            avatarChanged.value = false
            showNameDialog.value = false
            showWelcomeDialog.value = false
            uni.showToast({ title: '已保存', icon: 'success' })
        } catch (e: any) {
            if (store.member) {
                store.member.name = oldName
            }
            uni.showToast({ title: e.message || '保存失败', icon: 'none' })
        } finally {
            saving.value = false
        }
    }

    function onChooseAvatar(e: any) {
        const url = e?.detail?.avatarUrl
        if (!url) return
        editingAvatar.value = url
        avatarChanged.value = true
    }

    async function skipWelcome() {
        if (saving.value) return
        if (!store.member) return
        saving.value = true
        const autoName = `用户${Date.now()}`
        const oldName = store.member.name
        try {
            store.member.name = autoName
            await menuAction('updateMemberName', { memberId: store.member._id, name: autoName })
            saveSession({ groupId: store.member.groupId, role: store.member.role, member: store.member })
            showWelcomeDialog.value = false
            editingAvatar.value = ''
            avatarChanged.value = false
        } catch (e: any) {
            if (store.member) {
                store.member.name = oldName
            }
            uni.showToast({ title: e.message || '保存失败', icon: 'none' })
        } finally {
            saving.value = false
        }
    }

    function openNameEdit() {
        editingName.value = store.member?.name || ''
        editingAvatar.value = store.member?.avatar || ''
        avatarChanged.value = false
        showNameDialog.value = true
    }

    function closeNameDialog() {
        showNameDialog.value = false
        showLinkDialog.value = false
        editingName.value = ''
        editingAvatar.value = ''
        avatarChanged.value = false
    }

    function openLinkDialog() {
        showLinkDialog.value = true
    }

    async function linkVirtualMember() {
        if (saving.value) return
        if (!selectedVirtualId.value || !store.member) return
        saving.value = true
        try {
            const res = await menuAction('linkVirtualMember', { virtualMemberId: selectedVirtualId.value })
            if (res.result.code === 0) {
                const { member } = res.result.data
                setStore({ member, role: member.role })
                saveSession({ groupId: member.groupId, role: member.role, member })
                showLinkDialog.value = false
                showNameDialog.value = false
                uni.showToast({ title: '关联成功', icon: 'success' })
                await loadInitData()
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '关联失败', icon: 'none' })
        } finally {
            saving.value = false
        }
    }

    function selectVirtual(id: string) {
        selectedVirtualId.value = id
    }

    return {
        loading,
        memberLoading,
        displayName,
        currentMemberId,
        todayDate,
        monthCount,
        todayCount,
        todayOrders,
        showPrivacyDialog,
        showNameDialog,
        showWelcomeDialog,
        editingName,
        editingAvatar,
        currentAvatar,
        avatarChanged,
        virtualMembers,
        showLinkDialog,
        selectedVirtualId,
        noticeContent,
        showNoticeBanner,
        initApp,
        onShow,
        onHide: () => realtime.closeAll(),
        refreshData,
        cancelMyOrder,
        requestCancelOrder,
        agreePrivacy,
        disagreePrivacy,
        saveName,
        onChooseAvatar,
        skipWelcome,
        openNameEdit,
        closeNameDialog,
        openLinkDialog,
        linkVirtualMember,
        selectVirtual,
    }
}