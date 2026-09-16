import { ref, computed, onUnmounted, ComputedRef, Ref } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { useStore, setCache, flushCache, orderJustSucceeded } from '../services/store'
import { menuAction, orderAction } from '../services/repositories/baseRepository'
import { CACHE_KEYS } from '../constants/cacheConfig'
import { useAuth } from './useAuth'

interface MenuItem {
    _id: string
    name: string
    supplier: string
    price: number
    [key: string]: any
}

interface MemberItem {
    _id: string
    name: string
    nickName: string
    isVirtual?: boolean
    [key: string]: any
}

interface OrderReturn {
    selectedMenuId: Ref<string>
    selectedMenuItem: ComputedRef<MenuItem | null>
    orderFor: Ref<string>
    orderForMemberId: Ref<string>
    orderForName: ComputedRef<string>
    submitting: Ref<boolean>
    showMemberPicker: Ref<boolean>
    showAddMember: Ref<boolean>
    memberList: ComputedRef<MemberItem[]>
    orderJustSucceeded: Ref<boolean>
    isOrderAllowed: ComputedRef<boolean>
    selectMenuItem: (menuId: string) => void
    switchToSelf: () => void
    switchToHelp: () => void
    pickMember: (memberId: string) => void
    addVirtualAndPick: (name: string) => Promise<void>
    submitOrder: () => Promise<void>
    resetOrder: () => void
}

