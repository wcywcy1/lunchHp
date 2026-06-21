import { menuAction } from './repositories/baseRepository'

let initPromise: Promise<void> | null = null
let _isRunning = false

export function startInit() {
    if (initPromise || _isRunning) return initPromise || Promise.resolve()
    _isRunning = true
    initPromise = menuAction('initGroup').then(() => {
        _isRunning = false
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