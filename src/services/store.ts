import { reactive } from 'vue'
import { CACHE_KEYS, getTTL } from '../constants/cacheConfig'

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

let _recentLoadTime = 0

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
    _recentLoadTime = 0
}

export function getCache(key: string, skipTTL = false): any {
    try {
        const raw = uni.getStorageSync(key)
        if (!raw) return null
        const { data, ts } = JSON.parse(raw)
        if (!skipTTL) {
            const ttl = getTTL(key)
            if (ttl > 0 && ttl !== Infinity && Date.now() - ts > ttl) return null
        }
        return data
    } catch {
        return null
    }
}

export function setCache(key: string, data: any) {
    uni.setStorageSync(key, JSON.stringify({ data, ts: Date.now() }))
}

export function getRecentLoadTime() {
    return _recentLoadTime
}

export function setRecentLoadTime(time: number) {
    _recentLoadTime = time
}

export function restoreSession(): boolean {
    const session = getCache(CACHE_KEYS.SESSION, true)
    if (!session) return false
    setStore({
        member: session.member,
        role: session.role,
        groupId: session.groupId,
    })
    return true
}

export function saveSession(data: { groupId: string; role: string; member: any }) {
    setCache(CACHE_KEYS.SESSION, data)
}

export function restoreFromCache() {
    const recentOrders = getCache(CACHE_KEYS.RECENT_ORDERS, true)
    const menu = getCache(CACHE_KEYS.MENU, true)
    const members = getCache(CACHE_KEYS.MEMBERS, true)
    const recentTimestamp = getCache(CACHE_KEYS.RECENT_TIMESTAMP, true)
    const monthSummary = getCache(CACHE_KEYS.MONTH_SUMMARY, true)

    setStore({
        recentOrders: recentOrders || [],
        menu: menu || [],
        members: members || [],
        recentTimestamp: recentTimestamp || null,
        monthSummary: monthSummary || null,
        initialized: true,
    })
}