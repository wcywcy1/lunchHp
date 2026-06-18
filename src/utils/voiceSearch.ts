import { ref } from 'vue'

// 停用词：这些词不作为筛选关键词
const STOP_WORDS = [
    '我要', '我想', '我说', '给我', '想吃', '想吃个',
    '吃', '喝', '来', '来个', '来份', '来一份',
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
    cleaned = cleaned.replace(/[，。！？、,.!?;:\s]+/g, ' ')
    for (const w of STOP_WORDS) {
        cleaned = cleaned.split(w).join(' ')
    }
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
 * 方案：原生录音(mp3) → 上传云存储 → 云函数调用腾讯云ASR → 返回文字
 */
export function useVoiceSearch(options: VoiceSearchOptions = {}) {
    const state = ref<VoiceState>('idle')
    let recorderManager: any = null
    let recordTempFilePath = ''
    let recorderReady = true
    let pendingStop = false

    function getRecorderManager(): any {
        if (!recorderManager) {
            // #ifdef MP-WEIXIN
            recorderManager = uni.getRecorderManager()
            recorderManager.onStop((res: any) => {
                recordTempFilePath = res.tempFilePath
                recorderReady = true
                // 必须依靠pendingStop判断是否是主动停止录音
                if (pendingStop) {
                    processVoiceRecord(recordTempFilePath)
                } else {
                    // 超时自动结束录音，直接重置状态
                    state.value = 'idle'
                    pendingStop = false
                }
            })
            recorderManager.onError(() => {
                resetAllStatus()
                options.onError?.('录音出错，请重试')
            })
            // #endif
        }
        return recorderManager
    }

    // 统一重置所有状态（新增复用函数，解决状态残留问题）
    function resetAllStatus() {
        state.value = 'idle'
        recorderReady = true
        pendingStop = false
        recordTempFilePath = ''
    }

    function start() {
        // 识别中禁止重复点击
        if (state.value !== 'idle' || !recorderReady) return
        // #ifdef MP-WEIXIN
        uni.getSetting({
            success(res) {
                if (!res.authSetting['scope.record']) {
                    uni.authorize({
                        scope: 'scope.record',
                        success() { doStart() },
                        fail() { options.onError?.('需要开启麦克风录音权限') },
                    })
                } else {
                    doStart()
                }
            },
        })
        // #endif
    }

    function doStart() {
        const manager = getRecorderManager()
        if (!manager) {
            options.onError?.('录音初始化失败')
            return
        }
        recorderReady = false
        recordTempFilePath = ''
        pendingStop = false
        state.value = 'recording'
        options.onStart?.()
        manager.start({
            format: 'mp3',
            sampleRate: 16000,
            numberOfChannels: 1,
            encodeBitRate: 96000,
            duration: 30000,
        })
    }

    function stop() {
        if (state.value !== 'recording') return
        state.value = 'recognizing'
        pendingStop = true // 恢复这一行，不能注释
        getRecorderManager()?.stop()
    }

    function toggle() {
        if (state.value === 'idle') {
            start()
        } else if (state.value === 'recording') {
            stop()
        }
    }

    async function processVoiceRecord(filePath: string) {
        try {
            // 1. 上传到云存储
            const cloudPath = 'voice/' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '.mp3'
            // #ifdef MP-WEIXIN
            const uploadRes: any = await wx.cloud.uploadFile({
                cloudPath,
                filePath,
            })

            // 2. 调用云函数识别
            const res: any = await wx.cloud.callFunction({
                name: 'lunch_voice',
                data: {
                    action: 'speechRecognize',
                    fileID: uploadRes.fileID,
                    voiceFormat: 'mp3',
                },
            })

            // 3. 清理临时文件
            wx.cloud.deleteFile({ fileList: [uploadRes.fileID] })

            const result = res.result || {}
            if (result.success && result.text) {
                const keywords = extractKeywords(result.text)
                options.onStop?.(result.text, keywords)
            } else {
                options.onError?.(result.message || '语音识别失败，请再说一遍')
            }
            // #endif
            // #ifndef MP-WEIXIN
            options.onError?.('仅微信小程序端支持语音识别')
            // #endif
        } catch (err) {
            console.error('语音识别异常：', err)
            options.onError?.('网络异常，识别失败')
        } finally {
            // 无论成功失败，最后统一重置全部状态
            resetAllStatus()
        }
    }

    return { state, toggle, start, stop }
}