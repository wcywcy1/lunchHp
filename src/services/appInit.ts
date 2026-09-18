import { CloudActionError, menuAction } from './repositories/baseRepository'
import { clearAllCache, resetStore } from './store'
import { clearFreshnessCache } from './freshness'
import { ACTIVE_GROUP_ID_KEY } from '../constants/appConfig'

let initPromise: Promise<void> | null = null
let _isRunning = false

export function startInit() {
    if (initPromise || _isRunning) return initPromise || Promise.resolve()
    _isRunning = true
    initPromise = menuAction('initGroup').then(() => {
        _isRunning = false
    }).catch(e => {
        _isRunning = false
        initPromise = null
        // 组织已不存在（如被创建者删除）：清除失效会话并引导回选组页，避免自动"复活"死组
        if (e instanceof CloudActionError && e.code === 404) {
            clearFreshnessCache()
            clearAllCache()
            resetStore()
            try { uni.removeStorageSync(ACTIVE_GROUP_ID_KEY) } catch {}
            uni.reLaunch({ url: '/pages/group-select/index' })
            return
        }
        console.error('initGroup error:', e)
        throw e
    })
    return initPromise
}

export function waitForInit() {
    return initPromise || startInit()
}

export function resetInit() {
    initPromise = null
    _isRunning = false
}

export function isInitRunning() {
    return _isRunning
}