# 账单导入技术参考文档

> 本文档记录 family-ledger 项目账单导入功能的完整实现方案，供后续维护和扩展参考。
> 最后更新：2026-06-20

## 一、功能概览

支持从微信支付、支付宝导出的账单文件（CSV/Excel）批量导入记账记录，覆盖 H5 和 MP（微信小程序）两端。

### 入口分布

| 平台 | 入口位置 | 支持格式 | 用的 Hook |
|------|---------|---------|----------|
| H5 | 侧边栏 → 微信账单导入（独立页） | CSV / Excel | `useWechatImport` |
| H5 | 侧边栏 → 支付宝账单导入（独立页） | CSV / Excel | `useAlipayImport` |
| H5 | 数据管理页 → 通用 Excel 导入 | Excel（自定义模板） | `useDataImport` |
| MP | 设置 → 数据管理 → 导入导出 → 微信/支付宝账单 | CSV / Excel | `useBillImport` |

### 关键设计决策

1. **客户端不直接解析 Excel**：除 `useDataImport`（自定义模板）外，所有账单导入统一上传到云函数 `RevD_media` 解析为 CSV 文本，再回前端用解析器处理。避免前端打包 xlsx 库（约 400KB）。
2. **H5 和 MP 走不同写入路径**：H5 经 h5batch 中转（可二次编辑），MP 直接预览即导入（带快照可回滚）。
3. **CSV 解析器复用**：微信和支付宝共用 `h5CsvParserBase.js`，通过 config 对象差异化配置。

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │useWechatImport│  │useAlipayImport│  │useBillImport │       │
│  │  (H5+MP)     │  │  (H5+MP)     │  │  (MP only)   │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │                │
│         └────────┬────────┘                 │                │
│                  ▼                           │                │
│         ┌────────────────┐                   │                │
│         │  selectFile    │                   │                │
│         │  parseFile     │                   │                │
│         └────────┬───────┘                   │                │
│                  │                           │                │
│     ┌────────────┼───────────┐               │                │
│     ▼            ▼           ▼               │                │
│  H5上传      MP上传      云函数调用            │                │
│  app.upload  wx.cloud    callCloudFunction   │                │
│  File        uploadFile   ('RevD_media')     │                │
└────────────────┬─────────────────────────────┘                │
                 │                                               │
                 ▼                                               │
┌─────────────────────────────────────────────────────────────┐ │
│                  云端（wxcloud）                              │ │
│  ┌──────────────────────────────────────┐                    │ │
│  │  云存储：bill_import/{ts}_{rand}.xlsx│                    │ │
│  └──────────────────┬───────────────────┘                    │ │
│                     ▼                                        │ │
│  ┌──────────────────────────────────────┐                    │ │
│  │  云函数 RevD_media                    │                    │ │
│  │  - parseBill (xlsx/xls)              │                    │ │
│  │  - parseCSVBill (csv + 编码识别)      │                    │ │
│  │  返回 { csvContent }                 │                    │ │
│  └──────────────────┬───────────────────┘                    │ │
│                     │                                        │ │
└─────────────────────┼────────────────────────────────────────┘ │
                      │                                          │
                      ▼                                          │
