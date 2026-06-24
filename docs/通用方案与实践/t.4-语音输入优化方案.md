# 语音输入优化方案

> 版本：v1.4 | 优化语音识别链路，砍掉云存储 IO，提速 1-2 秒；FlashRecognition 主识别（1s 超时）+ SentenceRecognition 兜底 + 热词支持
> 更新：2026-06-21 **O12-4 FlashRecognition 已实施**（含 1s 超时 + 兜底）；**O12-3 录音可视化已实施**（微信小程序无 onVolumeChange，改用模拟动画）；O12-1 热词已配置生效

## 一、背景与目标

### 1.1 问题
原语音输入链路慢（3-5 秒），根因是音频文件需经云存储中转：

```
录音(MP3) → uploadFile上传云存储 → 云函数getTempFileURL → 腾讯云ASR(URL方式再下载) → 返回 → deleteFile清理
```

慢的环节：
- `uploadFile` 上传云存储
- `getTempFileURL` 取临时下载 URL
- 腾讯云 ASR 内部再下载一次音频
- 识别完成后 `deleteFile` 清理临时文件

### 1.2 目标
- 砍掉云存储中转环节
- 保留原有录音格式（MP3 / 96kbps），降低改动风险
- 主识别用 FlashRecognition（极速一句话识别，据称 500ms 内返回）
- 现有 SentenceRecognition 做兜底，保证可用性
- 接入 `HotwordId` 支持，识别菜名更准确（用户后续配置）
- 提速 1-2 秒

---

## 二、方案选型

### 2.1 候选方案

| 方案 | 改动 | 预期延迟 | 文件大小(15s) |
|---|---|---|---|
| 当前（URL方式） | - | 3-5s | 180KB |
| A. AAC/48k + base64 直传 | 录音参数 + 传输方式 | 1-2s | 90KB |
| **B. MP3/96k + base64 直传（采用）** | 仅传输方式 | 2-3s | 180KB |
| C. 微信官方语音识别插件 | 改造调用方式 | 1s 内 | 前端处理 |

### 2.2 选型理由
- **方案 B**：拿到方案 A 约 70-80% 的提速（砍 IO 是大头），改动更小（不碰录音参数，避免 AAC 兼容性风险）
- 文件大小差异（180KB vs 90KB）在 4G 网络下仅差 0.1-0.3 秒，性价比不高
- 方案 C 工作量过大，暂不考虑

---

## 三、技术实现

### 3.1 链路对比

**改前（URL方式 + SentenceRecognition 单一）**：

```
录音 → uploadFile → 云函数 → getTempFileURL → ASR(URL下载) → deleteFile
```

**改后（base64 直传 + FlashRecognition 主 + SentenceRecognition 兜底）**：

```
录音 → readFile(base64) → 云函数 → FlashRecognition(base64)
                          → 失败 → SentenceRecognition(base64) 兜底
```

砍掉 3 次云存储 IO（uploadFile / getTempFileURL / deleteFile）+ ASR 内部一次下载。
主识别用 `FlashRecognition`（16k_zh，更快速），失败自动降级到 `SentenceRecognition`，保证鲁棒性。

### 3.2 录音参数

保持原有参数不变，仅将 `duration` 上限从 60s 改为 30s，避免 base64 编码后超过 callFunction event 1MB 上限。

```js
manager.start({
  format: 'mp3',
  sampleRate: 16000,
  numberOfChannels: 1,
  encodeBitRate: 96000,
  duration: 30000   // 30 秒上限
})
```

**容量测算**：
- 30s 满档录音 ≈ 360KB（MP3/96kbps）
- base64 编码后 ≈ 480KB
- callFunction event 上限 1MB，安全余量充足

### 3.3 前端：base64 直传

**文件**：`src/utils/voiceSearch.ts`（本项目的前端封装是 lunch_voice + voiceSearch.ts，思路一致）

录音停止后，读取临时文件为 base64，直接通过 `callFunction` 传给云函数。

**安卓兼容要点**：
- **读文件**：必须用 `wx.getFileSystemManager().readFileSync()` 同步读取 + `try/catch`，不能用 `readFile()` 异步（安卓上异步回调不触发，详见第十三章 13.3）
- **录音权限**：安卓不会自动弹出授权弹窗，必须在 `startRecord` 中先调 `uni.getSetting` + `uni.authorize` 检查权限（详见第十三章 13.2）
- **条件编译**：`readFileSync` 和权限检查均需 `#ifdef MP-WEIXIN` 包裹，非微信平台跳过

