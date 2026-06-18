import { GROUP_ID, COLLECTIONS } from '../constants/appConfig'

interface WatcherRef {
    close: () => void
}

/**
 * 监听云数据库集合的实时变化
 * 调用方负责在 onShow 开启、onHide 关闭
 */
export function useRealtimeWatch() {
    let orderWatcher: WatcherRef | null = null
    let groupWatcher: WatcherRef | null = null

    /**
     * 监听今日订单变化
     */
    function watchTodayOrders(onChange: (snapshot: any) => void) {
        closeOrderWatcher()
        const db = wx.cloud.database()
        const today = getToday()
        orderWatcher = db.collection(COLLECTIONS.ORDERS)
            .where({ groupId: GROUP_ID, date: today })
            .watch({
                onChange,
                onError: (err: any) => {
                    console.error('[watchTodayOrders] error:', err)
                    orderWatcher = null
                },
            })
    }

    /**
     * 监听 lunch_groups 文档变化（用于 notice 通知）
     */
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

    function closeOrderWatcher() {
        if (orderWatcher) {
            orderWatcher.close()
            orderWatcher = null
        }
    }

    function closeGroupWatcher() {
        if (groupWatcher) {
            groupWatcher.close()
            groupWatcher = null
        }
    }

    function closeAll() {
        closeOrderWatcher()
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

function getToday() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