┌─────────────────────────────────────────────────────────────┐ │
│                  客户端解析                                   │ │
│  ┌──────────────────────────────────────┐                    │ │
│  │  h5CsvParserBase.parseCSV            │                    │ │
│  │  ├─ h5WechatParser (wechatConfig)    │                    │ │
│  │  └─ h5AlipayParser (alipayConfig)    │                    │ │
│  │  + accountKeywordMap (科目映射)       │                    │ │
│  └──────────────────┬───────────────────┘                    │ │
│                     ▼                                        │ │
│              { records, summary }                            │ │
│                     │                                        │ │
│         ┌───────────┴───────────┐                            │ │
│         ▼                       ▼                            │ │
│    H5: sendToBatch        MP: confirmBillImport              │ │
│    → sessionStorage        → BillPreviewModal                │ │
│    → h5batch 页面          → importRecords (带快照)           │ │
│    → batchCreateRecords    → 可回滚                          │ │
└─────────────────────────────────────────────────────────────┘ │
```

---

## 三、文件选入与上传

### 3.1 选文件（条件编译）

```js
function selectFile() {
  // #ifdef H5
  var input = document.createElement('input')
  input.type = 'file'
  input.accept = '.csv,.xlsx,.xls'
  input.onchange = function (e) {
    var file = e.target.files[0]
    if (file) { importFile.value = file; parseFile(file) }
  }
  input.click()
  // #endif
  // #ifndef H5
  wx.chooseMessageFile({
    count: 1, type: 'file', extension: ['csv', 'xlsx', 'xls'],
    success: function (res) {
      var file = res.tempFiles[0]
      if (file) { importFile.value = { name: file.name, path: file.path }; parseFile(file) }
    }
  })
  // #endif
}
```

**要点**：
- H5 用 `<input>` 元素，MP 用 `wx.chooseMessageFile`（从聊天会话选文件，用户需先把账单文件发给"文件传输助手"）
- MP 端文件对象是 `{ name, path }`，H5 端是 File 对象（有 `name` 无 `path`）

### 3.2 上传与调云函数

```js
function parseFile(file) {
  var fileName = (file.name || '').toLowerCase()
  var isCSV = fileName.endsWith('.csv')
  var cloudPath = 'bill_import/' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + (isCSV ? '.csv' : '.xlsx')

  function callParseCloud(fileID) {
    cloudClient.callCloudFunction('RevD_media', {
      action: isCSV ? 'parseCSVBill' : 'parseBill',
      params: { fileID: fileID, billType: 'wechat' }  // 或 'alipay'
    }).then(function (result) {
      if (result.success) doParse(result.csvContent)
    })
  }

  // #ifdef H5
  var app = cloudClient.initTcbApp()
  app.uploadFile({ cloudPath: cloudPath, filePath: file }).then(function (res) {
    callParseCloud(res.fileID)
  })
  // #endif
  // #ifndef H5
  wx.cloud.uploadFile({
    cloudPath: cloudPath, filePath: file.path,
    success: function (res) { callParseCloud(res.fileID) }
  })
  // #endif
}
```

**要点**：
- 云存储路径用时间戳+随机串避免冲突
- H5 用 `@cloudbase/js-sdk` 的 `app.uploadFile`，MP 用 `wx.cloud.uploadFile`
- `useBillImport`（MP only）直接用 `wx.cloud.callFunction` 而非 `cloudClient.callCloudFunction`，**无重试机制**

---

## 四、云函数 RevD_media

**文件**：`wxcloud/functions/RevD_media/index.js`

### 4.1 Action 列表

| Action | 入参 | 出参 | 说明 |
|--------|------|------|------|
| `parseBill` | `{ fileID, billType }` | `{ success, csvContent, billType, sheetName }` | 解析 Excel（xlsx/xls） |
| `parseCSVBill` | `{ fileID, billType }` | `{ success, csvContent, billType }` | 解析 CSV（含编码识别） |
| `speechRecognize` | `{ audioBase64, voiceFormat }` | `{ success, text, requestId }` | 语音识别（与账单无关） |

### 4.2 parseBill 实现

```js
// 1. 下载文件
cloud.downloadFile({ fileID })
// 2. XLSX 读取
var workbook = XLSX.read(fileContent, { type: 'buffer' })
// 3. 取第一个 sheet 转 CSV
var sheet = workbook.Sheets[workbook.SheetNames[0]]
var csvContent = XLSX.utils.sheet_to_csv(sheet)
// 4. 返回
return { success: true, csvContent, billType, sheetName: workbook.SheetNames[0] }
```

### 4.3 parseCSVBill 实现（含编码识别）

```js
// 1. 下载文件
cloud.downloadFile({ fileID })
// 2. 判断是否实际是 Excel（通过文件头魔术字节）
if (isExcelBuffer(fileContent)) { /* 走 parseBill 逻辑 */ }
// 3. UTF-8 解码
var text = new TextDecoder('utf-8').decode(fileContent)
// 4. 若不含"交易时间"关键字，回退 GBK
if (text.indexOf('交易时间') < 0) {
  text = new TextDecoder('gbk').decode(fileContent)
}
return { success: true, csvContent: text, billType }
```

**编码识别策略**：以"交易时间"关键字是否出现为判定，UTF-8 优先，失败回退 GBK。微信/支付宝账单导出默认是 GBK 编码（Windows 记事本习惯），但部分版本会用 UTF-8。

### 4.4 isExcelBuffer 判断

```js
function isExcelBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false
  return (buffer[0] === 0x50 && buffer[1] === 0x4B)  // PK = zip/xlsx
      || (buffer[0] === 0xD0 && buffer[1] === 0xCF)  // OLE = xls
}
```

### 4.5 xlsx 库容错加载

```js
var XLSX
try { XLSX = require('xlsx') } catch (e) { }
// 若未安装，返回 { success: false, message: 'xlsx解析库未安装' }
```

---

## 五、CSV 解析器

### 5.1 通用解析流程（h5CsvParserBase.js）

```
parseCSV(csvContent, config, options)
  │
  ├─ 1. stripBOM 去除 BOM 头
  ├─ 2. normalizeLines 统一换行（\r\n / \r → \n）并 split
  ├─ 3. findHeader 找表头行（包含 config.headerKeyword 的行）
  │     建立 headerMap[colName] = colIndex
  ├─ 4. 逐行处理数据行
  │     ├─ separatorCheck 跳过分隔线（如 "---微信支付---"）
  │     ├─ splitTabLine 切列（Tab 优先，否则逗号）
  │     ├─ getCol(timeCol) 取交易时间
  │     ├─ parseDate 解析为 ISO 时间
  │     ├─ getCol(incomeOrExpenseCol) 判定收支类型
  │     ├─ cleanAmount 清洗金额（去 ¥ , 空格）
  │     ├─ matchAccount 匹配科目（先名称，后关键词规则）
  │     └─ buildNote 拼备注
  └─ 5. buildResult 返回 { success, records, summary, preview }
