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
    // 防抖处理锁，识别期间禁止重复点击
    let isProcessing = false

    // 彻底销毁录音实例，释放麦克风占用
    function destroyRecorder() {
        if (recorderManager) {
            try {
                recorderManager.stop()
                recorderManager.destroy()
            } catch (e) {
                console.warn('录音实例销毁提示：', e)
            }
            recorderManager = null
        }
    }

    // 一键重置全部状态标记
    function resetAllStatus() {
        state.value = 'idle'
        recorderReady = true
        pendingStop = false
        recordTempFilePath = ''
        isProcessing = false
    }

    function getRecorderManager(): any {
        // 每次新建录音前，先销毁上一次的实例，防止堆积阻塞
        destroyRecorder()
        // #ifdef MP-WEIXIN
        recorderManager = uni.getRecorderManager()

        recorderManager.onStop((res: any) => {
            recordTempFilePath = res.tempFilePath
            recorderReady = true

            if (pendingStop) {
                processVoiceRecord(recordTempFilePath)
            } else {
                // 超时自动结束录音，直接重置状态，不再走识别流程
                resetAllStatus()
            }
        })

        recorderManager.onError(() => {
            resetAllStatus()
            options.onError?.('录音出错，请重试')
        })
        // #endif
        return recorderManager
    }

    function start() {
        // 多重判断拦截：空闲状态 + 未处理中 + 录音就绪
        if (state.value !== 'idle' || !recorderReady || isProcessing) return

        // #ifdef MP-WEIXIN
        uni.getSetting({
            success(res) {
                if (!res.authSetting['scope.record']) {
                    uni.authorize({
                        scope: 'scope.record',
                        success() { doStart() },
                        fail() {
                            resetAllStatus()
                            options.onError?.('需要开启麦克风录音权限')
                        },
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
            resetAllStatus()
            options.onError?.('录音初始化失败')
            return
        }

        recorderReady = false
        recordTempFilePath = ''
        pendingStop = false
        isProcessing = true
        state.value = 'recording'
        options.onStart?.()

        manager.start({
            format: 'mp3',
            sampleRate: 16000,
            numberOfChannels: 1,
            encodeBitRate: 96000,
            duration: 15000, // 优化：单次最长录音15秒，避免长时间占用麦克风
        })
    }

    function stop() {
        if (state.value !== 'recording' || isProcessing) return
        state.value = 'recognizing'
        pendingStop = true
        getRecorderManager()?.stop()
    }

    function toggle() {
        // 识别中完全屏蔽点击，防止状态错乱
        if (state.value === 'recognizing' || isProcessing) return

        if (state.value === 'idle') {
            start()
        } else if (state.value === 'recording') {
            stop()
        }
    }

    async function processVoiceRecord(filePath: string) {
        try {
            // 1. 上传到云存储临时目录
            const cloudPath = 'voice/' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '.mp3'
            // #ifdef MP-WEIXIN
            const uploadRes: any = await wx.cloud.uploadFile({
                cloudPath,
                filePath,
            })

            // 2. 调用语音识别云函数
            const res: any = await wx.cloud.callFunction({
                name: 'lunch_voice',
                data: {
                    action: 'speechRecognize',
                    fileID: uploadRes.fileID,
                    voiceFormat: 'mp3',
                },
            })

            // 3. 识别完成立刻删除云存储音频文件，节省空间
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
            // 无论识别成功/失败，最后销毁实例、复位所有状态
            destroyRecorder()
            resetAllStatus()
        }
    }

    // 暴露停止方法，供页面onUnload调用，切页时强制关闭录音
    return { state, toggle, start, stop, destroyRecorder }
}