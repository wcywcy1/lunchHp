import { useStore, setStore, setCache, saveSession } from './store'
import { menuAction } from './repositories/baseRepository'
import { CACHE_KEYS } from '../constants/cacheConfig'
import { GroupRequestCache } from './groupRequestCache'

export function toMs(val: any): number | null {
    if (!val) return null
    if (typeof val === 'number') return val
    const t = new Date(val).getTime()
    return isNaN(t) ? null : t
}

const FRESHNESS_CACHE_TTL = 5 * 1000
const freshnessRequests = new GroupRequestCache<any>(FRESHNESS_CACHE_TTL)

export function clearFreshnessCache() {
    freshnessRequests.clear()
}

/**
 * 统一的数据新鲜度检查（首页/菜单页共用）：
 * 对比 lunch_groups 时间戳，增量刷新 menu/members，同步 cutoff 配置与本人角色
 * 返回最新时间戳数据，调用方可据此做额外处理（如首页刷新订单）
 *
 * 优化：按组织短时缓存（5s TTL）+ 并发 Promise 复用，快速切页时减少重复调用
 */
export async function checkDataFreshness() {
    const store = useStore()
    const groupId = store.groupId || ''

    return freshnessRequests.getOrLoad(groupId, () => _doCheckFreshness(groupId))
}

async function _doCheckFreshness(groupId: string) {
    const store = useStore()
    try {
        const res = await menuAction('getDataTimestamps', { groupId })
        if (res.result.code !== 0) return null
        const { recentTimestamp, menuTimestamp, membersTimestamp, orderCutoff, cutoffDisabled } = res.result.data
        setStore({ groupCutoff: orderCutoff || '10:00', cutoffDisabled: !!cutoffDisabled })

        const tasks: Promise<void>[] = []
        if (toMs(menuTimestamp) !== toMs(store.menuTimestamp)) {
            tasks.push((async () => {
                try {
                    const menuRes = await menuAction('getMenuList', { groupId })
                    if (menuRes.result.code === 0) {
                        const menu = menuRes.result.data
                        setStore({ menu, menuTimestamp })
                        setCache(CACHE_KEYS.MENU, menu)
                        setCache(CACHE_KEYS.MENU_TIMESTAMP, menuTimestamp)
                    }
                } catch (e) { console.error('checkDataFreshness menu error:', e) }
            })())
        }
        if (toMs(membersTimestamp) !== toMs(store.membersTimestamp)) {
            tasks.push((async () => {
                try {
                    const membersRes = await menuAction('getMembers', { groupId })
                    if (membersRes.result.code === 0) {
                        const members = membersRes.result.data
                        setStore({ members, membersTimestamp })
                        setCache(CACHE_KEYS.MEMBERS, members)
                        setCache(CACHE_KEYS.MEMBERS_TIMESTAMP, membersTimestamp)
                        const meId = store.member?._id
                        const myRole = store.member?.role
                        if (meId) {
                            const me = members.find((m: any) => m._id === meId)
                            if (me && me.role !== myRole) {
                                setStore({ member: me, role: me.role })
                                saveSession({ groupId: me.groupId, role: me.role, member: me })
                            }
                        }
                    }
                } catch (e) { console.error('checkDataFreshness members error:', e) }
            })())
        }
        await Promise.all(tasks)
        const result = { recentTimestamp, menuTimestamp, membersTimestamp, orderCutoff, cutoffDisabled }
        return result
    } catch (e) {
        console.error('checkDataFreshness error:', e)
        return null
    }
}
