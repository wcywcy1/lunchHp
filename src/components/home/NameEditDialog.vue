<template>
  <view v-if="show" class="modal-mask" @tap="$emit('close')">
    <view class="edit-modal name-edit-modal" :style="modalStyle" @tap.stop>
      <text class="modal-title">修改姓名</text>
      <view class="avatar-section">
        <button class="avatar-btn" open-type="chooseAvatar" @chooseavatar="$emit('choose-avatar', $event)">
          <image v-if="avatar" class="avatar-img" :src="avatar" mode="aspectFill" />
          <view v-else class="avatar-placeholder">
            <text class="avatar-placeholder-text">选头像</text>
          </view>
        </button>
        <text class="avatar-hint">点击设置头像（选填）</text>
      </view>
      <view class="current-name">
        <text class="current-label">当前：</text>
        <text class="current-value">{{ currentName || '未设置' }}</text>
      </view>
      <view class="form-item">
        <text class="form-label">新姓名</text>
        <input
          class="form-input"
          :value="newName"
          placeholder="输入姓名，可点键盘上方使用微信昵称"
          type="nickname"
          @input="onInput"
          @keyboardheightchange="onKeyboardHeightChange"
        >
      </view>
      <view class="modal-actions">
        <view class="modal-btn cancel" @tap="$emit('close')"><text>取消</text></view>
        <view class="modal-btn confirm" @tap="$emit('save')"><text>保存</text></view>
      </view>
      <view v-if="hasVirtualMembers" class="link-section">
        <view class="link-divider">
          <view class="divider-line" />
          <text class="divider-text">或</text>
          <view class="divider-line" />
        </view>
        <view class="link-btn" @tap="$emit('open-link')">
          <text class="link-text">🔗 关联已有记录</text>
        </view>
      </view>
    </view>

    <view v-if="showLinkList" class="link-list-panel" @tap.stop>
      <text class="link-list-title">选择要关联的记录</text>
      <scroll-view scroll-y class="link-list-scroll">
        <view
          v-for="m in virtualMembers"
          :key="m._id"
          :class="['link-list-item', selectedId === m._id ? 'selected' : '']"
          @tap="$emit('select-virtual', m._id)"
        >
          <text>{{ m.name || m.nickName || '未命名' }}</text>
          <text class="virtual-tag">未登录</text>
        </view>
      </scroll-view>
      <view class="link-list-actions">
        <view class="modal-btn cancel" @tap="$emit('close-link')"><text>取消</text></view>
        <view :class="['modal-btn confirm', !selectedId ? 'disabled' : '']" @tap="$emit('confirm-link')"><text>关联</text></view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useModalKeyboardAvoid } from '../../hooks/useModalKeyboardAvoid'

const props = defineProps<{
  show: boolean
  currentName: string
  newName: string
  avatar: string
  hasVirtualMembers: boolean
  showLinkList: boolean
  virtualMembers: any[]
  selectedId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save'): void
  (e: 'open-link'): void
  (e: 'close-link'): void
  (e: 'select-virtual', id: string): void
  (e: 'confirm-link'): void
  (e: 'update:newName', val: string): void
  (e: 'choose-avatar', val: any): void
}>()

const { modalStyle, onKeyboardHeightChange, reset } = useModalKeyboardAvoid({
  modalSelector: '.name-edit-modal'
})

watch(() => props.show, (val) => {
  if (!val) reset()
})

function onInput(e: any) {
  emit('update:newName', e.detail.value)
}
</script>

<style scoped>
.modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.edit-modal {
  width: 600rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 40rpx;
}
.modal-title {
  display: block;
  font-size: 32rpx;
  font-weight: bold;
  text-align: center;
  margin-bottom: 24rpx;
}
.avatar-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 24rpx;
}
.avatar-btn {
  width: 128rpx;
  height: 128rpx;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  line-height: normal;
}
.avatar-btn::after {
  border: none;
}
.avatar-img {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
}
.avatar-placeholder {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  background: #e3f2fd;
  display: flex;
  align-items: center;
  justify-content: center;
}
.avatar-placeholder-text {
  font-size: 24rpx;
  color: #1976d2;
}
.avatar-hint {
  font-size: 22rpx;
  color: #999;
  margin-top: 8rpx;
}
.current-name {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}
.current-label {
  font-size: 26rpx;
  color: #999;
}
.current-value {
  font-size: 26rpx;
  color: #333;
}
.form-item {
  display: flex;
  align-items: center;
  margin-bottom: 24rpx;
  gap: 16rpx;
}
.form-label {
  width: 120rpx;
  font-size: 28rpx;
  color: #333;
  flex-shrink: 0;
}
.form-input {
  flex: 1;
  padding: 12rpx 16rpx;
  border: 1rpx solid #ddd;
  border-radius: 8rpx;
  font-size: 28rpx;
}
.modal-actions {
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
.modal-btn.disabled {
  background: #ccc;
}
.link-section {
  margin-top: 24rpx;
}
.link-divider {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 20rpx;
}
.divider-line {
  flex: 1;
  height: 1rpx;
  background: #ddd;
}
.divider-text {
  font-size: 24rpx;
  color: #999;
}
.link-btn {
  text-align: center;
  padding: 16rpx 0;
  border: 1rpx solid #1976d2;
  border-radius: 12rpx;
}
.link-text {
  font-size: 28rpx;
  color: #1976d2;
}
.link-list-panel {
  position: absolute;
  width: 600rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 32rpx;
}
.link-list-title {
  display: block;
  font-size: 30rpx;
  font-weight: bold;
  text-align: center;
  margin-bottom: 20rpx;
}
.link-list-scroll {
  max-height: 400rpx;
}
.link-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 16rpx;
  border-bottom: 1rpx solid #f0f0f0;
  font-size: 28rpx;
}
.link-list-item.selected {
  background: #e3f2fd;
  color: #1976d2;
}
.virtual-tag {
  font-size: 22rpx;
  color: #999;
  background: #f0f0f0;
  padding: 2rpx 12rpx;
  border-radius: 4rpx;
}
.link-list-actions {
  display: flex;
  gap: 24rpx;
  margin-top: 20rpx;
}
</style>