const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

export interface CutoffNoticeState {
    content: string
    nextUpdateInMs: number
}

export function getCutoffNoticeState(
    cutoff: string,
    disabled: boolean,
    nowMs = Date.now(),
): CutoffNoticeState {
    const match = /^(\d{2}):(\d{2})$/.exec(cutoff)
    if (disabled || !match) return { content: '', nextUpdateInMs: 0 }

    const hour = Number(match[1])
    const minute = Number(match[2])
    if (hour > 23 || minute > 59) return { content: '', nextUpdateInMs: 0 }

    const beijingNow = new Date(nowMs + BEIJING_OFFSET_MS)
    const year = beijingNow.getUTCFullYear()
    const month = beijingNow.getUTCMonth()
    const day = beijingNow.getUTCDate()
    const cutoffMs = Date.UTC(year, month, day, hour, minute) - BEIJING_OFFSET_MS
    const midnightMs = Date.UTC(year, month, day + 1) - BEIJING_OFFSET_MS
    const active = nowMs >= cutoffMs && nowMs < midnightMs
    const nextBoundary = active ? midnightMs : cutoffMs

    return {
        content: active ? `每天${cutoff}停止接单，有需要请电话联系` : '',
        nextUpdateInMs: Math.max(1, nextBoundary - nowMs),
    }
}
