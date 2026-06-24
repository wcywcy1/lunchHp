import { ref, computed } from 'vue'
import { orderAction } from '../services/repositories/baseRepository'
import { ORDER_STATUS } from '../constants/orderStatus'
import { useRealtimeWatch } from './useRealtimeWatch'
import { getTodayString } from '../utils/date'

export function useOrderManage() {
    const loading = ref(false)
    const pendingOrders = ref<any[]>([])
    const confirmedOrders = ref<any[]>([])
    const selectedIds = ref<string[]>([])
    const confirming = ref(false)
    const cancelling = ref(false)
    const confirmedSelectedIds = ref<string[]>([])
    const realtime = useRealtimeWatch()

    const currentNotice = ref('')

    const isAllSelected = computed(() =>
        pendingOrders.value.length > 0 &&
        pendingOrders.value.every(o => selectedIds.value.includes(o._id))
    )

    const isAllConfirmedSelected = computed(() => {
        return confirmedOrders.value.length > 0 && confirmedOrders.value.every(o => confirmedSelectedIds.value.includes(o._id))
    })

    const confirmedBySupplier = computed(() => {
        const map: Record<string, any[]> = {}
        confirmedOrders.value.forEach(o => {
            const key = o.supplier || '未分类'
            if (!map[key]) map[key] = []
            map[key].push(o)
        })
        return Object.entries(map).map(([supplier, orders]) => ({
            supplier,
            orders,
            subtotal: orders.reduce((sum: number, o: any) => sum + (o.price || 0), 0),
        }))
    })

    async function loadData() {
        loading.value = true
        try {
            const res = await orderAction('getRecentOrders')
            if (res.result.code === 0) {
                const orders = res.result.data || []
                const today = getTodayString()
                const todayOrders = orders.filter((o: any) => o.date === today)
                pendingOrders.value = todayOrders.filter((o: any) => o.status === ORDER_STATUS.PENDING)
                confirmedOrders.value = todayOrders.filter((o: any) => o.status === ORDER_STATUS.CONFIRMED)
                currentNotice.value = res.result.notice || ''
            }
        } catch (e) {
            console.error('loadData error:', e)
        } finally {
            loading.value = false
        }
    }

    function toggleSelect(id: string) {
        const idx = selectedIds.value.indexOf(id)
        if (idx >= 0) {
            selectedIds.value.splice(idx, 1)
        } else {
            selectedIds.value.push(id)
        }
    }

    function toggleSelectAll() {
        if (isAllSelected.value) {
            selectedIds.value = []
        } else {
            selectedIds.value = pendingOrders.value.map(o => o._id)
        }
    }

    function toggleConfirmedSelect(id: string) {
        const idx = confirmedSelectedIds.value.indexOf(id)
        if (idx >= 0) {
            confirmedSelectedIds.value.splice(idx, 1)
        } else {
            confirmedSelectedIds.value.push(id)
        }
    }

    function toggleSelectAllConfirmed() {
        if (isAllConfirmedSelected.value) {
            confirmedSelectedIds.value = []
        } else {
            confirmedSelectedIds.value = confirmedOrders.value.map(o => o._id)
        }
    }

    async function doBatchCancel(ids: string[], label: string, clearSelection: () => void) {
        const { confirm } = await uni.showModal({ title: '取消订单', content: `确认取消 ${ids.length} 条${label}？` })
        if (!confirm) return
        cancelling.value = true
        try {
            const res = await orderAction('batchCancelOrders', { orderIds: ids })
            if (res.result.code === 0) {
                uni.showToast({ title: '取消成功', icon: 'success' })
                clearSelection()
                await loadData()
                await loadPendingCancelRequests()
            } else {
                throw new Error(res.result.msg || '取消失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '取消失败', icon: 'none' })
        } finally {
            cancelling.value = false
        }
    }

    async function batchCancelConfirmed() {
        if (confirmedSelectedIds.value.length === 0) return
        await doBatchCancel([...confirmedSelectedIds.value], '已确认订单', () => { confirmedSelectedIds.value = [] })
    }

    async function batchCancelPending() {
        if (selectedIds.value.length === 0) return
        await doBatchCancel([...selectedIds.value], '待确认订单', () => { selectedIds.value = [] })
    }

    async function batchConfirm() {
        if (selectedIds.value.length === 0) return
        const ids = [...selectedIds.value]
        confirming.value = true
        try {
            const res = await orderAction('batchConfirm', { orderIds: ids, date: getTodayString() })
            if (res.result.code === 0) {
                uni.showToast({ title: '确认成功', icon: 'success' })
                selectedIds.value = []
                await loadData()
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '确认失败', icon: 'none' })
        } finally {
            confirming.value = false
        }
    }

    async function cancelOrder(orderId: string) {
        const { confirm } = await uni.showModal({ title: '确认取消', content: '取消后订单将变为已取消状态，确定？' })
        if (!confirm) return
        try {
            const res = await orderAction('cancelOrder', { orderId })
            if (res.result.code === 0) {
                uni.showToast({ title: '已取消', icon: 'success' })
                await loadData()
                await loadPendingCancelRequests()
            } else {
                throw new Error(res.result.msg || '取消失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '取消失败', icon: 'none' })
        }
    }

    const pendingCancelRequests = ref<any[]>([])

    async function loadPendingCancelRequests() {
        try {
            const res = await orderAction('getPendingCancelRequests')
            if (res.result.code === 0) {
                pendingCancelRequests.value = res.result.data || []
            }
        } catch (e) {
            console.error('loadPendingCancelRequests error:', e)
        }
    }

    async function approveCancelRequest(orderId: string) {
        const { confirm } = await uni.showModal({ title: '同意取消', content: '确认同意该取消申请？' })
        if (!confirm) return
        try {
            const res = await orderAction('cancelOrder', { orderId })
            if (res.result.code === 0) {
                uni.showToast({ title: '已同意取消', icon: 'success' })
                await loadData()
                await loadPendingCancelRequests()
            } else {
                throw new Error(res.result.msg || '操作失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    async function rejectCancelRequest(orderId: string) {
        const { confirm } = await uni.showModal({ title: '拒绝取消', content: '确认拒绝该取消申请？' })
        if (!confirm) return
        try {
            const res = await orderAction('rejectCancelRequest', { orderId })
            if (res.result.code === 0) {
                uni.showToast({ title: '已拒绝', icon: 'success' })
                await loadPendingCancelRequests()
            } else {
                throw new Error(res.result.msg || '操作失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    const historyPendingCount = ref(0)
    const historyConfirmedCount = ref(0)
    const historyPendingOrders = ref<any[]>([])
    const historyConfirmedOrders = ref<any[]>([])
    const historyPendingPage = ref(0)
    const historyConfirmedPage = ref(0)
    const showHistoryPending = ref(false)
    const showHistoryConfirmed = ref(false)
    const loadingHistoryPending = ref(false)
    const loadingHistoryConfirmed = ref(false)
    const historyPendingHasMore = ref(false)
    const historyConfirmedHasMore = ref(false)

    async function loadHistoryCount() {
        try {
            const res = await orderAction('getHistoryOrderCount')
            if (res.result.code === 0) {
                historyPendingCount.value = res.result.data.pendingCount || 0
                historyConfirmedCount.value = res.result.data.confirmedCount || 0
            }
        } catch (e) {
            console.error('loadHistoryCount error:', e)
        }
    }

    async function toggleHistoryPending() {
        if (showHistoryPending.value) {
            showHistoryPending.value = false
            return
        }
        showHistoryPending.value = true
        if (historyPendingOrders.value.length === 0) {
            await loadMoreHistoryPending()
        }
    }

    async function toggleHistoryConfirmed() {
        if (showHistoryConfirmed.value) {
            showHistoryConfirmed.value = false
            return
        }
        showHistoryConfirmed.value = true
        if (historyConfirmedOrders.value.length === 0) {
            await loadMoreHistoryConfirmed()
        }
    }

    async function loadMoreHistoryPending() {
        loadingHistoryPending.value = true
        try {
            const nextPage = historyPendingPage.value + 1
            const res = await orderAction('getHistoryOrders', {
                status: ORDER_STATUS.PENDING,
                page: nextPage,
                pageSize: 10,
            })
            if (res.result.code === 0) {
                const { list, total } = res.result.data
                historyPendingOrders.value = [...historyPendingOrders.value, ...list]
                historyPendingPage.value = nextPage
                historyPendingHasMore.value = historyPendingOrders.value.length < total
            }
        } catch (e) {
            console.error('loadMoreHistoryPending error:', e)
        } finally {
            loadingHistoryPending.value = false
        }
    }

    async function loadMoreHistoryConfirmed() {
        loadingHistoryConfirmed.value = true
        try {
            const nextPage = historyConfirmedPage.value + 1
            const res = await orderAction('getHistoryOrders', {
                status: ORDER_STATUS.CONFIRMED,
                page: nextPage,
                pageSize: 10,
            })
            if (res.result.code === 0) {
                const { list, total } = res.result.data
                historyConfirmedOrders.value = [...historyConfirmedOrders.value, ...list]
                historyConfirmedPage.value = nextPage
                historyConfirmedHasMore.value = historyConfirmedOrders.value.length < total
            }
        } catch (e) {
            console.error('loadMoreHistoryConfirmed error:', e)
        } finally {
            loadingHistoryConfirmed.value = false
        }
    }

    function applyOrderPatch(changes: any[]) {
        if (!changes || changes.length === 0) return
        const today = getTodayString()
        for (const c of changes) {
            const isToday = c.doc && c.doc.date === today
            if (c.queueType === 'add' || c.queueType === 'init') {
                if (!isToday) continue
                const status = c.doc.status
                if (status === ORDER_STATUS.PENDING) {
                    const idx = pendingOrders.value.findIndex((o: any) => o._id === c.doc._id)
                    if (idx < 0) pendingOrders.value.unshift(c.doc)
                } else if (status === ORDER_STATUS.CONFIRMED) {
                    const idx = confirmedOrders.value.findIndex((o: any) => o._id === c.doc._id)
                    if (idx < 0) confirmedOrders.value.unshift(c.doc)
                }
            } else if (c.queueType === 'update' || c.queueType === 'replace') {
                const oldPendingIdx = pendingOrders.value.findIndex((o: any) => o._id === c.doc._id)
                const oldConfirmedIdx = confirmedOrders.value.findIndex((o: any) => o._id === c.doc._id)
                if (oldPendingIdx >= 0) pendingOrders.value.splice(oldPendingIdx, 1)
                if (oldConfirmedIdx >= 0) confirmedOrders.value.splice(oldConfirmedIdx, 1)
                if (isToday) {
                    if (c.doc.status === ORDER_STATUS.PENDING) {
                        pendingOrders.value.unshift(c.doc)
                    } else if (c.doc.status === ORDER_STATUS.CONFIRMED) {
                        confirmedOrders.value.unshift(c.doc)
                    }
                }
            } else if (c.queueType === 'remove') {
                const pIdx = pendingOrders.value.findIndex((o: any) => o._id === c.doc._id)
                if (pIdx >= 0) pendingOrders.value.splice(pIdx, 1)
                const cIdx = confirmedOrders.value.findIndex((o: any) => o._id === c.doc._id)
                if (cIdx >= 0) confirmedOrders.value.splice(cIdx, 1)
            }
        }
    }

    function startRealtimeWatch() {
        realtime.watchTodayOrders({
            onInit: () => {},
            onPatch: (changes: any[]) => applyOrderPatch(changes),
            onError: () => { loadData() },
        })
    }

    function stopRealtimeWatch() {
        realtime.closeAll()
    }

    return {
        loading,
        pendingOrders,
        confirmedOrders,
        confirmedBySupplier,
        selectedIds,
        isAllSelected,
        confirming,
        cancelling,
        confirmedSelectedIds,
        isAllConfirmedSelected,
        currentNotice,
        loadData,
        toggleSelect,
        toggleSelectAll,
        toggleConfirmedSelect,
        toggleSelectAllConfirmed,
        batchCancelConfirmed,
        batchCancelPending,
        batchConfirm,
        cancelOrder,
        pendingCancelRequests,
        loadPendingCancelRequests,
        approveCancelRequest,
        rejectCancelRequest,
        historyPendingCount,
        historyConfirmedCount,
        historyPendingOrders,
        historyConfirmedOrders,
        showHistoryPending,
        showHistoryConfirmed,
        loadingHistoryPending,
        loadingHistoryConfirmed,
        historyPendingHasMore,
        historyConfirmedHasMore,
        toggleHistoryPending,
        toggleHistoryConfirmed,
        loadMoreHistoryPending,
        loadMoreHistoryConfirmed,
        loadHistoryCount,
        startRealtimeWatch,
        stopRealtimeWatch,
    }
}