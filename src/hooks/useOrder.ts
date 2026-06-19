import { ref, computed, ComputedRef, Ref } from 'vue'
import { useStore, setCache } from '../services/store'
import { menuAction, orderAction } from '../services/repositories/baseRepository'
import { CACHE_KEYS } from '../constants/cacheConfig'

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

    const memberList = computed<MemberItem[]>(() => store.members || [])

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
            uni.showToast({ title: '请先登录', icon: 'none' })
            return
        }

        const memberId = orderFor.value === 'self'
            ? store.member._id
            : orderForMemberId.value
        const memberName = orderForName.value

        const today = new Date()
        const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

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
        selectMenuItem,
        switchToSelf,
        switchToHelp,
        pickMember,
        addVirtualAndPick,
        submitOrder,
        resetOrder,
    }
}