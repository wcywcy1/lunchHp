import { ref, computed, ComputedRef, Ref } from 'vue'
import { useStore, setCache, flushCache } from '../services/store'
import { menuAction, orderAction } from '../services/repositories/baseRepository'
import { CACHE_KEYS } from '../constants/cacheConfig'
import { getTodayString } from '../utils/date'
import type { MenuItem, MemberItem } from '../types'

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
    selectMenuItem: (menuId: string) => void
    switchToSelf: () => void
    switchToHelp: () => void
    pickMember: (memberId: string) => void
    addVirtualAndPick: (name: string) => Promise<void>
    submitOrder: () => Promise<void>
    resetOrder: () => void
}

// 模块级标志位：点餐成功后置 true，供餐单页 onShow 检测并清空筛选
const orderJustSucceeded = ref(false)

export function useOrder(): OrderReturn {
    const store = useStore()
    const selectedMenuId = ref('')
    const orderFor = ref('self')
    const orderForMemberId = ref('')
    const submitting = ref(false)
    const showMemberPicker = ref(false)
    const showAddMember = ref(false)

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

        const date = getTodayString()

        submitting.value = true
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
                const orders = store.recentOrders || []
                if (!newOrder._id || !orders.some((o: any) => o._id === newOrder._id)) {
                    store.recentOrders = [newOrder, ...orders]
                }
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
                setTimeout(() => {
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
            submitting.value = false
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
        selectMenuItem,
        switchToSelf,
        switchToHelp,
        pickMember,
        addVirtualAndPick,
        submitOrder,
        resetOrder,
    }
}