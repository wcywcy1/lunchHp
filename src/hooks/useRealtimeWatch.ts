import { GROUP_ID, COLLECTIONS } from '../constants/appConfig'
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
    let orderWatcher: WatcherRef | null = null
    let groupWatcher: WatcherRef | null = null
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
                .where({ groupId: GROUP_ID, date: today })
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

    function watchGroupNotice(onChange: (snapshot: any) => void) {
        closeGroupWatcher()
        const db = wx.cloud.database()
        groupWatcher = db.collection(COLLECTIONS.GROUPS)
            .where({ _id: GROUP_ID })
            .watch({
                onChange,
                onError: (err: any) => {
                    console.error('[watchGroupNotice] error:', err)
                    groupWatcher = null
                },
            })
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

    function closeGroupWatcher() {
        if (groupWatcher) {
            groupWatcher.close()
            groupWatcher = null
        }
    }

    function closeAll() {
        closeOrderWatcherWithRetry()
        closeGroupWatcher()
    }

    return {
        watchTodayOrders,
        watchGroupNotice,
        closeOrderWatcher,
        closeGroupWatcher,
        closeAll,
    }
}
