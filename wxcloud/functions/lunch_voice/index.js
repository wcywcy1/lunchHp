'use strict'

var cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

var tencentcloud = null
try { tencentcloud = require('tencentcloud-sdk-nodejs') } catch (e) {}

/**
 * 语音识别：调用腾讯云 ASR SentenceRecognition
 * 入参: { fileID, voiceFormat }
 * 出参: { success, text, message }
 */
async function speechRecognize(data) {
  if (!tencentcloud) {
    return { success: false, message: '语音识别SDK未安装' }
  }
  if (!data.fileID) {
    return { success: false, message: '缺少音频文件ID' }
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

    var fileRes = await cloud.getTempFileURL({ fileList: [data.fileID] })
    var audioUrl = ''
    if (fileRes.fileList && fileRes.fileList[0] && fileRes.fileList[0].tempFileURL) {
      audioUrl = fileRes.fileList[0].tempFileURL
    }
    if (!audioUrl) {
      return { success: false, message: '获取音频文件链接失败' }
    }

    var client = new AsrClient(clientConfig)
    var res = await client.SentenceRecognition({
      SourceType: 0,
      Url: audioUrl,
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
