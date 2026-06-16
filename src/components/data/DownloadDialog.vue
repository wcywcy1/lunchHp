<template>
  <view v-if="show" class="modal-mask" @tap="$emit('close')">
    <view class="download-modal" @tap.stop>
      <text class="modal-title">下载确认单</text>
      <view class="radio-group">
        <view
          :class="['radio-item', mode === 'supplier' ? 'active' : '']"
          @tap="$emit('update:mode', 'supplier')"
        >
          <view :class="['radio-dot', mode === 'supplier' ? 'checked' : '']"></view>
          <text class="radio-label">按供应商分别下载</text>
        </view>
        <view
          :class="['radio-item', mode === 'all' ? 'active' : '']"
          @tap="$emit('update:mode', 'all')"
        >
          <view :class="['radio-dot', mode === 'all' ? 'checked' : '']"></view>
          <text class="radio-label">一并下载</text>
        </view>
      </view>
      <view class="modal-actions">
        <view class="modal-btn cancel" @tap="$emit('close')"><text>取消</text></view>
        <view :class="['modal-btn confirm', downloading ? 'disabled' : '']" @tap="$emit('confirm')">
          <text>{{ downloading ? '下载中...' : '确认下载' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  show: boolean
  mode: 'supplier' | 'all'
  downloading: boolean
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'update:mode', val: 'supplier' | 'all'): void
  (e: 'confirm'): void
}>()
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
.download-modal {
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
  margin-bottom: 32rpx;
}
.radio-group {
  margin-bottom: 32rpx;
}
.radio-item {
  display: flex;
  align-items: center;
  padding: 20rpx 16rpx;
  border-radius: 12rpx;
  margin-bottom: 12rpx;
}
.radio-item.active {
  background: #e3f2fd;
}
.radio-dot {
  width: 36rpx;
  height: 36rpx;
  border: 2rpx solid #ddd;
  border-radius: 50%;
  margin-right: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.radio-dot.checked {
  border-color: #1976d2;
}
.radio-dot.checked::after {
  content: '';
  width: 20rpx;
  height: 20rpx;
  background: #1976d2;
  border-radius: 50%;
}
.radio-label {
  font-size: 28rpx;
  color: #333;
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
</style>