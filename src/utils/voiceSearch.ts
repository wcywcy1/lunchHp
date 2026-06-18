/**
 * 语音识别 + 关键词提取
 * 基于微信同声传译插件（WechatSI）
 */

import { ref } from 'vue'

// 停用词：这些词不作为筛选关键词
const STOP_WORDS = [
    '我要', '我想', '吃', '喝', '来', '来个', '来份', '来一份',
    '点', '点个', '点份', '要', '要个', '要份',
    '的', '吧', '呢', '啊', '哦', '了', '吗',
    '帮', '帮我', '帮忙', '请', '一下', '下',
    '什么', '啥', '有没有', '有没', '有', '是',
    '和', '跟', '与', '及', '还有', '再', '加',
]

/**
 * 从语音识别文本中提取关键词
 * 策略：去除停用词后，按空格/标点分词，剩余片段作为关键词
 */
export function extractKeywords(text: string): string[] {
    if (!text) return []
    let cleaned = text.trim()
    // 去除标点
    cleaned = cleaned.replace(/[，。！？、,.!?;:\s]+/g, ' ')
    // 去除停用词
    for (const w of STOP_WORDS) {
        cleaned = cleaned.split(w).join(' ')
    }
    // 分词并去空、去重
    const words = cleaned.split(' ').map(s => s.trim()).filter(Boolean)
    return Array.from(new Set(words))
}

type VoiceState = 'idle' | 'recording' | 'recognizing'

interface VoiceSearchOptions {
    onStart?: () => void
    onStop?: (text: string, keywords: string[]) => void
    onError?: (msg: string) => void
}

/**
 * 语音搜索管理器
 * 点击开始录音，再点击结束并识别
 */
export function useVoiceSearch(options: VoiceSearchOptions = {}) {
    const state = ref<VoiceState>('idle')
    let manager: any = null

    function getManager(): any {
        if (!manager) {
            // #ifdef MP-WEIXIN
            const plugin = requirePlugin('WechatSI')
            manager = plugin.getRecordRecognitionManager()
            manager.onRecognize = (res: any) => {
                console.log('识别中', res)
            }
            manager.onStart = (res: any) => {
                console.log('开始录音', res)
                state.value = 'recording'
                options.onStart?.()
            }
            manager.onStop = (res: any) => {
                const text = res.result || ''
                console.log('识别结果', text)
                state.value = 'idle'
                if (!text) {
                    options.onError?.('听不清楚，请重试')
                    return
                }
                const keywords = extractKeywords(text)
                options.onStop?.(text, keywords)
            }
            manager.onError = (res: any) => {
                console.error('语音错误', res)
                state.value = 'idle'
                let msg = '语音识别失败，请重试'
                if (res.retcode === -30004) msg = '声音太小，请重试'
                // -30012 超时静默
                if (res.retcode !== -30012) {
                    options.onError?.(msg)
                }
            }
            // #endif
        }
        return manager
    }

    function start() {
        const m = getManager()
        if (!m) {
            options.onError?.('语音插件不可用')
            return
        }
        // #ifdef MP-WEIXIN
        uni.getSetting({
            success(res) {
                if (!res.authSetting['scope.record']) {
                    uni.authorize({
                        scope: 'scope.record',
                        success() { m.start({ duration: 30000, lang: 'zh_CN' }) },
                        fail() { options.onError?.('需要录音权限') },
                    })
                } else {
                    m.start({ duration: 30000, lang: 'zh_CN' })
                }
            },
        })
        // #endif
    }

    function stop() {
        if (state.value !== 'recording') return
        state.value = 'recognizing'
        getManager()?.stop()
    }

    function toggle() {
        if (state.value === 'idle') {
            start()
        } else if (state.value === 'recording') {
            stop()
        }
    }

    return { state, toggle, start, stop }
}
