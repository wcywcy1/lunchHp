# 键盘避让标准方案

## 适用场景
小程序页面含底部固定按钮（提交/确认）+ 表单输入框，键盘弹起时需同时满足：
1. 固定按钮不被键盘遮挡
2. 当前聚焦输入框不被固定按钮遮挡
3. 固定按钮与键盘间隙不透出背后内容

## 核心组件
`hooks/useKeyboardAvoid.js` —— 封装键盘监听、fixed 上浮、page 撑高、自动滚动、背景遮挡五件事。

## 接入步骤

### 1. 引入 hook
```js
import useKeyboardAvoid from '../../hooks/useKeyboardAvoid.js'
var kb = useKeyboardAvoid({
  fixedSelector: '.submit-area',   // 固定按钮区选择器
  contentSelector: '.form-card',   // 需保持可见的内容区选择器（通常是最底层表单卡）
  gap: 16,                          // 固定区与键盘/内容的间距 rpx
  fixedHeight: 88                   // 固定区高度 rpx，用于撑高 page
})
```

### 2. 生命周期绑定
```js
onShow(function () { kb.bind() })
onHide(function () { kb.unbind() })
```

### 3. 模板绑定
```html
<!-- page 绑定动态 padding（键盘弹起时撑高） -->
<view class="page" :style="kb.pageStyle.value">
  <view class="form-card">...</view>

  <!-- 固定区绑定 class + style（键盘弹起时变 fixed 上浮） -->
  <!-- 安卓兼容：弹窗打开时必须 v-if 隐藏，否则 fixed 元素穿透遮挡弹窗 -->
  <view v-if="!showShareModal && !showAddMemberModal" class="submit-area" :class="kb.fixedClass.value" :style="kb.fixedStyle.value">
    <view class="submit-btn">提交</view>
  </view>
</view>
```

### 4. 样式约定（必须）
```css
/* 固定区默认流式，键盘弹起时变 fixed */
.submit-area { margin: 0 24rpx 24rpx 24rpx; display: flex; align-items: center; gap: 16rpx; }
.submit-area.keyboard-up {
  position: fixed; left: 24rpx; right: 24rpx; z-index: 1000;
  transition: bottom 0.25s ease;
  padding-bottom: 16rpx;              /* 挡住与键盘的间隙背景 */
  background: #f5f5f5;                /* 与页面同色 */
}
.submit-area.keyboard-up .submit-btn { margin-bottom: -16rpx; }  /* 抵消 padding，按钮位置不变 */

/* page 默认 padding 只给 TabBar 留空间 */
.page { padding-bottom: calc(100rpx + env(safe-area-inset-bottom) + 24rpx); }
```

## 工作原理

| 键盘状态 | 固定区 | page | 滚动 |
|---------|-------|------|------|
| 收起 | 流式，跟在内容后 | 默认 padding | 无 |
| 弹起 | fixed，bottom=键盘高度 | padding += 键盘高度+固定区高度+间距 | 量内容区底部，若被固定区遮挡则滚动补差 |

### 滚动算法
```
fixedTop = 固定区顶部相对视口 y
contentBottom = 内容区底部相对视口 y
pageTop = .page 顶部相对视口 y（页面滚动时为负）
若 contentBottom > fixedTop - gap：
  delta = contentBottom - (fixedTop - gap)
  目标 scrollTop = -pageTop + delta
```

## 参数说明

| 参数 | 默认 | 说明 |
|------|------|------|
| fixedSelector | '.submit-area' | 固定按钮区选择器 |
| contentSelector | '.form-card' | 需保持可见的内容区选择器 |
| gap | 16 | 间距 rpx，同时用于键盘间距和滚动留白 |
| fixedHeight | 88 | 固定区高度 rpx，用于计算 page 撑高量 |
| scrollDelay | 250 | 键盘动画结束后再量位置的延迟 ms |

## 注意事项
- `contentSelector` 应选最底层表单卡（含备注等输入框），其 bottom 即需保持可见的边界
- `fixedHeight` 需与实际固定区高度一致，否则 page 撑高不足导致滚动不到底
- 若页面无 TabBar，调整 `.page` 默认 padding-bottom 即可
- hook 已在 `onUnmounted` 自动解绑，onHide 调 `unbind()` 是双保险
- **安卓兼容**：页面有弹窗时，固定区必须加 `v-if` 条件渲染（弹窗打开时隐藏），否则安卓上 fixed 元素会穿透遮挡弹窗（详见"安卓兼容性修复记录"）

---

# 弹窗键盘避让方案

## 适用场景
页面弹出居中模态框（modal-mask + 居中 modal），内含输入框，键盘弹起时需满足：
1. 弹窗底部确认/取消按钮不被键盘遮挡
2. 仅当弹窗真的被遮挡时才上移，且只上移刚好不被遮挡的量（不粗暴上移半个键盘高度）

