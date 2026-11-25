const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')

function loadTypeScriptModule(relativePath) {
    const output = esbuild.buildSync({
        entryPoints: [path.resolve(__dirname, '..', relativePath)],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
    }).outputFiles[0].text
    const module = { exports: {} }
    Function('require', 'module', 'exports', output)(require, module, module.exports)
    return module.exports
}

const { GroupRequestCache } = loadTypeScriptModule('src/services/groupRequestCache.ts')
const { loadAdminData } = loadTypeScriptModule('src/services/adminDataLoader.ts')
const { getCutoffNoticeState } = loadTypeScriptModule('src/utils/cutoffNotice.ts')
const {
    resolveCurrentMember,
    patchMembersAfterMerge,
    filterMergeTargets,
    getMemberMergeAction,
} = loadTypeScriptModule('src/utils/memberMerge.ts')

test('freshness 请求按组织复用并发 Promise，并分别缓存结果', async () => {
    const cache = new GroupRequestCache(5000)
    let calls = 0
    const loader = async value => {
        calls += 1
        await new Promise(resolve => setTimeout(resolve, 5))
        return value
    }

    const [a1, a2, b] = await Promise.all([
        cache.getOrLoad('a', () => loader('a')),
        cache.getOrLoad('a', () => loader('unused')),
        cache.getOrLoad('b', () => loader('b')),
    ])
    assert.deepEqual([a1, a2, b], ['a', 'a', 'b'])
    assert.equal(calls, 2)
    assert.equal(await cache.getOrLoad('a', () => loader('unused')), 'a')
    assert.equal(calls, 2)
})

test('清理缓存后，旧请求完成不会覆盖新一代缓存', async () => {
    const cache = new GroupRequestCache(5000)
    let resolveOld
    const old = cache.getOrLoad('a', () => new Promise(resolve => { resolveOld = resolve }))
    cache.clear()
    assert.equal(await cache.getOrLoad('a', async () => 'new'), 'new')
    resolveOld('old')
    await old
    assert.equal(await cache.getOrLoad('a', async () => 'unexpected'), 'new')
})

test('管理页并行请求允许订单或时间戳单独失败', async () => {
    const result = await loadAdminData(
        async () => { throw new Error('orders failed') },
        async () => ({ orderCutoff: '10:00' }),
    )
    assert.equal(result.orders, null)
    assert.match(result.ordersError.message, /orders failed/)
    assert.deepEqual(result.timestamps, { orderCutoff: '10:00' })
    assert.equal(result.timestampsError, null)
})

test('停止接单通知只在北京时间截止后至次日零点显示', () => {
    const before = Date.parse('2026-09-18T01:59:59.000Z')
    const atCutoff = Date.parse('2026-09-18T02:00:00.000Z')
    const endOfDay = Date.parse('2026-09-18T15:59:59.999Z')
    const midnight = Date.parse('2026-09-18T16:00:00.000Z')

    assert.equal(getCutoffNoticeState('10:00', false, before).content, '')
    assert.equal(getCutoffNoticeState('10:00', false, atCutoff).content,
        '每天10:00停止接单，有需要请电话联系')
    assert.equal(getCutoffNoticeState('10:00', false, endOfDay).content,
        '每天10:00停止接单，有需要请电话联系')
    assert.equal(getCutoffNoticeState('10:00', false, midnight).content, '')
    assert.equal(getCutoffNoticeState('10:00', true, atCutoff).content, '')
})

test('统计页冷启动不带 since，避免空增量导致页面无数据', async () => {
    const cachedStats = [{ _id: 's1', year: 2026, month: 9, totalAmount: 10, orderCount: 1, orderByMember: {}, orderBySupplier: {} }]
    const storage = new Map()
    storage.set('lunch_cache_monthly_stats', JSON.stringify({ data: cachedStats, ts: Date.now() }))
    storage.set('lunch_cache_monthly_stats_time', JSON.stringify({ data: Date.now() - 60 * 1000, ts: Date.now() }))

    const previousUni = global.uni
    const previousWx = global.wx
    let requestSince = 'not-called'
    global.uni = {
        getStorageSync: key => storage.get(key) || '',
        setStorageSync: (key, value) => storage.set(key, value),
        removeStorageSync: key => storage.delete(key),
        showToast: () => {},
    }
    global.wx = {
        cloud: {
            callFunction: async ({ data }) => {
                requestSince = data.since
                if (data.since) {
                    return { result: { code: 0, data: [], dataTimestamp: Date.now() - 60 * 1000, incremental: true } }
                }
                return { result: { code: 0, data: cachedStats, dataTimestamp: Date.now(), incremental: false } }
            },
        },
    }

    try {
        const { useStats } = loadTypeScriptModule('src/hooks/useStats.ts')
        const stats = useStats()
        await stats.loadStats()
        assert.equal(requestSince, undefined)
        assert.equal(stats.monthlyStats.value.length, 1)
    } finally {
        // 等待 setCache 的 300ms 合并写入完成，再恢复全局对象
        await new Promise(resolve => setTimeout(resolve, 350))
        global.uni = previousUni
        global.wx = previousWx
    }
})

