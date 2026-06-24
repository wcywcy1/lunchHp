import { ref } from 'vue'
import { useStore, setCache } from '../services/store'
import { menuAction, orderAction } from '../services/repositories/baseRepository'
import { CACHE_KEYS } from '../constants/cacheConfig'
import { chooseFile } from '../utils/csv'

const MAX_BATCH_COUNT = 2000
const MAX_BATCH_BYTES = 400 * 1024

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
    for (const field of fields) {
        const aliases = HEADER_ALIASES[field] || [field]
        const lowerAliases = aliases.map(a => a.toLowerCase())
        const idx = lowerHeader.findIndex(h => lowerAliases.some(a => h === a))
        if (idx >= 0) result[field] = idx
    }
    for (const field of fields) {
        if (result[field] !== undefined) continue
        const aliases = HEADER_ALIASES[field] || [field]
        const lowerAliases = aliases.map(a => a.toLowerCase())
        const idx = lowerHeader.findIndex(h => lowerAliases.some(a => h.includes(a) || a.includes(h)))
        if (idx >= 0 && !Object.values(result).includes(idx)) result[field] = idx
    }
    return result
}

export function useDataImport() {
    const store = useStore()
    const importing = ref(false)

    async function doImportXlsx(filePath: string, importType: 'orders' | 'menu' | 'members', loadData: () => Promise<void>) {
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

    function showSkippedDetails(details: any[]) {
        if (!details || details.length === 0) return
        const lines = details.slice(0, 10).map(d =>
            `${d.memberName} - ${d.menuName}（${d.date}，¥${d.price}）`
        )
        if (details.length > 10) {
            lines.push(`...等共${details.length}条`)
        }
        uni.showModal({
            title: `跳过${details.length}条重复`,
            content: lines.join('\n'),
            showCancel: false,
            confirmText: '知道了',
        })
    }

    async function doImportCsvOrders(filePath: string, loadData: () => Promise<void>) {
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

        uni.showLoading({ title: '上传文件...' })
        try {
            const cloudPath = `csv_import/${Date.now()}_${Math.random().toString(36).substr(2, 6)}.csv`
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

    async function doImportOrders(filePath: string, ext: string, loadData: () => Promise<void>) {
        if (ext === 'xlsx') {
            await doImportXlsx(filePath, 'orders', loadData)
            return
        }
        await doImportCsvOrders(filePath, loadData)
    }

    async function fetchCsvRowsFromCloud(filePath: string): Promise<string[][]> {
        const cloudPath = `csv_import/${Date.now()}_${Math.random().toString(36).substr(2, 6)}.csv`
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
        const res = await menuAction('parseCsv', { fileID: uploadRes.fileID })
        try { await wx.cloud.deleteFile({ fileList: [uploadRes.fileID] }).catch(() => {}) } catch {}
        if (res.result.code !== 0) throw new Error(res.result.msg || 'CSV解析失败')
        return res.result.data.rows || []
    }

    async function doImportMenu(filePath: string, ext: string) {
        if (ext === 'xlsx') {
            await doImportXlsx(filePath, 'menu', async () => {})
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
            if (!mode) return
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
            await doImportXlsx(filePath, 'members', async () => {})
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

    async function importData(type: 'orders' | 'menu' | 'members', loadData: () => Promise<void>) {
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
                await doImportOrders(filePath, ext, loadData)
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

    return {
        importing,
        importData,
    }
}