import { ref, computed, ComputedRef, Ref, watch } from 'vue'
import type { MenuItem } from '../types'

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
    // 默认显示"常点"tab
    const selectedSupplier = ref(RECENT_TAB)
    const selectedMenuName = ref('')
    const keyword = ref('')

    // 取最近点餐时间戳，无则 0（排最后）
    function orderTime(item: MenuItem): number {
        return item.lastOrderedAt ? new Date(item.lastOrderedAt as any).getTime() : 0
    }

    // "常点"：个人常点优先，不足 9 个用大众常点补齐
    // 只按最近点餐时间排序（LRU），不看频率，这样新菜点一次就能进常点
    // 帮他人点餐时 statsOverride 为被帮人的统计，否则用 menu 自带的当前用户统计
    // 用 ref+watch 替代 computed，规避小程序端 computed 依赖 computed 的响应式失效
    const recentItems = ref<MenuItem[]>([])
    function computeRecent() {
        const override = statsOverride?.value
        const visible = menuList.value.filter((i: MenuItem) => i.visible !== false)
        const userTime = (i: MenuItem) => {
            const s = override && override[i._id]
            const t = s ? s.lastAt : i.userLastAt
            return t ? new Date(t as any).getTime() : 0
        }
        const userCount = (i: MenuItem) =>
            override && override[i._id] ? Number(override[i._id].count) || 0 : Number(i.userCount) || 0
        // 个人常点：userCount>0，按最近点餐时间降序
        const personal = visible
            .filter((i: MenuItem) => userCount(i) > 0)
            .sort((a, b) => userTime(b) - userTime(a))
        // 大众常点：被点过的菜（orderCount>0），按最近点餐时间降序
        const publicTop = visible
            .filter((i: MenuItem) => userCount(i) === 0 && (Number(i.orderCount) || 0) > 0)
            .sort((a, b) => {
                const ta = a.lastOrderedAt ? new Date(a.lastOrderedAt as any).getTime() : 0
                const tb = b.lastOrderedAt ? new Date(b.lastOrderedAt as any).getTime() : 0
                return tb - ta
            })
        // 个人常点在前，不足 9 个用大众常点补齐；个人常点逐步取代大众常点
        const result = [...personal]
        for (const item of publicTop) {
            if (result.length >= 9) break
            result.push(item)
        }
        // 新账号无个人/大众常点时，回退显示全部可见菜品，避免空列表
        if (result.length === 0) {
            const fallback = [...visible].sort((a, b) => (Number(a.sortNo) || 0) - (Number(b.sortNo) || 0))
            result.push(...fallback.slice(0, 9))
        }
        recentItems.value = result.slice(0, 9)
    }

    // tab 顺序：常点 → 全部 → 各供应商（按大众最近点餐时间排序）
    const supplierOptions = ref<string[]>([RECENT_TAB, ''])
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
        supplierOptions.value = [RECENT_TAB, '', ...suppliers]
    }

    // menuList 或 statsOverride 变化时重算常点列表与供应商列表
    // 默认 tab 已在初始化时设为"常点"，无需在此切换
    watch([menuList, () => statsOverride?.value], () => {
        computeSuppliers()
        computeRecent()
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
        // "常点"tab：直接返回个人 Top 9，不分组
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
        selectedSupplier.value = RECENT_TAB
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