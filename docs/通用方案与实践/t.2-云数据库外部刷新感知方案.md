# 云数据库外部刷新感知与恢复方案

## 问题背景

微信小程序云开发中，数据可能通过"清库重写"导入被整体替换。此时前端缓存的时间戳与数据库实际状态脱节，导致：

- 统计页显示旧聚合数据
- 首页不刷新订单列表
- 成员/菜单列表过时

核心矛盾：**前端靠时间戳判断数据新鲜度，但外部操作不会触发云函数里的时间戳更新。**

## 解决思路

在 `lunch_groups`（每个群组只有一条文档）中集中管理所有业务数据的时间戳。任何可能导致数据变化的操作，都必须更新对应时间戳。对于无法精确判断影响范围的操作，将聚合时间戳清零，触发下次访问时全量重建。

## 时间戳设计

### 存储位置

集合：`lunch_groups`，文档 `_id = groupId`（如 `lunch_hp`）

### 四个时间戳字段

| 字段 | 作用 | 正常更新 | 清零触发 |
|------|------|---------|---------|
| `ordersTimestamp` | 订单数据新鲜度 | 每次订单写操作 | 不清零 |
| `dataTimestamp` | 月度统计是否需要重建 | 单条订单操作后 | 导入/清库时清零 |
| `menuTimestamp` | 菜单数据新鲜度 | 每次菜单写操作 | 不清零 |
| `membersTimestamp` | 成员数据新鲜度 | 每次成员写操作 | 不清零 |

### 为什么 `dataTimestamp` 需要清零而不是更新？

月度统计（`lunch_monthly_stats`）是从订单聚合出来的。当批量导入数据时：

- 影响的月份不确定（可能跨多个月）
- 逐月 rebuild 既复杂又容易遗漏
- 清零 `dataTimestamp` 后，下次访问统计页时 `getMonthlyStats` 检测到 `serverTs === 0`，自动全量 rebuild

月度统计文档数量极少（一个月一条），全量 rebuild 成本可忽略。

## 操作与时间戳对照表

### 订单类操作（lunch_order 云函数）

| 操作 | ordersTimestamp | dataTimestamp | 服务端额外动作 |
|------|:-:|:-:|------|
| submitOrder | ✅ now | ✅ now | 无 |
| cancelOrder | ✅ now | ✅ now | `doRebuildMonthStats(该月)` |
| updateOrder（改价格） | ✅ now | ✅ now | `doRebuildMonthStats(该月)` |
| updateOrder（改备注等） | ✅ now | 不动 | 无 |
| batchConfirm | ✅ now | ✅ now | `doRebuildMonthStats(该月)` |
| importOrders 追加 | ✅ now | **清零**（仅最后一批） | 无（下次访问自动 rebuild） |
| importOrders 清库重写 | ✅ now | **清零**（仅最后一批） | 无（同上） |

### 成员类操作（lunch_menu 云函数）

| 操作 | membersTimestamp | dataTimestamp | 服务端额外动作 |
|------|:-:|:-:|------|
| joinGroup | ✅ now | 不动 | 无 |
| deleteMember | ✅ now | 不动 | 无 |
| updateMemberName | ✅ now | ✅ now | `doRebuildMonthStats(该成员所有月份)` |
| linkVirtualMember | ✅ now | 不动 | 无 |
| setAdmin | ✅ now | 不动 | 无 |
| importMembers 追加 | ✅ now | 不动 | 无 |
| importMembers 清库重写 | ✅ now | **清零** | 无（下次访问自动 rebuild） |

### 菜单类操作（lunch_menu 云函数）

| 操作 | menuTimestamp | 服务端额外动作 |
|------|:-:|------|
| addMenuItem | ✅ now | 无 |
| updateMenuItem | ✅ now | 无 |
| deleteMenuItem | ✅ now | 无 |
| moveMenuItem | ✅ now | 无 |
| importMenuItems 追加 | ✅ now | 无 |
| importMenuItems 清库重写 | ✅ now | 无 |

> 菜单操作不影响月度统计，因为统计中的 supplier 来自订单记录而非菜单。

## 前端检测机制

| 页面 | 检测的时间戳 | 检测时机 | 变了之后做什么 |
|------|------------|---------|------------|
| 首页 useHome | `ordersTimestamp` | onShow（30秒冷却） | 重拉 recentOrders + monthSummary |
| 统计页 useStats | `dataTimestamp` | onShow（30秒冷却） | `=0` → 全量 rebuild；否则全量请求 |
| 菜单页 useMenu | `menuTimestamp` | onShow | 重拉 menu |
| 菜单页 useMenu | `membersTimestamp` | onShow | 重拉 members |

