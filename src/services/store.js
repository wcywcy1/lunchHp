import { reactive } from 'vue'

const store = reactive({
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

export function setStore(payload) {
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