import { menuAction } from './repositories/baseRepository'

let initPromise: Promise<void> | null = null

export function startInit() {
    if (!initPromise) {
        initPromise = menuAction('initGroup').then(() => { }).catch(e => {
            console.error('initGroup error:', e)
        })
    }
    return initPromise
}

export function waitForInit() {
    return initPromise || startInit()
}

// 切换组后重置 init 缓存，使下次 startInit 重新调用 initGroup
export function resetInit() {
    initPromise = null
}