test('CSV 导出对 emoji 使用标准 UTF-8 编码', () => {
    const { writeCsvWithBom } = loadTypeScriptModule('src/utils/csv.ts')
    const chunks = []
    writeCsvWithBom({ writeFileSync: (_path, buffer) => chunks.push(new Uint8Array(buffer)) }, 'x.csv', 'A\u{1F600}中')
    assert.deepEqual(Array.from(chunks[0]), [0xEF, 0xBB, 0xBF, 0x41, 0xF0, 0x9F, 0x98, 0x80, 0xE4, 0xB8, 0xAD])
})

test('旧设备通过 freshness 从旧 memberId 解析到同 openid 的新 memberId', () => {
    const members = [
        { _id: 'A', groupId: 'a', name: '虚拟同事', role: 'member', openid: 'b', isVirtual: false },
        { _id: 'C', groupId: 'a', name: '其他', role: 'member', openid: 'c' },
    ]
    const resolved = resolveCurrentMember(members, { _id: 'B', groupId: 'a', name: '同事', role: 'member', openid: 'b' })
    assert.equal(resolved._id, 'A')
    assert.equal(resolveCurrentMember(members, { _id: 'B', groupId: 'a', name: '同事', role: 'member', openid: 'none' }), null)
})

test('管理页合账后立即用 mergedMember 替换虚拟成员', () => {
    const members = [
        { _id: 'virtual', groupId: 'a', name: '虚拟同事', role: 'member', isVirtual: true },
        { _id: 'member', groupId: 'a', name: '同事', role: 'member' },
        { _id: 'other', groupId: 'a', name: '其他', role: 'member' },
    ]
    const merged = { _id: 'virtual', groupId: 'a', name: '虚拟同事', role: 'member', isVirtual: false, openid: 'b' }
    const next = patchMembersAfterMerge(members, merged, 'member')
    assert.deepEqual(next.map(m => m._id).sort(), ['other', 'virtual'])
    assert.equal(next.find(m => m._id === 'virtual').isVirtual, false)
    assert.equal(next.find(m => m._id === 'virtual').openid, 'b')
})

test('管理员合账目标排除 creator，未完成合账优先继续', () => {
    const members = [
        { _id: 'virtual', groupId: 'a', name: '虚拟同事', role: 'member', isVirtual: true },
        { _id: 'creator', groupId: 'a', name: '创建者', role: 'creator' },
        { _id: 'real', groupId: 'a', name: '同事', role: 'member' },
    ]
    assert.deepEqual(filterMergeTargets(members, 'virtual').map(m => m._id), ['creator', 'real'].filter(id => id !== 'creator'))
    assert.equal(getMemberMergeAction({ _id: 'v', groupId: 'a', name: '虚拟', role: 'member', isVirtual: true, mergeFromMemberId: 'real' }), 'resume')
    assert.equal(getMemberMergeAction({ _id: 'v', groupId: 'a', name: '虚拟', role: 'member', isVirtual: true }), 'select')
    assert.equal(getMemberMergeAction({ _id: 'r', groupId: 'a', name: '真实', role: 'member' }), 'none')
})

test('业务日期统一按北京时间跨日', () => {
    const { getTodayString, getTodayDisplayString, getBeijingHHMM } = loadTypeScriptModule('src/utils/date.ts')
    assert.equal(getTodayString(new Date('2026-09-16T15:59:59.000Z')), '2026-09-16')
    assert.equal(getTodayString(new Date('2026-09-16T16:00:00.000Z')), '2026-09-17')
    assert.equal(getTodayDisplayString(new Date('2026-09-16T16:00:00.000Z')), '2026年09月17日')
    assert.equal(getBeijingHHMM(Date.parse('2026-09-16T02:00:00.000Z')), '10:00')
})

test('截止状态按北京时间计算，下一次变化落在截止时刻或次日零点', () => {
    const { getBeijingCutoffState } = loadTypeScriptModule('src/utils/date.ts')
    const before = getBeijingCutoffState('10:00', Date.parse('2026-09-16T01:59:59.000Z'))
    assert.equal(before.allowed, true)
    assert.ok(before.nextChangeMs > 0 && before.nextChangeMs <= 3000)

    const atCutoff = getBeijingCutoffState('10:00', Date.parse('2026-09-16T02:00:00.000Z'))
    assert.equal(atCutoff.allowed, false)
    assert.ok(atCutoff.nextChangeMs > 0)

    const midnight = getBeijingCutoffState('10:00', Date.parse('2026-09-16T16:00:00.000Z'))
    assert.equal(midnight.allowed, true)

    assert.equal(getBeijingCutoffState('bad-value', Date.parse('2026-09-16T01:00:00.000Z')).allowed, true)
})

function walkSourceFiles(dir) {
    const files = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) files.push(...walkSourceFiles(full))
        else files.push(full)
    }
    return files
}

test('客户端不再直接访问云数据库，也不再使用 Collection.watch', () => {
    const root = path.resolve(__dirname, '../src')
    const offenders = []
    for (const file of walkSourceFiles(root)) {
        if (!/\.(ts|js|vue)$/.test(file) || file.endsWith('.d.ts')) continue
        const text = fs.readFileSync(file, 'utf8')
        if (/wx\.cloud\.database/.test(text) || /\.watch\s*\(/.test(text) ||
            /watchTodayOrders|useRealtimeWatch/.test(text)) {
            offenders.push(path.relative(root, file))
        }
    }
    assert.deepEqual(offenders, [])
    assert.equal(fs.existsSync(path.resolve(root, 'hooks/useRealtimeWatch.ts')), false)
})
