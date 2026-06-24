let serverTimeOffset = 0

export function syncServerTime(serverTimeMs: number) {
    serverTimeOffset = serverTimeMs - Date.now()
}

export function getNow(): Date {
    return new Date(Date.now() + serverTimeOffset)
}

export function getTodayString(): string {
    const d = getNow()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}