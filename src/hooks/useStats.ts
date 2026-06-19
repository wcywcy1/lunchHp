import { ref, computed, ComputedRef, Ref } from 'vue'
import { useStore, getCache, setCache } from '../services/store'
import { orderAction } from '../services/repositories/baseRepository'
import { CACHE_KEYS, CACHE_TTL } from '../constants/cacheConfig'
import { buildCsvLine, writeCsvWithBom } from '../utils/csv'

interface MonthlyStat {
    _id: string
    year: number
    month: number
    totalAmount: number
    orderCount: number
    orderByMember: Record<string, number>
    orderBySupplier: Record<string, number>
    [key: string]: any
}

interface FilterState {
    year: number | null
    months: number[]
    members: string[]
    suppliers: string[]
}

interface StatsReturn {
    loading: Ref<boolean>
    monthlyStats: Ref<MonthlyStat[]>
    filter: Ref<FilterState>
    showFilter: Ref<boolean>
    filteredStats: ComputedRef<MonthlyStat[]>
    totalAmount: ComputedRef<number>
    totalCount: ComputedRef<number>
    yearOptions: ComputedRef<number[]>
    memberOptions: ComputedRef<string[]>
    supplierOptions: ComputedRef<string[]>
    barChartData: ComputedRef<{ label: string; value: number; amount: number; year: number }[]>
    pieChartData: ComputedRef<{ name: string; value: number; amount: number; percent: string }[]>
    detailOrders: Ref<any[]>
    detailLoading: Ref<boolean>
    hasMoreDetail: ComputedRef<boolean>
    loadStats: (forceRefresh?: boolean) => Promise<void>
    refreshStats: () => Promise<void>
    getStatsLoadTime: () => number
    applyFilter: (f: FilterState) => Promise<void>
    resetFilter: () => Promise<void>
    openFilter: () => void
    closeFilter: () => void
    searchDetail: () => Promise<void>
    loadMoreDetail: () => Promise<void>
    downloadMonthlyData: () => Promise<void>
}

