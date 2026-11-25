'use strict'

var cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
var db = cloud.database()
var _ = db.command

var tencentcloud = null
try { tencentcloud = require('tencentcloud-sdk-nodejs') } catch (e) {}

// 每日配额：同一 openid 每天最多 30 次 ASR 调用（控制按次计费成本）
var VOICE_DAILY_QUOTA = 30
// 客户端已限制 base64 ≤900KB，服务端再兜底一次，避免直接调用云函数传入超大 payload
var MAX_AUDIO_BASE64 = 900 * 1024
var FLASH_TIMEOUT_MS = 1000

// 简单速率限制：同一 openid 10 秒内最多 5 次（实例级内存）
var _rateMap = new Map()
function rateLimit(openid) {
  if (!openid) return false
  var now = Date.now()
  var windowMs = 10000
  var arr = (_rateMap.get(openid) || []).filter(function (t) { return now - t < windowMs })
  if (arr.length >= 5) return false
  arr.push(now)
  _rateMap.set(openid, arr)
  if (_rateMap.size > 10000) {
    for (var entry of _rateMap) {
      if (entry[1].every(function (t) { return now - t >= windowMs })) _rateMap.delete(entry[0])
    }
  }
  return true
}

var _usageEnsured = false
async function ensureUsageCollection() {
  if (_usageEnsured) return
  try { await db.createCollection('lunch_voice_usage') } catch (e) { /* 已存在 */ }
  _usageEnsured = true
}

// 每日配额原子递增（北京时间日切）；任何异常一律 fail-closed，避免按次计费失控
async function checkDailyQuota(openid) {
  if (!openid) return false
  await ensureUsageCollection()
  var bj = new Date(Date.now() + 8 * 3600 * 1000)
  var today = bj.getUTCFullYear() + '-' + String(bj.getUTCMonth() + 1).padStart(2, '0') + '-' + String(bj.getUTCDate()).padStart(2, '0')
  var docId = openid + '_' + today
  var col = db.collection('lunch_voice_usage')
  try {
    var updated = await col.where({ _id: docId, count: _.lt(VOICE_DAILY_QUOTA) })
      .update({ data: { count: _.inc(1) } })
    if (updated && updated.stats && updated.stats.updated === 1) return true
  } catch (e) {
    console.warn('updateVoiceQuota error:', e && e.message)
    return false
  }
  // 更新命中 0：文档不存在或配额已满。先确认是否已有记录。
  var existing = null
  try {
    existing = (await col.doc(docId).get()).data
  } catch (e) {
    existing = null // 首次调用，文档不存在
  }
  if (existing) return false
  // 首次建文档：用固定 _id add，并发首建只有一个成功，另一个走条件更新
  try {
    await col.add({ data: { _id: docId, count: 1, date: today } })
    return true
  } catch (e) {
    try {
      var retry = await col.where({ _id: docId, count: _.lt(VOICE_DAILY_QUOTA) })
        .update({ data: { count: _.inc(1) } })
      return !!(retry && retry.stats && retry.stats.updated === 1)
    } catch (retryErr) {
      console.warn('updateVoiceQuota error:', retryErr && retryErr.message)
      return false
    }
  }
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
  if (typeof data.audioBase64 !== 'string' || data.audioBase64.length > MAX_AUDIO_BASE64) {
    return { success: false, message: '录音过长，请缩短后重试' }
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
    var flashTimedOut = false
    try {
      var flashPromise = client.FlashRecognition({
        EngSerViceType: '16k_zh',
        VoiceFormat: format,
        SourceType: 1,                    // 1 = base64 直传
        Data: data.audioBase64,
        ...(hotwordId ? { HotwordId: hotwordId } : {})
      })
      var timer = null
      var timeoutP = new Promise(function (_, reject) {
        timer = setTimeout(function () {
          flashTimedOut = true
          reject(new Error('FlashRecognition timeout'))
        }, FLASH_TIMEOUT_MS)
      })
      var flashRes
      try {
        flashRes = await Promise.race([flashPromise, timeoutP])
      } finally {
        if (timer) clearTimeout(timer)
      }
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
      // 超时后不再发 Sentence，避免同一段音频产生两次 ASR 计费
      if (flashTimedOut) {
        return { success: false, message: '识别超时，请重试' }
      }
      // Flash 调用失败，打印日志但不向上抛，走 Sentence 兜底
      console.warn('FlashRecognition 失败，降级 SentenceRecognition：',
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
    if (!OPENID) return { success: false, code: 401, message: '请先登录' }
    if (!rateLimit(OPENID)) {
      return { success: false, message: '操作太频繁，请稍后再试' }
    }
    if (event.audioBase64 !== undefined && typeof event.audioBase64 !== 'string') {
      return { success: false, message: '音频格式无效' }
    }
    if (event.audioBase64 && event.audioBase64.length > MAX_AUDIO_BASE64) {
      return { success: false, message: '录音过长，请缩短后重试' }
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
