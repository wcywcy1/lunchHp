# 数据库字段映射文档

## 集合总览

| 常量名 | 集合名 | 中文名 |
|--------|--------|--------|
| GROUPS | lunch_groups | 组织/群组 |
| MEMBERS | lunch_members | 成员 |
| MENU | lunch_menu | 菜单 |
| ORDERS | lunch_orders | 订单 |
| MONTHLY_STATS | lunch_monthly_stats | 月度统计 |
| BACKUPS | lunch_backups | 备份 |

---

## 1. lunch_groups（组织/群组）

| 数据库字段 | 类型 | 中文含义 | 说明 |
|-----------|------|---------|------|
| _id | string | 组织ID | 固定为 `lunch_hp` |
| name | string | 组织名称 | 如 `HP午饭` |
| creatorId | string | 创建者openid | 创建者的微信openid |
| qrcode | string | 二维码 | 群二维码图片 |
| ordersTimestamp | serverDate | 订单时间戳 | 订单数据更新时间，用于增量同步 |
| menuTimestamp | serverDate | 菜单时间戳 | 菜单数据更新时间 |
| membersTimestamp | serverDate | 成员时间戳 | 成员数据更新时间 |
| dataTimestamp | serverDate | 数据时间戳 | 统计数据更新时间，用于月度统计增量刷新 |
| createdAt | serverDate | 创建时间 | |

---

## 2. lunch_members（成员）

| 数据库字段 | 类型 | 中文含义 | CSV列名别名 | 说明 |
|-----------|------|---------|------------|------|
| _id | string | 成员ID | | 系统自动生成 |
| groupId | string | 组织ID | | 固定为 `lunch_hp` |
| name | string | 姓名 | 姓名 / name / name list / 名单 | 成员真实姓名 |
| nickName | string | 昵称 | 昵称 / nickname / nick name | 微信昵称 |
| avatar | string | 头像 | | 头像URL，默认空 |
| openid | string | 微信openid | | 虚拟用户为空字符串 |
| role | string | 角色 | 角色 / role | 见角色枚举 |
| isVirtual | boolean | 是否虚拟用户 | 虚拟用户 / virtual | `true`=虚拟(代点)，`false`=真实微信用户 |
| privacyAgreed | boolean | 是否同意隐私 | | |
| joinedAt | serverDate | 加入时间 | | |

### 角色枚举（role）

| 常量值 | 英文 | 中文 | 权限 |
|--------|------|------|------|
| creator | creator | 创建者 | 最高权限，可设置管理员、清除数据 |
| admin | admin | 管理员 | 可确认订单、管理菜单/成员 |
| member | member | 普通成员 | 可点餐、修改自己姓名 |

---

## 3. lunch_menu（菜单）

| 数据库字段 | 类型 | 中文含义 | CSV列名别名 | 说明 |
|-----------|------|---------|------------|------|
| _id | string | 菜品ID | | 系统自动生成 |
| groupId | string | 组织ID | | 固定为 `lunch_hp` |
| supplier | string | 供应商 | 供应商 / vendor | 供应商/商家名称 |
| name | string | 菜品名 | 菜品名 / 菜品 / order / description | 菜品名称 |
| price | number | 价格 | 价格 / 金额 / price / rmb | 菜品单价 |
| photo | string | 图片 | | 菜品图片URL，默认空 |
| visible | boolean | 是否可见 | 可见 / visible | `true`=上架，`false`=下架 |
| sortNo | number | 排序号 | | 数值越大越靠后，默认步进10 |
| createdAt | serverDate | 创建时间 | | |

---

## 4. lunch_orders（订单）

| 数据库字段 | 类型 | 中文含义 | CSV列名别名 | 说明 |
|-----------|------|---------|------------|------|
| _id | string | 订单ID | | 系统自动生成 |
| groupId | string | 组织ID | | 固定为 `lunch_hp` |
| date | string | 日期 | 日期 / date | 格式 `YYYY-MM-DD` |
| memberId | string | 成员ID | | 关联 members._id |
| memberName | string | 成员姓名 | 姓名 / name / name list / 名单 | 冗余存储，方便查询 |
| menuId | string | 菜品ID | | 关联 menu._id |
| menuName | string | 菜品名 | 菜品 / 菜品名 / order / description | 冗余存储，方便查询 |
| supplier | string | 供应商 | 供应商 / vendor | 冗余存储，来自菜单 |
| price | number | 金额 | 金额 / 价格 / price / rmb | 订单金额 |
| note | string | 备注 | 备注 / note / comment / column1 | |
| status | string | 状态 | 状态 / status | 见订单状态枚举 |
| createdBy | string | 创建者openid | | 下单人的微信openid |
| createdAt | serverDate | 创建时间 | | |
| updatedAt | serverDate | 更新时间 | | |

### 订单状态枚举（status）

| 常量值 | 英文 | 中文 | 说明 |
|--------|------|------|------|
| pending | pending | 待确认 | 刚提交的订单 |
| confirmed | confirmed | 已确认 | 管理员确认后的订单 |
| cancelled | cancelled | 已取消 | 被取消的订单，不计入月度统计 |

---

## 5. lunch_monthly_stats（月度统计）

