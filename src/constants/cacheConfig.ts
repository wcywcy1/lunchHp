const MINUTE = 60 * 1000

export const CACHE_KEYS: Record<string, string> = {
    MEMBERS: 'lunch_cache_members',
    MENU: 'lunch_cache_menu',
    RECENT_ORDERS: 'lunch_cache_recent_orders',
    RECENT_TIMESTAMP: 'lunch_cache_recent_timestamp',
    MONTHLY_STATS: 'lunch_cache_monthly_stats',
    MONTHLY_STATS_TIME: 'lunch_cache_monthly_stats_time',
    SESSION: 'lunch_session',
}

export const CACHE_TTL: Record<string, number> = {
    MEMBERS: 30 * MINUTE,
    MENU: 30 * MINUTE,
    RECENT_ORDERS: 5 * MINUTE,
    RECENT_TIMESTAMP: 0,
    MONTHLY_STATS: Infinity,
    MONTHLY_STATS_TIME: 0,
    SESSION: Infinity,
}

const _keyToTTL: Record<string, number> = {}
Object.keys(CACHE_KEYS).forEach(k => {
    _keyToTTL[CACHE_KEYS[k]] = CACHE_TTL[k]
})

export function getTTL(storageKey: string): number {
    return _keyToTTL[storageKey] ?? 0
}