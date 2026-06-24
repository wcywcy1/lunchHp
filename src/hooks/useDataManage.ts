import { ref, computed } from 'vue'
import { useStore, saveSession, setCache, resetStore, clearAllCache, setActiveGroupId, getActiveGroupId, setStore } from '../services/store'
import { menuAction, orderAction, backupAction } from '../services/repositories/baseRepository'
import { resetInit, startInit } from '../services/appInit'
import { ROLE } from '../constants/orderStatus'
import { CACHE_KEYS } from '../constants/cacheConfig'
import { buildCsvLine, writeCsvWithBom, shareLocalFile } from '../utils/csv'
import { getTodayString } from '../utils/date'
import { useOrderManage } from './useOrderManage'
import { useDataExport } from './useDataExport'
import { useDataImport } from './useDataImport'

export function useDataManage() {
    const store = useStore()
    const orderManage = useOrderManage()
    const dataExport = useDataExport()
    const dataImport = useDataImport()

    const showDownloadDialog = ref(false)
    const downloadMode = ref<'supplier' | 'all'>('all')
    const downloading = ref(false)
    const showNameEditDialog = ref(false)
    const editingMember = ref<any>(null)
    const editingName = ref('')
    const showBackupDialog = ref(false)
    const backupList = ref<any[]>([])
    const selectedBackupId = ref('')
    const restoring = ref(false)
    const restoreProgress = ref('')
    const backupStep = ref<'list' | 'preview' | 'confirm'>('list')
    const selectedBackup = ref<any>(null)
    const backingUp = ref(false)
    const rebuilding = ref(false)
    const saving = ref(false)

    const showNoticeSendDialog = ref(false)
    const noticeInput = ref('')
    const sendingNotice = ref(false)

    const showMergeDialog = ref(false)
    const mergingMember = ref<any>(null)
    const mergeTargetId = ref('')
    const merging = ref(false)

    const mergeTargetCandidates = computed(() =>
        (store.members || []).filter((m: any) =>
            !m.isVirtual && m._id !== mergingMember.value?._id
        )
    )

    const showMenuEditModal = ref(false)
    const menuEditForm = ref({ menuId: '', supplier: '', name: '', price: '', photo: '' })
    const isMenuEdit = ref(false)
    const menuList = ref<any[]>([])

    const currentGroupId = computed(() => store.groupId || getActiveGroupId())
    const switchingGroup = ref(false)
    const targetGroupId = ref('')

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
                for (const group of orderManage.confirmedBySupplier.value) {
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
                orderManage.confirmedBySupplier.value.forEach(group => {
                    group.orders.forEach((o: any) => {
                        lines.push(buildCsvLine([group.supplier, o.memberName, o.menuName, o.price, o.note || '']))
                    })
                    lines.push(buildCsvLine([group.supplier, '小计', '', group.subtotal, '']))
                })
                const total = orderManage.confirmedOrders.value.reduce((s: number, o: any) => s + (o.price || 0), 0)
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
            orderManage.pendingOrders.value = []
            orderManage.confirmedOrders.value = []
            uni.showToast({ title: '数据已清除', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    function openMergeDialog(member: any) {
        mergingMember.value = member
        mergeTargetId.value = ''
        showMergeDialog.value = true
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
                const { member: mergedMember, mergedOrders } = res.result.data
                store.members = store.members.filter((m: any) => m._id !== mergeTargetId.value)
                if (store.member?._id === mergeTargetId.value) {
                    setStore({ member: mergedMember, role: mergedMember.role })
                    saveSession({ groupId: mergedMember.groupId, role: mergedMember.role, member: mergedMember })
                }
                showMergeDialog.value = false
                showNameEditDialog.value = false
                uni.showToast({ title: `关联成功（订单${mergedOrders}条）`, icon: 'success' })
                await orderManage.loadData()
            } else {
                throw new Error(res.result.msg || '关联失败')
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '关联失败', icon: 'none' })
        } finally {
            merging.value = false
        }
    }

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

    async function loadMenuList(forceRefresh = false) {
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

    async function loadMembers() {
        try {
            const res = await menuAction('getMembers')
            if (res.result.code === 0) {
                store.members = res.result.data || []
                setCache(CACHE_KEYS.MEMBERS, store.members)
            }
        } catch (e) {
            console.error('loadMembers error:', e)
        }
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
            } else {
                uni.showToast({ title: res.result.msg || '获取备份列表失败', icon: 'none' })
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
        restoreProgress.value = '准备中...'
        try {
            const prepareRes = await backupAction('restorePrepare', { backupId: selectedBackupId.value })
            if (prepareRes.result.code !== 0) {
                uni.showToast({ title: prepareRes.result.msg || '准备恢复失败', icon: 'none' })
                return
            }
            const { sessionId, totalChunks, totalItems } = prepareRes.result.data

            for (let i = 0; i < totalChunks; i++) {
                restoreProgress.value = `恢复中 ${Math.min((i + 1) * 2000, totalItems)}/${totalItems}`
                const batchRes = await backupAction('restoreBatch', { sessionId, chunkIndex: i })
                if (batchRes.result.code !== 0) {
                    uni.showToast({ title: batchRes.result.msg || `第${i + 1}批写入失败`, icon: 'none' })
                    return
                }
            }

            restoreProgress.value = '完成中...'
            const finishRes = await backupAction('restoreFinish', { sessionId })
            if (finishRes.result.code !== 0) {
                uni.showToast({ title: finishRes.result.msg || '完成恢复失败', icon: 'none' })
                return
            }

            uni.showToast({ title: '恢复成功', icon: 'success' })
            showBackupDialog.value = false
            await Promise.all([
                orderManage.loadData(),
                loadMenuList(true),
                loadMembers(),
            ])
        } catch (e: any) {
            uni.showToast({ title: e.message || '恢复失败', icon: 'none' })
        } finally {
            restoring.value = false
            restoreProgress.value = ''
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
                if (d.memberNameCollisions) content += `\n⚠ ${d.memberNameCollisions} 个姓名存在同名成员，已跳过`
                if (d.memberNotFound) content += `\n⚠ ${d.memberNotFound} 条未找到对应成员`
                if (d.menuNotFound) content += `\n⚠ ${d.menuNotFound} 条未找到对应餐品`
                uni.showModal({ title: '重置完成', content, showCancel: false })
                await orderManage.loadData()
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '重置失败', icon: 'none' })
        } finally {
            rebuilding.value = false
        }
    }

    async function switchGroup() {
        const target = targetGroupId.value.trim()
        if (!target) {
            uni.showToast({ title: '请输入目标组ID', icon: 'none' })
            return
        }
        if (target === currentGroupId.value) {
            uni.showToast({ title: '已是当前组', icon: 'none' })
            return
        }
        const { confirm } = await uni.showModal({
            title: '切换组织',
            content: `将切换到组织「${target}」，本地缓存会清空并重新初始化。确定？`,
        })
        if (!confirm) return
        switchingGroup.value = true
        store.isSwitchingGroup = true
        try {
            orderManage.stopRealtimeWatch()
            clearAllCache()
            resetStore()
            setActiveGroupId(target)
            resetInit()
            await startInit()
            const joinRes = await menuAction('joinGroup', { nickName: '', name: '' })
            if (joinRes.result.code === 0) {
                const { member } = joinRes.result.data
                setStore({ member, role: member.role, groupId: target })
                saveSession({ groupId: target, role: member.role, member })
            }
            targetGroupId.value = ''
            uni.showToast({ title: '已切换组织', icon: 'success' })
            setTimeout(() => {
                uni.switchTab({ url: '/pages/home/index' })
            }, 800)
        } catch (e: any) {
            uni.showToast({ title: e.message || '切换失败', icon: 'none' })
        } finally {
            switchingGroup.value = false
            store.isSwitchingGroup = false
        }
    }

    function resetToDefaultGroup() {
        targetGroupId.value = 'lunch_hp'
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
                orderManage.currentNotice.value = content
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
            orderManage.currentNotice.value = ''
            uni.showToast({ title: '通知已清除', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    return {
        loading: orderManage.loading,
        pendingOrders: orderManage.pendingOrders,
        confirmedOrders: orderManage.confirmedOrders,
        confirmedBySupplier: orderManage.confirmedBySupplier,
        selectedIds: orderManage.selectedIds,
        isAllSelected: orderManage.isAllSelected,
        confirming: orderManage.confirming,
        cancelling: orderManage.cancelling,
        confirmedSelectedIds: orderManage.confirmedSelectedIds,
        isAllConfirmedSelected: orderManage.isAllConfirmedSelected,
        showDownloadDialog,
        downloadMode,
        downloading,
        showNameEditDialog,
        editingMember,
        editingName,
        exporting: dataExport.exporting,
        importing: dataImport.importing,
        showBackupDialog,
        backupList,
        selectedBackupId,
        restoring,
        restoreProgress,
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
        historyPendingCount: orderManage.historyPendingCount,
        historyConfirmedCount: orderManage.historyConfirmedCount,
        historyPendingOrders: orderManage.historyPendingOrders,
        historyConfirmedOrders: orderManage.historyConfirmedOrders,
        showHistoryPending: orderManage.showHistoryPending,
        showHistoryConfirmed: orderManage.showHistoryConfirmed,
        loadingHistoryPending: orderManage.loadingHistoryPending,
        loadingHistoryConfirmed: orderManage.loadingHistoryConfirmed,
        historyPendingHasMore: orderManage.historyPendingHasMore,
        historyConfirmedHasMore: orderManage.historyConfirmedHasMore,
        showNoticeSendDialog,
        noticeInput,
        sendingNotice,
        currentNotice: orderManage.currentNotice,
        loadData: orderManage.loadData,
        toggleSelect: orderManage.toggleSelect,
        toggleSelectAll: orderManage.toggleSelectAll,
        batchConfirm: orderManage.batchConfirm,
        cancelOrder: orderManage.cancelOrder,
        toggleConfirmedSelect: orderManage.toggleConfirmedSelect,
        toggleSelectAllConfirmed: orderManage.toggleSelectAllConfirmed,
        batchCancelConfirmed: orderManage.batchCancelConfirmed,
        batchCancelPending: orderManage.batchCancelPending,
        pendingCancelRequests: orderManage.pendingCancelRequests,
        loadPendingCancelRequests: orderManage.loadPendingCancelRequests,
        approveCancelRequest: orderManage.approveCancelRequest,
        rejectCancelRequest: orderManage.rejectCancelRequest,
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
        toggleMenuVisible,
        toggleSupplierVisible,
        loadMenuList,
        exportData: (type: 'orders' | 'menu' | 'members') =>
            dataExport.exportData(type, orderManage.pendingOrders.value, orderManage.confirmedOrders.value),
        importData: (type: 'orders' | 'menu' | 'members') =>
            dataImport.importData(type, orderManage.loadData),
        manualBackup,
        openBackupDialog,
        selectBackup,
        confirmRestore,
        restoreBackup,
        rebuilding,
        rebuildRelations,
        toggleHistoryPending: orderManage.toggleHistoryPending,
        toggleHistoryConfirmed: orderManage.toggleHistoryConfirmed,
        loadMoreHistoryPending: orderManage.loadMoreHistoryPending,
        loadMoreHistoryConfirmed: orderManage.loadMoreHistoryConfirmed,
        startRealtimeWatch: orderManage.startRealtimeWatch,
        stopRealtimeWatch: orderManage.stopRealtimeWatch,
        openNoticeSendDialog,
        sendNotice,
        clearNotice,
        currentGroupId,
        targetGroupId,
        switchingGroup,
        switchGroup,
        resetToDefaultGroup,
    }
}