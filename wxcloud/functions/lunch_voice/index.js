'use strict'

var cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

var tencentcloud = null
try { tencentcloud = require('tencentcloud-sdk-nodejs') } catch (e) {}

/**
 * 语音识别：调用腾讯云 ASR SentenceRecognition
 * 入参: { audioBase64, voiceFormat }
 * 出参: { success, text, message }
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

    // SourceType=1 走 base64 直传，省掉 getTempFileURL + 腾讯外网拉音频两次往返
    // 注：新版 SDK 已废弃 Length 参数，由 SDK 内部根据 base64 自算
    var client = new AsrClient(clientConfig)
    var res = await client.SentenceRecognition({
      SourceType: 1,
      Data: data.audioBase64,
      EngSerViceType: '16k_zh',
      VoiceFormat: data.voiceFormat || 'mp3'
    })

    return {
      success: true,
      text: res.Result || '',
      requestId: res.RequestId || ''
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
