import { ref, computed } from 'vue'
import { useStore, saveSession, setCache, setStatsLoadTime, setRecentLoadTime, resetStore, clearAllCache, getActiveGroupId, setStore, flushCache } from '../services/store'
import { menuAction, orderAction, backupAction } from '../services/repositories/baseRepository'
import { clearFreshnessCache, toMs } from '../services/freshness'
import { ORDER_STATUS, ROLE } from '../constants/orderStatus'
import { CACHE_KEYS } from '../constants/cacheConfig'
import { buildCsvLine, writeCsvWithBom, shareOrSaveFile, isPcPlatform, chooseFile } from '../utils/csv'
import { getTodayString } from '../utils/date'
import { loadAdminData } from '../services/adminDataLoader'
import { filterMergeTargets, patchMembersAfterMerge } from '../utils/memberMerge'

export function useDataManage() {
    const MAX_BATCH_COUNT = 2000
    const MAX_BATCH_BYTES = 400 * 1024 // 400KB，避免云函数 callFunction payload 超限

    function splitBatches<T>(records: T[]): T[][] {
        if (records.length === 0) return []
        const batches: T[][] = []
        let batch: T[] = []
        let batchSize = 0
        for (const record of records) {
            const recSize = JSON.stringify(record).length * 3
            if (batch.length >= MAX_BATCH_COUNT || (batch.length > 0 && batchSize + recSize > MAX_BATCH_BYTES)) {
                batches.push(batch)
                batch = []
                batchSize = 0
            }
            batch.push(record)
            batchSize += recSize
        }
        if (batch.length > 0) batches.push(batch)
        return batches
    }

    const store = useStore()
    const loading = ref(false)
    const pendingOrders = ref<any[]>([])
    const confirmedOrders = ref<any[]>([])
    const selectedIds = ref<string[]>([])
    const confirming = ref(false)
    const showDownloadDialog = ref(false)
    const downloadMode = ref<'supplier' | 'all'>('all')
    const downloading = ref(false)
    const showNameEditDialog = ref(false)
    const editingMember = ref<any>(null)
    const editingName = ref('')
    const exporting = ref(false)
    const importing = ref(false)
    const showBackupDialog = ref(false)
    const backupList = ref<any[]>([])
    const selectedBackupId = ref('')
    const restoring = ref(false)
    const backupStep = ref<'list' | 'preview' | 'confirm'>('list')
    const selectedBackup = ref<any>(null)
    const backingUp = ref(false)
    const rebuilding = ref(false)
    const saving = ref(false)

    // 停止接单时间相关
    const showCutoffDialog = ref(false)
    const cutoffInput = ref('')
    const savingCutoff = ref(false)
    const groupCutoff = computed(() => store.groupCutoff || '10:00')
    const groupCutoffDisabled = computed(() => store.cutoffDisabled)
    const togglingCutoff = ref(false)

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

    const isAllSelected = computed(() =>
        pendingOrders.value.length > 0 &&
        pendingOrders.value.every(o => selectedIds.value.includes(o._id))
    )

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
            subtotal: Math.round(orders.reduce((sum: number, o: any) => sum + (o.price || 0) * 100, 0)) / 100,
        }))
    })

    async function loadData() {
        loading.value = true
        try {
            // 历史订单计数与今日列表并行拉取，避免管理页入口缺失
            const historyTask = loadHistoryCount()
            const { orders: res, timestamps: tsRes, ordersError, timestampsError } = await loadAdminData(
                () => orderAction('getRecentOrders'),
                () => menuAction('getDataTimestamps'),
            )
            if (res?.result.code === 0) {
                const orders = res.result.data || []
                const today = getTodayString()
                const todayOrders = orders.filter((o: any) => o.date === today)
                pendingOrders.value = todayOrders.filter((o: any) => o.status === ORDER_STATUS.PENDING)
                confirmedOrders.value = todayOrders.filter((o: any) => o.status === ORDER_STATUS.CONFIRMED)
            }
            if (tsRes?.result.code === 0) {
                setStore({ groupCutoff: tsRes.result.data.orderCutoff || '10:00', cutoffDisabled: !!tsRes.result.data.cutoffDisabled })
                const membersTimestamp = tsRes.result.data.membersTimestamp
                if (toMs(membersTimestamp) !== toMs(store.membersTimestamp)) {
                    try {
                        const membersRes = await menuAction('getMembers')
                        if (membersRes.result.code === 0) {
                            store.members = membersRes.result.data || []
                            setStore({ membersTimestamp })
                            setCache(CACHE_KEYS.MEMBERS, store.members)
                            setCache(CACHE_KEYS.MEMBERS_TIMESTAMP, membersTimestamp)
                        }
                    } catch (e) {
                        console.error('loadData members error:', e)
                    }
                }
            }
            if (ordersError) console.error('loadData orders error:', ordersError)
            if (timestampsError) console.error('loadData timestamps error:', timestampsError)
            await historyTask
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

    // 已确认订单的选择状态（独立于待确认）
    const confirmedSelectedIds = ref<string[]>([])
    const cancelling = ref(false)

    const isAllConfirmedSelected = computed(() => {
        return confirmedOrders.value.length > 0 && confirmedOrders.value.every(o => confirmedSelectedIds.value.includes(o._id))
    })

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

    async function batchCancelConfirmed() {
        if (confirmedSelectedIds.value.length === 0) return
        const ids = [...confirmedSelectedIds.value]
        const { confirm } = await uni.showModal({ title: '取消订单', content: `确认取消 ${ids.length} 条已确认订单？` })
        if (!confirm) return
        cancelling.value = true
        try {
            const res = await orderAction('batchCancelOrders', { orderIds: ids })
            if (res.result.code === 0) {
                uni.showToast({ title: '取消成功', icon: 'success' })
                confirmedSelectedIds.value = []
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

    async function batchCancelPending() {
        if (selectedIds.value.length === 0) return
        const ids = [...selectedIds.value]
        const { confirm } = await uni.showModal({ title: '取消订单', content: `确认取消 ${ids.length} 条待确认订单？` })
        if (!confirm) return
        cancelling.value = true
        try {
            const res = await orderAction('batchCancelOrders', { orderIds: ids })
            if (res.result.code === 0) {
                uni.showToast({ title: '取消成功', icon: 'success' })
                selectedIds.value = []
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

    // 取消申请相关
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

    function shareLocalFile(filePath: string, fileName: string): Promise<{ success: boolean; message: string; cancelled?: boolean }> {
        return new Promise((resolve) => {
            // PC 端：直接保存到磁盘，无需弹窗确认
            if (isPcPlatform()) {
                shareOrSaveFile(filePath, fileName).then(res => {
                    try { wx.getFileSystemManager().unlinkSync(filePath) } catch {}
                    resolve(res)
                })
                return
            }
            // 移动端：弹窗确认后分享到微信
            uni.showModal({
                title: '导出成功',
                content: '是否分享到微信？',
                confirmText: '分享',
                cancelText: '取消',
                success: (modalRes) => {
                    if (!modalRes.confirm) {
                        try { wx.getFileSystemManager().unlinkSync(filePath) } catch {}
                        resolve({ success: false, message: '已取消', cancelled: true })
                        return
                    }
                    shareOrSaveFile(filePath, fileName).then(res => {
                        try { wx.getFileSystemManager().unlinkSync(filePath) } catch {}
                        resolve(res)
                    })
                },
            })
        })
    }

    async function downloadCloudFile(fileID: string, fileName?: string) {
        return new Promise<void>((resolve, reject) => {
            wx.cloud.downloadFile({
                fileID,
                success: (downloadRes: any) => {
                    const name = fileName || 'export_file.csv'
                    const filePath = downloadRes.tempFilePath
                    // PC 端：直接保存到磁盘
                    if (isPcPlatform()) {
                        shareOrSaveFile(filePath, name).then(res => {
                            if (res.success || res.cancelled) resolve()
                            else reject(new Error(res.message))
                        })
                        return
                    }
                    // 移动端：弹窗确认后分享
                    uni.showModal({
                        title: '下载成功',
                        content: '是否分享到微信？',
                        confirmText: '分享',
                        cancelText: '取消',
                        success: (modalRes) => {
                            if (!modalRes.confirm) {
                                resolve()
                                return
                            }
                            shareOrSaveFile(filePath, name).then(res => {
                                if (res.success || res.cancelled) resolve()
                                else reject(new Error(res.message))
                            })
                        },
                    })
                },
                fail: () => reject(new Error('下载文件失败')),
            })
        })
    }

    async function downloadConfirmed() {
        downloading.value = true
        try {
            await localDownloadConfirmed()
        } finally {
            downloading.value = false
        }
    }

    async function localDownloadConfirmed() {
        try {
            if (downloadMode.value === 'supplier') {
                for (const group of confirmedBySupplier.value) {
                    const lines = ['姓名,餐品,金额,备注']
                    group.orders.forEach((o: any) => {
                        lines.push(buildCsvLine([o.memberName, o.menuName, o.price, o.note || '']))
                    })
                    lines.push(buildCsvLine(['合计', '', group.subtotal, '']))
                    const fs = wx.getFileSystemManager()
                    const fileName = `确认单_${group.supplier}_${getTodayString()}.csv`
                    const path = `${wx.env.USER_DATA_PATH}/${fileName}`
                    writeCsvWithBom(fs, path, lines.join('\r\n'))
                    const shareRes = await shareLocalFile(path, fileName)
                    uni.showToast({ title: shareRes.success ? '分享成功' : (shareRes.cancelled ? '已取消' : '分享失败'), icon: shareRes.success ? 'success' : 'none' })
                }
            } else {
                const lines = ['供应商,姓名,餐品,金额,备注']
                confirmedBySupplier.value.forEach(group => {
                    group.orders.forEach((o: any) => {
                        lines.push(buildCsvLine([group.supplier, o.memberName, o.menuName, o.price, o.note || '']))
                    })
                    lines.push(buildCsvLine([group.supplier, '小计', '', group.subtotal, '']))
                })
                const total = Math.round(confirmedOrders.value.reduce((s: number, o: any) => s + (o.price || 0) * 100, 0)) / 100
                lines.push(buildCsvLine(['全部', '合计', '', total, '']))
                const fs = wx.getFileSystemManager()
                const fileName = `确认单_全部_${getTodayString()}.csv`
                const path = `${wx.env.USER_DATA_PATH}/${fileName}`
                writeCsvWithBom(fs, path, lines.join('\r\n'))
                const shareRes = await shareLocalFile(path, fileName)
                uni.showToast({ title: shareRes.success ? '分享成功' : (shareRes.cancelled ? '已取消' : '分享失败'), icon: shareRes.success ? 'success' : 'none' })
            }
            showDownloadDialog.value = false
        } catch (e: any) {
            uni.showToast({ title: e.message || '下载失败', icon: 'none' })
        }
    }

    function openNameEdit(member: any) {
        editingMember.value = member
        editingName.value = member.name || ''
        showNameEditDialog.value = true
    }

    async function saveMemberName() {
        if (saving.value) return
        if (!editingMember.value) return
        const name = editingName.value.trim()
        if (!name) {
            uni.showToast({ title: '姓名不能为空', icon: 'none' })
            return
        }
        if (name.length > 20) {
            uni.showToast({ title: '姓名不能超过20个字符', icon: 'none' })
            return
        }
        saving.value = true
        try {
            await menuAction('updateMemberName', { memberId: editingMember.value._id, name })
            const member = store.members.find((m: any) => m._id === editingMember.value._id)
            if (member) member.name = name
            setCache(CACHE_KEYS.MEMBERS, store.members)
            if (store.member && store.member._id === editingMember.value._id) {
                store.member.name = name
                saveSession({ groupId: store.member.groupId, role: store.member.role, member: store.member })
            }
            showNameEditDialog.value = false
            uni.showToast({ title: '已保存', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '保存失败', icon: 'none' })
        } finally {
            saving.value = false
        }
    }

    async function setAdminRole(memberId: string) {
        try {
            await menuAction('setAdmin', { memberId, isAdmin: true })
            const member = store.members.find((m: any) => m._id === memberId)
            if (member) member.role = ROLE.ADMIN
            setCache(CACHE_KEYS.MEMBERS, store.members)
            if (store.member?._id === memberId) {
                store.member.role = ROLE.ADMIN
                store.role = ROLE.ADMIN
                saveSession({ groupId: store.member.groupId, role: ROLE.ADMIN, member: store.member })
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    async function removeAdminRole(memberId: string) {
        try {
            await menuAction('setAdmin', { memberId, isAdmin: false })
            const member = store.members.find((m: any) => m._id === memberId)
            if (member) member.role = ROLE.MEMBER
            setCache(CACHE_KEYS.MEMBERS, store.members)
            if (store.member?._id === memberId) {
                store.member.role = ROLE.MEMBER
                store.role = ROLE.MEMBER
                saveSession({ groupId: store.member.groupId, role: ROLE.MEMBER, member: store.member })
            }
            uni.showToast({ title: '已撤除管理员', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    // 覆盖导入前先做一次全量备份；备份失败则取消，避免“先删后写”中途失败丢数据
    async function ensureBackupBeforeRewrite(mode: 'append' | 'rewrite' | ''): Promise<boolean> {
        if (mode !== 'rewrite') return true
        uni.showLoading({ title: '覆盖前自动备份...', mask: true })
        try {
            const res = await backupAction('backupManual', { remark: '覆盖导入前自动备份' })
            if (res.result.code !== 0) throw new Error(res.result.msg || '自动备份失败')
            return true
        } catch (e: any) {
            uni.showToast({ title: (e.message || '自动备份失败') + '，已取消覆盖导入', icon: 'none', duration: 3000 })
            return false
        } finally {
            uni.hideLoading()
        }
    }

    async function doImportXlsx(filePath: string, importType: 'orders' | 'menu' | 'members') {
        const mode = await new Promise<'append' | 'rewrite' | ''>(resolve => {
            const typeLabel = importType === 'orders' ? '订单' : importType === 'menu' ? '菜单' : '人员'
            uni.showModal({
                title: '导入方式',
                content: importType === 'members'
                    ? '已有微信账号及角色保留，同名账号行跳过。角色列忽略。追加导入或覆盖未绑定微信的普通成员？'
                    : `追加数据：仅导入新${typeLabel}，重复跳过\n清库重写：清空所有${typeLabel}后导入`,
                confirmText: '追加',
                cancelText: '清库重写',
                success: res => resolve(res.confirm ? 'append' : 'rewrite'),
            })
        })
        if (!mode) return
        if (!await ensureBackupBeforeRewrite(mode)) return

        uni.showLoading({ title: '上传文件...' })
        try {
            const cloudPath = 'lunch/imports/' + getActiveGroupId() + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 10) + '.xlsx'
            const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
            uni.showLoading({ title: '导入中...' })
            let res: any
            try {
                res = await orderAction('importFromXlsx', { fileID: uploadRes.fileID, mode, importType })
            } catch (callErr: any) {
                const errMsg = callErr?.errMsg || callErr?.message || String(callErr)
                throw new Error(`云函数调用失败: ${errMsg}`)
            }
            const result = res?.result
            if (!result) throw new Error('云函数未返回结果')
            if (result.code === 0) {
                const data = result.data || {}
                const parts = [`导入${data.count || 0}条`]
                if (data.skipped > 0) parts.push(`跳过${data.skipped}条`)
                if (data.errors > 0) parts.push(`${data.errors}条失败`)
                uni.showToast({ title: parts.join('，'), icon: data.count > 0 ? 'success' : 'none' })
                if (importType === 'orders') {
                    await loadData()
                    if (data.skippedDetails && data.skippedDetails.length > 0) {
                        showSkippedDetails(data.skippedDetails)
                    }
                } else if (importType === 'menu') {
                    try {
                        const menuRes = await menuAction('getMenuList')
                        if (menuRes.result.code === 0) {
                            store.menu = menuRes.result.data || []
                            setCache(CACHE_KEYS.MENU, store.menu)
                        }
                    } catch {}
                } else {
                    if (data.skippedDetails?.length) showSkippedDetails(data.skippedDetails)
                    try {
                        const memberRes = await menuAction('getMembers')
                        if (memberRes.result.code === 0) {
                            store.members = memberRes.result.data || []
                            setCache(CACHE_KEYS.MEMBERS, store.members)
                        }
                    } catch {}
                }
            } else {
                throw new Error(result.msg || '导入失败')
            }
        } catch (e: any) {
            uni.hideLoading()
            uni.showToast({ title: e.message || '导入失败', icon: 'none', duration: 3000 })
        }
    }

    const HEADER_ALIASES: Record<string, string[]> = {
        date: ['日期', 'date'],
        menuName: ['菜品', '菜品名', 'menuname', 'order', 'description'],
        memberName: ['姓名', 'membername', 'name', 'name list', '名单'],
        price: ['金额', '价格', 'price', 'rmb'],
        note: ['备注', 'note', 'comment', 'column1'],
        supplier: ['供应商', 'vendor'],
        status: ['状态', 'status'],
        supplier_menu: ['供应商', 'vendor'],
        menuName_menu: ['菜品名', '菜品', 'menuname', 'order', 'description'],
        price_menu: ['价格', '金额', 'price', 'rmb'],
        visible: ['可见', 'visible'],
        name_member: ['姓名', 'membername', 'name', 'name list', '名单'],
        nickName: ['昵称', 'nickname', 'nick name'],
        role: ['角色', 'role'],
        isVirtual: ['虚拟用户', 'virtual'],
    }

    function mapHeader(header: string[], fields: string[]): Record<string, number> {
        const result: Record<string, number> = {}
        const lowerHeader = header.map(h => (h ?? '').trim().toLowerCase())
        // Pass 1: exact match
        for (const field of fields) {
            const aliases = HEADER_ALIASES[field] || [field]
            const lowerAliases = aliases.map(a => a.toLowerCase())
            const idx = lowerHeader.findIndex(h => lowerAliases.some(a => h === a))
            if (idx >= 0) result[field] = idx
        }
        // Pass 2: fuzzy match (only for unmatched fields, avoid already-assigned columns)
        for (const field of fields) {
            if (result[field] !== undefined) continue
            const aliases = HEADER_ALIASES[field] || [field]
            const lowerAliases = aliases.map(a => a.toLowerCase())
            const idx = lowerHeader.findIndex(h => lowerAliases.some(a => h.includes(a) || a.includes(h)))
            if (idx >= 0 && !Object.values(result).includes(idx)) result[field] = idx
        }
        return result
    }

    async function exportData(type: 'orders' | 'menu' | 'members') {
        exporting.value = true
        try {
            if (type === 'orders') {
                await exportOrders()
            } else if (type === 'menu') {
                await exportMenu()
            } else {
                await exportMembers()
            }
        } finally {
            exporting.value = false
        }
    }

    async function exportOrders() {
        try {
            const res = await orderAction('exportOrders')
            if (res.result.code === 0 && res.result.data.fileID) {
                await downloadCloudFile(res.result.data.fileID)
                return
            }
        } catch {}
        await localExportOrders()
    }

    async function localExportOrders() {
        try {
            const allOrders = [...pendingOrders.value, ...confirmedOrders.value]
            const statusMap: Record<string, string> = { pending: '待确认', confirmed: '已确认', cancelled: '已取消' }
            const lines = ['日期,菜品,姓名,金额,备注,状态,供应商']
            allOrders.forEach(o => {
                lines.push(buildCsvLine([o.date, o.menuName, o.memberName, o.price, o.note || '', statusMap[o.status] || o.status, o.supplier || '']))
            })
            const fs = wx.getFileSystemManager()
            const fileName = `export_orders_${getTodayString()}.csv`
            const path = `${wx.env.USER_DATA_PATH}/${fileName}`
            writeCsvWithBom(fs, path, lines.join('\r\n'))
            const shareRes = await shareLocalFile(path, fileName)
            if (shareRes.success) {
                uni.showToast({ title: allOrders.length === 0 ? '模板已分享' : '分享成功', icon: 'success' })
            } else if (!shareRes.cancelled) {
                uni.showToast({ title: '分享失败', icon: 'none' })
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '导出失败', icon: 'none' })
        }
    }

    async function exportMenu() {
        try {
            const res = await menuAction('getMenuList')
            if (res.result.code === 0) {
                const menuList = res.result.data || []
                const lines = ['供应商,菜品名,价格,可见']
                menuList.forEach((m: any) => {
                    lines.push(buildCsvLine([m.supplier, m.name, m.price, m.visible !== false ? '是' : '否']))
                })
                const fs = wx.getFileSystemManager()
                const fileName = `export_menu_${getTodayString()}.csv`
                const path = `${wx.env.USER_DATA_PATH}/${fileName}`
                writeCsvWithBom(fs, path, lines.join('\r\n'))
                const shareRes = await shareLocalFile(path, fileName)
                if (shareRes.success) {
                    uni.showToast({ title: menuList.length === 0 ? '模板已分享' : '分享成功', icon: 'success' })
                } else if (!shareRes.cancelled) {
                    uni.showToast({ title: '分享失败', icon: 'none' })
                }
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '导出失败', icon: 'none' })
        }
    }

    async function exportMembers() {
        try {
            const res = await menuAction('getMembers')
            if (res.result.code === 0) {
                const memberList = res.result.data || []
                const lines = ['姓名,昵称,角色,虚拟用户']
                memberList.forEach((m: any) => {
                    lines.push(buildCsvLine([m.name || '', m.nickName || '', m.role || 'member', m.isVirtual ? '是' : '否']))
                })
                const fs = wx.getFileSystemManager()
                const fileName = `export_members_${getTodayString()}.csv`
                const path = `${wx.env.USER_DATA_PATH}/${fileName}`
                writeCsvWithBom(fs, path, lines.join('\r\n'))
                const shareRes = await shareLocalFile(path, fileName)
                if (shareRes.success) {
                    uni.showToast({ title: memberList.length === 0 ? '模板已分享' : '分享成功', icon: 'success' })
                } else if (!shareRes.cancelled) {
                    uni.showToast({ title: '分享失败', icon: 'none' })
                }
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '导出失败', icon: 'none' })
        }
    }

    async function importData(type: 'orders' | 'menu' | 'members') {
        const chooseRes = await chooseFile(['csv', 'xlsx'])
        if (!chooseRes.success || !chooseRes.filePath) {
            if (!chooseRes.cancelled) {
                uni.showToast({ title: chooseRes.message, icon: 'none' })
            }
            return
        }
        const filePath = chooseRes.filePath
        const ext = filePath.split('.').pop()?.toLowerCase()
        if (ext !== 'csv' && ext !== 'xlsx') {
            uni.showToast({ title: '只支持csv和xlsx格式', icon: 'none' })
            return
        }
        importing.value = true
        try {
            if (type === 'orders') {
                await doImportOrders(filePath, ext)
            } else if (type === 'menu') {
                await doImportMenu(filePath, ext)
            } else {
                await doImportMembers(filePath, ext)
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '导入失败', icon: 'none' })
        } finally {
            importing.value = false
        }
    }

    function showSkippedDetails(details: any[]) {
        if (!details || details.length === 0) return
        const lines = details.slice(0, 10).map(d =>
            d.reason ? (d.name + '：' + d.reason) : `${d.memberName} - ${d.menuName}（${d.date}，¥${d.price}）`
        )
        if (details.length > 10) {
            lines.push(`...等共${details.length}条`)
        }
        uni.showModal({
            title: '已跳过 ' + details.length + ' 条',
            content: lines.join('\n'),
            showCancel: false,
            confirmText: '知道了',
        })
    }

    async function doImportCsvOrders(filePath: string) {
        const mode = await new Promise<'append' | 'rewrite' | ''>(resolve => {
            uni.showModal({
                title: '导入方式',
                content: '追加数据：仅导入新数据，重复跳过\n清库重写：清空所有订单后导入',
                confirmText: '追加',
                cancelText: '清库重写',
                success: res => resolve(res.confirm ? 'append' : 'rewrite'),
            })
        })
        if (!mode) return
        if (!await ensureBackupBeforeRewrite(mode)) return

        uni.showLoading({ title: '上传文件...' })
        try {
            const cloudPath = 'lunch/imports/' + getActiveGroupId() + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 10) + '.csv'
            const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
            uni.showLoading({ title: '导入中...' })
            const res = await orderAction('importFromCsv', { fileID: uploadRes.fileID, mode })
            try { await wx.cloud.deleteFile({ fileList: [uploadRes.fileID] }).catch(() => {}) } catch {}
            const result = res?.result
            if (!result) throw new Error('云函数未返回结果')
            if (result.code === 0) {
                const data = result.data || {}
                const parts = [`导入${data.count || 0}条`]
                if (data.skipped > 0) parts.push(`跳过${data.skipped}条`)
                if (data.errors > 0) parts.push(`${data.errors}条失败`)
                uni.showToast({ title: parts.join('，'), icon: (data.count || 0) > 0 ? 'success' : 'none' })
                await loadData()
                if (data.skippedDetails && data.skippedDetails.length > 0) {
                    showSkippedDetails(data.skippedDetails)
                }
            } else {
                throw new Error(result.msg || '导入失败')
            }
        } catch (e: any) {
            uni.hideLoading()
            uni.showToast({ title: e.message || '导入失败', icon: 'none', duration: 3000 })
        }
    }

    async function doImportOrders(filePath: string, ext: string) {
        if (ext === 'xlsx') {
            await doImportXlsx(filePath, 'orders')
            return
        }
        await doImportCsvOrders(filePath)
    }

    async function fetchCsvRowsFromCloud(filePath: string): Promise<string[][]> {
        const cloudPath = 'lunch/imports/' + getActiveGroupId() + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 10) + '.csv'
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
        const res = await menuAction('parseCsv', { fileID: uploadRes.fileID })
        try { await wx.cloud.deleteFile({ fileList: [uploadRes.fileID] }).catch(() => {}) } catch {}
        if (res.result.code !== 0) throw new Error(res.result.msg || 'CSV解析失败')
        return res.result.data.rows || []
    }

    async function doImportMenu(filePath: string, ext: string) {
        if (ext === 'xlsx') {
            await doImportXlsx(filePath, 'menu')
            return
        }
        uni.showLoading({ title: '上传文件...' })
        try {
            const rows = await fetchCsvRowsFromCloud(filePath)
            if (rows.length < 2) throw new Error('文件为空')
            const header = rows[0]
            const idx = mapHeader(header, ['supplier_menu', 'menuName_menu', 'price_menu', 'visible'])
            if (idx.supplier_menu === undefined || idx.menuName_menu === undefined) {
                throw new Error('格式不正确，需包含供应商/菜品名')
            }
            const items = rows.slice(1)
                .filter(cols => cols[idx.supplier_menu!] && cols[idx.menuName_menu!])
                .map(cols => ({
                    supplier: cols[idx.supplier_menu!] || '',
                    name: cols[idx.menuName_menu!] || '',
                    price: idx.price_menu !== undefined ? (Number(cols[idx.price_menu]) || 0) : 0,
                    visible: idx.visible !== undefined ? cols[idx.visible] !== '否' : true,
                }))
            if (items.length === 0) throw new Error('无有效数据')
            const mode = await new Promise<'append' | 'rewrite' | ''>(resolve => {
                uni.showModal({
                    title: '导入方式',
                    content: '追加数据：仅导入新数据，重复跳过\n清库重写：清空所有菜单后导入',
                    confirmText: '追加',
                    cancelText: '清库重写',
                    success: res => resolve(res.confirm ? 'append' : 'rewrite'),
                })
            })
            if (!mode) { uni.hideLoading(); return }
            if (!await ensureBackupBeforeRewrite(mode)) return
            const batches = splitBatches(items)
            uni.showLoading({ title: '导入中...' })
            let totalInserted = 0
            for (let i = 0; i < batches.length; i++) {
                const batchMode = i === 0 ? mode : (mode === 'rewrite' ? 'rewrite_continue' : 'append')
                const res = await menuAction('importMenuItems', { items: batches[i], mode: batchMode })
                if (res.result.code === 0) totalInserted += res.result.data.count
                else throw new Error(res.result.msg || '导入失败')
            }
            uni.showToast({ title: `导入${totalInserted}条`, icon: 'success' })
            try {
                const res = await menuAction('getMenuList')
                if (res.result.code === 0) {
                    const data = res.result.data || []
                    store.menu = data
                    setCache(CACHE_KEYS.MENU, data)
                }
            } catch {}
        } catch (e: any) {
            uni.hideLoading()
            uni.showToast({ title: e.message || '导入失败', icon: 'none', duration: 3000 })
        }
    }

    async function doImportMembers(filePath: string, ext: string) {
        if (ext === 'xlsx') {
            await doImportXlsx(filePath, 'members')
            return
        }
        uni.showLoading({ title: '上传文件...' })
        let rows: string[][]
        try {
            rows = await fetchCsvRowsFromCloud(filePath)
            if (rows.length < 2) throw new Error('文件为空')
        } catch (e: any) {
            uni.hideLoading()
            uni.showToast({ title: e.message || '导入失败', icon: 'none', duration: 3000 })
            return
        }
        const header = rows[0]
        const idx = mapHeader(header, ['name_member', 'nickName', 'role', 'isVirtual'])
        if (idx.name_member === undefined) {
            uni.showToast({ title: '格式不正确，需包含姓名', icon: 'none' })
            return
        }
        const members = rows.slice(1)
            .filter(cols => cols[idx.name_member!]?.trim())
            .map(cols => ({
                name: cols[idx.name_member!].trim(),
                nickName: idx.nickName !== undefined ? (cols[idx.nickName] || '') : '',
                role: idx.role !== undefined ? (cols[idx.role] || 'member') : 'member',
                isVirtual: idx.isVirtual !== undefined ? cols[idx.isVirtual] !== '否' : true,
            }))
        if (members.length === 0) {
            uni.showToast({ title: '无有效数据', icon: 'none' })
            return
        }
        const mode = await new Promise<'append' | 'rewrite' | ''>(resolve => {
            uni.showModal({
                title: '导入方式',
                content: '已有微信账号及角色保留，同名账号行跳过，角色列忽略。追加导入或覆盖未绑定微信的普通成员？',
                confirmText: '追加',
                cancelText: '清库重写',
                success: res => resolve(res.confirm ? 'append' : 'rewrite'),
            })
        })
        if (!mode) { uni.hideLoading(); return }
        if (!await ensureBackupBeforeRewrite(mode)) return
        const batches = splitBatches(members)
        let totalInserted = 0
        const skippedMembers: any[] = []
        for (let i = 0; i < batches.length; i++) {
            const batchMode = i === 0 ? mode : (mode === 'rewrite' ? 'rewrite_continue' : 'append')
            const res = await menuAction('importMembers', { members: batches[i], mode: batchMode, retainedNames: members.map(m => m.name) })
            if (res.result.code === 0) {
                totalInserted += res.result.data.count
                skippedMembers.push(...(res.result.data.skippedDetails || []))
            }
            else throw new Error(res.result.msg || '导入失败')
        }
        if (skippedMembers.length) showSkippedDetails(skippedMembers)
        uni.showToast({ title: `导入${totalInserted}条`, icon: 'success' })
        try {
            const res = await menuAction('getMembers')
            if (res.result.code === 0) {
                const data = res.result.data || []
                store.members = data
                setCache(CACHE_KEYS.MEMBERS, data)
            }
        } catch {}
    }

    async function manualBackup() {
        backingUp.value = true
        try {
            const res = await backupAction('backupManual')
            if (res.result.code === 0) {
                uni.showToast({ title: '备份成功', icon: 'success' })
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '备份失败', icon: 'none' })
        } finally {
            backingUp.value = false
        }
    }

    async function openBackupDialog() {
        try {
            const res = await backupAction('getBackupList')
            if (res.result.code === 0) {
                backupList.value = res.result.data || []
                if (backupList.value.length === 0) {
                    uni.showToast({ title: '暂无备份', icon: 'none' })
                    return
                }
                selectedBackupId.value = ''
                selectedBackup.value = null
                backupStep.value = 'list'
                showBackupDialog.value = true
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '获取备份列表失败', icon: 'none' })
        }
    }

    function selectBackup(bk: any) {
        selectedBackupId.value = bk._id
        selectedBackup.value = bk
        backupStep.value = 'preview'
    }

    function confirmRestore() {
        backupStep.value = 'confirm'
    }

    async function restoreBackup() {
        if (restoring.value) return
        if (!selectedBackupId.value) {
            uni.showToast({ title: '请选择备份', icon: 'none' })
            return
        }
        restoring.value = true
        try {
            const backupId = selectedBackupId.value
            const groupId = store.groupId
            const capabilities = await backupAction('getBackupCapabilities', { groupId })
            if (capabilities.result.data?.restoreProtocol !== 2) throw new Error('请先更新备份云函数')
            let jobId = ''
            let rounds = 0
            let lastProcessed = -1
            let stalled = 0
            const MAX_RESTORE_ROUNDS = 2000
            while (true) {
                if (++rounds > MAX_RESTORE_ROUNDS) throw new Error('恢复轮次过多，请稍后重试继续')
                if (store.groupId !== groupId) throw new Error('组织已切换，请返回原组织继续恢复')
                const res = await backupAction('restoreBackup', { backupId, jobId: jobId || undefined, groupId, restoreProtocol: 2 })
                const progress = res.result.data
                if (typeof progress?.done !== 'boolean') throw new Error('恢复协议不匹配，请更新云函数')
                jobId = progress.jobId
                if (progress.done) break
                const processed = Number(progress.processed) || 0
                if (processed === lastProcessed) {
                    stalled++
                    if (stalled >= 3) throw new Error('恢复长时间无进展，请稍后重试继续')
                } else {
                    lastProcessed = processed
                    stalled = 0
                }
                uni.showLoading({ title: '恢复 ' + (progress.processed || 0) + '/' + progress.total, mask: true })
            }
            showBackupDialog.value = false
            flushCache()
            clearAllCache()
            clearFreshnessCache()
            setStore({ statsLoadTime: 0, recentLoadTime: 0 })
            try {
                const init = await orderAction('getInitData')
                setStore(init.result.data)
                saveSession({ groupId: groupId!, role: init.result.data.role, member: init.result.data.member })
                await loadData()
                uni.showToast({ title: '恢复成功', icon: 'success' })
            } catch {
                uni.showToast({ title: '已恢复，请重新打开小程序刷新', icon: 'none', duration: 3500 })
            }
        } catch (e: any) {
            uni.hideLoading()
            await uni.showModal({ title: '恢复未完成', content: (e.message || '请求失败') + '。若恢复已经开始，组织将保持维护状态；请选择同一备份继续恢复。', showCancel: false })
        } finally {
            uni.hideLoading()
            restoring.value = false
        }
    }

    async function rebuildRelations() {
        const { confirm } = await uni.showModal({
            title: '重置订单关联',
            content: '将根据成员姓名和餐品名称重新匹配所有订单的内部关联，并清除个人点餐统计（下次点餐自动重建）。确认？',
        })
        if (!confirm) return
        rebuilding.value = true
        try {
            const res = await orderAction('rebuildOrderRelations')
            if (res.result.code === 0) {
                const d = res.result.data
                let content = `扫描 ${d.totalOrders} 条订单\n修复成员关联 ${d.memberFixed} 条\n修复菜单关联 ${d.menuFixed} 条`
                if (d.memberNotFound) content += `\n⚠ ${d.memberNotFound} 条未找到对应成员`
                if (d.menuNotFound) content += `\n⚠ ${d.menuNotFound} 条未找到对应餐品`
                uni.showModal({ title: '重置完成', content, showCancel: false })
                await loadData()
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '重置失败', icon: 'none' })
        } finally {
            rebuilding.value = false
        }
    }

    async function deleteMember(member: any) {
        if (member.role === 'creator') return
        const { confirm } = await uni.showModal({
            title: '确认删除',
            content: `删除成员"${member.name || member.nickName || '未命名'}"后不可恢复，确定？`,
        })
        if (!confirm) return
        try {
            await menuAction('deleteMember', { memberId: member._id })
            store.members = store.members.filter((m: any) => m._id !== member._id)
            setCache(CACHE_KEYS.MEMBERS, store.members)
            uni.showToast({ title: '已删除', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '删除失败', icon: 'none' })
        }
    }

    async function clearAllData() {
        const { confirm: c1 } = await uni.showModal({
            title: '⚠️ 危险操作',
            content: '将删除本组织所有数据（订单、菜单、成员），确定继续？',
        })
        if (!c1) return
        const { confirm: c2 } = await uni.showModal({
            title: '二次确认',
            content: '数据删除后不可恢复，是否已备份？',
        })
        if (!c2) return
        try {
            await backupAction('clearAllData')
            store.members = []
            store.menu = []
            store.recentOrders = []
            pendingOrders.value = []
            confirmedOrders.value = []
            // 服务端已清空业务数据，本机缓存必须同步清掉，避免重启后旧数据回填
            setCache(CACHE_KEYS.RECENT_ORDERS, [])
            setCache(CACHE_KEYS.MENU, [])
            setCache(CACHE_KEYS.MEMBERS, [])
            setCache(CACHE_KEYS.MONTH_SUMMARY, null)
            setCache(CACHE_KEYS.RECENT_TIMESTAMP, null)
            setCache(CACHE_KEYS.MENU_TIMESTAMP, null)
            setCache(CACHE_KEYS.MEMBERS_TIMESTAMP, null)
            setRecentLoadTime(0)
            // 复用现有缓存机制：清掉本机统计缓存并让统计页下次按原流程重新加载
            setStatsLoadTime(0)
            setCache(CACHE_KEYS.MONTHLY_STATS, [], true)
            setCache(CACHE_KEYS.MONTHLY_STATS_TIME, 0, true)
            uni.showToast({ title: '数据已清除', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    async function deleteGroup() {
        const { confirm: c1 } = await uni.showModal({
            title: '⚠️ 永久删除组织',
            content: '将删除本组织及全部数据，你会被登出并跳转选组页。确定？',
        })
        if (!c1) return
        const { confirm: c2, content: confirmText } = await uni.showModal({
            title: '最后确认',
            content: '操作不可逆，请输入"删除"确认。',
            editable: true,
            placeholderText: '请输入"删除"',
        })
        if (!c2) return
        const text = (confirmText || '').trim()
        if (text !== '删除') {
            uni.showToast({ title: '输入"删除"以确认', icon: 'none' })
            return
        }
        try {
            const res = await menuAction('deleteGroup')
            if (!res || !res.result || res.result.code !== 0) {
                uni.showToast({ title: res?.result?.msg || '删除失败', icon: 'none' })
                return
            }
            clearFreshnessCache()
            clearAllCache()
            resetStore()
            uni.showToast({ title: '组织已删除', icon: 'success' })
            setTimeout(() => {
                uni.reLaunch({ url: '/pages/group-select/index' })
            }, 800)
        } catch (e: any) {
            uni.showToast({ title: e.message || '删除失败', icon: 'none' })
        }
    }

    const showMergeDialog = ref(false)
    const mergingMember = ref<any>(null)
    const mergeTargetId = ref('')
    const merging = ref(false)

    // 可作为合帐目标的成员：已登录微信（非虚拟）、非创建者且不是当前正在合并的虚拟成员
    const mergeTargetCandidates = computed(() =>
        filterMergeTargets(store.members || [], mergingMember.value?._id)
    )

    function openMergeDialog(member: any) {
        mergingMember.value = member
        mergeTargetId.value = ''
        showMergeDialog.value = true
    }

    function applyMergeResult(data: any, targetMemberId: string) {
        const mergedMember = data?.member
        if (!mergedMember) return
        const mergedOrders = data.mergedOrders || 0
        store.members = patchMembersAfterMerge(store.members || [], mergedMember, targetMemberId)
        setCache(CACHE_KEYS.MEMBERS, store.members)
        if (store.member?._id === targetMemberId || store.member?._id === mergedMember._id) {
            setStore({ member: mergedMember, role: mergedMember.role })
            saveSession({ groupId: mergedMember.groupId, role: mergedMember.role, member: mergedMember })
        }
        // 服务端已完成统计重建；这里只负责清 UI 缓存，等待统计页重新拉取
        setStatsLoadTime(0)
        setCache(CACHE_KEYS.MONTHLY_STATS, [], true)
        setCache(CACHE_KEYS.MONTHLY_STATS_TIME, 0, true)
        showMergeDialog.value = false
        showNameEditDialog.value = false
        uni.showToast({ title: `关联成功（订单${mergedOrders}条）`, icon: 'success' })
    }

    async function mergeWithWechat() {
        if (merging.value) return
        if (!mergingMember.value) return
        if (!mergeTargetId.value) {
            uni.showToast({ title: '请选择目标微信成员', icon: 'none' })
            return
        }
        const target = mergeTargetCandidates.value.find((m: any) => m._id === mergeTargetId.value)
        const virtualName = mergingMember.value.name || mergingMember.value.nickName || '未命名'
        const targetName = target?.name || target?.nickName || '未命名'
        const { confirm } = await uni.showModal({
            title: '确认关联',
            content: `将微信成员「${targetName}」的订单和统计转移到「${virtualName}」，保留「${virtualName}」并挂上微信账号，「${targetName}」记录将被删除。确定？`,
        })
        if (!confirm) return
        merging.value = true
        try {
            const res = await menuAction('adminLinkVirtualMember', {
                virtualMemberId: mergingMember.value._id,
                targetMemberId: mergeTargetId.value,
            })
            if (res.result.code === 0) {
                applyMergeResult(res.result.data, mergeTargetId.value)
                await loadData()
            } else {
                throw new Error(res.result.msg || '关联失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '关联失败', icon: 'none' })
        } finally {
            merging.value = false
        }
    }

    // 页面刷新后继续未完成合账：target 已被认领事务删除，直接使用持久化指针
    async function resumeMergeInProgress(member: any) {
        if (merging.value) return
        if (!member?.mergeFromMemberId) return
        merging.value = true
        try {
            const res = await menuAction('adminLinkVirtualMember', {
                virtualMemberId: member._id,
                targetMemberId: member.mergeFromMemberId,
            })
            if (res.result.code === 0) {
                applyMergeResult(res.result.data, member.mergeFromMemberId)
                await loadData()
            } else {
                throw new Error(res.result.msg || '继续合账失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '继续合账失败', icon: 'none' })
        } finally {
            merging.value = false
        }
    }

    const showMenuEditModal = ref(false)
    const menuEditForm = ref({ menuId: '', supplier: '', name: '', price: '', photo: '' })
    const isMenuEdit = ref(false)

    function openMenuAdd() {
        isMenuEdit.value = false
        menuEditForm.value = { menuId: '', supplier: '', name: '', price: '', photo: '' }
        showMenuEditModal.value = true
    }

    function openMenuEdit(item: any) {
        isMenuEdit.value = true
        menuEditForm.value = {
            menuId: item._id,
            supplier: item.supplier,
            name: item.name,
            price: String(item.price),
            photo: item.photo || '',
        }
        showMenuEditModal.value = true
    }

    async function saveMenuItem() {
        if (saving.value) return
        const { menuId, supplier, name, price, photo } = menuEditForm.value
        if (!supplier || !name || price === '') {
            uni.showToast({ title: '请填写完整', icon: 'none' })
            return
        }
        saving.value = true
        try {
            if (isMenuEdit.value) {
                await menuAction('updateMenuItem', { menuId, supplier, name, price: Number(price), photo })
            } else {
                await menuAction('addMenuItem', { supplier, name, price: Number(price), photo, visible: true })
            }
            showMenuEditModal.value = false
            await loadMenuList(true)
            uni.showToast({ title: isMenuEdit.value ? '已保存' : '已添加', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        } finally {
            saving.value = false
        }
    }

    async function deleteMenuItem(menuId: string) {
        const { confirm } = await uni.showModal({ title: '确认删除', content: '删除后不可恢复，确定？' })
        if (!confirm) return
        try {
            await menuAction('deleteMenuItem', { menuId })
            await loadMenuList(true)
            uni.showToast({ title: '已删除', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '删除失败', icon: 'none' })
        }
    }

    async function toggleMenuVisible(menuId: string) {
        try {
            const res = await menuAction('toggleVisible', { menuId })
            if (res.result.code !== 0) {
                throw new Error(res.result.msg || '操作失败')
            }
            await loadMenuList(true)
            uni.showToast({ title: '已切换', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    async function toggleSupplierVisible(supplier: string, visible: boolean) {
        try {
            const res = await menuAction('batchToggleVisibleBySupplier', { supplier, visible })
            if (res.result.code !== 0) {
                throw new Error(res.result.msg || '操作失败')
            }
            await loadMenuList(true)
            const count = res.result.data?.count || 0
            uni.showToast({ title: visible ? `已上架${count}道菜` : `已下架${count}道菜`, icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    const menuList = ref<any[]>([])

    async function loadMenuList(forceRefresh = false) {
        // 优先复用 store.menu（home 页已加载），避免重复调用 getMenuList
        // 写操作（增删改/上下架）后必须 forceRefresh=true 强制拉取最新数据
        if (!forceRefresh && store.menu && store.menu.length > 0) {
            menuList.value = store.menu
            return
        }
        try {
            const res = await menuAction('getMenuList')
            if (res.result.code === 0) {
                menuList.value = res.result.data || []
                store.menu = menuList.value
                setCache(CACHE_KEYS.MENU, store.menu)
            }
        } catch (e) {
            console.error('loadMenuList error:', e)
        }
    }

    function openCutoffDialog() {
        cutoffInput.value = groupCutoff.value
        showCutoffDialog.value = true
    }

    async function saveCutoff() {
        if (!cutoffInput.value) {
            uni.showToast({ title: '请选择时间', icon: 'none' })
            return
        }
        savingCutoff.value = true
        try {
            const res = await menuAction('setOrderCutoff', { time: cutoffInput.value })
            if (res.result.code === 0) {
                setStore({ groupCutoff: cutoffInput.value, cutoffDisabled: false })
                uni.showToast({ title: '已保存并启用', icon: 'success' })
                showCutoffDialog.value = false
            } else {
                throw new Error(res.result.msg || '保存失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '保存失败', icon: 'none' })
        } finally {
            savingCutoff.value = false
        }
    }

    async function toggleCutoffDisabled() {
        if (togglingCutoff.value) return
        togglingCutoff.value = true
        try {
            const disabled = !groupCutoffDisabled.value
            const res = await menuAction('setCutoffDisabled', { disabled })
            if (res.result.code === 0) {
                setStore({ cutoffDisabled: disabled })
                uni.showToast({ title: disabled ? '已禁用，停止接单时间不生效' : '已启用停止接单时间', icon: 'none' })
            } else {
                throw new Error(res.result.msg || '操作失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        } finally {
            togglingCutoff.value = false
        }
    }

    return {
        loading,
        pendingOrders,
        confirmedOrders,
        confirmedBySupplier,
        selectedIds,
        isAllSelected,
        confirming,
        showDownloadDialog,
        downloadMode,
        downloading,
        showNameEditDialog,
        editingMember,
        editingName,
        exporting,
        importing,
        showBackupDialog,
        backupList,
        selectedBackupId,
        restoring,
        backupStep,
        selectedBackup,
        backingUp,
        showMergeDialog,
        mergingMember,
        mergeTargetId,
        mergeTargetCandidates,
        merging,
        showMenuEditModal,
        menuEditForm,
        isMenuEdit,
        menuList,
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
        showCutoffDialog,
        cutoffInput,
        savingCutoff,
        groupCutoff,
        groupCutoffDisabled,
        loadData,
        toggleSelect,
        toggleSelectAll,
        batchConfirm,
        cancelOrder,
        confirmedSelectedIds,
        isAllConfirmedSelected,
        toggleConfirmedSelect,
        toggleSelectAllConfirmed,
        batchCancelConfirmed,
        batchCancelPending,
        cancelling,
        pendingCancelRequests,
        loadPendingCancelRequests,
        approveCancelRequest,
        rejectCancelRequest,
        downloadConfirmed,
        openNameEdit,
        saveMemberName,
        setAdminRole,
        removeAdminRole,
        deleteMember,
        clearAllData,
        deleteGroup,
        openMergeDialog,
        mergeWithWechat,
        resumeMergeInProgress,
        openMenuAdd,
        openMenuEdit,
        saveMenuItem,
        deleteMenuItem,
        toggleMenuVisible,
        toggleSupplierVisible,
        loadMenuList,
        exportData,
        importData,
        manualBackup,
        openBackupDialog,
        selectBackup,
        confirmRestore,
        restoreBackup,
        rebuilding,
        rebuildRelations,
        toggleHistoryPending,
        toggleHistoryConfirmed,
        loadMoreHistoryPending,
        loadMoreHistoryConfirmed,
        openCutoffDialog,
        saveCutoff,
        toggleCutoffDisabled,
    }
}
