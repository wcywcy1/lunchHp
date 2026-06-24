import { ref } from 'vue'
import { useStore, setCache } from '../services/store'
import { menuAction, orderAction } from '../services/repositories/baseRepository'
import { CACHE_KEYS } from '../constants/cacheConfig'
import { buildCsvLine, writeCsvWithBom, shareOrSaveFile, isPcPlatform } from '../utils/csv'
import { getTodayString } from '../utils/date'

export function useDataExport() {
    const store = useStore()
    const exporting = ref(false)

    function shareLocalFile(filePath: string, fileName: string): Promise<{ success: boolean; message: string; cancelled?: boolean }> {
        return new Promise((resolve) => {
            if (isPcPlatform()) {
                shareOrSaveFile(filePath, fileName).then(res => {
                    try { wx.getFileSystemManager().unlinkSync(filePath) } catch {}
                    resolve(res)
                })
                return
            }
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
                    if (isPcPlatform()) {
                        shareOrSaveFile(filePath, name).then(res => {
                            if (res.success || res.cancelled) resolve()
                            else reject(new Error(res.message))
                        })
                        return
                    }
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

    async function exportData(type: 'orders' | 'menu' | 'members', pendingOrders: any[], confirmedOrders: any[]) {
        exporting.value = true
        try {
            if (type === 'orders') {
                await exportOrders(pendingOrders, confirmedOrders)
            } else if (type === 'menu') {
                await exportMenu()
            } else {
                await exportMembers()
            }
        } finally {
            exporting.value = false
        }
    }

    async function exportOrders(pendingOrders: any[], confirmedOrders: any[]) {
        try {
            const res = await orderAction('exportOrders')
            if (res.result.code === 0 && res.result.data.fileID) {
                await downloadCloudFile(res.result.data.fileID)
                return
            }
        } catch {}
        await localExportOrders(pendingOrders, confirmedOrders)
    }

    async function localExportOrders(pendingOrders: any[], confirmedOrders: any[]) {
        try {
            const allOrders = [...pendingOrders, ...confirmedOrders]
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

    return {
        exporting,
        exportData,
        downloadCloudFile,
        shareLocalFile,
    }
}