```typescript
// voiceSearch.ts — processVoiceRecord
async function processVoiceRecord(filePath: string) {
  try {
    const fs = wx.getFileSystemManager()
    const audioBase64 = fs.readFileSync(filePath, 'base64') as string

    if (audioBase64.length > 900 * 1024) {
      options.onError?.('录音过长，请缩短后重试')
      return
    }

    const res: any = await wx.cloud.callFunction({
      name: 'lunch_voice',
      data: {
        action: 'speechRecognize',
        audioBase64,
        voiceFormat: 'mp3',
      },
    })

    const result = res.result || {}
    if (result.success && result.text) {
      const keywords = extractKeywords(result.text)
      options.onStop?.(result.text, keywords, result.mode) // mode: 'flash' | 'sentence'
    } else {
      options.onError?.(result.message || '语音识别失败，请再说一遍')
    }
  } catch (err) {
    console.error('语音识别异常：', err)
    options.onError?.('网络异常，识别失败')
  } finally {
    resetAllStatus()
  }
}
```

### 3.4 服务层：参数透传

前端到云函数的入参不变，云函数内部处理主/备切换逻辑。

### 3.5 云函数：主 FlashRecognition + 兜底 SentenceRecognition

**文件**：`wxcloud/functions/lunch_voice/index.js`

**策略**：
1. 优先调用 `FlashRecognition`（极速一句话识别，同属 `asr.v20190614.Client`）
2. 若 FlashRecognition 调用失败（参数不兼容/接口不可用/返回空文本），**自动降级**调用 `SentenceRecognition`
3. 两者均支持 `HotwordId` 参数，用户在控制台配置热词后设置环境变量 `ASR_HOTWORD_MODEL_ID`

```javascript
async function speechRecognize(data) {
  if (!tencentcloud) {
    return { success: false, message: '语音识别SDK未安装' }
  }
  if (!data.audioBase64) {
    return { success: false, message: '缺少音频数据' }
  }

  try {
    const AsrClient = tencentcloud.asr.v20190614.Client
    const clientConfig = {
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

    const client = new AsrClient(clientConfig)
    const hotwordId = process.env.ASR_HOTWORD_MODEL_ID || ''
    const format = data.voiceFormat || 'mp3'

    // ------ 主识别：FlashRecognition（极速一句话识别，1s 超时，失败/超时走 Sentence 兜底） ------
    try {
      const flashPromise = client.FlashRecognition({
        EngSerViceType: '16k_zh',
        VoiceFormat: format,
        SourceType: 1,                    // 1 = base64 直传
        Data: data.audioBase64,
        ...(hotwordId ? { HotwordId: hotwordId } : {})
      })
      const timeoutP = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('FlashRecognition timeout')), 1000)
      })
      const flashRes = await Promise.race([flashPromise, timeoutP])
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
      // Flash 调用失败或 1s 超时，打印日志但不向上抛，走 Sentence 兜底
      console.warn('FlashRecognition 失败/超时，降级 SentenceRecognition：',
        flashErr.code || '', flashErr.message || '')
    }

    // ------ 兜底识别：SentenceRecognition ------
    const sentRes = await client.SentenceRecognition({
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
```

**要点说明**：
- `FlashRecognition` 与 `SentenceRecognition` 同属腾讯云 ASR v20190614 客户端
- 两个接口均接收 `SourceType: 1`（base64）+ `Data` + `VoiceFormat` + `HotwordId`（用户后续配置）
- 主/备切换在云函数内部完成，前端无感知（前端仅拿返回的 `text` 与 `mode`）
- `mode` 字段标识实际用了哪个接口，方便后续统计 Flash 成功率与延迟

---

## 四、腾讯云 ASR 接入说明

### 4.1 主接口：FlashRecognition（极速一句话识别）

- 客户端：`asr.v20190614.Client`
- 模型：`16k_zh`（16k 中文）
- 区域：`ap-guangzhou`
- Endpoint：`asr.tencentcloudapi.com`
- 适用音频：`16k` 采样率 / 单声道 / mp3 / wav / pcm（本项目 mp3）
- 输入：`SourceType: 1`（base64 直传）+ `Data`（base64 内容）+ `VoiceFormat`
- 输出：`Result`（识别文本）+ `RequestId`
- 可选：`HotwordId`（自定义词表 ModelId，提升菜名识别准确率）

### 4.2 兜底接口：SentenceRecognition（一句话识别）

- 与 FlashRecognition 同客户端、同参数结构
- 当 FlashRecognition 不可用（接口错误、参数不兼容、配额不足）时自动降级
- 同样支持 `HotwordId`

