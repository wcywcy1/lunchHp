import { ref, computed, ComputedRef, Ref } from 'vue'

interface MenuItem {
    _id: string
    supplier: string
    name: string
    price: number
    visible: boolean
    [key: string]: any
}

interface MenuFilterReturn {
    selectedSupplier: Ref<string>
    selectedMenuName: Ref<string>
    supplierOptions: ComputedRef<string[]>
    menuNameOptions: ComputedRef<string[]>
    filteredList: ComputedRef<MenuItem[]>
    onSupplierChange: (val: string) => void
    onMenuNameChange: (val: string) => void
    resetFilter: () => void
}

export function useMenuFilter(menuList: Ref<MenuItem[]>): MenuFilterReturn {
    const selectedSupplier = ref('')
    const selectedMenuName = ref('')

    const supplierOptions = computed(() => {
        const set = new Set<string>()
        menuList.value.forEach((item: MenuItem) => {
            if (item.visible !== false) set.add(item.supplier)
        })
        return ['', ...Array.from(set).sort()]
    })

    const menuNameOptions = computed(() => {
        const list = selectedSupplier.value
            ? menuList.value.filter((i: MenuItem) => i.visible !== false && i.supplier === selectedSupplier.value)
            : menuList.value.filter((i: MenuItem) => i.visible !== false)
        const set = new Set<string>()
        list.forEach((item: MenuItem) => set.add(item.name))
        return ['', ...Array.from(set).sort()]
    })

    const filteredList = computed(() => {
        let list: MenuItem[] = menuList.value
        if (selectedSupplier.value) {
            list = list.filter((i: MenuItem) => i.supplier === selectedSupplier.value)
        }
        if (selectedMenuName.value) {
            list = list.filter((i: MenuItem) => i.name === selectedMenuName.value)
        }
        return list
    })

    function onSupplierChange(val: string) {
        selectedSupplier.value = val
        if (val && selectedMenuName.value) {
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

    function resetFilter() {
        selectedSupplier.value = ''
        selectedMenuName.value = ''
    }

    return {
        selectedSupplier,
        selectedMenuName,
        supplierOptions,
        menuNameOptions,
        filteredList,
        onSupplierChange,
        onMenuNameChange,
        resetFilter,
    }
}