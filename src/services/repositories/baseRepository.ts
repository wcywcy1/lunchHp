import { CLOUD_FUNCTIONS } from '../../constants/appConfig'

export function cloudAction(cloudFuncName: string, action: string, data: Record<string, any> = {}) {
    return wx.cloud.callFunction({
        name: cloudFuncName,
        data: {
            action,
            ...data,
        },
    })
}

export function menuAction(action: string, data: Record<string, any> = {}) {
    return cloudAction(CLOUD_FUNCTIONS.MENU, action, data)
}

export function orderAction(action: string, data: Record<string, any> = {}) {
    return cloudAction(CLOUD_FUNCTIONS.ORDER, action, data)
}

export function backupAction(action: string, data: Record<string, any> = {}) {
    return cloudAction(CLOUD_FUNCTIONS.BACKUP, action, data)
}