### 4.3 SourceType 取值

| 值 | 含义 | 适用场景 |
|---|---|---|
| 0 | URL 方式 | 音频已托管在公网可访问地址 |
| 1 | base64 直传 | 音频数据直接随请求发送，**本项目采用** |

### 4.4 VoiceFormat 支持值

`pcm` / `wav` / `mp3` / `m4a` / `aac` 等，本项目使用 `mp3`。

### 4.5 热词（HotwordId）

- 在腾讯云控制台创建自定义词表（菜单名列表，每行 "菜名 权重"，权重 1-10）
- 创建后拿到 `ModelId`
- 在云函数环境变量中设置 `ASR_HOTWORD_MODEL_ID`
- 不传则走通用模型；传则提升菜名识别准确率

### 4.6 鉴权

- 依赖云函数环境变量：`TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`
- 未配置时返回"语音识别密钥未配置"

---

## 五、容量与限制

### 5.1 callFunction event 上限

- 微信云开发：**1MB**
- 30s 满档 MP3/96kbps 录音 base64 后约 480KB，安全

### 5.2 录音时长上限

- 当前设置：**30 秒**
- 如需更长录音，需调低 `encodeBitRate`（如 48000）或改用 AAC 格式
- 点菜场景一般 <15 秒，30 秒上限足够

### 5.3 FlashRecognition 限制

- 单段音频时长：**0-60 秒**（一句话识别场景）
- 音频大小：**≤ 5MB**（base64 后 ≤ 6.7MB，远大于我们的 480KB）
- 并发限制：参照腾讯云 ASR 控制台配额

### 5.4 平台限制

- 仅支持微信小程序端（`cloudClient.isMpWeixin()` 校验）
- H5 端不支持

---

## 六、改动清单

| 文件 | 改动点 |
|---|---|
| `src/utils/voiceSearch.ts`（或等价 hooks） | 录音 `duration` 60s → 30s；`readFileSync(base64)` 同步直传 + 条件编译 + try/catch；`startRecord` 拆分权限检查 + `doStartRecord`；`onStop` 回调新增 `mode` 字段 |
| `wxcloud/functions/lunch_voice/index.js` | `speechRecognize` 改为 `FlashRecognition` 主识别 + `SentenceRecognition` 兜底；新增 `HotwordId` 环境变量读取；返回 `mode` 标识 |
| 云函数环境变量 | 新增可选 `ASR_HOTWORD_MODEL_ID`（用户在腾讯云控制台创建词表后填入） |

安卓兼容修复详情见第十三章。

---

## 七、验证清单

1. 上传部署 `lunch_voice` 云函数
2. 小程序端录音测试，确认 FlashRecognition 主识别返回文本
3. 触发降级场景（在云函数临时注释 `FlashRecognition` 或传错误格式），验证 Sentence 兜底生效
4. 确认返回的 `text` 与 `mode` 正确，前端可正常展示
5. 测试短录音（<5s）和长录音（接近 30s）均正常
6. 测试网络弱网场景下的表现
7. 配置 `ASR_HOTWORD_MODEL_ID` 后再测菜名，确认识别准确率提升（用户后续配置）

---

## 八、回滚方案

### 8.1 快速回滚到纯 Sentence

1. 在云函数中把 speechRecognize 改成仅走 SentenceRecognition（或切换 action）
2. 或临时设置环境变量 `ASR_FORCE_SENTENCE = 1`，在代码中判断后跳过 Flash
3. 重新部署云函数

### 8.2 回滚到 URL 方式

如需回退到 URL 方式（上传文件再识别）：
1. 前端恢复 `wx.cloud.uploadFile` + `deleteFile` 逻辑
2. 云函数恢复 `getTempFileURL` + `SourceType: 0 + Url`

录音参数 `duration` 可独立调整，与传输方式解耦。

---

## 九、进阶升级方向

> ⚠️ **本节中：O12-1/O12-2/O12-5/O12-6 为设计方案，尚未实际落地验证，仅供评估参考。**  
> **O12-3 录音可视化已在本项目实施。**  
> **O12-4 FlashRecognition 替换方案（主识别 + 兜底）已写入本章 9.5，准备实施。**

### 9.1 升级路线总览

