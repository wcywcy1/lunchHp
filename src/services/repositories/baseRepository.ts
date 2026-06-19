import { CLOUD_FUNCTIONS, GROUP_ID } from '../../constants/appConfig'
import { useStore } from '../store'

export function cloudAction(cloudFuncName: string, action: string, data: Record<string, any> = {}) {
    // 自动注入当前激活组ID，云函数据此隔离数据
    const store = useStore()
    const groupId = store.groupId || GROUP_ID
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