import { ref, computed, ComputedRef, Ref } from 'vue'
import { useStore, getCache, setCache } from '../services/store'
import { menuAction } from '../services/repositories/baseRepository'
import { waitForInit } from '../services/appInit'
import { CACHE_KEYS } from '../constants/cacheConfig'

interface MenuItem {
    _id: string
    supplier: string
    name: string
    price: number
    visible: boolean
    sortNo: number
    [key: string]: any
}

interface MenuReturn {
    menuList: ComputedRef<MenuItem[]>
    visibleItems: ComputedRef<MenuItem[]>
    hiddenItems: ComputedRef<MenuItem[]>
    suppliers: ComputedRef<string[]>
    loading: Ref<boolean>
    loadMenu: (forceRefresh?: boolean) => Promise<MenuItem[]>
    loadMembers: () => Promise<void>
    checkFreshness: () => Promise<void>
}

export function useMenu(): MenuReturn {
    const store = useStore()
    const loading = ref(false)

    const menuList = computed(() => store.menu as MenuItem[])

    const visibleItems = computed(() =>
        menuList.value.filter((i: MenuItem) => i.visible !== false)
    )

    const hiddenItems = computed(() =>
        menuList.value.filter((i: MenuItem) => i.visible === false)
    )

    const suppliers = computed(() => {
        const set = new Set<string>()
        menuList.value.forEach((i: MenuItem) => set.add(i.supplier))
        return Array.from(set).sort()
    })

    async function loadMenu(forceRefresh = false): Promise<MenuItem[]> {
        await waitForInit()
        if (!forceRefresh) {
            const cached = getCache(CACHE_KEYS.MENU)
            if (cached) {
                store.menu = cached
                return cached
            }
        }

        loading.value = true
        try {
            const res = await menuAction('getMenuList')
            if (res.result.code === 0) {
                const data = res.result.data || []
                store.menu = data
                setCache(CACHE_KEYS.MENU, data)
                return data
            }
            throw new Error(res.result.msg)
        } finally {
            loading.value = false
        }
    }

    async function loadMembers() {
        try {
            const res = await menuAction('getMembers')
            if (res.result.code === 0) {
                const data = res.result.data || []
                store.members = data
                setCache(CACHE_KEYS.MEMBERS, data)
            }
        } catch (e) {
            console.error('loadMembers error:', e)
        }
    }

    async function checkFreshness() {
        try {
            const res = await menuAction('getDataTimestamps')
            if (res.result.code !== 0) return
            const { menuTimestamp, membersTimestamp } = res.result.data

            if (menuTimestamp !== store.menuTimestamp) {
                await loadMenu(true)
                store.menuTimestamp = menuTimestamp
                setCache(CACHE_KEYS.MENU_TIMESTAMP, menuTimestamp)
            }

            if (membersTimestamp !== store.membersTimestamp) {
                await loadMembers()
                store.membersTimestamp = membersTimestamp
                setCache(CACHE_KEYS.MEMBERS_TIMESTAMP, membersTimestamp)
            }
        } catch (e) {
            console.error('checkFreshness error:', e)
        }
    }

    return {
        menuList,
        visibleItems,
        hiddenItems,
        suppliers,
        loading,
        loadMenu,
        loadMembers,
        checkFreshness,
    }
}