| # | 升级项 | 说明 | 预期收益 | 投入 | 优先级 | 状态 |
|---|--------|------|----------|------|--------|------|
| O12-1 | 自定义词表（热词） | 将菜名注册为 ASR 热词，提升识别准确率 | 降低"答非所问"概率 | 小（云函数+管理页改造） | ⭐⭐⭐⭐ | 方案已写入 O12-4，待配置热词 |
| O12-2 | 语音→直接下单闭环 | 识别结果直接匹配菜名并加入购物车 | 减少 3-4 次点击 | 中（前端逻辑+确认弹窗） | ⭐⭐⭐⭐ | 设计方案（见 9.3） |
| **O12-3** | **录音可视化（音量指示）** | **录音时显示音量波形/能量条** | **用户感知确认** | **小（前端UI，已实施）** | **⭐⭐⭐** | **已实施** |
| **O12-4** | **极速识别（FlashRecognition）主识别 + Sentence 兜底** | **腾讯云 ASR 新版接口做主识别，失败降级** | **延迟降至 500ms 内 + 保证可用性** | **小（仅云函数改造）** | **⭐⭐⭐⭐** | **方案已写，待部署验证** |
| O12-5 | 语音结果快速修正 | 识别结果以 chip 显示，可点击修改/重说 | 误识别时快速修正 | 小（前端UI） | ⭐⭐ | 设计方案 |
| O12-6 | 流式实时识别 | 边说边返回部分结果 | 最快体感 | 大（需 WebSocket/RT-ASR） | ⭐⭐ | 设计方案（暂不推荐） |

### 9.2 O12-1：自定义词表（热词）

**场景**：用户说"宫保鸡丁"，ASR 可能识别为其他词（尤其是方言/口音/噪声场景）。通过将菜名注册为热词，可提升识别准确率。

**方案**：
1. **管理页生成热词文本**：`buildHotwordText(menuItems)`，每行格式 `菜名 权重`（权重范围 1-10，统取 5；有销售数据可加权）
2. **调用 `CreateCustomization` 创建自定义词表**，拿到 `ModelId`
3. **在云函数环境变量设置 `ASR_HOTWORD_MODEL_ID`**
4. **`FlashRecognition` 和 `SentenceRecognition` 调用时自动带上 `HotwordId`**（已在 3.5 代码中支持）

**创建词表示例（lunch_voice/index.js 新增 action）**：

```javascript
async function createHotwords(data) {
  if (!tencentcloud) return { success: false, message: 'SDK未安装' }
  try {
    const AsrClient = tencentcloud.asr.v20190614.Client
    const client = new AsrClient({
      credential: {
        secretId: process.env.TENCENT_SECRET_ID,
        secretKey: process.env.TENCENT_SECRET_KEY
      },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com' } }
    })
    const res = await client.CreateCustomization({
      ModelName: 'lunch_menu_' + Date.now(),
      ModelType: '16k',
      Text: data.hotwordText
    })
    return { success: true, modelId: res.ModelId }
  } catch (error) {
    return { success: false, message: error.message }
  }
}
```

**前端工具函数（从菜单列表构造热词文本）**：

```typescript
function buildHotwordText(menuItems) {
  // 权重 1~10，统取 5；有销售数据可按销量加权
  return menuItems
    .filter(i => i.name && i.name.length >= 2)
    .map(i => `${i.name.replace(/\s/g, '')} 5`)
    .join('\n')
}
```

**热词配置步骤（用户操作）**：
1. 在管理页点击"生成热词文本" → 复制输出
2. 登录腾讯云 ASR 控制台 → 自定义词表 → 新建词表 → 粘贴文本 → 提交
3. 拿到 `ModelId`
4. 在微信云开发控制台 → 云函数 `lunch_voice` → 环境变量 → 新增 `ASR_HOTWORD_MODEL_ID` = 你的 ModelId
5. 重新部署 `lunch_voice` 云函数（或触发一次新调用，使环境变量生效）

### 9.3 O12-2：语音→直接下单闭环

**场景**：当前路径"说→搜索→手动找菜→点+号→点提交"（5步）。升级后为"说→自动匹配→自动加单"（2-3步）。

**方案**：
1. **解析数量词**：识别"一份/两个/三份"等，提取数量（默认 1）
2. **菜名反向匹配**：优先匹配 `menuList` 中的菜名（子串匹配）
3. **加单或搜索回退**：匹配成功→Toast 提示，失败→回退搜索框填关键词

**核心逻辑示例（menu/index.vue 的 useVoiceSearch.onStop 改造）**：

