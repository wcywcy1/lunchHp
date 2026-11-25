const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

// 业务日期统一按北京时间（UTC+8），避免设备时区不同导致"今日"数据错乱。
export function getBeijingDate(date: Date = new Date()): Date {
    return new Date(date.getTime() + BEIJING_OFFSET_MS)
}

export function getTodayString(date: Date = new Date()): string {
    const d = getBeijingDate(date)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function getTodayDisplayString(date: Date = new Date()): string {
    const d = getBeijingDate(date)
    return `${d.getUTCFullYear()}年${String(d.getUTCMonth() + 1).padStart(2, '0')}月${String(d.getUTCDate()).padStart(2, '0')}日`
}

export function getBeijingHHMM(timestamp: number = Date.now()): string {
    return new Date(timestamp + BEIJING_OFFSET_MS).toISOString().slice(11, 16)
}

// 返回当前是否未到截止时间，以及下一次状态变化还需多少毫秒（截止时刻或次日零点）
export function getBeijingCutoffState(cutoff: string, timestamp: number = Date.now()): { allowed: boolean; nextChangeMs: number } {
    const match = /^(\d{1,2}):(\d{2})$/.exec(cutoff || '')
    const hours = match ? Math.min(Number(match[1]), 23) : 10
    const minutes = match ? Math.min(Number(match[2]), 59) : 0
    const bj = new Date(timestamp + BEIJING_OFFSET_MS)
    const todayCutoff = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), hours, minutes) - BEIJING_OFFSET_MS
    const nextMidnight = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() + 1, 0, 0) - BEIJING_OFFSET_MS
    if (timestamp < todayCutoff) {
        return { allowed: true, nextChangeMs: todayCutoff - timestamp + 1000 }
    }
    return { allowed: false, nextChangeMs: nextMidnight - timestamp + 1000 }
}