```

### 5.2 splitTabLine（智能切列）

微信/支付宝账单导出可能用 Tab 或逗号分隔，`splitTabLine` 统计行内 Tab 数和逗号数（引号外），Tab 多用 Tab split，否则用 `splitCSVLine`（支持双引号转义）。

### 5.3 parseDate（日期解析）

```js
function parseDate(timeStr) {
  timeStr = (timeStr || '').trim()
  var m = timeStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (m) {
    var y = m[1], mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0')
    var h = (m[4] || '0').padStart(2, '0')
    var mi = (m[5] || '0').padStart(2, '0')
    var s = (m[6] || '0').padStart(2, '0')
    return y + '-' + mo + '-' + d + 'T' + h + ':' + mi + ':' + s + '.000Z'
  }
  return ''
}
```

**行为**：
- 输入 `2026-06-20 14:30:25` → 输出 `2026-06-20T14:30:25.000Z`
- 输入 `2026-06-20` → 输出 `2026-06-20T00:00:00.000Z`
- 输入 `6/20/2026`（美式）→ 返回空字符串（不匹配，该行跳过）

### 5.4 科目匹配（accountKeywordMap.js）

**两层匹配**：
1. **名称直接匹配**：账单"交易类型"与科目名完全相同
2. **关键词规则匹配**：`MAPPING_RULES` 定义关键词→科目名映射，子串匹配

```js
// accountKeywordMap.js 示例
ACCOUNT_KEYWORDS = {
  expense: {
    '餐饮': ['外卖', '美食', '餐厅', '吃饭'],
    '交通': ['打车', '地铁', '公交', '加油'],
    '购物': ['淘宝', '京东', '超市'],
    // ...
  },
  income: {
    '工资': ['工资', '薪资'],
    '奖金': ['奖金', '红包'],
  }
}
```

匹配流程（以微信为例）：
1. `matchAccountByName(tradeType, accounts, type)` —— "交易类型"直接匹配科目名
2. 失败则 `matchAccountByRules(tradeType + ' ' + counterparty, ...)` —— 拼接"交易对方"做关键词子串匹配
3. 仍失败用 `defaultExpenseId` / `defaultIncomeId`（用户在导入页下拉选的默认科目）

### 5.5 微信 vs 支付宝配置差异

| 配置项 | 微信（wechatConfig） | 支付宝（alipayConfig） |
|--------|---------------------|----------------------|
| `headerKeyword` | `交易时间` | `交易时间` |
| `timeCol` | `交易时间` | `交易时间` |
| `amountCol` | `金额(元)` | `金额` |
| `separatorCheck` | 含 `---` 且含 `微信` | 含 `---` 且含 `支付宝` |
| `matchAccount` 取值 | 交易类型 + 交易对方 | 交易分类 |
| `buildNote` | 交易对方:商品 | 交易对方:商品说明 |

---

## 六、H5 端写入流程

### 6.1 经 h5batch 中转

H5 端微信/支付宝导入**不直接写入数据库**，而是：
1. 解析后显示统计摘要（`ParseSummary` 组件）
2. 用户点"写入批量录入表" → `sendToBatch()`
3. 去重后映射为 `batchRows`，写入 `sessionStorage`
4. 跳转 `h5batch` 页面，用户可二次编辑
5. 在 h5batch 提交时调 `familyService.batchCreateRecords` → `RevD_import.batchCreateRecords`

**去重规则**（前端）：`date(前10位) + accountId + amount` 三元组

### 6.2 batchRows 结构

```js
{
  date: '2026-06-20',           // 前 10 位
  type: 'expense',
  subjectInput: '餐饮',
  subjectId: 'acc_xxx',
  subjectName: '餐饮',
  amount: '25.5',               // String
  payerInput: '张三',
  payerId: 'mem_xxx',
  memberInput: '张三',
  memberId: 'mem_xxx',
  memberIds: ['mem_xxx'],
  remark: '美团外卖:午餐',
  error: false
}
```

### 6.3 通用 Excel 导入（useDataImport）

`useDataImport` 是例外，它**前端直接用 xlsx 库解析**（`await import('xlsx')`），不走云函数。用于自定义模板格式的 Excel，支持序号列、科目代码、成员代码、分摊明细。提供两种写入路径：
- `sendToBatch`：同上，经 h5batch
- `confirmImport`：直接 `importRecords`（带快照，可回滚）

---

## 七、MP 端写入流程

### 7.1 预览即导入

MP 端用 `useBillImport`，流程：
1. `importWechatFromFile()` / `importAlipayFromFile()` 弹窗提示用户发文件到文件传输助手
2. `familyService.importFromFile()` → `wx.chooseMessageFile` 选文件
3. `processExcelViaCloud(fileRes, billType)` 上传 + 调云函数
4. 解析后填充 `billPendingRecords`，弹出 `BillPreviewModal`
5. 用户点"确认导入" → `confirmBillImport()`

### 7.2 去重与冲突处理

**去重规则**（前端，比 H5 严格）：`date(前10位) + amount + accountId + memberId` 四元组

发现重复时弹 `DuplicateModal`，用户选择：
- `all`：全部导入（含重复）
- `skip`：跳过重复
- `overwrite`：覆盖（实际云函数只跳过不覆盖，此选项语义待修正）

### 7.3 写入与快照

```js
function doBillImport(records) {
  familyService.importRecords(records, familyId)  // enableSnapshot: true
    .then(function (res) {
      lastSnapshotId.value = res.snapshotId
      lastImportCount.value = res.imported
      store.syncIncremental()
    })
}
```

`RevD_import.importRecords` 云函数逻辑：
1. 生成 `snapshotId = 'snap_' + generateId()`
2. `fetchAll(recordsCol, { familyId })` 拉取当前所有记录
3. 写入 `import_snapshots` 集合（只存 id + 少量字段）
4. 云端再查重（更严格：date + amount + type + account + memberId + note）
5. 分批 200 条/批写入 `records` 集合
6. `updateDataTimestamp`

### 7.4 回滚

```js
function rollbackLastImport() {
  familyService.rollbackImport(snapshotId, familyId)
}
```

`RevD_import.rollbackImport` 逻辑：
1. 按 `snapshotId` 查 `import_snapshots` 拿快照中的记录 id 集合
2. `fetchAll` 当前所有记录，凡 `_id` 不在快照中的 → 删除（即导入新增的）
3. 删除快照文档本身

**限制**：只能回滚"新增"的记录，无法恢复"被覆盖"的记录（快照只存 id，不存完整文档）。

---

## 八、日期处理方案

### 8.1 存储格式

统一用 ISO 8601 字符串：`YYYY-MM-DDTHH:mm:ss.000Z`
- 有时间：`2026-06-20T14:30:25.000Z`
- 无时间：`2026-06-20T00:00:00.000Z`

### 8.2 显示规则

**H5 端**（统一模式，4 处使用）：
```js
record.date.indexOf('T00:00:00') > -1
  ? record.date.substring(0, 10)                              // 2026-06-20
  : record.date.substring(0, 16).replace('T', ' ')            // 2026-06-20 14:30
