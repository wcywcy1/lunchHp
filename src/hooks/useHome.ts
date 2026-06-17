import { ref, computed } from 'vue'
import { useStore, setStore, getCache, setCache, saveSession, getRecentLoadTime, setRecentLoadTime } from '../services/store'
import { menuAction, orderAction } from '../services/repositories/baseRepository'
import { waitForInit } from '../services/appInit'
import { CACHE_KEYS, CACHE_TTL } from '../constants/cacheConfig'
import { ORDER_STATUS } from '../constants/orderStatus'

function getToday() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useHome() {
    const store = useStore()
    const loading = ref(false)
    const showPrivacyDialog = ref(false)
    const showNameDialog = ref(false)
    const showWelcomeDialog = ref(false)
    const editingName = ref('')
    const showLinkDialog = ref(false)
    const selectedVirtualId = ref('')

    const displayName = computed(() => {
        const m = store.member
        return m ? (m.name || m.nickName || '未命名') : ''
    })

    const todayDate = computed(() => {
        const d = new Date()
        return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`
    })

    const todayOrders = computed(() => {
        const today = getToday()
        return (store.recentOrders || [])
            .filter((o: any) => o.date === today && o.status !== ORDER_STATUS.CANCELLED)
    })

    const todayAmount = computed(() =>
        todayOrders.value.reduce((sum: number, o: any) => sum + (o.price || 0), 0)
    )

    const monthTotal = computed(() => store.monthSummary?.totalAmount || 0)

    const virtualMembers = computed(() =>
        (store.members || []).filter((m: any) => m.isVirtual === true)
    )

    async function initApp() {
        loading.value = true
        try {
            await waitForInit()
            const joinRes = await menuAction('joinGroup', { nickName: '', name: '' })
            if (joinRes.result.code === 0) {
                const { member, isNew } = joinRes.result.data
                setStore({ member, role: member.role, groupId: member.groupId })
                saveSession({ groupId: member.groupId, role: member.role, member })
                if (!member.privacyAgreed) {
                    showPrivacyDialog.value = true
                } else if (isNew && !member.name) {
                    showWelcomeDialog.value = true
                }
            }
            await loadInitData()
        } catch (e) {
            console.error('initApp error:', e)
            uni.showToast({ title: '初始化失败，请重试', icon: 'none' })
        } finally {
            loading.value = false
        }
    }

    async function loadInitData() {
        await waitForInit()
        try {
            const res = await orderAction('getInitData')
            if (res.result.code === 0) {
                const { monthSummary, recentOrders, menu, members, recentTimestamp } = res.result.data
                setStore({ monthSummary, recentOrders, menu, members, recentTimestamp, initialized: true })
                setCache(CACHE_KEYS.RECENT_ORDERS, recentOrders)
                setCache(CACHE_KEYS.MENU, menu)
                setCache(CACHE_KEYS.MEMBERS, members)
                setCache(CACHE_KEYS.RECENT_TIMESTAMP, recentTimestamp)
                setRecentLoadTime(Date.now())
            }
        } catch (e) {
            console.error('loadInitData error:', e)
        }
    }

    async function onShow() {
        if (!store.member) {
            await initApp()
            return
        }
        if (!store.member.privacyAgreed) {
            showPrivacyDialog.value = true
            return
        }
        const now = Date.now()
        if (now - getRecentLoadTime() < CACHE_TTL.RECENT_ORDERS) return
        await checkFreshness()
    }

    async function checkFreshness() {
        try {
            const res = await orderAction('getRecentTimestamp')
            if (res.result.code === 0) {
                const serverTs = res.result.data.recentTimestamp
                if (serverTs !== store.recentTimestamp) {
                    await fetchRecentOrders(serverTs)
                } else {
                    setRecentLoadTime(Date.now())
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
            }
        } catch (e) {
            console.error('fetchRecentOrders error:', e)
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
        const name = editingName.value.trim()
        if (!store.member) return
        try {
            await menuAction('updateMemberName', { memberId: store.member._id, name })
            store.member.name = name
            saveSession({ groupId: store.member.groupId, role: store.member.role, member: store.member })
            editingName.value = ''
            showNameDialog.value = false
            showWelcomeDialog.value = false
            uni.showToast({ title: '已保存', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '保存失败', icon: 'none' })
        }
    }

    function skipWelcome() {
        showWelcomeDialog.value = false
    }

    function openNameEdit() {
        editingName.value = store.member?.name || ''
        showNameDialog.value = true
    }

    function closeNameDialog() {
        showNameDialog.value = false
        showLinkDialog.value = false
        editingName.value = ''
    }

    function openLinkDialog() {
        showLinkDialog.value = true
    }

    async function linkVirtualMember() {
        if (!selectedVirtualId.value || !store.member) return
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
        }
    }

    function selectVirtual(id: string) {
        selectedVirtualId.value = id
    }

    return {
        loading,
        displayName,
        todayDate,
        monthTotal,
        todayAmount,
        todayOrders,
        showPrivacyDialog,
        showNameDialog,
        showWelcomeDialog,
        editingName,
        virtualMembers,
        showLinkDialog,
        selectedVirtualId,
        initApp,
        onShow,
        refreshData,
        agreePrivacy,
        disagreePrivacy,
        saveName,
        skipWelcome,
        openNameEdit,
        closeNameDialog,
        openLinkDialog,
        linkVirtualMember,
        selectVirtual,
    }
}