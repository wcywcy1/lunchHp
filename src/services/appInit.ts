import { menuAction } from './repositories/baseRepository'
import { setStore } from './store'

let initPromise: Promise<void> | null = null
let _isRunning = false

export function startInit() {
    if (initPromise || _isRunning) return initPromise || Promise.resolve()
    _isRunning = true
    initPromise = menuAction('initGroup').then((res: any) => {
        _isRunning = false
        if (res?.result?.code === 0 && res.result.data?.group?.name) {
            setStore({ groupName: res.result.data.group.name })
        }
    }).catch(e => {
        _isRunning = false
        console.error('initGroup error:', e)
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