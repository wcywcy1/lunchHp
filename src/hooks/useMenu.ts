import { ref, computed, ComputedRef, Ref } from 'vue'
import { useStore } from '../services/store'
import { menuAction } from '../services/repositories/baseRepository'
import { CACHE_KEYS, CACHE_TTL } from '../constants/cacheConfig'

interface MenuItem {
    _id: string
    supplier: string
    name: string
    price: number
    visible: boolean
    sortNo: number
    [key: string]: any
}

function getCache(key: string): MenuItem[] | null {
    try {
        const raw = uni.getStorageSync(key)
        if (!raw) return null
        const { data, ts } = JSON.parse(raw)
        if (CACHE_TTL.MENU !== Infinity && Date.now() - ts > CACHE_TTL.MENU) return null
        return data
    } catch {
        return null
    }
}

function setCache(key: string, data: MenuItem[]) {
    uni.setStorageSync(key, JSON.stringify({ data, ts: Date.now() }))
}

interface MenuReturn {
    menuList: ComputedRef<MenuItem[]>
    visibleItems: ComputedRef<MenuItem[]>
    hiddenItems: ComputedRef<MenuItem[]>
    suppliers: ComputedRef<string[]>
    loading: Ref<boolean>
    loadMenu: (forceRefresh?: boolean) => Promise<MenuItem[]>
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

    return {
        menuList,
        visibleItems,
        hiddenItems,
        suppliers,
        loading,
        loadMenu,
    }
}