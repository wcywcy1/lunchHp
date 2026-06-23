import { GROUP_ID, COLLECTIONS } from '../constants/appConfig'
import { useStore } from '../services/store'
import { getDB } from '../services/cloudClient'
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

function currentGroupId(): string {
    return useStore().groupId || GROUP_ID
}

export function useRealtimeWatch() {
    let orderWatcher: WatcherRef | null = null
    let groupWatcher: WatcherRef | null = null
    let orderRetryTimer: any = null
    let orderRetryCount = 0
    let groupRetryTimer: any = null
    let groupRetryCount = 0

    function watchTodayOrders(callbacks: OrderWatchCallbacks | ((snapshot: any) => void)) {
        closeOrderWatcherWithRetry()
        const db = getDB()
        const today = getTodayString()
        const gid = currentGroupId()

        const cb = typeof callbacks === 'function'
            ? { onChange: callbacks }
            : callbacks

        const startWatcher = () => {
            orderWatcher = db.collection(COLLECTIONS.ORDERS)
                .where({ groupId: gid, date: today })
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
                        const delay = Math.min(30000 * Math.pow(2, orderRetryCount++), 300000)
                        orderRetryTimer = setTimeout(startWatcher, delay)
                    },
                })
        }
        startWatcher()
    }

    function watchGroupNotice(onChange: (snapshot: any) => void) {
        closeGroupWatcherWithRetry()
        const db = getDB()
        const gid = currentGroupId()

        const startWatcher = () => {
            groupWatcher = db.collection(COLLECTIONS.GROUPS)
                .where({ _id: gid })
                .watch({
                    onChange: (snapshot: any) => {
                        groupRetryCount = 0
                        onChange(snapshot)
                    },
                    onError: (err: any) => {
                        console.error('[watchGroupNotice] error:', err)
                        groupWatcher = null
                        const delay = Math.min(5000 * Math.pow(2, groupRetryCount++), 300000)
                        groupRetryTimer = setTimeout(startWatcher, delay)
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

    function closeGroupWatcherWithRetry() {
        if (groupRetryTimer) {
            clearTimeout(groupRetryTimer)
            groupRetryTimer = null
        }
        groupRetryCount = 0
        if (groupWatcher) {
            groupWatcher.close()
            groupWatcher = null
        }
    }

    function closeGroupWatcher() {
        closeGroupWatcherWithRetry()
    }

    function closeAll() {
        closeOrderWatcherWithRetry()
        closeGroupWatcherWithRetry()
    }

    return {
        watchTodayOrders,
        watchGroupNotice,
        closeOrderWatcher,
        closeGroupWatcher,
        closeAll,
    }
}