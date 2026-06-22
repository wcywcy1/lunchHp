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

interface MemberChange {
    queueType: string
    doc: any
}

interface MemberWatchCallbacks {
    onInit?: (members: any[]) => void
    onPatch?: (changes: MemberChange[]) => void
    onError?: () => void
}

export function useRealtimeWatch() {
    let orderWatcher: WatcherRef | null = null
    let groupWatcher: WatcherRef | null = null
    let memberWatcher: WatcherRef | null = null
    let orderRetryTimer: any = null
    let orderRetryCount = 0
    let memberRetryTimer: any = null
    let memberRetryCount = 0

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
                        const delay = Math.min(30000 * Math.pow(2, orderRetryCount++), 300000)
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

    function watchMembers(callbacks: MemberWatchCallbacks) {
        closeMemberWatcher()
        const db = wx.cloud.database()

        const startWatcher = () => {
            memberWatcher = db.collection(COLLECTIONS.MEMBERS)
                .where({ groupId: GROUP_ID })
                .watch({
                    onChange: (snapshot: any) => {
                        memberRetryCount = 0
                        if (snapshot.type === 'init') {
                            if (callbacks.onInit) callbacks.onInit(snapshot.docs || [])
                            return
                        }
                        if (callbacks.onPatch && snapshot.docChanges && snapshot.docChanges.length > 0) {
                            callbacks.onPatch(snapshot.docChanges.map((c: any) => ({
                                queueType: c.queueType || c.dataType || 'update',
                                doc: c.doc,
                            })))
                        }
                    },
                    onError: (err: any) => {
                        console.error('[watchMembers] error:', err)
                        memberWatcher = null
                        if (callbacks.onError) callbacks.onError()
                        const delay = Math.min(30000 * Math.pow(2, memberRetryCount++), 300000)
                        memberRetryTimer = setTimeout(startWatcher, delay)
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

    function closeGroupWatcher() {
        if (groupWatcher) {
            groupWatcher.close()
            groupWatcher = null
        }
    }

    function closeMemberWatcher() {
        if (memberRetryTimer) {
            clearTimeout(memberRetryTimer)
            memberRetryTimer = null
        }
        memberRetryCount = 0
        if (memberWatcher) {
            memberWatcher.close()
            memberWatcher = null
        }
    }

    function closeAll() {
        closeOrderWatcherWithRetry()
        closeGroupWatcher()
        closeMemberWatcher()
    }

    return {
        watchTodayOrders,
        watchGroupNotice,
        watchMembers,
        closeOrderWatcher,
        closeGroupWatcher,
        closeMemberWatcher,
        closeAll,
    }
}