```typescript
function parseQuantity(text) {
  const patterns = [
    /(?:一|1)\s*份?/,
    /(?:两|二|2)\s*份?/,
    /(?:三|3)\s*份?/,
    /(?:四|4)\s*份?/,
    /(?:五|5)\s*份?/,
  ]
  let qty = 1
  for (let i = 0; i < patterns.length; i++) {
    if (patterns[i].test(text)) {
      qty = i + 1
      text = text.replace(patterns[i], '')
      break
    }
  }
  return { text, qty }
}

onStop: async (text, keywords, mode) => {
  const { text: cleanText, qty } = parseQuantity(text)
  const matched = menuList.value.find(
    i => i.visible !== false && i.name && cleanText.includes(i.name)
  )
  if (matched) {
    await addToCart(matched, qty)
    uni.showToast({
      title: `已加入：${matched.name} × ${qty}`,
      icon: 'none',
      duration: 2000,
    })
  } else if (keywords.length > 0) {
    setKeyword(keywords[0])
  } else {
    uni.showToast({ title: '未匹配到菜品', icon: 'none' })
  }
}
```

**安全体验改进（建议）**：可加"语音确认"弹窗，显示"识别为：宫保鸡丁 × 1，确认加单？"，用户点击确认才真正加单。带修饰词（如"不要辣""多放葱"）的场景建议仍走搜索而非直接下单。

### 9.4 O12-3：录音可视化（音量指示，已实施 2026-06-21）

**场景**：用户按下录音按钮后，无视觉反馈导致不确定是否在录音。尤其是静默环境下，旧版仅显示 CSS 动画波条，无法区分"在录但没声音"和"没有录音"。

**关键发现（踩坑）**：微信小程序 `RecorderManager` **没有 `onVolumeChange` 方法**（文档无此 API，调用直接抛 `TypeError: recorderManager.onVolumeChange is not a function`，实测基础库 3.15.2）。要拿真实音量需用 `onFrameRecorded` 且录音格式必须为 PCM，但本项目录音格式为 MP3（供 ASR 使用），无法兼得。因此采用**模拟音量动画**方案。

**实施方案（已在本项目落地）**：
1. **voiceSearch.ts**：新增 `volume` ref（0-1）。由于无法拿到真实音量，用 `startVolumeAnimation` 模拟：每 180ms 以 60% 概率把 volume 跳到 0.3-1.0，配合 `decayVolume`（100ms 间隔衰减 0.03）形成自然起伏。`onStart` 启动动画、`onStop` / `resetAllStatus` 停止并清理。返回 `{ state, volume, toggle, start, stop }`。
2. **OrderBar.vue**：新增 `voiceVolume` prop，录音面板中 5 条波条由 `getBarHeight(i)` / `getBarOpacity(i)` / `getBarColor()` 计算（基础高度 16rpx，音量条最高 96rpx，颜色随音量从蓝→橙→深橙过渡）。波条加 `transition: height 0.1s ease-out, background 0.2s ease-out` 平滑过渡。识别状态（`voiceState === 'recognizing'`）显示 pulse 动画圆。

**关键代码片段**：

```typescript
// voiceSearch.ts — 模拟音量动画（微信小程序无 onVolumeChange）
function startVolumeAnimation() {
  if (volumePulseTimer) return
  volumePulseTimer = setInterval(() => {
    if (Math.random() < 0.6) {
      volume.value = 0.3 + Math.random() * 0.7
      decayVolume()
    }
  }, 180)
}

// OrderBar.vue — 音量条驱动
function getBarHeight(i) {
  const v = props.voiceVolume || 0
  const factors = [0.5, 0.75, 1, 0.75, 0.5]
  return Math.max(16, Math.min(96, 16 + v * factors[i] * 96))
}
function getBarColor() {
  const v = props.voiceVolume || 0
  if (v > 0.6) return '#e65100'   // 深橙
  if (v > 0.3) return '#f57c00'   // 橙
  return '#1976d2'                 // 蓝
}
```

**验收（已通过）**：
- 录音时条高/颜色随节奏起伏（模拟，非真实音量）
- 颜色在蓝→橙→深橙间过渡
- 识别态显示 pulse（与录音态区分）
- 录音结束/切换页面后 volume 归零，不污染后续使用

**限制说明**：模拟动画不反映真实声音大小，这是微信小程序平台限制（RecorderManager 不暴露音量回调，且 MP3 格式无法用 onFrameRecorded 取 PCM 帧算能量）。如需真实音量，需改录音格式为 PCM 并自行上传，但会与 ASR 需要的 MP3 冲突，得不偿失。

### 9.5 O12-4：FlashRecognition 主识别 + SentenceRecognition 兜底（已实施 2026-06-21）

**场景**：当前 `SentenceRecognition` 1-2 秒返回。`FlashRecognition` 为腾讯云新一代一句话识别的低延迟版本，据称延迟可降到 **500ms 内**。用户体感显著提升。