```

**MP 端**（始终只显示日期）：
```js
item.date.substring(0, 10)  // 2026-06-20
```

### 8.3 筛选兼容性

筛选时统一用 `substring(0, 10)` 做前缀比较，保证与 `YYYY-MM-DD` 格式的 `startDate/endDate` 兼容：

```js
if (f.startDate) result = result.filter(r => r.date.substring(0, 10) >= f.startDate)
if (f.endDate) result = result.filter(r => r.date.substring(0, 10) <= f.endDate)
if (f.years.length > 0) result = result.filter(r => yearSet[r.date.substring(0, 4)])
```

**关键**：因为 ISO 字符串前 10 位就是 `YYYY-MM-DD`，`substring(0, 10)` 比较等价于日期前缀比较，无论原数据有无时间都能正确筛选。

### 8.4 显示位置清单

| 文件 | 位置 | 平台 | 规则 |
|------|------|------|------|
| `DataFilterPanel.vue:24` | 筛选结果列表 | H5 | 带时间显示到分钟 |
| `DataFilterPanel.vue:83` | 表格视图 | H5 | 带时间显示到分钟 |
| `DataImportPanel.vue:111,138` | 导入预览 | H5 | 带时间显示到分钟 |
| `DataBackupPanel.vue:43` | 备份预览 | H5 | 带时间显示到分钟 |
| `useDataFilter.js:303` | CSV 导出 | H5 | 带时间显示到分钟 |
| `BillPreviewModal.vue:43` | 账单预览 | MP | 只显示日期 |
| `useHome.js:96` | 首页列表 | MP | 只显示日期 |
| `useFilterTable.js:308` | 筛选表格 | MP | 只显示日期 |

---

## 九、云函数资源消耗

### 9.1 每次导入消耗

| 资源 | 次数 | 触发点 |
|------|------|--------|
| 云存储上传 | 1 | `app.uploadFile` / `wx.cloud.uploadFile` |
| 云函数调用 | 1 | `RevD_media`（parseBill / parseCSVBill） |

### 9.2 写入阶段额外消耗

| 写入方式 | 云函数 | 数据库操作 |
|---------|--------|-----------|
| `batchCreateRecords`（H5） | 1 次 `RevD_import` | N 次 `records` 写入（分批 200/批） |
| `importRecords`（MP / H5 Excel） | 1 次 `RevD_import` | 1 次 `import_snapshots` 写入 + N 次 `records` 写入 |
| `rollbackImport` | 1 次 `RevD_import` | 1 次 `import_snapshots` 查询 + M 次 `records` 删除 |

### 9.3 免费额度估算

微信云开发免费额度：云函数 4 万次/月，云存储 5GB。
按每次导入消耗 1 次云函数 + 1 次上传算，免费额度内可支持约 **4 万次账单导入/月**。

### 9.4 例外情况

`useDataImport`（H5 通用 Excel 导入）前端直接用 xlsx 库解析，**不消耗云函数**，但也不支持微信/支付宝账单格式。

---

## 十、去重规则对比

| 位置 | 规则字段 | 严格度 |
|------|---------|--------|
| `useWechatImport.sendToBatch` | date(前10) + accountId + amount | 三元组 |
| `useAlipayImport.sendToBatch` | date(前10) + accountId + amount | 三元组 |
| `useBillImport.confirmBillImport` | date(前10) + amount + accountId + memberId | 四元组 |
| `useDataImport.checkDuplicates` | 可配置（date + subject + amount + payer + participant） | 灵活 |
| `RevD_import.importRecords`（云端） | date + amount + type + account + memberId + note | 六元组 |

**注意**：前端去重是"软过滤"，云端 `importRecords` 会再查重做最终保障。但 `batchCreateRecords`（H5 经 h5batch 提交）云端不再查重，若用户在 h5batch 修改后提交可能写入重复。

---

## 十一、关键文件清单

### Hook 层

| 文件 | 作用 |
|------|------|
| `hooks/useWechatImport.js` | H5+MP 微信账单导入 |
| `hooks/useAlipayImport.js` | H5+MP 支付宝账单导入 |
| `hooks/useBillImport.js` | MP 端 settings 统一账单导入入口 |
| `hooks/useDataImport.js` | H5 通用 Excel 导入（自定义模板） |
| `hooks/useDataManage.js` | MP 数据管理（串联 useBillImport） |
| `hooks/useBatchTable.js` | H5 批量录入表（接收导入数据） |

### 解析器

| 文件 | 作用 |
|------|------|
| `utils/h5CsvParserBase.js` | CSV 解析基类（parseCSV 主流程） |
| `utils/h5WechatParser.js` | 微信账单配置（wechatConfig） |
| `utils/h5AlipayParser.js` | 支付宝账单配置（alipayConfig） |
| `utils/accountKeywordMap.js` | 科目关键词映射规则 |

### 云函数

| 文件 | 作用 |
|------|------|
| `wxcloud/functions/RevD_media/index.js` | 文件解析（parseBill / parseCSVBill） |
| `wxcloud/functions/RevD_import/index.js` | 导入写入（importRecords / batchCreateRecords / rollbackImport） |

### 页面与组件

| 文件 | 作用 |
|------|------|
| `pages/h5wechat-import/h5wechat-import.vue` | H5 微信导入页 |
| `pages/h5alipay-import/h5alipay-import.vue` | H5 支付宝导入页 |
| `pages/h5data/h5data.vue` | H5 数据管理页（含通用 Excel 导入） |
| `pages/h5batch/h5batch.vue` | H5 批量录入页 |
| `pages/settings/settings.vue` | MP 设置页（数据管理卡片） |
| `components/settings/BillPreviewModal.vue` | MP 账单预览弹窗 |
| `components/h5data/DataImportPanel.vue` | H5 导入面板 |
| `components/h5data/DataFilterPanel.vue` | H5 筛选面板 |

---

## 十二、完整流程图

### H5 微信/支付宝导入

```
用户在 h5wechat-import / h5alipay-import 页面
  ↓ 点击"选择文件"
