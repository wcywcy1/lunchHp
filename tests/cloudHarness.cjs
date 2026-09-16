const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { AsyncLocalStorage } = require('node:async_hooks')

function harness() {
    let tables = new Map()
    let id = 0
    let transactionQueue = Promise.resolve()
    const identity = new AsyncLocalStorage()
    const files = new Map()
    const clone = value => value === undefined ? undefined : structuredClone(value)
    const op = (type, value) => ({ __op: type, value })
    const command = Object.fromEntries(['eq', 'neq', 'lt', 'gt', 'in', 'nin', 'exists', 'inc', 'remove', 'set'].map(type => [type, value => op(type, value)]))
    command.aggregate = {}
    const getTable = (name, state = tables) => {
        if (!state.has(name)) state.set(name, new Map())
        return state.get(name)
    }
    function matches(row, where) {
        return Object.entries(where || {}).every(([key, expected]) => {
            const actual = row[key]
            if (!expected || !expected.__op) return actual === expected
            switch (expected.__op) {
                case 'eq': return actual === expected.value
                case 'neq': return actual !== expected.value
                case 'lt': return actual < expected.value
                case 'gt': return actual > expected.value
                case 'in': return expected.value.includes(actual)
                case 'nin': return !expected.value.includes(actual)
                case 'exists': return (actual !== undefined) === expected.value
                default: throw new Error('unsupported matcher')
            }
        })
    }
    function updated(row, data) {
        const result = clone(row)
        for (const [key, value] of Object.entries(data)) {
            if (value && value.__op === 'inc') result[key] = (result[key] || 0) + value.value
            else if (value && value.__op === 'remove') delete result[key]
            else if (value && value.__op === 'set') result[key] = clone(value.value)
            else result[key] = clone(value)
        }
        return result
    }
    function collection(name, state, transactional = false) {
        const table = () => getTable(name, state || tables)
        const query = (where = {}, offset = 0, max = 100, sorts = [], projection) => ({
            where: w => { if (transactional) throw new Error('where is forbidden in transaction mock'); return query(w, offset, max, sorts, projection) },
            skip: value => query(where, value, max, sorts, projection),
            limit: value => query(where, offset, value, sorts, projection),
            orderBy: (key, direction) => query(where, offset, max, [...sorts, [key, direction]], projection),
            field: value => query(where, offset, max, sorts, value),
            async get() {
                let rows = [...table().values()].filter(row => matches(row, where))
                for (const [key, direction] of sorts.toReversed ? sorts.toReversed() : [...sorts].reverse()) {
                    rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === 'desc' ? -1 : 1))
                }
                rows = clone(rows.slice(offset, offset + max))
                if (projection) rows = rows.map(row => {
                    if (Object.values(projection).some(Boolean)) return Object.fromEntries(Object.entries(row).filter(([k]) => projection[k] || k === '_id'))
                    for (const key of Object.keys(projection)) if (!projection[key]) delete row[key]
                    return row
                })
                return { data: rows }
            },
            async count() { return { total: [...table().values()].filter(row => matches(row, where)).length } },
            async update({ data }) {
                let count = 0
                for (const [key, row] of table()) if (matches(row, where)) { table().set(key, updated(row, data)); count++ }
                return { stats: { updated: count } }
            },
            async remove() {
                let count = 0
                for (const [key, row] of table()) if (matches(row, where)) { table().delete(key); count++ }
                return { stats: { removed: count } }
            },
            doc(key) {
                return {
                    async get() { return { data: clone(table().get(key)) } },
                    async set({ data }) {
                        if (db.failWrite && db.failWrite(name, key, data)) throw new Error('injected write failure')
                        table().set(key, { ...clone(data), _id: key })
                        return { stats: { updated: 1 } }
                    },
                    async update({ data }) {
                        const old = table().get(key)
                        if (!old) throw new Error('document does not exist')
                        table().set(key, updated(old, data))
                        return { stats: { updated: 1 } }
                    },
                    async remove() { table().delete(key); return { stats: { removed: 1 } } },
                }
            },
            async add({ data }) {
                const rows = Array.isArray(data) ? data : [data]
                const ids = []
                for (const row of rows) {
                    const key = row._id || 'generated_' + (++id)
                    if (table().has(key)) throw new Error('duplicate id')
                    table().set(key, { ...clone(row), _id: key })
                    ids.push(key)
                }
                return Array.isArray(data) ? { _ids: ids } : { _id: ids[0] }
            },
        })
        return query()
    }
    const db = {
        command, failWrite: null, collection: name => collection(name),
        serverDate: () => new Date('2026-09-16T01:00:00Z'),
        createCollection: async name => { getTable(name) },
        runTransaction(fn) {
            const work = transactionQueue.then(async () => {
                const snapshot = clone(tables)
                const result = await fn({ collection: name => collection(name, snapshot, true) })
                tables = snapshot
                return result
            })
            transactionQueue = work.catch(() => {})
            return work
        },
    }
    const cloud = {
        DYNAMIC_CURRENT_ENV: 'test', init() {}, database: () => db,
        getWXContext: () => ({ OPENID: identity.getStore() || '' }),
        uploadFile: async ({ cloudPath, fileContent }) => {
            const fileID = 'cloud://test/' + cloudPath
            files.set(fileID, Buffer.from(fileContent))
            return { fileID }
        },
        downloadFile: async ({ fileID }) => {
            if (!files.has(fileID)) throw new Error('file missing')
            return { fileContent: files.get(fileID) }
        },
        deleteFile: async ({ fileList }) => { fileList.forEach(id => files.delete(id)); return {} },
    }
    const functions = new Map()
    let now = new Date('2026-09-16T01:00:00Z').getTime()
    class TestDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])) }
        static now() { return now }
    }
    function load(name) {
        if (functions.has(name)) return functions.get(name)
        const filename = path.resolve(__dirname, '../wxcloud/functions', name, 'index.js')
        const sandbox = {
            exports: {}, Buffer, Date: TestDate, TextDecoder, console: { log() {}, warn() {}, error() {} },
            setTimeout, clearTimeout,
            require(module) {
                if (module === 'wx-server-sdk') return cloud
                if (module === 'xlsx') throw new Error('not installed in test')
                return require(module.startsWith('.') ? path.resolve(path.dirname(filename), module) : module)
            },
        }
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename })
        functions.set(name, sandbox.exports.main)
        return sandbox.exports.main
    }
    const seed = (name, rows) => rows.forEach(row => getTable(name).set(row._id, clone(row)))
    seed('lunch_groups', [
        { _id: 'a', creatorId: 'owner-a', orderCutoff: '10:00' },
        { _id: 'b', creatorId: 'owner-b', orderCutoff: '10:00' },
    ])
    seed('lunch_members', [
        { _id: 'owner', groupId: 'a', openid: 'owner-a', role: 'creator', name: '创建者', isVirtual: false },
        { _id: 'admin', groupId: 'a', openid: 'admin-a', role: 'admin', name: '管理员', isVirtual: false },
        { _id: 'member', groupId: 'a', openid: 'member-a', role: 'member', name: '同事', isVirtual: false },
        { _id: 'virtual', groupId: 'a', openid: '', role: 'member', name: '虚拟同事', isVirtual: true },
        { _id: 'other', groupId: 'b', openid: 'owner-b', role: 'creator', name: '其他组织', isVirtual: false },
    ])
    seed('lunch_menu', [
        { _id: 'dish', groupId: 'a', name: '午餐', supplier: '店家', price: 18.5, visible: true, sortNo: 1 },
        { _id: 'other-dish', groupId: 'b', name: '其他午餐', price: 20, visible: true, sortNo: 1 },
    ])
    return {
        db, cloud, files, seed,
        rows: name => clone([...getTable(name).values()]),
        setNow: date => { now = new Date(date).getTime() },
        invoke: (name, event, openid = 'admin-a') => identity.run(openid, () => load(name)(event, {})),
    }
}
module.exports = { harness }