export function useStats(): StatsReturn {
    const store = useStore()
    const loading = ref(false)
    const monthlyStats = ref<MonthlyStat[]>([])
    const showFilter = ref(false)
    const detailOrders = ref<any[]>([])
    const detailLoading = ref(false)
    const detailPage = ref(0)
    const detailTotal = ref(0)
    const pageSize = 50

    const filter = ref<FilterState>({
        year: null,
        months: [],
        members: [],
        suppliers: [],
    })

    const yearOptions = computed(() => {
        const years = new Set<number>()
        monthlyStats.value.forEach(s => years.add(s.year))
        return Array.from(years).sort((a, b) => b - a)
    })

    let _statsLoadTime = 0

    const memberOptions = computed(() => {
        const names = new Set<string>()
        monthlyStats.value.forEach(s => {
            if (s.orderByMember) Object.keys(s.orderByMember).forEach(n => names.add(n))
        })
        ;(store.members || []).forEach((m: any) => {
            const name = m.name || m.nickName
            if (name) names.add(name)
        })
        return Array.from(names).sort()
    })

    const supplierOptions = computed(() => {
        const names = new Set<string>()
        monthlyStats.value.forEach(s => {
            if (s.orderBySupplier) Object.keys(s.orderBySupplier).forEach(n => names.add(n))
        })
        return Array.from(names).sort()
    })

    const filteredStats = computed(() => {
        let list = monthlyStats.value
        const f = filter.value
        if (f.year !== null) {
            list = list.filter(s => s.year === f.year)
        }
        if (f.months.length > 0) {
            list = list.filter(s => f.months.includes(s.month))
        }
        if (f.members.length > 0) {
            list = list.filter(s => {
                if (!s.orderByMember) return false
                return f.members.some(m => s.orderByMember[m] !== undefined)
            })
        }
        if (f.suppliers.length > 0) {
            list = list.filter(s => {
                if (!s.orderBySupplier) return false
                return f.suppliers.some(sp => s.orderBySupplier[sp] !== undefined)
            })
        }
        return list.sort((a, b) => {
            if (a.year !== b.year) return a.year - b.year
            return a.month - b.month
        })
    })

    const totalAmount = computed(() =>
        filteredStats.value.reduce((sum, s) => sum + (s.totalAmount || 0), 0)
    )

    const totalCount = computed(() =>
        filteredStats.value.reduce((sum, s) => sum + (s.orderCount || 0), 0)
    )

    const barChartData = computed(() =>
        filteredStats.value.map(s => ({
            label: `${s.month}月`,
            value: s.totalAmount || 0,
            amount: s.totalAmount || 0,
            year: s.year,
        }))
    )

    const pieChartData = computed(() => {
        const supplierMap: Record<string, number> = {}
        filteredStats.value.forEach(s => {
            if (!s.orderBySupplier) return
            Object.entries(s.orderBySupplier).forEach(([name, amount]) => {
                const key = name || '未定义'
                supplierMap[key] = (supplierMap[key] || 0) + amount
            })
        })
        const total = Object.values(supplierMap).reduce((a, b) => a + b, 0)
        return Object.entries(supplierMap)
            .map(([name, amount]) => ({
                name,
                value: amount,
                amount,
                percent: total > 0 ? ((amount / total) * 100).toFixed(1) : '0.0',
            }))
            .sort((a, b) => b.value - a.value)
    })

    const hasMoreDetail = computed(() =>
        detailOrders.value.length < detailTotal.value
    )

    async function loadStats(forceRefresh = false) {
        if (!forceRefresh) {
            const now = Date.now()
            if (now - _statsLoadTime < CACHE_TTL.MONTHLY_STATS) {
                const cached = getCache(CACHE_KEYS.MONTHLY_STATS)
                if (cached && cached.length > 0) {
                    monthlyStats.value = cached
                    return
                }
            }
        }
        loading.value = true
        try {
            const params: Record<string, any> = {}
            if (!forceRefresh) {
                const cachedTime = getCache(CACHE_KEYS.MONTHLY_STATS_TIME, true) || 0
                const oneHourAgo = Date.now() - 60 * 60 * 1000
                if (cachedTime > 0 && cachedTime > oneHourAgo) params.since = cachedTime
            }

            const res = await orderAction('getMonthlyStats', params)
            if (res.result.code === 0) {
                const freshData = res.result.data || []
                const serverTs = res.result.dataTimestamp || 0
                const isIncremental = res.result.incremental === true

                if (isIncremental && freshData.length > 0) {
                    const cached = getCache(CACHE_KEYS.MONTHLY_STATS, true) || []
                    const merged = _mergeStats(cached, freshData)
                    monthlyStats.value = merged
                    setCache(CACHE_KEYS.MONTHLY_STATS, merged)
                } else if (!isIncremental) {
                    monthlyStats.value = freshData
                    setCache(CACHE_KEYS.MONTHLY_STATS, freshData)
                }

                const now = Date.now()
                _statsLoadTime = now
                setCache(CACHE_KEYS.MONTHLY_STATS_TIME, serverTs || now)
            }
        } catch (e) {
            console.error('loadStats error:', e)
            if (monthlyStats.value.length === 0) {
                const cached = getCache(CACHE_KEYS.MONTHLY_STATS, true)
                if (cached && cached.length > 0) {
                    monthlyStats.value = cached
                }
            }
        } finally {
            loading.value = false
        }
    }

    function _mergeStats(cached: MonthlyStat[], fresh: MonthlyStat[]): MonthlyStat[] {
        const merged = cached.slice()
        for (const s of fresh) {
            const key = `${s.year}_${s.month}`
            const idx = merged.findIndex(m => `${m.year}_${m.month}` === key)
            if (idx >= 0) {
                merged[idx] = s
            } else {
                merged.push(s)
            }
        }
        return merged
    }

    async function applyFilter(f: FilterState) {
        filter.value = { ...f }
        showFilter.value = false
        await searchDetail()
    }

    async function resetFilter() {
        filter.value = { year: null, months: [], members: [], suppliers: [] }
        showFilter.value = false
        await searchDetail()
    }

    function openFilter() { showFilter.value = true }
    function closeFilter() { showFilter.value = false }

    async function searchDetail() {
        detailPage.value = 0
        detailOrders.value = []
        await fetchDetailPage()
    }

    async function loadMoreDetail() {
        if (detailLoading.value || !hasMoreDetail.value) return
        await fetchDetailPage()
    }

    async function fetchDetailPage() {
        detailLoading.value = true
        try {
            const f = filter.value
            const params: Record<string, any> = { page: detailPage.value + 1, pageSize }
            if (f.year !== null) params.year = f.year
            if (f.months.length > 0) params.months = f.months
            if (f.members.length > 0) params.members = f.members
            if (f.suppliers.length > 0) params.suppliers = f.suppliers

            const res = await orderAction('searchOrders', params)
            if (res.result.code === 0) {
                const { list, total } = res.result.data
                detailOrders.value = [...detailOrders.value, ...list]
                detailTotal.value = total
                detailPage.value++
            }
        } catch (e) {
            console.error('searchDetail error:', e)
        } finally {
            detailLoading.value = false
        }
    }

    async function downloadMonthlyData() {
        if (filteredStats.value.length === 0) {
            uni.showToast({ title: '暂无数据', icon: 'none' })
            return
        }
        try {
            const f = filter.value
            const params: Record<string, any> = {}
            if (f.year !== null) params.year = f.year
            if (f.months.length > 0) params.months = f.months

            const res = await orderAction('downloadMonthlyData', params)
            if (res.result.code === 0 && res.result.data.fileID) {
                const { fileID } = res.result.data
                await wx.cloud.downloadFile({
                    fileID,
                    success: (downloadRes: any) => {
                        const fs = wx.getFileSystemManager()
                        const fileName = 'monthly_stats.csv'
                        const localPath = `${wx.env.USER_DATA_PATH}/${fileName}`
                        fs.saveFileSync(downloadRes.tempFilePath, localPath)
                        uni.showModal({
                            title: '下载成功',
                            content: '是否分享到微信？',
                            confirmText: '分享',
                            cancelText: '取消',
                            success: (modalRes) => {
                                if (!modalRes.confirm) {
                                    try { fs.unlinkSync(localPath) } catch {}
                                    return
                                }
                                wx.shareFileMessage({
                                    filePath: localPath,
                                    fileName,
                                    success: () => {
                                        try { fs.unlinkSync(localPath) } catch {}
                                        uni.showToast({ title: '分享成功', icon: 'success' })
                                    },
                                    fail: (err: any) => {
                                        try { fs.unlinkSync(localPath) } catch {}
                                        if (err?.errMsg?.indexOf('cancel') > -1) {
                                            uni.showToast({ title: '已取消', icon: 'none' })
                                        } else {
                                            uni.showToast({ title: '分享失败', icon: 'none' })
                                        }
                                    },
                                })
                            },
                        })
                    },
                })
            } else {
                const csvLines = ['月份,总金额,订单数']
                filteredStats.value.forEach(s => {
                    csvLines.push(buildCsvLine([`${s.year}-${String(s.month).padStart(2, '0')}`, s.totalAmount, s.orderCount]))
                })
                const fs = wx.getFileSystemManager()
                const fileName = 'monthly_stats.csv'
                const path = `${wx.env.USER_DATA_PATH}/${fileName}`
                writeCsvWithBom(fs, path, csvLines.join('\r\n'))
                uni.showModal({
                    title: '导出成功',
                    content: '是否分享到微信？',
                    confirmText: '分享',
                    cancelText: '取消',
                    success: (modalRes) => {
                        if (!modalRes.confirm) {
                            try { fs.unlinkSync(path) } catch {}
                            return
                        }
                        wx.shareFileMessage({
                            filePath: path,
                            fileName,
                            success: () => {
                                try { fs.unlinkSync(path) } catch {}
                                uni.showToast({ title: '分享成功', icon: 'success' })
                            },
                            fail: (err: any) => {
                                try { fs.unlinkSync(path) } catch {}
                                if (err?.errMsg?.indexOf('cancel') > -1) {
                                    uni.showToast({ title: '已取消', icon: 'none' })
                                } else {
                                    uni.showToast({ title: '分享失败', icon: 'none' })
                                }
                            },
                        })
                    },
                })
            }
        } catch (e: any) {
            uni.showToast({ title: e.message || '下载失败', icon: 'none' })
        }
    }

    async function refreshStats() {
        await loadStats(true)
    }

    function getStatsLoadTime() {
        return _statsLoadTime
    }

    return {
        loading,
        monthlyStats,
        filter,
        showFilter,
        filteredStats,
        totalAmount,
        totalCount,
        yearOptions,
        memberOptions,
        supplierOptions,
        barChartData,
        pieChartData,
        detailOrders,
        detailLoading,
        hasMoreDetail,
        loadStats,
        refreshStats,
        getStatsLoadTime,
        applyFilter,
        resetFilter,
        openFilter,
        closeFilter,
        searchDetail,
        loadMoreDetail,
        downloadMonthlyData,
    }
}