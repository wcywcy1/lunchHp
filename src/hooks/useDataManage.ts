import { ref, computed } from 'vue'
import { useStore, saveSession } from '../services/store'
import { menuAction, orderAction, backupAction } from '../services/repositories/baseRepository'
import { ORDER_STATUS, ROLE } from '../constants/orderStatus'

export function useDataManage() {
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
    const exportingAll = ref(false)

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
                pendingOrders.value = orders.filter((o: any) => o.status === ORDER_STATUS.PENDING)
                confirmedOrders.value = orders.filter((o: any) => o.status === ORDER_STATUS.CONFIRMED)
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

    async function batchConfirm() {
        if (selectedIds.value.length === 0) {
            uni.showToast({ title: '请选择订单', icon: 'none' })
            return
        }
        confirming.value = true
        try {
            const res = await orderAction('batchConfirm', { orderIds: selectedIds.value })
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

    function getDateStr() {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    async function downloadCloudFile(fileID: string) {
        return new Promise<void>((resolve, reject) => {
            wx.cloud.downloadFile({
                fileID,
                success: (downloadRes: any) => {
                    wx.openDocument({
                        filePath: downloadRes.tempFilePath,
                        showMenu: true,
                        success: () => resolve(),
                        fail: () => reject(new Error('打开文件失败')),
                    })
                },
                fail: () => reject(new Error('下载文件失败')),
            })
        })
    }

    async function downloadConfirmed() {
        downloading.value = true
        try {
            const res = await orderAction('downloadConfirmed', { mode: downloadMode.value })
            if (res.result.code === 0 && res.result.data.fileID) {
                await downloadCloudFile(res.result.data.fileID)
            } else if (res.result.code === 0 && res.result.data.files) {
                for (const file of res.result.data.files) {
                    await downloadCloudFile(file.fileID)
                }
            }
            showDownloadDialog.value = false
        } catch (e) {
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
                    const path = `${wx.env.USER_DATA_PATH}/确认单_${group.supplier}_${getDateStr()}.csv`
                    fs.writeFileSync(path, lines.join('\n'), 'utf8')
                    wx.openDocument({ filePath: path, showMenu: true })
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
                const path = `${wx.env.USER_DATA_PATH}/确认单_全部_${getDateStr()}.csv`
                fs.writeFileSync(path, lines.join('\n'), 'utf8')
                wx.openDocument({ filePath: path, showMenu: true })
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
        if (!editingMember.value) return
        const name = editingName.value.trim()
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

    async function exportOrders() {
        exporting.value = true
        try {
            const res = await orderAction('exportOrders')
            if (res.result.code === 0 && res.result.data.fileID) {
                await downloadCloudFile(res.result.data.fileID)
            } else {
                await localExportOrders()
            }
        } catch (e) {
            await localExportOrders()
        } finally {
            exporting.value = false
        }
    }

    async function localExportOrders() {
        try {
            const allOrders = [...pendingOrders.value, ...confirmedOrders.value]
            const lines = ['日期,菜品,姓名,金额,备注,状态,供应商']
            allOrders.forEach(o => {
                const statusText = o.status === 'pending' ? '待确认' : o.status === 'confirmed' ? '已确认' : '已取消'
                lines.push(`${o.date},${o.menuName},${o.memberName},${o.price},${o.note || ''},${statusText},${o.supplier || ''}`)
            })
            const fs = wx.getFileSystemManager()
            const path = `${wx.env.USER_DATA_PATH}/export_orders_${getDateStr()}.csv`
            fs.writeFileSync(path, lines.join('\n'), 'utf8')
            wx.openDocument({ filePath: path, showMenu: true })
        } catch (e: any) {
            uni.showToast({ title: e.message || '导出失败', icon: 'none' })
        }
    }

    function importOrders() {
        wx.chooseMessageFile({
            count: 1,
            type: 'file',
            extension: ['csv'],
            success: async (chooseRes: any) => {
                importing.value = true
                try {
                    const fs = wx.getFileSystemManager()
                    const content = fs.readFileSync(chooseRes.tempFiles[0].path, 'utf8') as string
                    const lines = content.split('\n').filter(l => l.trim())
                    if (lines.length < 2) {
                        uni.showToast({ title: '文件为空', icon: 'none' })
                        return
                    }
                    if (!lines[0].includes('日期') || !lines[0].includes('菜品')) {
                        uni.showToast({ title: '格式不正确', icon: 'none' })
                        return
                    }
                    const records = lines.slice(1).map(line => {
                        const parts = line.split(',')
                        return {
                            date: parts[0] || '',
                            menuName: parts[1] || '',
                            memberName: parts[2] || '',
                            price: Number(parts[3]) || 0,
                            note: parts[4] || '',
                            status: parts[5] || 'pending',
                            supplier: parts[6] || '',
                        }
                    })
                    const res = await orderAction('importOrders', { orders: records })
                    if (res.result.code === 0) {
                        uni.showToast({ title: `导入${res.result.data.count}条`, icon: 'success' })
                        await loadData()
                    }
                } catch (e: any) {
                    uni.showToast({ title: e.message || '导入失败', icon: 'none' })
                } finally {
                    importing.value = false
                }
            },
        })
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

    async function exportAllOrders() {
        exportingAll.value = true
        try {
            const res = await backupAction('exportAllOrders')
            if (res.result.code === 0 && res.result.data.fileID) {
                await downloadCloudFile(res.result.data.fileID)
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '导出失败', icon: 'none' })
        } finally {
            exportingAll.value = false
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
        exportingAll,
        loadData,
        toggleSelect,
        toggleSelectAll,
        batchConfirm,
        downloadConfirmed,
        openNameEdit,
        saveMemberName,
        setAdminRole,
        removeAdminRole,
        exportOrders,
        importOrders,
        manualBackup,
        openBackupDialog,
        selectBackup,
        confirmRestore,
        restoreBackup,
        exportAllOrders,
    }
}