## 实时数据推送（Watch）

### 问题

时间戳 + onShow 机制只能解决"切回页面时"的数据刷新，无法实现：

- 成员停留在首页时看到别人新提交的订单
- 管理员停留在管理页时看到新的待确认订单
- 管理员向所有在线成员推送通知（如"已停止接单，电话联系"）

### 方案

使用微信云开发 `Collection.watch` API，在页面打开时建立实时监听，数据变化时自动推送，页面隐藏时关闭连接。

### 监听设计

| 页面 | 监听目标 | where 条件 | 变更回调 |
|------|---------|-----------|---------|
| 首页 useHome | `lunch_orders` | `{ groupId, date: today }` | 重拉 recentOrders + monthSummary |
| 首页 useHome | `lunch_groups` | `{ _id: groupId }` | 检测 notice 字段变化，弹出通知弹窗 |
| 管理页 useDataManage | `lunch_orders` | `{ groupId, date: today }` | 重拉 pendingOrders + confirmedOrders |

### 生命周期管理

```
onShow → 开启 watch（watchTodayOrders + watchGroupNotice）
onHide → closeAll() 关闭所有 watch 连接
```

- watch 只在页面可见时存在，切后台自动断开
- 每次 onShow 重新建立连接，watch init 会拉取当前快照（忽略，因为已有 loadData）
- 仅监听后续变更事件（`snapshot.type !== 'init'`）

### 管理员通知功能

在 `lunch_groups` 文档中新增两个字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `notice` | string | 通知内容，空字符串表示无通知 |
| `noticeUpdatedAt` | serverDate | 通知更新时间，用于去重 |

**发送通知**：管理员在管理页输入内容 → 调用 `lunch_menu` 云函数 `setNotice` → 写入 `notice` + `noticeUpdatedAt`

**清除通知**：管理员点击"清除通知" → 调用 `clearNotice` → 将 `notice` 置空

**接收通知**：首页 watch `lunch_groups` 文档变化 → 检测 `notice` 非空且 `noticeUpdatedAt > lastShownNoticeTime` → 弹出通知弹窗

去重机制：用 `lastShownNoticeTime` 记录已展示过的通知时间戳，同一通知不会重复弹出。

### 云函数新增操作（lunch_menu）

| 操作 | 权限 | DB 写 | 说明 |
|------|------|-------|------|
| `setNotice` | admin/creator | 1（groups update） | 写入 notice + noticeUpdatedAt |
| `clearNotice` | admin/creator | 1（groups update） | 清空 notice，更新 noticeUpdatedAt |

### 资源消耗

#### Watch 连接

| 场景 | 连接数 | 说明 |
|------|--------|------|
| 首页打开 | 2 | watchTodayOrders + watchGroupNotice |
| 管理页打开 | 1 | watchTodayOrders |
| 页面隐藏 | 0 | onHide 自动关闭 |

- watch 不占用数据库连接数，走独立长连接通道
- 每个用户同时最多 2-3 个连接，仅在页面打开时存在

#### 数据库操作

| 操作 | 触发时机 | DB 读 | DB 写 |
|------|---------|-------|-------|
| watch init | onShow 开启 | 0（init 快照不计入 DB 读） | 0 |
| watch 变更回调 | 订单变化 | 1（fetchRecentOrders） | 0 |
| setNotice | 管理员发送通知 | 0 | 1 |
| clearNotice | 管理员清除通知 | 0 | 1 |

#### 对比原有方案的增量

| 指标 | 之前（仅时间戳） | 现在（+ watch） | 增量 |
|------|-----------------|----------------|------|
| DB 读 | onShow checkFreshness 1次 + 条件性 fetchRecentOrders | 同上 + watch 变更时 fetchRecentOrders | 几乎无增量（仅数据变化时触发） |
| DB 写 | 无 | setNotice/clearNotice 偶尔 1次 | 可忽略 |
| 长连接 | 0 | 1-2个/在线用户 | 新增，但免费 |

> watch 方案比定时轮询更省资源。15秒轮询每人每小时 240 次 checkFreshness 调用；watch 只在数据真正变化时才触发一次读取。

#### 免费额度覆盖

