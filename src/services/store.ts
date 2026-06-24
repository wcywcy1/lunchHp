import { reactive } from 'vue'
import { CACHE_KEYS, getTTL } from '../constants/cacheConfig'
import { GROUP_ID, ACTIVE_GROUP_ID_KEY } from '../constants/appConfig'

interface JoinedGroup {
    groupId: string
    groupName: string
    role: string
    joinedAt: any
}

interface StoreState {
    member: any
    role: string | null
    groupId: string | null
    groupName: string
    menu: any[]
    members: any[]
    recentOrders: any[]
    monthSummary: any
    recentTimestamp: any
    menuTimestamp: any
    membersTimestamp: any
    initialized: boolean
    joinedGroups: JoinedGroup[]
    isSwitchingGroup: boolean
    statsLoadTime: number
    recentLoadTime: number
}

const store = reactive<StoreState>({
    member: null,
    role: null,
    groupId: null,
    groupName: '',
    menu: [],
    members: [],
    recentOrders: [],
    monthSummary: null,
    recentTimestamp: null,
    menuTimestamp: null,
    membersTimestamp: null,
    initialized: false,
    joinedGroups: [],
    isSwitchingGroup: false,
    statsLoadTime: 0,
    recentLoadTime: 0,
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
    store.groupName = ''
    store.menu = []
    store.members = []
    store.recentOrders = []
    store.monthSummary = null
    store.recentTimestamp = null
    store.menuTimestamp = null
    store.membersTimestamp = null
    store.initialized = false
    store.joinedGroups = []
    store.isSwitchingGroup = false
    store.statsLoadTime = 0
    store.recentLoadTime = 0
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

export function setRecentLoadTime(time: number) {
    store.recentLoadTime = time
}

export function getStatsLoadTime() {
    return store.statsLoadTime
}

export function setStatsLoadTime(time: number) {
    store.statsLoadTime = time
}

export function setCache(key: string, data: any, immediate = false) {
    const value = JSON.stringify({ data, ts: Date.now() })
    if (immediate) {
        uni.setStorageSync(key, value)
        return
    }
    _pendingWrites.set(key, value)
    if (_writeTimer) return
    _writeTimer = setTimeout(() => {
        for (const [k, v] of _pendingWrites) {
            uni.setStorageSync(k, v)
        }
        _pendingWrites.clear()
        _writeTimer = null
    }, 300)
}

const _pendingWrites = new Map<string, string>()
let _writeTimer: any = null

export function flushCache() {
    if (_writeTimer) clearTimeout(_writeTimer)
    _writeTimer = null
    for (const [k, v] of _pendingWrites) {
        uni.setStorageSync(k, v)
    }
    _pendingWrites.clear()
}

export function restoreSession(): boolean {
    const session = getCache(CACHE_KEYS.SESSION)
    if (!session) return false
    const groupName = session.groupName || (session.groupId === GROUP_ID ? 'HP午饭' : '')
    setStore({
        member: session.member,
        role: session.role,
        groupId: session.groupId,
        groupName,
    })
    return true
}

export function saveSession(data: { groupId: string; role: string; member: any; groupName?: string }) {
    setCache(CACHE_KEYS.SESSION, data)
}

// 当前激活组ID：优先 localStorage，回退默认 GROUP_ID
export function getActiveGroupId(): string {
    try {
        const id = uni.getStorageSync(ACTIVE_GROUP_ID_KEY)
        if (id) return id
    } catch {}
    return GROUP_ID
}

export function setActiveGroupId(groupId: string) {
    uni.setStorageSync(ACTIVE_GROUP_ID_KEY, groupId)
    setStore({ groupId })
}

// 清空所有本地缓存（切换组时调用）
export function clearAllCache() {
    Object.values(CACHE_KEYS).forEach(key => {
        try { uni.removeStorageSync(key) } catch {}
    })
}

export function restoreFromCache() {
    const recentOrders = getCache(CACHE_KEYS.RECENT_ORDERS, true)
    const menu = getCache(CACHE_KEYS.MENU, true)
    const members = getCache(CACHE_KEYS.MEMBERS, true)
    const recentTimestamp = getCache(CACHE_KEYS.RECENT_TIMESTAMP, true)
    const menuTimestamp = getCache(CACHE_KEYS.MENU_TIMESTAMP, true)
    const membersTimestamp = getCache(CACHE_KEYS.MEMBERS_TIMESTAMP, true)
    const monthSummary = getCache(CACHE_KEYS.MONTH_SUMMARY, true)

    setStore({
        recentOrders: recentOrders || [],
        menu: menu || [],
        members: members || [],
        recentTimestamp: recentTimestamp || null,
        menuTimestamp: menuTimestamp || null,
        membersTimestamp: membersTimestamp || null,
        monthSummary: monthSummary || null,
        initialized: true,
    })
}