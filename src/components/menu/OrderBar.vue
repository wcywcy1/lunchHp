<template>
  <view class="order-bar">
    <view v-if="selectedMenuItem" class="selected-info">
      <text class="selected-name">{{ selectedMenuItem.name }}</text>
    </view>
    <view v-else class="selected-info">
      <text class="no-selection">请选择菜品</text>
    </view>

    <view class="order-for-row">
      <view
        :class="['order-for-tab', orderFor === 'self' ? 'active' : '']"
        @tap="$emit('switch-self')"
      >
        <text>为自己点</text>
      </view>
      <view
        :class="['order-for-tab', orderFor === 'help' ? 'active' : '']"
        @tap="$emit('switch-help')"
      >
        <text>{{ orderFor === 'help' && orderForName ? '帮 ' + orderForName + ' 点' : '帮人点' }}</text>
      </view>
    </view>

    <view
      v-if="!selectedMenuItem"
      :class="['submit-btn', 'voice-btn', voiceState !== 'idle' ? 'recording' : '']"
      @tap="$emit('voice-toggle')"
    >
      <text>{{ voiceState === 'recording' ? '点击结束' : voiceState === 'recognizing' ? '识别中...' : '点击说话' }}</text>
    </view>
    <view
      v-else
      :class="['submit-btn', submitting ? 'disabled' : '']"
      @tap="$emit('submit')"
    >
      <text>{{ submitting ? '提交中...' : '提交点餐' }}</text>
    </view>

    <!-- 语音录音遮罩（豆包风格底部面板） -->
    <view v-if="voiceState !== 'idle'" class="voice-mask" @tap="$emit('voice-toggle')">
      <view class="voice-bottom-panel">
        <text class="voice-status">{{ voiceState === 'recognizing' ? '识别中...' : '录音中' }}</text>
        <view v-if="voiceState === 'recording'" class="voice-wave-wrap">
          <view
            v-for="(factor, i) in waveBars" :key="i" class="voice-wave-bar" :style="{
              height: getBarHeight(i) + 'rpx',
              opacity: getBarOpacity(i),
              background: getBarColor(),
              borderRadius: '4rpx'
            }"
          />
        </view>
        <view v-else class="voice-wave-wrap">
          <view class="voice-pulse" />
        </view>
        <text class="voice-tip">{{ voiceState === 'recognizing' ? '请稍候' : '点击结束录音' }}</text>
      </view>
    </view>

    <view v-if="showMemberPicker" class="member-picker-mask" @tap="$emit('close-picker')">
      <view class="member-picker" @tap.stop>
        <text class="picker-title">选择同事</text>
        <scroll-view scroll-y class="picker-list">
          <view
            v-for="m in memberList"
            :key="m._id"
            :class="['picker-item', orderForMemberId === m._id ? 'picked' : '']"
            @tap="$emit('pick-member', m._id)"
          >
            <text>{{ m.name || m.nickName || '未命名' }}</text>
            <text v-if="m.isVirtual" class="virtual-tag">未登录</text>
          </view>
          <view class="picker-item add-member" @tap="$emit('show-add')">
            <text class="add-member-text">＋新增同事</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <view v-if="showAddMember" class="member-picker-mask" @tap="$emit('close-add')">
      <view class="add-member-modal" :style="addModalStyle" @tap.stop>
        <text class="modal-title">新增同事</text>
        <input v-model="localMemberName" class="add-input" placeholder="输入姓名" @keyboardheightchange="onKeyboardHeightChange">
        <view class="modal-btns">
          <view class="modal-btn cancel" @tap="$emit('close-add')"><text>取消</text></view>
          <view class="modal-btn confirm" @tap="$emit('add-virtual', localMemberName)"><text>添加</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useModalKeyboardAvoid } from '../../hooks/useModalKeyboardAvoid'

const props = defineProps<{
  selectedMenuItem: any
  orderFor: string
  orderForMemberId: string
  orderForName: string
  submitting: boolean
  showMemberPicker: boolean
  showAddMember: boolean
  memberList: any[]
  voiceState: string
  voiceVolume?: number
}>()

// 音量条高度/透明度因子：中间条最高，两侧递减，形成波形效果
const waveBars = [0.5, 0.75, 1, 0.75, 0.5]

function getBarHeight(index: number): number {
  const v = props.voiceVolume || 0
  const factor = waveBars[index] || 0.5
  // 基础最小高度 16rpx，最大 96rpx，跟随音量
  const base = 16
  const dynamic = v * factor * 96
  return Math.max(base, Math.min(96, base + dynamic))
}

function getBarOpacity(index: number): number {
  const v = props.voiceVolume || 0
  const factor = waveBars[index] || 0.5
  return Math.max(0.35, 0.35 + v * factor * 0.65)
}