微信云开发免费额度：数据库每天 10 万次读写。以 20 人团队估算：

- 每人每天开关首页约 10 次 → watch init 约 20 次（不计入 DB 读）
- 订单变更触发 fetchRecentOrders → 假设 50 次订单操作 → 50 次 DB 读
- 通知操作 → 几乎 0

总计约 50-70 次数据库读/天，远低于 10 万次免费额度。

## 关键实现细节

### 1. 时间戳存在独立集合，不随数据删除而丢失

```
❌ 错误做法：查 lunch_orders 最新一条的 createdAt
   → 记录被删后，时间戳也丢了，无法感知

✅ 正确做法：时间戳存在 lunch_groups 中
   → 数据怎么删都不影响时间戳
```

### 2. 清零时间戳是延迟重建，不是跳过重建

`dataTimestamp = 0` 并不直接重建数据，而是标记"需要重建"。下次用户访问统计页时，`getMonthlyStats` 检测到 `serverTs === 0`，才触发 `doRebuildMonthStats`：

1. `_updateDataTimestamp()` 先占位（防并发）
2. `where({ groupId }).remove()` 一次清掉旧的 `lunch_monthly_stats`（兼容旧格式 _id）
3. 遍历所有 confirmed 订单，按月聚合
4. 逐月 `doc(GROUP_ID_YEAR_MONTH).set()` 写入（确定性 _id，并发不重复）
5. 返回完整数据 + 新时间戳

优势：**懒执行**——如果没人访问统计页，rebuild 就不会发生，节省资源。

### 3. 单条操作精确 rebuild，批量操作清零

```
单条 cancelOrder：已知 order.date → 只 rebuild 那一个月
批量 importOrders：影响月份不确定 → dataTimestamp = 0 → 全量 rebuild
```

### 4. 防并发 rebuild

两个请求可能同时读到 `dataTimestamp === 0`，都触发 rebuild 导致重复数据。防护机制：

1. **占位**：`getMonthlyStats` 检测到 `serverTs === 0` 时，先调 `_updateDataTimestamp()` 将时间戳恢复，再执行 rebuild。第二个并发请求读到非零时间戳，不会触发 rebuild。
2. **确定性 _id**：`doRebuildMonthStats` 用 `doc(GROUP_ID_YEAR_MONTH).set()` 写入，同一个月永远写同一个 `_id`。即使并发 rebuild，`set()` 是覆盖而非新增，不会产生重复记录。
3. **失败回滚**：rebuild 失败时 catch 里调 `_resetDataTimestamp()` 重新清零，下次访问可重试。

### 5. 分批导入时 dataTimestamp 的控制

前端分批调用 `importOrders`，每批传 `isLastBatch` 标记：

| 批次 | mode | isLastBatch | dataTimestamp |
|------|------|:-:|------|
| 第1批 | `rewrite` | false | 不动 |
| 中间批 | `rewrite_continue` | false | 不动 |
| 最后批 | `rewrite_continue` | true | **清零** |

导入期间 `dataTimestamp` 不为 0，用户切到统计页不会触发不完整的 rebuild。只有全部导入完成后才清零，下次访问触发完整 rebuild。

XLSX 导入是单次云函数调用，`_importOrdersFromRows` 的 `isLastBatch` 默认为 `true`，自动清零。

### 6. 前端 loadStats 刷新策略

| 场景 | forceRefresh | 传 since? | 行为 |
|------|:-:|:-:|------|
| onMounted | false | 可能 | 30分钟内用前端缓存，否则请求云端 |
| onShow (>30s) | true | **否** | 全量请求云端 |
| 下拉刷新 | true | **否** | 全量请求云端 |

- `forceRefresh=true`（下拉刷新/onShow）不传 `since`，直接全量请求，确保拿到最新数据
- `forceRefresh=false`（非强制加载）可传 `since` 做增量，节省传输

收到云端响应的处理：
- `incremental=true && data.length>0` → 增量合并缓存
- `incremental=false` → 直接用新数据
- `incremental=true && data.length===0` → **保持现有数据不变**（语义是"无增量变更"，不是"无数据"）

## 云函数与数据库调用次数

### 清库重写导入（N 批，共 M 条订单，K 个月份）

