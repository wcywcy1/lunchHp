export function createDebouncedTask(task: () => void, delayMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null

    return {
        schedule() {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
                timer = null
                task()
            }, delayMs)
        },
        cancel() {
            if (timer) clearTimeout(timer)
            timer = null
        },
    }
}
