import { CLOUD_FUNCTIONS } from '../../constants/appConfig'

export function cloudAction(cloudFuncName, action, data = {}) {
    return wx.cloud.callFunction({
        name: cloudFuncName,
        data: {
            action,
            ...data,
        },
    })
}

export function menuAction(action, data = {}) {
    return cloudAction(CLOUD_FUNCTIONS.MENU, action, data)
}

export function orderAction(action, data = {}) {
    return cloudAction(CLOUD_FUNCTIONS.ORDER, action, data)
}

export function backupAction(action, data = {}) {
    return cloudAction(CLOUD_FUNCTIONS.BACKUP, action, data)
}