export function useOrder(): OrderReturn {
    const store = useStore()
    const { isAdmin } = useAuth()
    const selectedMenuId = ref('')
    const orderFor = ref('self')
    const orderForMemberId = ref('')
    const submitting = ref(false)
    const showMemberPicker = ref(false)
    const showAddMember = ref(false)
    const clockNow = ref(Date.now())
    let clockTimer: ReturnType<typeof setInterval> | null = null
    function stopClock() {
        if (clockTimer) clearInterval(clockTimer)
        clockTimer = null
    }
    onShow(() => {
        stopClock()
        clockNow.value = Date.now()
        clockTimer = setInterval(() => { clockNow.value = Date.now() }, 1000)
    })
    onHide(stopClock)
    onUnmounted(stopClock)

    const selectedMenuItem = computed<MenuItem | null>(() => {
        if (!selectedMenuId.value) return null
        return (store.menu as MenuItem[]).find((i: MenuItem) => i._id === selectedMenuId.value) || null
    })

    const memberList = computed<MemberItem[]>(() => {
        const list = (store.members || []) as MemberItem[]
        // 最近点过靠前 → 加入时间早的靠前（稳定兜底）
        return [...list].sort((a, b) => {
            const ta = a.lastOrderedAt ? new Date(a.lastOrderedAt as any).getTime() : 0
            const tb = b.lastOrderedAt ? new Date(b.lastOrderedAt as any).getTime() : 0
            if (ta !== tb) return tb - ta
            const ja = a.joinedAt ? new Date(a.joinedAt as any).getTime() : 0
            const jb = b.joinedAt ? new Date(b.joinedAt as any).getTime() : 0
            return ja - jb
        })
    })

    const orderForName = computed(() => {
        if (orderFor.value === 'self') {
            const m = store.member
            return m ? (m.name || m.nickName || '') : ''
        }
        const target = memberList.value.find((m: MemberItem) => m._id === orderForMemberId.value)
        return target ? (target.name || target.nickName || '') : ''
    })

    const isOrderAllowed = computed(() => {
        if (isAdmin.value || store.cutoffDisabled) return true
        const cutoff = (store.groupCutoff as string) || '10:00'
        const hhmm = new Date(clockNow.value + 8 * 3600000).toISOString().slice(11, 16)
        return hhmm < cutoff
    })

    function selectMenuItem(menuId: string) {
        selectedMenuId.value = selectedMenuId.value === menuId ? '' : menuId
    }

    function switchToSelf() {
        orderFor.value = 'self'
        orderForMemberId.value = ''
    }

    function switchToHelp() {
        orderFor.value = 'help'
        showMemberPicker.value = true
    }

    function pickMember(memberId: string) {
        orderForMemberId.value = memberId
        showMemberPicker.value = false
    }

    async function addVirtualAndPick(name: string) {
        if (submitting.value) return
        const trimmed = name.trim()
        if (!trimmed) {
            uni.showToast({ title: '请输入姓名', icon: 'none' })
            return
        }
        submitting.value = true
        try {
            const res = await menuAction('addVirtualMember', { name: trimmed })
            if (res.result.code === 0) {
                const newMember = res.result.data
                store.members = [...(store.members || []), newMember]
                orderForMemberId.value = newMember._id
                orderFor.value = 'help'
                showAddMember.value = false
                showMemberPicker.value = false
                uni.showToast({ title: '已添加', icon: 'success' })
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '添加失败', icon: 'none' })
        } finally {
            submitting.value = false
        }
    }

    async function submitOrder() {
        if (submitting.value) return
        clockNow.value = Date.now()
        if (!isOrderAllowed.value) {
            uni.showToast({ title: '今日点餐已截止，如需点餐请联系管理员', icon: 'none', duration: 2500 })
            return
        }
        if (!selectedMenuId.value) {
            uni.showToast({ title: '请选择菜品', icon: 'none' })
            return
        }
        if (orderFor.value === 'help' && !orderForMemberId.value) {
            uni.showToast({ title: '请选择同事', icon: 'none' })
            return
        }

        const item = selectedMenuItem.value
        if (!item) return
        if (!store.member) {
            uni.showToast({ title: '用户信息加载中，请稍后', icon: 'none' })
            return
        }
        if (!store.member.name && !store.member.nickName) {
            uni.showToast({ title: '请先设置姓名', icon: 'none' })
            return
        }

        const memberId = orderFor.value === 'self'
            ? store.member._id
            : orderForMemberId.value
        const memberName = orderForName.value

        const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)

        submitting.value = true
        const submitted = { done: false }
        try {
            const res = await orderAction('submitOrder', {
                date,
                memberId,
                memberName,
                menuId: item._id,
                menuName: item.name,
                supplier: item.supplier,
                price: item.price,
                note: '',
            })
            if (res.result.code === 0) {
                uni.showToast({ title: '点餐成功', icon: 'success' })
                orderJustSucceeded.value = true
                const newOrder = res.result.data?.order || {
                    date,
                    memberId,
                    memberName,
                    menuId: item._id,
                    menuName: item.name,
                    supplier: item.supplier,
                    price: item.price,
                    note: '',
                    status: 'pending',
                }
                store.recentOrders = [newOrder, ...(store.recentOrders || [])]
                setCache(CACHE_KEYS.RECENT_ORDERS, store.recentOrders)
                const updatedMenu = res.result.data?.updatedMenu
                if (store.menu && updatedMenu) {
                    store.menu = (store.menu as any[]).map((i: any) =>
                        i._id === updatedMenu._id ? updatedMenu : i
                    )
                    setCache(CACHE_KEYS.MENU, store.menu)
                }
                const updatedMember = res.result.data?.updatedMember
                if (store.members && updatedMember) {
                    store.members = (store.members as any[]).map((m: any) =>
                        m._id === updatedMember._id ? updatedMember : m
                    )
                    setCache(CACHE_KEYS.MEMBERS, store.members)
                }
                selectedMenuId.value = ''
                orderFor.value = 'self'
                orderForMemberId.value = ''
                // 标记成功，finally 不释放 submitting，避免 1 秒跳转窗口内重复点击
                submitted.done = true
                setTimeout(() => {
                    submitting.value = false
                    uni.switchTab({ url: '/pages/home/index' })
                }, 1000)
            } else if (res.result.code === 409 || (res.result.msg && res.result.msg.includes('已提交'))) {
                uni.showToast({ title: '已提交，请联系管理员', icon: 'none', duration: 2000 })
            } else {
                throw new Error(res.result.msg)
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '提交失败', icon: 'none' })
        } finally {
            if (!submitted.done) submitting.value = false
        }
    }

    function resetOrder() {
        selectedMenuId.value = ''
        orderFor.value = 'self'
        orderForMemberId.value = ''
    }

    return {
        selectedMenuId,
        selectedMenuItem,
        orderFor,
        orderForMemberId,
        orderForName,
        submitting,
        showMemberPicker,
        showAddMember,
        memberList,
        orderJustSucceeded,
        isOrderAllowed,
        selectMenuItem,
        switchToSelf,
        switchToHelp,
        pickMember,
        addVirtualAndPick,
        submitOrder,
        resetOrder,
    }
}