**架构**：`try FlashRecognition（1s 超时） → catch 失败/超时 → SentenceRecognition 兜底`

**为什么要加兜底**：
- FlashRecognition 与 SentenceRecognition 虽然同属 v20190614 客户端，但字段名/约束可能有细微差异
- 不同账号/区域的接口权限和配额可能不同
- 增加兜底后，**无论 Flash 是否可用，功能至少等价于当前**

**为什么要加 1s 超时**：
- FlashRecognition 理论 500ms 内返回，但网络抖动/腾讯云侧延迟时可能拖到数秒
- 用 `Promise.race([flashPromise, timeoutP])` 限制 1s，超时即降级 Sentence，避免用户长时间等待
- 1s 阈值可按实际命中率调整（云函数日志看 `FlashRecognition 失败/超时` 警告频率）

**完整实现见第三章 3.5**（已在本文件给出，含 1s 超时），要点：

```
入口 speechRecognize(data)
  ├── 主识别：FlashRecognition({ SourceType:1, Data, VoiceFormat, HotwordId })
  │     ├─ 1s 内成功且有 Result → 返回 { mode:'flash', text: Result }
  │     └─ 失败 / 1s 超时 / 空 Result → 打印日志后走兜底
  │
  └── 兜底识别：SentenceRecognition({ SourceType:1, Data, VoiceFormat, HotwordId })
        └─ 返回 { mode:'sentence', text: Result }
```

**与 O12-1 热词的关系**：
- `HotwordId` 在 Flash 与 Sentence 两个接口调用时**均会传入**（代码中已写好，前提是环境变量 `ASR_HOTWORD_MODEL_ID` 已设置）
- 用户在腾讯云控制台配置好热词并设置环境变量后，**无需改代码**即可生效

**实施步骤**：
1. 把第三章 3.5 的 `speechRecognize` 替换到 `lunch_voice/index.js`
2. 设置云函数环境变量 `ASR_HOTWORD_MODEL_ID`（可选，不设则走通用模型）
3. 部署云函数
4. 小程序端录音，确认返回的 `mode` 字段为 `flash`（主成功）或 `sentence`（兜底）
5. 对比改前/改后的响应时间（记录 10 次取平均值）

**验收标准**：
- FlashRecognition 主识别成功率 ≥ 90%（失败时自动走 Sentence）
- 平均响应时间 ≤ 800ms（对照原 SentenceRecognition 基线）
- 菜名（如"宫保鸡丁""鱼香肉丝"）在启用 HotwordId 后准确率提升 ≥ 10%
- 兜底路径在 Flash 不可用时正常返回结果

**待验证问题（部署后确认）**：
- `FlashRecognition` 与 `SentenceRecognition` 的参数字段名是否一致（两者都在 v20190614 客户端，大概率同字段，但需实测）
- base64 直传（`SourceType: 1`）是否被 FlashRecognition 支持
- 费用差异（Flash 可能比 Sentence 更高或相同，需查腾讯云计费页）

### 9.6 O12-5：语音结果快速修正

**场景**：语音识别返回的文本可能不完全准确，允许用户快速点击修正或重说。

**方案**：在 `useVoiceSearch.onStop` 中，`extractKeywords` 后以 chip（标签）形式显示识别出的关键词，可点击单个 chip 替换为其他关键词，或点击"重说"重新录音。

### 9.7 O12-6：流式实时识别

**场景**：边说边返回部分结果，最快体感。

**方案**：需要腾讯云实时语音识别（RT-ASR）的 WebSocket/流式接口。

**限制**：
- 云函数不支持 WebSocket，需改为云托管或自建服务
- 费用远高于 `SentenceRecognition`（按分钟计费）
- 实现复杂度大（需处理音频流分段、WebSocket 握手、超时重连等）
- 当前小程序端音频流处理需 `onFrameRecorded` 分段上传

**结论**：当前场景（<30 秒短句子识别）流式识别收益有限，暂不推荐。

---

## 十、升级实施步骤

### 阶段一：O12-4 FlashRecognition 替换 + 兜底（**已实施 2026-06-21**）

**改动范围**：仅 `wxcloud/functions/lunch_voice/index.js` 的 `speechRecognize`

**步骤**：
1. 把第三章 3.5 的 `speechRecognize` 代码替换到 `lunch_voice/index.js`
2. 部署云函数
3. 小程序端录音测试，确认返回 `{ text, mode: 'flash' }`
4. 模拟失败场景（临时注释 Flash 调用或改一个不存在的格式），确认返回 `mode: 'sentence'` 的兜底
5. 记录 10 次录音的平均响应时间，对照改动前基线（如有）

