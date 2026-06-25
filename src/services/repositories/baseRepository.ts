import { CLOUD_FUNCTIONS } from '../../constants/appConfig'
import { useStore, getActiveGroupId } from '../store'

export function cloudAction(cloudFuncName: string, action: string, data: Record<string, any> = {}) {
    const store = useStore()
    const groupId = store.groupId || getActiveGroupId()
    if (!groupId) {
        uni.reLaunch({ url: '/pages/group-select/index' })
        return Promise.reject(new Error('groupId missing'))
    }
    return wx.cloud.callFunction({
        name: cloudFuncName,
        data: {
            action,
            groupId,
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