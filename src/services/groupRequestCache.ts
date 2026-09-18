export class GroupRequestCache<T> {
    private cache = new Map<string, { expiresAt: number; value: T }>()
    private pending = new Map<string, Promise<T>>()
    private generation = 0

    constructor(private readonly ttlMs: number) {}

    getOrLoad(groupId: string, loader: () => Promise<T>): Promise<T> {
        const cached = this.cache.get(groupId)
        if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)

        const existing = this.pending.get(groupId)
        if (existing) return existing

        const generation = this.generation
        const request = loader()
            .then(value => {
                if (generation === this.generation && value !== null) {
                    this.cache.set(groupId, { expiresAt: Date.now() + this.ttlMs, value })
                }
                return value
            })
            .finally(() => {
                if (this.pending.get(groupId) === request) this.pending.delete(groupId)
            })

        this.pending.set(groupId, request)
        return request
    }

    clear() {
        this.generation += 1
        this.cache.clear()
        this.pending.clear()
    }
}
