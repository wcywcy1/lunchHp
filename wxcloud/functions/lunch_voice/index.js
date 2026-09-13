'use strict'

var cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
var db = cloud.database()
var _ = db.command

var tencentcloud = null
try { tencentcloud = require('tencentcloud-sdk-nodejs') } catch (e) {}

// 每日配额：同一 openid 每天最多 30 次 ASR 调用（控制按次计费成本）
var VOICE_DAILY_QUOTA = 30

// 简单速率限制：同一 openid 10 秒内最多 5 次（实例级内存）
var _rateMap = new Map()
function rateLimit(openid) {
  if (!openid) return true
  var now = Date.now()
  var windowMs = 10000
  var arr = (_rateMap.get(openid) || []).filter(function (t) { return now - t < windowMs })
  if (arr.length >= 5) return false
  arr.push(now)
  _rateMap.set(openid, arr)
  return true
}

var _usageEnsured = false
async function ensureUsageCollection() {
  if (_usageEnsured) return
  try { await db.createCollection('lunch_voice_usage') } catch (e) { /* 已存在 */ }
  _usageEnsured = true
}

// 每日配额检查并计数（北京时间日切）；配额表异常时放行，不阻断功能
async function checkDailyQuota(openid) {
  if (!openid) return true
  await ensureUsageCollection()
  var bj = new Date(Date.now() + 8 * 3600 * 1000)
  var today = bj.getUTCFullYear() + '-' + String(bj.getUTCMonth() + 1).padStart(2, '0') + '-' + String(bj.getUTCDate()).padStart(2, '0')
  var docId = openid + '_' + today
  var col = db.collection('lunch_voice_usage')
  var existing = null
  try {
    var res = await col.doc(docId).get()
    existing = res.data
  } catch (e) {
    existing = null // 首次调用，文档不存在
  }
  if (existing && existing.count >= VOICE_DAILY_QUOTA) return false
  try {
    if (existing) {
      await col.doc(docId).update({ data: { count: _.inc(1) } })
    } else {
      await col.doc(docId).set({ data: { count: 1, date: today } })
    }
  } catch (e) {
    console.warn('updateVoiceQuota error:', e && e.message)
  }
  return true
}

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

    // ------ 主识别：FlashRecognition（极速一句话识别，1s 超时，失败/超时走 Sentence 兜底） ------
    try {
      var flashPromise = client.FlashRecognition({
        EngSerViceType: '16k_zh',
        VoiceFormat: format,
        SourceType: 1,                    // 1 = base64 直传
        Data: data.audioBase64,
        ...(hotwordId ? { HotwordId: hotwordId } : {})
      })
      var timeoutP = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('FlashRecognition timeout')) }, 1000)
      })
      var flashRes = await Promise.race([flashPromise, timeoutP])
      if (flashRes && flashRes.Result) {
        return {
          success: true,
          text: flashRes.Result,
          mode: 'flash',
          requestId: flashRes.RequestId || ''
        }
      }
      // Flash 返回但 Result 为空，走兜底
      console.warn('FlashRecognition 返回空文本，降级 SentenceRecognition')
    } catch (flashErr) {
      // Flash 调用失败或超时，打印日志但不向上抛，走 Sentence 兜底
      console.warn('FlashRecognition 失败/超时，降级 SentenceRecognition：',
        flashErr.code || '', flashErr.message || '')
    }

    // ------ 兜底识别：SentenceRecognition ------
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
  var { OPENID } = cloud.getWXContext()
  var action = event.action
  if (action === 'speechRecognize') {
    if (!rateLimit(OPENID)) {
      return { success: false, message: '操作太频繁，请稍后再试' }
    }
    if (event.audioBase64) {
      var allowed = await checkDailyQuota(OPENID)
      if (!allowed) {
        return { success: false, message: '今日语音识别次数已用完（每天限' + VOICE_DAILY_QUOTA + '次）' }
      }
    }
    return speechRecognize(event)
  }
  return { success: false, message: '未知操作: ' + action }
}