| 数据库字段 | 类型 | 中文含义 | 说明 |
|-----------|------|---------|------|
| _id | string | 统计ID | 系统自动生成 |
| groupId | string | 组织ID | 固定为 `lunch_hp` |
| year | number | 年份 | 如 2026 |
| month | number | 月份 | 1-12 |
| totalAmount | number | 总金额 | 该月已确认订单总金额 |
| orderCount | number | 订单数 | 该月已确认订单数（旧字段名 `count` 兼容） |
| orderByMember | array | 按成员统计 | 数组，每项含 `memberId`、`memberName`、`amount`、`count` |
| orderBySupplier | array | 按供应商统计 | 数组，每项含 `supplier`、`amount`、`count` |
| orderByMemberMap | object | 按成员统计(映射) | `{ "成员名": 金额 }` 格式，前端直接使用 |
| orderBySupplierMap | object | 按供应商统计(映射) | `{ "供应商名": 金额 }` 格式，前端直接使用 |
| createdAt | serverDate | 创建时间 | |
| updatedAt | serverDate | 更新时间 | |

### 前端格式化后的字段（_formatStatDoc）

| 返回字段 | 来源 | 说明 |
|---------|------|------|
| _id | doc._id | |
| year | doc.year | |
| month | doc.month | |
| totalAmount | doc.totalAmount | |
| orderCount | doc.orderCount 或 doc.count | 兼容旧字段 |
| orderByMember | doc.orderByMemberMap 或从数组转换 | `{ "成员名": 金额 }` |
| orderBySupplier | doc.orderBySupplierMap 或从数组转换 | `{ "供应商名": 金额 }` |

---

## 6. lunch_backups（备份）

| 数据库字段 | 类型 | 中文含义 | 说明 |
|-----------|------|---------|------|
| _id | string | 备份ID | 系统自动生成 |
| type | string | 备份类型 | `auto`=自动备份，`manual`=手动备份 |
| createdAt | serverDate | 创建时间 | |
| orderCount | number | 订单数 | 备份时订单数量 |
| menuCount | number | 菜单数 | 备份时菜单数量 |
| memberCount | number | 成员数 | 备份时成员数量 |
| dateRange | object | 日期范围 | `{ start: "最早日期", end: "最晚日期" }`，可能为 null |
| remark | string | 备注 | 手动备份可填写备注 |
| data | string | 备份数据 | JSON字符串，包含 `{ orders, menu, members }` |

### 备份保留策略

| 类型 | 最大保留数 |
|------|-----------|
| auto（自动） | 8 |
| manual（手动） | 10 |

---

## CSV 导入导出列名映射

### 订单 CSV

**导出表头**：`日期,菜品,姓名,金额,备注,状态,供应商`

| CSV列名 | 数据库字段 | 导入时识别的列名别名 |
|---------|-----------|-------------------|
| 日期 | date | 日期 / date |
| 菜品 | menuName | 菜品 / 菜品名 / order / description |
| 姓名 | memberName | 姓名 / name / name list / 名单 |
| 金额 | price | 金额 / 价格 / price / rmb |
| 备注 | note | 备注 / note / comment / column1 |
| 状态 | status | 状态 / status |
| 供应商 | supplier | 供应商 / vendor |

**状态值映射**（导入时中文→英文）：

| 中文 | 数据库值 |
|------|---------|
| 待确认 | pending |
| 已确认 | confirmed |
| 已取消 | cancelled |

### 菜单 CSV

**导出表头**：`供应商,菜品名,价格,可见`

| CSV列名 | 数据库字段 | 导入时识别的列名别名 |
|---------|-----------|-------------------|
| 供应商 | supplier | 供应商 / vendor |
| 菜品名 | name | 菜品名 / 菜品 / order / description |
| 价格 | price | 价格 / 金额 / price / rmb |
| 可见 | visible | 可见 / visible |

**可见值映射**：`否` → `false`，其他 → `true`

### 成员 CSV

**导出表头**：`姓名,昵称,角色,虚拟用户`

| CSV列名 | 数据库字段 | 导入时识别的列名别名 |
|---------|-----------|-------------------|
| 姓名 | name | 姓名 / name / name list / 名单 |
| 昵称 | nickName | 昵称 / nickname / nick name |
| 角色 | role | 角色 / role |
| 虚拟用户 | isVirtual | 虚拟用户 / virtual |

**虚拟用户值映射**：`否` → `false`，其他 → `true`

---

## 前端 Store 字段与数据库的对应关系

| Store 字段 | 来源 | 说明 |
|-----------|------|------|
| member | lunch_members | 当前登录成员对象 |
| role | member.role | 当前用户角色 |
| groupId | member.groupId | 当前组织ID |
| menu | lunch_menu | 菜单列表 |
| members | lunch_members | 成员列表 |
| recentOrders | lunch_orders | 最近订单列表 |
| monthSummary | 聚合计算 | `{ totalAmount, count, yearMonth }` |
| recentTimestamp | lunch_groups.ordersTimestamp | 订单数据时间戳 |
| menuTimestamp | lunch_groups.menuTimestamp | 菜单数据时间戳 |
| membersTimestamp | lunch_groups.membersTimestamp | 成员数据时间戳 |
