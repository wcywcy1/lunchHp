<template>
  <view class="card-section">
    <text class="section-title">数据备份</text>
    <view class="btn-row">
      <view :class="['action-btn', backingUp ? 'disabled' : '']" @tap="$emit('backup')">
        <text>{{ backingUp ? '备份中...' : '立即备份' }}</text>
      </view>
      <view class="action-btn" @tap="$emit('restore')">
        <text>恢复备份</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  backingUp: boolean
}>()

defineEmits<{
  (e: 'backup'): void
  (e: 'restore'): void
}>()
</script>

<style scoped>
.card-section {
  margin: 0 32rpx 24rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
}
.section-title {
  font-size: 30rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 16rpx;
  display: block;
}
.btn-row {
  display: flex;
  gap: 24rpx;
}
.action-btn {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  background: #f5f5f5;
  color: #333;
}
.action-btn.disabled {
  color: #999;
}
</style>