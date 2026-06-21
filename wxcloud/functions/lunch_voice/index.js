'use strict'

var cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

var tencentcloud = null
try { tencentcloud = require('tencentcloud-sdk-nodejs') } catch (e) {}

/**
 * 语音识别：FlashRecognition 主识别 + SentenceRecognition 兜底
 * 入参: { audioBase64, voiceFormat }
 * 出参: { success, text, mode, message, requestId }
 *   mode: 'flash' | 'sentence'，标识实际命中的接口
 * 环境变量:
 *   TENCENT_SECRET_ID / TENCENT_SECRET_KEY  腾讯云密钥
 *   ASR_HOTWORD_MODEL_ID                    可选，自定义词表 ModelId
 */
async function speechRecognize(data) {
  if (!tencentcloud) {
    return { success: false, message: '语音识别SDK未安装' }
  }
  if (!data.audioBase64) {
    return { success: false, message: '缺少音频数据' }
  }

  try {
    var AsrClient = tencentcloud.asr.v20190614.Client
    var clientConfig = {
      credential: {
        secretId: process.env.TENCENT_SECRET_ID || '',
        secretKey: process.env.TENCENT_SECRET_KEY || ''
      },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com' } }
    }

    if (!clientConfig.credential.secretId || !clientConfig.credential.secretKey) {
      return { success: false, message: '语音识别密钥未配置' }
    }

    var client = new AsrClient(clientConfig)
    var hotwordId = process.env.ASR_HOTWORD_MODEL_ID || ''
    var format = data.voiceFormat || 'mp3'

    // ------ 主识别：FlashRecognition（极速一句话识别） ------
    // TODO: Flash 调试未完成，暂时禁用，走 Sentence 兜底。调试好后取消注释即可启用。
    // try {
    //   var flashRes = await client.FlashRecognition({
    //     EngSerViceType: '16k_zh',
    //     VoiceFormat: format,
    //     SourceType: 1,                    // 1 = base64 直传
    //     Data: data.audioBase64,
    //     ...(hotwordId ? { HotwordId: hotwordId } : {})
    //   })
    //   if (flashRes && flashRes.Result) {
    //     return {
    //       success: true,
    //       text: flashRes.Result,
    //       mode: 'flash',
    //       requestId: flashRes.RequestId || ''
    //     }
    //   }
    //   // Flash 返回但 Result 为空，走兜底
    //   console.warn('FlashRecognition 返回空文本，降级 SentenceRecognition')
    // } catch (flashErr) {
    //   // Flash 调用失败（可能接口字段不兼容 / 权限 / 配额）
    //   // 打印日志但不向上抛，走 Sentence 兜底
    //   console.warn('FlashRecognition 调用失败，降级 SentenceRecognition：',
    //     flashErr.code || '', flashErr.message || '')
    // }

    // ------ 兜底识别：SentenceRecognition（Flash 禁用期间作为主识别） ------
    var sentRes = await client.SentenceRecognition({
      SourceType: 1,
      Data: data.audioBase64,
      EngSerViceType: '16k_zh',
      VoiceFormat: format,
      ...(hotwordId ? { HotwordId: hotwordId } : {})
    })

    return {
      success: true,
      text: sentRes.Result || '',
      mode: 'sentence',
      requestId: sentRes.RequestId || ''
    }
  } catch (error) {
    console.error('speechRecognize error:', error)
    return { success: false, message: '语音识别失败: ' + (error.message || '未知错误') }
  }
}

exports.main = async function (event, context) {
  var action = event.action
  if (action === 'speechRecognize') {
    return speechRecognize(event)
  }
  return { success: false, message: '未知操作: ' + action }
}