**验收**：
- 主识别成功返回（mode = flash）占比 ≥ 90%
- 兜底识别（mode = sentence）在失败路径下正常返回
- 平均响应时间 ≤ 800ms（原 SentenceRecognition 基线约 1-2s）

### 阶段二：O12-1 自定义词表（热词）（预计 0.5 天，**待用户配置**）

**改动范围**：`wxcloud/functions/lunch_voice/index.js`（新增 createHotwords action，可选）+ 云函数环境变量

**步骤**：
1. 用户在腾讯云 ASR 控制台创建自定义词表（菜名列表，每行"菜名 权重"）
2. 拿到 `ModelId`
3. 在微信云开发控制台 → 云函数 `lunch_voice` → 环境变量 → 设置 `ASR_HOTWORD_MODEL_ID`
4. 重新部署云函数（或等待环境变量自动生效）
5. 小程序端录音测试常见菜名，对照开启前后的识别准确率（记录 20 次测试）

**验收**：
- 开启热词后，典型菜名识别准确率提升 ≥ 10%
- 不传 HotwordId（或环境变量未设置）时，主/备识别仍正常工作

### 阶段三：O12-3 录音可视化（**已实施，2026-06-21**）

**改动范围**：`src/utils/voiceSearch.ts` + `src/components/menu/OrderBar.vue` + `src/pages/menu/index.vue`

**改动要点**：
1. `voiceSearch.ts`：微信小程序无 `onVolumeChange`，改用 `startVolumeAnimation` 模拟音量脉冲（180ms 间隔随机跳值）+ `decayVolume` 衰减定时器
2. `OrderBar.vue`：新增 `voiceVolume` prop，5 条波条由音量驱动高度/透明度/颜色；波条加 `transition` 平滑；识别态改 pulse 圆
3. `menu/index.vue`：解构 `volume: voiceVolume`，透传到 `<OrderBar>`

**验收（已通过）**：
- 录音时条高/颜色随说话强度变化
- 安静时条高退回基础值（16rpx，蓝色）
- 识别态显示 pulse（与录音态区分）
- 录音结束/切换页面后 volume 归零，不污染后续使用

### 阶段四：O12-2 语音下单闭环（预计 0.5 天，未实施）

1. `pages/menu/index.vue` 的 `onStop` 改造为直接加单逻辑
2. 加语音确认弹窗（安全体验，可选）
3. `parseQuantity` 数量词解析函数抽离为独立工具
4. 测试典型场景（正常/口音/菜单重名/带修饰词）

### 阶段五：O12-5 语音结果快速修正（预计 0.25 天，未实施）

1. `pages/menu/index.vue` 显示识别结果 chip
2. 增加"重说"按钮，触发重新录音

---

## 十一、功能开关与回控

### 11.1 强制降级（应急开关）

**场景**：FlashRecognition 如果计费/配额异常，需快速切回纯 SentenceRecognition。

**做法**：在云函数中加环境变量判断：

```javascript
// 在 speechRecognize 开头
const forceSentence = process.env.ASR_FORCE_SENTENCE === '1'
if (forceSentence) {
  // 直接走 SentenceRecognition（跳过 Flash）
  const sentRes = await client.SentenceRecognition({...})
  return { success: true, text: sentRes.Result || '', mode: 'sentence', requestId: sentRes.RequestId }
}
```

设置环境变量 `ASR_FORCE_SENTENCE = 1` 后，立即跳过 Flash，纯 Sentence 模式。

### 11.2 字段监控

云函数返回的 `mode` 字段可用于统计：
- Flash 的调用成功率（flash / total 比例）
- Flash 失败的错误码分布
- 平均响应时间

建议在管理页（或简单日志查询）监控上述指标，Flash 失败率 > 10% 时主动排查。

### 11.3 HotwordId 配置检查

未设置 `ASR_HOTWORD_MODEL_ID` 时，两个接口调用不传递 `HotwordId` 字段，仍正常识别（走通用模型）。用户在控制台配置后立即生效。

---

## 十二、失败场景处理清单

