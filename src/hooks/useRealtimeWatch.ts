import { GROUP_ID, COLLECTIONS } from '../constants/appConfig'
import { useStore } from '../services/store'
import { getTodayString } from '../utils/date'

interface WatcherRef {
    close: () => void
}

interface OrderWatchCallbacks {
    onInit?: () => void
    onPatch?: (changes: any[]) => void
    onChange?: (snapshot: any) => void
    onError?: () => void
}

export function useRealtimeWatch() {
    const store = useStore()
    // 实时监听当前激活组（运行时可切换），回退默认组
    const activeGroupId = () => store.groupId || GROUP_ID
    let orderWatcher: WatcherRef | null = null
    let orderRetryTimer: any = null
    let orderRetryCount = 0

    function watchTodayOrders(callbacks: OrderWatchCallbacks | ((snapshot: any) => void)) {
        closeOrderWatcherWithRetry()
        const db = wx.cloud.database()
        const today = getTodayString()

        const cb = typeof callbacks === 'function'
            ? { onChange: callbacks }
            : callbacks

        const startWatcher = () => {
            orderWatcher = db.collection(COLLECTIONS.ORDERS)
                .where({ groupId: activeGroupId(), date: today })
                .watch({
                    onChange: (snapshot: any) => {
                        orderRetryCount = 0
                        if (cb.onInit && snapshot.type === 'init') {
                            cb.onInit()
                            return
                        }
                        if (cb.onPatch && snapshot.docChanges && snapshot.docChanges.length > 0) {
                            cb.onPatch(snapshot.docChanges.map((c: any) => ({
                                queueType: c.queueType || c.dataType || 'update',
                                doc: c.doc,
                            })))
                            return
                        }
                        if (cb.onChange) cb.onChange(snapshot)
                    },
                    onError: (err: any) => {
                        console.error('[watchTodayOrders] error:', err)
                        orderWatcher = null
                        if (cb.onError) cb.onError()
                        const delay = Math.min(30000 * Math.pow(2, orderRetryCount), 300000)
                        orderRetryCount++
                        orderRetryTimer = setTimeout(startWatcher, delay)
                    },
                })
        }
        startWatcher()
    }

    function closeOrderWatcherWithRetry() {
        if (orderRetryTimer) {
            clearTimeout(orderRetryTimer)
            orderRetryTimer = null
        }
        orderRetryCount = 0
        if (orderWatcher) {
            orderWatcher.close()
            orderWatcher = null
        }
    }

    function closeOrderWatcher() {
        closeOrderWatcherWithRetry()
    }

    function closeAll() {
        closeOrderWatcherWithRetry()
    }

    return {
        watchTodayOrders,
        closeOrderWatcher,
        closeAll,
    }
}
