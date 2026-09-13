import { CLOUD_FUNCTIONS, GROUP_ID } from '../../constants/appConfig'
import { useStore } from '../store'

export async function cloudAction(cloudFuncName: string, action: string, data: Record<string, any> = {}) {
    // 自动注入当前激活组ID，云函数据此隔离数据
    const store = useStore()
    const groupId = store.groupId || GROUP_ID
    const res = await wx.cloud.callFunction({
        name: cloudFuncName,
        data: {
            action,
            groupId,
            ...data,
        },
    })
    // 云函数全局 catch 会把内部异常"正常化"为 {code:500} 返回（callFunction 不会失败），
    // 这里统一转为异常抛出，否则各调用点的 try/catch 全部失效、错误被静默吞掉
    // 仅拦截 code 信封（lunch_voice 用 {success,message} 信封，code 未定义不拦截）
    const code = (res as any)?.result?.code
    if (typeof code === 'number' && code !== 0) {
        throw new Error((res as any).result.msg || `操作失败(${code})`)
    }
    return res
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