function getBarColor(): string {
  const v = props.voiceVolume || 0
  // 安静：蓝色；中等：橙色；大声：深橙（阈值适配放大后的 0-1 范围）
  if (v > 0.6) return '#e65100'
  if (v > 0.3) return '#f57c00'
  return '#1976d2'
}

defineEmits<{
  (e: 'switch-self'): void
  (e: 'switch-help'): void
  (e: 'submit'): void
  (e: 'voice-toggle'): void
  (e: 'pick-member', memberId: string): void
  (e: 'close-picker'): void
  (e: 'show-add'): void
  (e: 'close-add'): void
  (e: 'add-virtual', name: string): void
}>()

const { modalStyle: addModalStyle, onKeyboardHeightChange, reset: resetKb } = useModalKeyboardAvoid({
  modalSelector: '.add-member-modal',
  centeredByTransform: true
})

const localMemberName = ref('')

watch(() => props.showAddMember, (val) => {
  if (!val) {
    resetKb()
    localMemberName.value = ''
  }
})
</script>

<style scoped>
.order-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(100rpx + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1rpx solid #eee;
  padding: 16rpx 24rpx 16rpx;
  z-index: 100;
}
.selected-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8rpx 0 8rpx 16rpx;
  border-left: 6rpx solid #1976d2;
}
.selected-name {
  font-size: 28rpx;
  color: #333;
  font-weight: bold;
}
.no-selection {
  font-size: 28rpx;
  color: #ccc;
}
.order-for-row {
  display: flex;
  gap: 16rpx;
  margin: 12rpx 0;
}
.order-for-tab {
  flex: 1;
  text-align: center;
  padding: 20rpx 0;
  font-size: 28rpx;
  color: #666;
  background: #f5f5f5;
  border-radius: 8rpx;
}
.order-for-tab.active {
  background: #e3f2fd;
  color: #1976d2;
  font-weight: bold;
}
.submit-btn {
  text-align: center;
  padding: 28rpx 0;
  background: #1976d2;
  color: #fff;
  border-radius: 12rpx;
  font-size: 30rpx;
  font-weight: bold;
}
.submit-btn.disabled {
  background: #ccc;
}
.voice-btn.recording {
  background: #e65100;
}
.voice-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
}
.voice-bottom-panel {
  width: 100%;
  padding: 48rpx 0 calc(60rpx + env(safe-area-inset-bottom));
  background: #fff;
  border-radius: 32rpx 32rpx 0 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32rpx;
}
.voice-status {
  font-size: 30rpx;
  color: #333;
  font-weight: bold;
}
.voice-wave-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  height: 100rpx;
}
.voice-wave-bar {
  width: 12rpx;
  transition: height 0.1s ease-out, background 0.2s ease-out, opacity 0.1s ease-out;
}
.voice-pulse {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: #1976d2;
  opacity: 0.6;
  animation: voicePulse 1s ease-in-out infinite;
}
@keyframes voicePulse {
  0%, 100% { transform: scale(0.6); opacity: 0.4; }
  50% { transform: scale(1.2); opacity: 1; }
}
.voice-tip {
  font-size: 26rpx;
  color: #999;
}
.member-picker-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 150;
  display: flex;
  align-items: flex-end;
}
.member-picker {
  width: 100%;
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  max-height: 60vh;
  padding-bottom: calc(240rpx + env(safe-area-inset-bottom));
}
.picker-title {
  display: block;
  text-align: center;
  padding: 24rpx;
  font-size: 30rpx;
  font-weight: bold;
  border-bottom: 1rpx solid #eee;
}
.picker-list {
  max-height: 50vh;
}
.picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx;
  border-bottom: 1rpx solid #f0f0f0;
  font-size: 28rpx;
}
.picker-item.picked {
  background: #e8f5e9;
  color: #2e7d32;
}
.virtual-tag {
  font-size: 22rpx;
  color: #999;
  background: #f0f0f0;
  padding: 2rpx 12rpx;
  border-radius: 4rpx;
}
.picker-item.add-member {
  justify-content: center;
}
.add-member-text {
  color: #1976d2;
  font-weight: bold;
}
.add-member-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 600rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 40rpx;
}
.modal-title {
  display: block;
  text-align: center;
  font-size: 32rpx;
  font-weight: bold;
  margin-bottom: 24rpx;
}
.add-input {
  padding: 16rpx;
  border: 1rpx solid #ddd;
  border-radius: 8rpx;
  font-size: 28rpx;
  margin-bottom: 24rpx;
}
.modal-btns {
  display: flex;
  gap: 24rpx;
}
.modal-btn {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
}
.modal-btn.cancel {
  background: #f5f5f5;
  color: #666;
}
.modal-btn.confirm {
  background: #1976d2;
  color: #fff;
}
</style>