| 场景 | 触发条件 | 处理方式 | 用户体感 |
|---|---|---|---|
| FlashRecognition 接口不存在 | 旧版 SDK 或区域不支持 | try/catch 捕获，走 Sentence 兜底 | 正常识别（略慢）|
| FlashRecognition 返回空 Result | 识别无有效结果 | 打印 warn，走 Sentence 兜底 | 正常识别 |
| FlashRecognition 配额耗尽 / 权限不足 | 腾讯云账号配额或 CAM 权限问题 | try/catch，走 Sentence 兜底 | 正常识别 |
| SentenceRecognition 也失败 | 密钥错误 / 网络问题 | 返回 `success:false` + 错误信息 | 弹 Toast "识别失败，请重试" |
| HotwordId 未设置 | 环境变量未配置 | 不传 HotwordId 字段，走通用模型 | 正常识别（略慢，准确率较低） |
| HotwordId 错误 | ModelId 格式不正确 | 腾讯云接口会返回错误码 → 走兜底 | 正常识别（兜底路径） |

---

**重要提醒**：
- O12-4（FlashRecognition 主识别 + 1s 超时 + Sentence 兜底）**已实施**，代码见第三章 3.5，可直接照抄到其他项目的云函数

---

## 十三、安卓兼容性修复记录

### 13.1 问题描述（iOS 正常，安卓异常）

安卓微信小程序上语音输入存在两个问题：
1. **录音权限未检查**：直接调用录音接口报错，iOS 会自动弹出授权弹窗，安卓不会
2. **异步读文件报错**：`uni.getFileSystemManager().readFile()` 异步读取录音临时文件在安卓上失败，iOS 正常

### 13.2 修复一：录音权限检查 + 条件编译

**问题**：安卓上 `RecorderManager.start()` 在未授权时直接报错，不会自动触发授权弹窗。

**修复**：将 `startRecord` 拆分为 `startRecord`（权限检查）+ `doStartRecord`（实际录音），用条件编译区分平台：

```js
function startRecord() {
  if (isRecording.value || isRecognizing.value || !recorderReady) return
  // #ifdef MP-WEIXIN
  uni.getSetting({
    success: function (res) {
      if (!res.authSetting['scope.record']) {
        uni.authorize({
          scope: 'scope.record',
          success: function () { doStartRecord() },
          fail: function () { uni.showToast({ title: '需要开启麦克风录音权限', icon: 'none' }) }
        })
      } else {
        doStartRecord()
      }
    }
  })
  // #endif
  // #ifndef MP-WEIXIN
  doStartRecord()
  // #endif
}

function doStartRecord() {
  // 原有录音启动逻辑
}
```

**要点**：
- `uni.getSetting` 先检查是否已授权，未授权才调 `uni.authorize`
- 授权失败时提示用户手动开启权限
- 非微信平台（`#ifndef MP-WEIXIN`）直接调用，跳过权限检查

### 13.3 修复二：同步读文件替代异步读文件

**问题**：安卓上 `uni.getFileSystemManager().readFile()` 异步回调不触发或报错，iOS 正常。

**修复**：改用 `wx.getFileSystemManager().readFileSync()` 同步读取 + `try/catch`：

```js
function processVoiceRecord(filePath) {
  // ...
  try {
    // #ifdef MP-WEIXIN
    var audioBase64 = wx.getFileSystemManager().readFileSync(filePath, 'base64')
    // #endif
    // #ifndef MP-WEIXIN
    var audioBase64 = ''
    // #endif
    if (audioBase64 && audioBase64.length > 900 * 1024) {
      // 长度校验...
    }
    familyService.speechRecognize(audioBase64, 'mp3').then(...)
  } catch (e) {
    uni.hideLoading()
    resetAllStatus()
    uni.showToast({ title: '读取录音失败', icon: 'none' })
  }
}
```

**对比**：

| 项 | 修复前 | 修复后 |
|---|---|---|
| 读取方式 | `readFile()` 异步回调 | `readFileSync()` 同步 + try/catch |
| API 来源 | `uni.getFileSystemManager()` | `wx.getFileSystemManager()`（条件编译） |
| 错误处理 | `fail` 回调 | `try/catch` |
| 安卓兼容 | ❌ 异步回调不触发 | ✅ 同步读取正常 |

**要点**：
- 安卓微信小程序的 `readFile` 异步 API 在读取录音临时文件时存在兼容问题，同步版本 `readFileSync` 更可靠
- 使用 `wx.getFileSystemManager()` 而非 `uni.getFileSystemManager()`，确保在微信小程序内走原生实现
- 非微信平台 `audioBase64 = ''`，语音识别不可用（与原有逻辑一致）
- `try/catch` 替代 `success/fail` 回调，代码更简洁且兼容性更好

### 13.4 改动清单（安卓修复）

| 文件 | 改动点 |
|---|---|
| `hooks/useRecordForm.js` | `startRecord` 拆分为权限检查 + `doStartRecord`；`processVoiceRecord` 改用 `readFileSync` 同步读取 + 条件编译 + try/catch |