selectFile()
  ├─ H5: input.click()
  └─ MP: wx.chooseMessageFile
  ↓ 拿到 File
parseFile(file)
  ├─ 判断 isCSV（按后缀）
  ├─ 生成 cloudPath = bill_import/{ts}_{rand}.csv|.xlsx
  ├─ H5: app.uploadFile  /  MP: wx.cloud.uploadFile  【1 次云存储上传】
  ↓ 拿到 fileID
callParseCloud(fileID)
  └─ cloudClient.callCloudFunction('RevD_media', {action, params})  【1 次云函数】
     ↓ 返回 csvContent
doParse(csvContent)
  └─ h5WechatParser.parseWechatCSV / h5AlipayParser.parseAlipayCSV
     ├─ stripBOM → normalizeLines → findHeader
     ├─ 逐行 splitTabLine → getCol → parseDate(完整ISO) → matchAccount → buildNote
     └─ 返回 { records, summary, preview }
  ↓ 写入 parsedRecords / parseSummary
ParseSummary 组件显示统计
  ↓ 用户点击"写入批量录入表"
sendToBatch()
  ├─ 去重：date(前10) + accountId + amount
  ├─ 映射为 batchRows
  ├─ sessionStorage.setItem('pending_bill_import', {source, rows})
  └─ uni.redirectTo('/pages/h5batch/h5batch?source=xxx-import')
     ↓
