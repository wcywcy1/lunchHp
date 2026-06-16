import { reactive } from 'vue'

interface StoreState {
    member: any
    role: string | null
    groupId: string | null
    menu: any[]
    members: any[]
    recentOrders: any[]
    monthSummary: any
    recentTimestamp: any
    initialized: boolean
}

const store = reactive<StoreState>({
    member: null,
    role: null,
    groupId: null,
    menu: [],
    members: [],
    recentOrders: [],
    monthSummary: null,
    recentTimestamp: null,
    initialized: false,
})

export function useStore() {
    return store
}

export function setStore(payload: Partial<StoreState>) {
    Object.assign(store, payload)
}

export function resetStore() {
    store.member = null
    store.role = null
    store.groupId = null
    store.menu = []
    store.members = []
    store.recentOrders = []
    store.monthSummary = null
    store.recentTimestamp = null
    store.initialized = false
}