export const APP_NAME = '我要干饭'

// 默认组ID（写死，作为回退值）
export const GROUP_ID = 'lunch_hp'

// 当前激活组ID的本地存储键（运行时可切换）
export const ACTIVE_GROUP_ID_KEY = 'lunch_active_group_id'

// 应用模式：'hp' = hp_lunch 专用（扫码直进 lunch_hp）；'general' = 通用程序（用户选组或创建组）
// 开发者改此值 + 重新发版即可切换模式
export const APP_MODE = 'hp' as 'hp' | 'general'

export const CLOUD_ENV = 'cloud1-d0g9zww8h390b6f41'

export const DB_PREFIX = 'lunch_'

export const CLOUD_FUNC_PREFIX = 'lunch_'

export const STORAGE_PREFIX = 'lunch_'

export const CLOUD_STORAGE_PATH = 'lunch/'

export const COLLECTIONS = {
    GROUPS: 'lunch_groups',
    MEMBERS: 'lunch_members',
    MENU: 'lunch_menu',
    ORDERS: 'lunch_orders',
    MONTHLY_STATS: 'lunch_monthly_stats',
    BACKUPS: 'lunch_backups',
}

export const CLOUD_FUNCTIONS = {
    MENU: 'lunch_menu',
    ORDER: 'lunch_order',
    BACKUP: 'lunch_backup',
    VOICE: 'lunch_voice',
}