useBatchTable.initFromOptions → loadImportData
  ├─ 读 sessionStorage → 填充 batchRows
  └─ 用户在 h5batch 编辑/确认
     ↓ 提交
useBatchSubmit.submitBatch → familyService.batchCreateRecords → RevD_import.batchCreateRecords
  ↓ 写入 records 集合（分批 200/批）
store.syncIncremental() 刷新本地
```

### MP 微信/支付宝导入

```
用户在 settings 页面 → 数据管理 → 导入导出 → 导入微信/支付宝账单
  ↓
useDataManage.importWechatFromFile / importAlipayFromFile
  └─ billImport.importXxxFromFile
     ├─ uni.showModal 提示发到文件传输助手
     └─ familyService.importFromFile() → wx.chooseMessageFile
        ↓ 拿到 { filePath, type }
processExcelViaCloud(fileRes, billType)
  ├─ wx.cloud.uploadFile  【1 次云存储上传】
  └─ wx.cloud.callFunction('RevD_media', {action, data:{fileID, billType}})  【1 次云函数】
     ↓ 返回 csvContent
processWechatCSV / processAlipayCSV / processGenericCSV
  └─ h5XxxParser.parseXxxCSV → { records, summary, preview }
     ↓
billPendingRecords / billPreviewRecords / billSummary 赋值
showBillPreview = true
  ↓ 弹出 BillPreviewModal
