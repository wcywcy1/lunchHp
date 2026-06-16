const MINUTE = 60 * 1000

export const CACHE_KEYS = {
    MEMBERS: 'lunch_cache_members',
    MENU: 'lunch_cache_menu',
    RECENT_ORDERS: 'lunch_cache_recent_orders',
    RECENT_TIMESTAMP: 'lunch_cache_recent_timestamp',
    MONTHLY_STATS: 'lunch_cache_monthly_stats',
    SESSION: 'lunch_session',
}

export const CACHE_TTL = {
    MEMBERS: 30 * MINUTE,
    MENU: 30 * MINUTE,
    RECENT_ORDERS: 5 * MINUTE,
    RECENT_TIMESTAMP: 0,
    MONTHLY_STATS: Infinity,
    SESSION: Infinity,
}