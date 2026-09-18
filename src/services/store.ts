import { reactive, ref } from 'vue'
import { CACHE_KEYS, getTTL } from '../constants/cacheConfig'
import { GROUP_ID, ACTIVE_GROUP_ID_KEY } from '../constants/appConfig'

// 模块级标志位：点餐成功后置 true，供餐单页 onShow 检测并清空筛选（放 store 避免 store→useOrder 循环依赖）
export const orderJustSucceeded = ref(false)

// Store 核心业务类型（各页面共享，字段尽量全但带索引签名兼容云函数扩展字段）
export interface CoreMember {
    _id: string
    openid?: string
    groupId: string
    name: string
    nickName?: string
    role: string
    isVirtual?: boolean
    privacyAgreed?: boolean
    joinedAt?: number
    lastOrderedAt?: number
    [key: string]: any
}

export interface CoreMenuItem {
    _id: string
    supplier: string
    name: string
    price: number
    visible?: boolean
    sortNo?: number
    orderCount?: number
    lastOrderedAt?: number
    [key: string]: any
}

export interface CoreOrder {
    _id: string
    groupId: string
    memberId: string
    memberName: string
    menuId: string
    menuName: string
    supplier: string
    price: number
    date: string
    status: string
    note?: string
    cancelRequested?: boolean
    cancelRejected?: boolean
    updatedAt?: number
    [key: string]: any
}

export interface MonthSummary {
    totalAmount: number
    count: number
    yearMonth?: string
    orderByMember?: Record<string, number>
    orderBySupplier?: Record<string, number>
    [key: string]: any
}

interface JoinedGroup {
    groupId: string
    groupName: string
    role: string
    joinedAt?: number
}

interface StoreState {
    member: CoreMember | null
    role: string | null
    groupId: string | null
    groupName: string
    menu: CoreMenuItem[]
    members: CoreMember[]
    recentOrders: CoreOrder[]
    monthSummary: MonthSummary | null
    recentTimestamp: number | null
    menuTimestamp: number | null
    membersTimestamp: number | null
    initialized: boolean
    joinedGroups: JoinedGroup[]
    isSwitchingGroup: boolean
    statsLoadTime: number
    recentLoadTime: number
    groupCutoff: string
    cutoffDisabled: boolean
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
    groupCutoff: '',
    cutoffDisabled: false,
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
    store.groupCutoff = ''
    store.cutoffDisabled = false
    // 重置点餐成功标志，避免切换组织后残留
    orderJustSucceeded.value = false
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

export function getRecentLoadTime() {
    return store.recentLoadTime
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
    const generation = _cacheGeneration
    const groupId = store.groupId
    _pendingWrites.set(key, { value, generation, groupId })
    if (_writeTimer) return
    _writeTimer = setTimeout(() => {
        for (const [k, pending] of _pendingWrites) {
            if (pending.generation === _cacheGeneration && pending.groupId === store.groupId) {
                uni.setStorageSync(k, pending.value)
            }
        }
        _pendingWrites.clear()
        _writeTimer = null
    }, 300)
}

interface PendingCacheWrite {
    value: string
    generation: number
    groupId: string | null
}

const _pendingWrites = new Map<string, PendingCacheWrite>()
let _writeTimer: any = null
let _cacheGeneration = 0

export function flushCache() {
    if (_writeTimer) clearTimeout(_writeTimer)
    _writeTimer = null
    for (const [k, pending] of _pendingWrites) {
        if (pending.generation === _cacheGeneration && pending.groupId === store.groupId) {
            uni.setStorageSync(k, pending.value)
        }
    }
    _pendingWrites.clear()
}

export function restoreSession(): boolean {
    const session = getCache(CACHE_KEYS.SESSION)
    if (!session) return false
    setStore({
        member: session.member,
        role: session.role,
        groupId: session.groupId,
        groupName: session.groupName || '',
    })
    return true
}

export function saveSession(data: { groupId: string; role: string; member: any; groupName?: string }) {
    if (data.groupName) setStore({ groupName: data.groupName })
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
    _cacheGeneration++
    if (_writeTimer) clearTimeout(_writeTimer)
    _writeTimer = null
    _pendingWrites.clear()
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