用户查看预览 → 点击"确认导入 N 条"
  ↓ @confirm
confirmBillImport()
  ├─ 去重：date(前10) + amount + accountId + memberId
  ├─ 有重复 → showDuplicateModal → 用户选 all/skip/overwrite
  └─ doBillImport(filteredRecords)
     └─ familyService.importRecords(records, familyId)  【enableSnapshot:true】
        → RevD_import.importRecords
           ├─ 创建 snapshot 写入 import_snapshots 集合
           ├─ fetchAll 现有记录
           ├─ 分批 200/批 写入 records 集合（云端再查重）
           └─ updateDataTimestamp
        ↓ 返回 { snapshotId, imported, skipped }
store.syncIncremental()
  ↓
用户可在 settings → 撤销导入 → rollbackLastImport
  └─ familyService.rollbackImport(snapshotId, familyId)
     → RevD_import.rollbackImport
        ├─ 查 import_snapshots 拿快照 id 集合
        ├─ 当前记录中不在快照的 → 删除
        └─ 删除快照文档
```

---

## 十三、已知问题与注意事项

1. **前端去重与云端去重规则不一致**：H5 微信/支付宝导入前端用三元组，但经 h5batch 提交走 `batchCreateRecords` 云端不再查重，可能写入重复。MP 端走 `importRecords` 云端会再查重（六元组）。

2. **回滚文案不准确**：`useDataManage.js` 和 `useDataImport.js` 都说"被覆盖的记录将恢复"，但 `RevD_import.importRecords` 实际只跳过重复不覆盖，`rollbackImport` 也只删除新增不恢复覆盖。

3. **`useBillImport` 直接用 `wx.cloud.callFunction`** 而非 `cloudClient.callCloudFunction`，**无指数退避重试**，超时直接 fail。

4. **`parseDate` 不匹配美式日期**：`6/20/2026`（用 `/` 分隔）正则不匹配，返回空字符串，该行被跳过。微信/支付宝国内导出不会出现此格式，但若用户用其他工具导出需注意。

5. **`processGenericCSV` 日期格式不统一**：`useBillImport.js` 的 `processGenericCSV` 补 `T00:00:00.000Z`，而 `useDataImport` 的日期是 `YYYY-MM-DD` 无时间，两者筛选时都靠 `substring(0,10)` 兼容。

6. **`splitCSVLine` 把 Tab 替换为空格**：若某行 Tab 数 = 逗号数，会走 `splitCSVLine`，Tab 被替换为空格，可能导致列数对不上 headerMap。实际微信/支付宝账单 Tab 数通常远多于逗号，不会触发。

---

## 十四、扩展指南

### 新增账单来源（如京东金融）

1. 在 `utils/` 新建 `h5JdParser.js`，导出 `jdConfig`（参考 wechatConfig 结构）
2. 在 `accountKeywordMap.js` 补充京东相关的关键词映射
3. 在 `useWechatImport.js` / `useAlipayImport.js` 模式下新建 `useJdImport.js`，或扩展 `useBillImport` 加 `importJdFromFile`
4. 云函数 `RevD_media` 无需改动（已通用）
5. 新建 H5 页面 `pages/h5jd-import/` 或在 settings 加 MP 入口

### 修改去重规则

前端去重在各自 hook 的 `sendToBatch` / `confirmBillImport` 中，云端去重在 `RevD_import/index.js` 的 `findDuplicate` 函数。改前端不影响云端，改云端需重新部署云函数。

### 修改科目匹配规则

编辑 `utils/accountKeywordMap.js` 的 `ACCOUNT_KEYWORDS`，新增关键词或科目分类。无需改其他文件，解析器会自动加载新规则。

### 支持新的文件格式（如 PDF）

1. 云函数 `RevD_media` 新增 action（如 `parsePdfBill`），引入 pdf 解析库
2. 客户端 `selectFile` 的 `accept` / `extension` 加 pdf
3. `parseFile` 根据 `isPDF` 调用新 action
4. 解析后仍返回 CSV 文本，复用现有解析器