| 步骤 | 云函数调用 | DB 读 | DB 写 |
|------|:-:|:-:|:-:|
| 前端分批循环 | N 次 `importOrders` | — | — |
| 第1批 `rewrite` | — | 2（members + menu） | 1（清空 orders）+ ceil(M₁/100)（插入 orders）+ 1（ordersTimestamp） |
| 中间批 `rewrite_continue` | — | 2（members + menu） | ceil(Mᵢ/100)（插入 orders）+ 1（ordersTimestamp） |
| 最后批 `rewrite_continue` | — | 2（members + menu） | ceil(Mₙ/100)（插入 orders）+ 1（ordersTimestamp）+ 1（dataTimestamp 清零） |
| **合计** | **N** | **2N** | **1 + ceil(M/100) + 2N + 1** |

> 额外：如果导入过程中自动创建了虚拟成员或菜单项，每个新增 1 次 DB 写。

### 统计页访问触发 rebuild（K 个月份，共 M 条订单）

| 步骤 | 云函数调用 | DB 读 | DB 写 |
|------|:-:|:-:|:-:|
| `getMonthlyStats` | 1 | — | — |
| 读取 dataTimestamp | — | 1（groups） | — |
| 占位 `_updateDataTimestamp` | — | 1（groups） | 1（dataTimestamp 恢复） |
| `doRebuildMonthStats` | — | — | — |
| 　├ remove 旧 stats | — | — | 1 |
| 　├ fetchAll orders | — | ceil(M/1000) | — |
| 　└ 逐月 set | — | — | K |
| 查询 rebuild 结果 | — | 1（monthly_stats） | — |
| 读取新 dataTimestamp | — | 1（groups） | — |
| **合计** | **1** | **3 + ceil(M/1000)** | **2 + K** |

> 示例：4166 条订单、18 个月份 → 1 次云函数、8 次 DB 读、20 次 DB 写

### 统计页普通访问（dataTimestamp 非0，无需 rebuild）

| 场景 | 云函数调用 | DB 读 | DB 写 |
|------|:-:|:-:|:-:|
| 全量请求（forceRefresh） | 1 | 1（groups）+ 1（monthly_stats） | 0 |
| 增量请求（非 forceRefresh，有 since） | 1 | 1（groups）+ 1（monthly_stats） | 0 |
| 无变更（增量返回空） | 1 | 1（groups）+ 1（monthly_stats）+ 1（count） | 0 |

### 单条订单操作

| 操作 | 云函数调用 | DB 读 | DB 写 |
|------|:-:|:-:|:-:|
| submitOrder | 1 | 1（groups） | 1（order）+ 1（ordersTimestamp）+ 1（dataTimestamp） |
| cancelOrder | 1 | 1（order）+ 1（groups） | 1（order）+ 1（ordersTimestamp）+ 1（dataTimestamp）+ rebuild 该月 |
| updateOrder（改价格） | 1 | 1（order）+ 1（groups） | 1（order）+ 1（ordersTimestamp）+ 1（dataTimestamp）+ rebuild 该月 |
| updateOrder（改备注） | 1 | 1（order） | 1（order）+ 1（ordersTimestamp） |
| batchConfirm | 1 | N（orders）+ 1（groups） | N（orders）+ 1（ordersTimestamp）+ 1（dataTimestamp）+ rebuild 该月 |

### 单月 rebuild

| 步骤 | DB 读 | DB 写 |
|------|:-:|:-:|
| remove 该月旧 stats | — | 1 |
| fetchAll 该月 orders | ceil(该月订单数/1000) | — |
| set 该月 stats | — | 1 |
| **合计** | **ceil(该月订单数/1000)** | **2** |

## 迁移检查清单

当新增一个可能修改数据库的操作时，确认以下事项：

- [ ] 该操作影响了哪个集合？（orders / members / menu / monthly_stats / groups）
- [ ] 对应的时间戳是否已更新？（ordersTimestamp / membersTimestamp / menuTimestamp）
- [ ] 是否影响了月度统计？如果是 → 单条操作 rebuild 对应月份，批量操作清零 dataTimestamp
- [ ] 分批操作是否只在最后一批清零 dataTimestamp？
- [ ] 前端对应页面的 checkFreshness 能否通过时间戳变化感知到？
- [ ] 如果修改了 lunch_orders，首页/管理页的 watch 能否感知到？（watch 监听 today 订单，历史数据变更不会触发）
- [ ] 如果修改了 lunch_groups 的 notice 字段，是否通过 setNotice/clearNotice 操作？（不要直接 update，确保 noticeUpdatedAt 同步更新）
