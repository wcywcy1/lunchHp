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