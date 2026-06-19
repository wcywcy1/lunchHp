import { ref, computed, ComputedRef, Ref, watch } from 'vue'

interface MenuItem {
    _id: string
    supplier: string
    name: string
    price: number
    visible: boolean
    [key: string]: any
}

// "常点"tab 的特殊标识值
export const RECENT_TAB = '__recent__'

interface MenuFilterReturn {
    selectedSupplier: Ref<string>
    selectedMenuName: Ref<string>
    keyword: Ref<string>
    supplierOptions: Ref<string[]>
    menuNameOptions: ComputedRef<string[]>
    filteredList: ComputedRef<MenuItem[]>
    recentItems: Ref<MenuItem[]>
    onSupplierChange: (val: string) => void
    onMenuNameChange: (val: string) => void
    setKeyword: (val: string) => void
    updateKeyword: (val: string) => void
    resetFilter: () => void
}

export function useMenuFilter(
    menuList: Ref<MenuItem[]>,
    statsOverride?: Ref<Record<string, { count: number; lastAt: any }>>
): MenuFilterReturn {
    const selectedSupplier = ref('')
    const selectedMenuName = ref('')
    const keyword = ref('')

    // 取最近点餐时间戳，无则 0（排最后）
    function orderTime(item: MenuItem): number {
        return item.lastOrderedAt ? new Date(item.lastOrderedAt as any).getTime() : 0
    }

    // "常点"：个人点餐记录，按最近→频率排序，Top 8
    // 帮他人点餐时 statsOverride 为被帮人的统计，否则用 menu 自带的当前用户统计
    // 用 ref+watch 替代 computed，规避小程序端 computed 依赖 computed 的响应式失效
    const recentItems = ref<MenuItem[]>([])
    function computeRecent() {
        const override = statsOverride?.value
        const getCount = (i: MenuItem) =>
            override && override[i._id] ? Number(override[i._id].count) || 0 : Number(i.userCount) || 0
        const getTime = (i: MenuItem) => {
            const s = override && override[i._id]
            const t = s ? s.lastAt : i.userLastAt
            return t ? new Date(t as any).getTime() : 0
        }
        recentItems.value = menuList.value
            .filter((i: MenuItem) => i.visible !== false && getCount(i) > 0)
            .sort((a, b) => {
                const ta = getTime(a), tb = getTime(b)
                if (ta !== tb) return tb - ta
                return getCount(b) - getCount(a)
            })
            .slice(0, 8)
    }

    // tab 顺序：全部 → 常点 → 各供应商（按大众最近点餐时间排序）
    const supplierOptions = ref<string[]>(['', RECENT_TAB])
    function computeSuppliers() {
        const visible = menuList.value.filter((i: MenuItem) => i.visible !== false && i.supplier)
        const latestBySupplier = new Map<string, number>()
        visible.forEach((item: MenuItem) => {
            const t = orderTime(item)
            const cur = latestBySupplier.has(item.supplier) ? latestBySupplier.get(item.supplier)! : -1
            if (t > cur) latestBySupplier.set(item.supplier, t)
        })
        const suppliers = Array.from(latestBySupplier.keys())
        suppliers.sort((a, b) =>
            (latestBySupplier.get(b)! - latestBySupplier.get(a)!) || a.localeCompare(b)
        )
        supplierOptions.value = ['', RECENT_TAB, ...suppliers]
    }

    // menuList 或 statsOverride 变化时重算
    // 首次有常点记录时默认切到"常点"tab
    let firstComputed = false
    watch([menuList, () => statsOverride?.value], () => {
        computeSuppliers()
        computeRecent()
        if (!firstComputed) {
            firstComputed = true
            if (recentItems.value.length > 0) {
                selectedSupplier.value = RECENT_TAB
            }
        }
    }, { immediate: true, deep: false })

    const menuNameOptions = computed(() => {
        const list = selectedSupplier.value && selectedSupplier.value !== RECENT_TAB
            ? menuList.value.filter((i: MenuItem) => i.visible !== false && i.supplier === selectedSupplier.value)
            : menuList.value.filter((i: MenuItem) => i.visible !== false)
        const set = new Set<string>()
        list.forEach((item: MenuItem) => {
            if (item.name) set.add(item.name)
        })
        return ['', ...Array.from(set).sort()]
    })

    const filteredList = computed(() => {
        // "常点"tab：直接返回个人 Top 8，不分组
        if (selectedSupplier.value === RECENT_TAB) {
            return recentItems.value
        }
        let list: MenuItem[] = menuList.value
        if (selectedSupplier.value) {
            list = list.filter((i: MenuItem) => i.supplier === selectedSupplier.value)
        }
        if (selectedMenuName.value) {
            list = list.filter((i: MenuItem) => i.name === selectedMenuName.value)
        }
        if (keyword.value) {
            const kw = keyword.value
            list = list.filter((i: MenuItem) =>
                i.name.includes(kw) || i.supplier.includes(kw)
            )
        }
        // LRU 为主 → 频率为辅 → sortNo 兜底
        return [...list].sort((a, b) => {
            const ta = orderTime(a), tb = orderTime(b)
            if (ta !== tb) return tb - ta
            const ca = Number(a.orderCount) || 0, cb = Number(b.orderCount) || 0
            if (ca !== cb) return cb - ca
            return (Number(a.sortNo) || 0) - (Number(b.sortNo) || 0)
        })
    })

    function onSupplierChange(val: string) {
        selectedSupplier.value = val
        if (val && val !== RECENT_TAB && selectedMenuName.value) {
            const valid = menuNameOptions.value.includes(selectedMenuName.value)
            if (!valid) selectedMenuName.value = ''
        }
    }

    function onMenuNameChange(val: string) {
        selectedMenuName.value = val
        if (val) {
            const match = menuList.value.find((i: MenuItem) => i.name === val && i.visible !== false)
            if (match) selectedSupplier.value = match.supplier
        }
    }

    function setKeyword(val: string) {
        keyword.value = val
        if (val) {
            // 语音识别填入关键词时清除供应商/餐品精确选择
            selectedSupplier.value = ''
            selectedMenuName.value = ''
        }
    }

    function updateKeyword(val: string) {
        keyword.value = val
    }

    function resetFilter() {
        selectedSupplier.value = ''
        selectedMenuName.value = ''
        keyword.value = ''
    }

    return {
        selectedSupplier,
        selectedMenuName,
        keyword,
        supplierOptions,
        menuNameOptions,
        filteredList,
        recentItems,
        onSupplierChange,
        onMenuNameChange,
        setKeyword,
        updateKeyword,
        resetFilter,
    }
}
