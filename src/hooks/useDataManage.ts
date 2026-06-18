import { ref, computed } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { useStore, saveSession, setCache, setRecentLoadTime } from '../services/store'
import { menuAction, orderAction, backupAction } from '../services/repositories/baseRepository'
import { ORDER_STATUS, ROLE } from '../constants/orderStatus'
import { CACHE_KEYS } from '../constants/cacheConfig'
import { useRealtimeWatch } from './useRealtimeWatch'

export function useDataManage() {
    const MAX_BATCH_COUNT = 2000
    const MAX_BATCH_BYTES = 800 * 1024

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

    function writeCsvWithBom(fs: any, path: string, content: string) {
        const bytes: number[] = [0xEF, 0xBB, 0xBF]
        for (let i = 0; i < content.length; i++) {
            let code = content.charCodeAt(i)
            if (code >= 0x10000) {
                code -= 0x10000
                bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
            } else if (code >= 0x800) {
                bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
            } else if (code >= 0x80) {
                bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F))
            } else {
                bytes.push(code)
            }
        }
        fs.writeFileSync(path, new Uint8Array(bytes).buffer as ArrayBuffer)
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
    const saving = ref(false)
    const realtime = useRealtimeWatch()

    // 通知相关
    const showNoticeSendDialog = ref(false)
    const noticeInput = ref('')
    const sendingNotice = ref(false)

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
            subtotal: orders.reduce((sum: number, o: any) => sum + (o.price || 0), 0),
        }))
    })

    async function loadData() {
        loading.value = true
        try {
            const res = await orderAction('getRecentOrders')
            if (res.result.code === 0) {
                const orders = res.result.data || []
                const today = getDateStr()
                const todayOrders = orders.filter((o: any) => o.date === today)
                pendingOrders.value = todayOrders.filter((o: any) => o.status === ORDER_STATUS.PENDING)
                confirmedOrders.value = todayOrders.filter((o: any) => o.status === ORDER_STATUS.CONFIRMED)
            }
            await loadHistoryCount()
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

    async function batchConfirm() {
        if (selectedIds.value.length === 0) {
            uni.showToast({ title: '请选择订单', icon: 'none' })
            return
        }
        confirming.value = true
        try {
            const res = await orderAction('batchConfirm', { orderIds: selectedIds.value, date: getDateStr() })
            if (res.result.code === 0) {
                uni.showToast({ title: '确认成功', icon: 'success' })
                selectedIds.value = []
                store.recentTimestamp = res.result.data?.recentTimestamp || store.recentTimestamp
                setCache(CACHE_KEYS.RECENT_TIMESTAMP, store.recentTimestamp)
                setRecentLoadTime(Date.now())
                await loadData()
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '确认失败', icon: 'none' })
        } finally {
            confirming.value = false
        }
    }

    function getDateStr() {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
                    wx.shareFileMessage({
                        filePath,
                        fileName,
                        success: () => {
                            try { wx.getFileSystemManager().unlinkSync(filePath) } catch {}
                            resolve({ success: true, message: '分享成功', cancelled: false })
                        },
                        fail: (err: any) => {
                            try { wx.getFileSystemManager().unlinkSync(filePath) } catch {}
                            if (err?.errMsg?.indexOf('cancel') > -1) {
                                resolve({ success: false, message: '分享已取消', cancelled: true })
                            } else {
                                resolve({ success: false, message: '分享失败', cancelled: false })
                            }
                        },
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
                            wx.shareFileMessage({
                                filePath: downloadRes.tempFilePath,
                                fileName: name,
                                success: () => resolve(),
                                fail: (err: any) => {
                                    if (err?.errMsg?.indexOf('cancel') > -1) {
                                        resolve()
                                    } else {
                                        reject(new Error('分享失败'))
                                    }
                                },
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
                        lines.push(`${o.memberName},${o.menuName},${o.price},${o.note || ''}`)
                    })
                    lines.push(`合计,,${group.subtotal},`)
                    const fs = wx.getFileSystemManager()
                    const fileName = `确认单_${group.supplier}_${getDateStr()}.csv`
                    const path = `${wx.env.USER_DATA_PATH}/${fileName}`
                    writeCsvWithBom(fs, path, lines.join('\n'))
                    const shareRes = await shareLocalFile(path, fileName)
                    uni.showToast({ title: shareRes.success ? '分享成功' : (shareRes.cancelled ? '已取消' : '分享失败'), icon: shareRes.success ? 'success' : 'none' })
                }
            } else {
                const lines = ['供应商,姓名,餐品,金额,备注']
                confirmedBySupplier.value.forEach(group => {
                    group.orders.forEach((o: any) => {
                        lines.push(`${group.supplier},${o.memberName},${o.menuName},${o.price},${o.note || ''}`)
                    })
                    lines.push(`${group.supplier},小计,,${group.subtotal},`)
                })
                const total = confirmedOrders.value.reduce((s: number, o: any) => s + (o.price || 0), 0)
                lines.push(`全部,合计,,${total},`)
                const fs = wx.getFileSystemManager()
                const fileName = `确认单_全部_${getDateStr()}.csv`
                const path = `${wx.env.USER_DATA_PATH}/${fileName}`
                writeCsvWithBom(fs, path, lines.join('\n'))
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
        saving.value = true
        try {
            await menuAction('updateMemberName', { memberId: editingMember.value._id, name })
            const member = store.members.find((m: any) => m._id === editingMember.value._id)
            if (member) member.name = name
            if (store.member?._id === editingMember.value._id) {
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

    function parseCsvLine(line: string): string[] {
        const result: string[] = []
        let current = ''
        let inQuotes = false
        for (let i = 0; i < line.length; i++) {
            const ch = line[i]
            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        current += '"'
                        i++
                    } else {
                        inQuotes = false
                    }
                } else {
                    current += ch
                }
            } else {
                if (ch === '"') {
                    inQuotes = true
                } else if (ch === ',') {
                    result.push(current)
                    current = ''
                } else {
                    current += ch
                }
            }
        }
        result.push(current)
        return result
    }

    function splitCsvLines(content: string): string[] {
        const lines: string[] = []
        let current = ''
        let inQuotes = false
        for (let i = 0; i < content.length; i++) {
            const ch = content[i]
            if (inQuotes) {
                current += ch
                if (ch === '"') {
                    if (i + 1 < content.length && content[i + 1] === '"') {
                        i++
                    } else {
                        inQuotes = false
                    }
                }
            } else {
                if (ch === '"') {
                    inQuotes = true
                    current += ch
                } else if (ch === '\r' || ch === '\n') {
                    if (ch === '\r' && i + 1 < content.length && content[i + 1] === '\n') {
                        i++
                    }
                    if (current.trim()) lines.push(current)
                    current = ''
                } else {
                    current += ch
                }
            }
        }
        if (current.trim()) lines.push(current)
        return lines
    }

    async function parseXlsxViaCloud(filePath: string): Promise<string[][]> {
        const cloudPath = `xlsx_import/${Date.now()}_${Math.random().toString(36).substr(2, 6)}.xlsx`
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
        const parseRes = await menuAction('parseXlsx', { fileID: uploadRes.fileID })
        if (parseRes.result.code !== 0) {
            throw new Error(parseRes.result.msg || 'xlsx解析失败')
        }
        try { await wx.cloud.deleteFile({ fileList: [uploadRes.fileID] }) } catch (e) { }
        return parseRes.result.data.rows
    }

    async function doImportXlsx(filePath: string, importType: 'orders' | 'menu' | 'members') {
        const mode = await new Promise<'append' | 'rewrite' | ''>(resolve => {
            const typeLabel = importType === 'orders' ? '订单' : importType === 'menu' ? '菜单' : '人员'
            uni.showModal({
                title: '导入方式',
                content: `追加数据：仅导入新${typeLabel}，重复跳过\n清库重写：清空所有${typeLabel}后导入`,
                confirmText: '追加',
                cancelText: '清库重写',
                success: res => resolve(res.confirm ? 'append' : 'rewrite'),
            })
        })
        if (!mode) return

        uni.showLoading({ title: '上传文件...' })
        try {
            const cloudPath = `xlsx_import/${Date.now()}_${Math.random().toString(36).substr(2, 6)}.xlsx`
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
                } else if (importType === 'menu') {
                    try {
                        const menuRes = await menuAction('getMenuList')
                        if (menuRes.result.code === 0) {
                            store.menu = menuRes.result.data || []
                            setCache(CACHE_KEYS.MENU, store.menu)
                        }
                    } catch {}
                } else {
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

    function parseDate(val: string | number | undefined): string {
        if (!val) return ''
        if (typeof val === 'number') {
            const epoch = new Date(Date.UTC(1899, 11, 30))
            const d = new Date(epoch.getTime() + val * 86400000)
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
        }
        const str = String(val).trim()
        let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
        if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
        m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
        if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
        // 2-digit year: M/D/YY → assume 20XX
        m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/)
        if (m) {
            const yr = Number(m[3]) + 2000
            return `${yr}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
        }
        return ''
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
                lines.push(`${o.date},${o.menuName},${o.memberName},${o.price},${o.note || ''},${statusMap[o.status] || o.status},${o.supplier || ''}`)
            })
            const fs = wx.getFileSystemManager()
            const fileName = `export_orders_${getDateStr()}.csv`
            const path = `${wx.env.USER_DATA_PATH}/${fileName}`
            writeCsvWithBom(fs, path, lines.join('\n'))
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
                    lines.push(`${m.supplier},${m.name},${m.price},${m.visible !== false ? '是' : '否'}`)
                })
                const fs = wx.getFileSystemManager()
                const fileName = `export_menu_${getDateStr()}.csv`
                const path = `${wx.env.USER_DATA_PATH}/${fileName}`
                writeCsvWithBom(fs, path, lines.join('\n'))
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
                    lines.push(`${m.name || ''},${m.nickName || ''},${m.role || 'member'},${m.isVirtual ? '是' : '否'}`)
                })
                const fs = wx.getFileSystemManager()
                const fileName = `export_members_${getDateStr()}.csv`
                const path = `${wx.env.USER_DATA_PATH}/${fileName}`
                writeCsvWithBom(fs, path, lines.join('\n'))
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

    function importData(type: 'orders' | 'menu' | 'members') {
        wx.chooseMessageFile({
            count: 1,
            type: 'file',
            extension: ['csv', 'xlsx'],
            success: async (chooseRes: any) => {
                const filePath = chooseRes.tempFiles[0].path
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
            },
        })
    }

    async function doImportOrders(filePath: string, ext: string) {
        if (ext === 'xlsx') {
            await doImportXlsx(filePath, 'orders')
            return
        }
        const fs = wx.getFileSystemManager()
        let content = fs.readFileSync(filePath, 'utf8') as string
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
        const rows = splitCsvLines(content).map(l => parseCsvLine(l))
        if (rows.length < 2) {
            uni.showToast({ title: '文件为空', icon: 'none' })
            return
        }
        const header = rows[0]
        const idx = mapHeader(header, ['date', 'menuName', 'memberName', 'price', 'note', 'status', 'supplier'])
        if (idx.date === undefined || idx.menuName === undefined || idx.memberName === undefined || idx.price === undefined) {
            uni.showToast({ title: '格式不正确，需包含日期/菜品/姓名/金额', icon: 'none' })
            return
        }
        const records = rows.slice(1)
            .filter(cols => cols[idx.date!] && cols[idx.menuName!] && cols[idx.memberName!])
            .map(cols => {
                let statusVal = idx.status !== undefined && cols[idx.status] ? cols[idx.status] : 'confirmed'
                const statusMap: Record<string, string> = { '待确认': 'pending', '已确认': 'confirmed', '已取消': 'cancelled' }
                statusVal = statusMap[statusVal] || statusVal
                return {
                    date: parseDate(cols[idx.date!]),
                    menuName: cols[idx.menuName!] || '',
                    memberName: cols[idx.memberName!] || '',
                    price: Number(cols[idx.price!]) || 0,
                    note: idx.note !== undefined ? (cols[idx.note] || '') : '',
                    status: statusVal,
                    supplier: idx.supplier !== undefined ? (cols[idx.supplier] || '') : '',
                }
            })
            .filter(r => r.date)
        if (records.length === 0) {
            uni.showToast({ title: '无有效数据', icon: 'none' })
            return
        }
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
        const batches = splitBatches(records)
        let totalInserted = 0
        let totalErrors = 0
        let totalSkipped = 0
        for (let i = 0; i < batches.length; i++) {
            const batchMode = i === 0 ? mode : (mode === 'rewrite' ? 'rewrite_continue' : 'append')
            const isLastBatch = i === batches.length - 1
            const res = await orderAction('importOrders', { orders: batches[i], mode: batchMode, isLastBatch })
            if (res.result.code === 0) {
                totalInserted += res.result.data.count
                totalErrors += res.result.data.errors || 0
                totalSkipped += res.result.data.skipped || 0
            } else {
                throw new Error(res.result.msg || '导入失败')
            }
        }
        const parts = [`导入${totalInserted}条`]
        if (totalSkipped > 0) parts.push(`跳过${totalSkipped}条`)
        if (totalErrors > 0) parts.push(`${totalErrors}条失败`)
        uni.showToast({ title: parts.join('，'), icon: totalInserted > 0 ? 'success' : 'none' })
        await loadData()
    }

    async function doImportMenu(filePath: string, ext: string) {
        if (ext === 'xlsx') {
            await doImportXlsx(filePath, 'menu')
            return
        }
        const fs = wx.getFileSystemManager()
        let content = fs.readFileSync(filePath, 'utf8') as string
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
        const rows = splitCsvLines(content).map(l => parseCsvLine(l))
        if (rows.length < 2) {
            uni.showToast({ title: '文件为空', icon: 'none' })
            return
        }
        const header = rows[0]
        const idx = mapHeader(header, ['supplier_menu', 'menuName_menu', 'price_menu', 'visible'])
        if (idx.supplier_menu === undefined || idx.menuName_menu === undefined) {
            uni.showToast({ title: '格式不正确，需包含供应商/菜品名', icon: 'none' })
            return
        }
        const items = rows.slice(1)
            .filter(cols => cols[idx.supplier_menu!] && cols[idx.menuName_menu!])
            .map(cols => ({
                supplier: cols[idx.supplier_menu!] || '',
                name: cols[idx.menuName_menu!] || '',
                price: idx.price_menu !== undefined ? (Number(cols[idx.price_menu]) || 0) : 0,
                visible: idx.visible !== undefined ? cols[idx.visible] !== '否' : true,
            }))
        if (items.length === 0) {
            uni.showToast({ title: '无有效数据', icon: 'none' })
            return
        }
        const mode = await new Promise<'append' | 'rewrite' | ''>(resolve => {
            uni.showModal({
                title: '导入方式',
                content: '追加数据：仅导入新数据，重复跳过\n清库重写：清空所有菜单后导入',
                confirmText: '追加',
                cancelText: '清库重写',
                success: res => resolve(res.confirm ? 'append' : 'rewrite'),
            })
        })
        if (!mode) return
        const batches = splitBatches(items)
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
    }

    async function doImportMembers(filePath: string, ext: string) {
        if (ext === 'xlsx') {
            await doImportXlsx(filePath, 'members')
            return
        }
        const fs = wx.getFileSystemManager()
        let content = fs.readFileSync(filePath, 'utf8') as string
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
        const rows = splitCsvLines(content).map(l => parseCsvLine(l))
        if (rows.length < 2) {
            uni.showToast({ title: '文件为空', icon: 'none' })
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
                content: '追加数据：仅导入新数据，重复跳过\n清库重写：清空所有人员后导入',
                confirmText: '追加',
                cancelText: '清库重写',
                success: res => resolve(res.confirm ? 'append' : 'rewrite'),
            })
        })
        if (!mode) return
        const batches = splitBatches(members)
        let totalInserted = 0
        for (let i = 0; i < batches.length; i++) {
            const batchMode = i === 0 ? mode : (mode === 'rewrite' ? 'rewrite_continue' : 'append')
            const res = await menuAction('importMembers', { members: batches[i], mode: batchMode })
            if (res.result.code === 0) totalInserted += res.result.data.count
            else throw new Error(res.result.msg || '导入失败')
        }
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
        if (!selectedBackupId.value) {
            uni.showToast({ title: '请选择备份', icon: 'none' })
            return
        }
        restoring.value = true
        try {
            const res = await backupAction('restoreBackup', { backupId: selectedBackupId.value })
            if (res.result.code === 0) {
                uni.showToast({ title: '恢复成功', icon: 'success' })
                showBackupDialog.value = false
                await loadData()
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '恢复失败', icon: 'none' })
        } finally {
            restoring.value = false
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
            uni.showToast({ title: '数据已清除', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    const showMergeDialog = ref(false)
    const mergingMember = ref<any>(null)

    function openMergeDialog(member: any) {
        mergingMember.value = member
        showMergeDialog.value = true
    }

    async function mergeWithWechat() {
        if (saving.value) return
        if (!mergingMember.value) return
        saving.value = true
        try {
            const res = await menuAction('linkVirtualMember', { virtualMemberId: mergingMember.value._id })
            if (res.result.code === 0) {
                const updated = res.result.data.member
                store.members = store.members.map((m: any) => m._id === updated._id ? updated : m)
                store.member = updated
                saveSession({ groupId: updated.groupId, role: updated.role, member: updated })
                showMergeDialog.value = false
                showNameEditDialog.value = false
                uni.showToast({ title: '合帐成功', icon: 'success' })
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '合帐失败', icon: 'none' })
        } finally {
            saving.value = false
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
            await loadMenuList()
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
            await loadMenuList()
            uni.showToast({ title: '已删除', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '删除失败', icon: 'none' })
        }
    }

    async function moveMenuItem(menuId: string, direction: string) {
        try {
            await menuAction('moveMenuItem', { menuId, direction })
            await loadMenuList()
        } catch (e: any) {
            uni.showToast({ title: e.message || '移动失败', icon: 'none' })
        }
    }

    async function toggleMenuVisible(menuId: string) {
        try {
            await menuAction('toggleVisible', { menuId })
            await loadMenuList()
            uni.showToast({ title: '已切换', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    async function toggleSupplierVisible(supplier: string, visible: boolean) {
        try {
            const res = await menuAction('batchToggleVisibleBySupplier', { supplier, visible })
            await loadMenuList()
            const count = res.result.data?.count || 0
            uni.showToast({ title: visible ? `已上架${count}道菜` : `已下架${count}道菜`, icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    const menuList = ref<any[]>([])

    async function loadMenuList() {
        try {
            const res = await menuAction('getMenuList')
            if (res.result.code === 0) {
                menuList.value = res.result.data || []
                store.menu = menuList.value
            }
        } catch (e) {
            console.error('loadMenuList error:', e)
        }
    }

    function startRealtimeWatch() {
        realtime.watchTodayOrders((snapshot: any) => {
            if (snapshot.type === 'init') return
            loadData()
        })
    }

    function stopRealtimeWatch() {
        realtime.closeAll()
    }

    function openNoticeSendDialog() {
        noticeInput.value = ''
        showNoticeSendDialog.value = true
    }

    async function sendNotice() {
        const content = noticeInput.value.trim()
        if (!content) {
            uni.showToast({ title: '请输入通知内容', icon: 'none' })
            return
        }
        sendingNotice.value = true
        try {
            const res = await menuAction('setNotice', { content })
            if (res.result.code === 0) {
                uni.showToast({ title: '通知已发送', icon: 'success' })
                showNoticeSendDialog.value = false
                noticeInput.value = ''
            } else {
                throw new Error(res.result.msg || '发送失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '发送失败', icon: 'none' })
        } finally {
            sendingNotice.value = false
        }
    }

    async function clearNotice() {
        try {
            await menuAction('clearNotice')
            uni.showToast({ title: '通知已清除', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
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
        showNoticeSendDialog,
        noticeInput,
        sendingNotice,
        loadData,
        toggleSelect,
        toggleSelectAll,
        batchConfirm,
        downloadConfirmed,
        openNameEdit,
        saveMemberName,
        setAdminRole,
        removeAdminRole,
        deleteMember,
        clearAllData,
        openMergeDialog,
        mergeWithWechat,
        openMenuAdd,
        openMenuEdit,
        saveMenuItem,
        deleteMenuItem,
        moveMenuItem,
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
        toggleHistoryPending,
        toggleHistoryConfirmed,
        loadMoreHistoryPending,
        loadMoreHistoryConfirmed,
        startRealtimeWatch,
        stopRealtimeWatch,
        openNoticeSendDialog,
        sendNotice,
        clearNotice,
    }
}