## 核心组件
`hooks/useModalKeyboardAvoid.ts` —— 监听 input 的 `@keyboardheightchange`，量弹窗实际高度，精确计算上移量。

## 接入步骤

### 1. 引入 hook
```ts
import { useModalKeyboardAvoid } from '../../hooks/useModalKeyboardAvoid'

const { modalStyle, onKeyboardHeightChange, reset } = useModalKeyboardAvoid({
  modalSelector: '.my-modal',        // 弹窗选择器，用于量高度
  gap: 16,                            // 弹窗底部与键盘顶部的间距 px
  centeredByTransform: false          // 弹窗是否用 translate(-50%,-50%) 居中
})
```

### 2. 模板绑定
```html
<view class="modal-mask">
  <!-- 弹窗绑定 modalStyle（键盘弹起时上移） -->
  <view class="my-modal" :style="modalStyle">
    <input @keyboardheightchange="onKeyboardHeightChange" />
    <view class="modal-actions">...</view>
  </view>
</view>
```

### 3. 弹窗关闭时重置
```ts
watch(showModal, (val) => { if (!val) reset() })
```

## 工作原理

| 键盘状态 | 弹窗 | 上移量 |
|---------|------|--------|
| 收起 | 原位 | 0 |
| 弹起且弹窗底部 > 键盘顶部 - gap | 上移 | 弹窗底部 - (键盘顶部 - gap) |
| 弹起但弹窗底部 ≤ 键盘顶部 - gap | 不上移 | 0 |

### 上移量算法
```
modalHeight = 量到的弹窗实际高度
modalBottom = (windowHeight + modalHeight) / 2   // 居中时弹窗原始底部
keyboardTop = windowHeight - kbHeight
若 modalBottom > keyboardTop - gap：
  offset = modalBottom - (keyboardTop - gap)
否则：offset = 0
```

## 参数说明

| 参数 | 默认 | 说明 |
|------|------|------|
| modalSelector | （必填） | 弹窗选择器，用于量高度 |
| gap | 16 | 弹窗底部与键盘顶部的间距 px |
| centeredByTransform | false | true 时用 `translate(-50%, calc(-50% - X))`；false 时用 `translateY(-X)` |

## 两种居中方式的适配
- **flex 居中**（modal-mask 用 `align-items:center; justify-content:center`）：`centeredByTransform: false`，上移用 `translateY`
- **transform 居中**（弹窗用 `position:fixed; top:50%; left:50%; transform:translate(-50%,-50%)`）：`centeredByTransform: true`，上移叠加到原有 transform 上

## 注意事项
- hook 内部已用 `getCurrentInstance()` + `q.in(instance.proxy)` 绑定组件作用域，**页面和自定义组件内都能正确量到节点**（自定义组件内不加 `.in()` 会查不到节点，导致 offset 恒为 0）
- `modalSelector` 必须是弹窗根元素的实际 class，多个弹窗共存时需用不同 class 区分
- 弹窗关闭时务必调 `reset()`，避免下次打开时残留上移量
- 与 `useKeyboardAvoid`（页面级固定按钮避让）互不冲突，可同页面共存

---

## 安卓兼容性修复记录

### 问题描述（iOS 正常，安卓异常）

安卓微信小程序上，当页面弹出模态框（如分摊人选择、添加成员）时，键盘避让的 fixed 提交区域仍显示在弹窗上方，遮挡弹窗内容。iOS 上因渲染差异表现正常。

### 根因

安卓 WebView 对 `position: fixed` 元素的层叠处理与 iOS 不同：
- iOS：弹窗的 `modal-mask`（通常 `z-index` 较高）自然覆盖 fixed 元素
- 安卓：fixed 元素可能突破普通 z-index 层叠上下文，仍渲染在弹窗上方

### 修复方案

**在模板中对提交区域加 `v-if` 条件渲染**，弹窗打开时直接移除提交区域 DOM，而非依赖 z-index 遮挡：

```html
<!-- 弹窗打开时隐藏提交区域，避免安卓 fixed 元素穿透遮挡 -->
<view v-if="!showShareModal && !showAddMemberModal" class="submit-area" :class="kb.fixedClass.value" :style="kb.fixedStyle.value">
  ...
</view>
```

### 修复效果

| 场景 | 修复前（安卓） | 修复后 |
|------|--------------|--------|
| 正常浏览 | 提交按钮和麦克风可见 | ✅ 同左 |
| 键盘弹出 | 提交区域被键盘遮挡 | ✅ 提交区域浮在键盘上方 |
| 弹窗打开 | ❌ 提交区域遮挡弹窗 | ✅ 提交区域隐藏，不遮挡弹窗 |
| 弹窗关闭 | — | ✅ 提交区域恢复显示 |

### 要点

- 此问题属于安卓 WebView 渲染差异，非 hook 逻辑 bug
- 修复方式是模板层 `v-if` 控制，不需要改 `useKeyboardAvoid.js`
- 若页面有多个弹窗，`v-if` 条件需覆盖所有弹窗的显示状态