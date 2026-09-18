const test = require('node:test')
const assert = require('node:assert/strict')
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
const { createDebouncedTask } = loadTypeScriptModule('src/utils/debouncedTask.ts')
const { getCutoffNoticeState } = loadTypeScriptModule('src/utils/cutoffNotice.ts')

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

test('Watch 防抖只执行最后一次任务，取消后不再执行', async () => {
    let calls = 0
    const debounced = createDebouncedTask(() => { calls += 1 }, 15)
    debounced.schedule()
    debounced.schedule()
    debounced.schedule()
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(calls, 1)

    debounced.schedule()
    debounced.cancel()
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(calls, 1)
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
