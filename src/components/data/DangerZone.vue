<template>
  <view class="danger-zone">
    <text class="section-title">危险操作</text>
    <view class="danger-btn delete-data" @tap="$emit('delete-data')">
      <text>删除数据</text>
    </view>
    <view class="danger-btn delete-account disabled">
      <text>删除账号</text>
    </view>
    <text class="danger-tip">删除账号不可用：当前组织ID为系统预设</text>
  </view>
</template>

<script setup lang="ts">
defineEmits<{
  (e: 'delete-data'): void
}>()
</script>

<style scoped>
.danger-zone {
  margin: 0 32rpx 24rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
}
.section-title {
  font-size: 30rpx;
  font-weight: bold;
  color: #d32f2f;
  margin-bottom: 16rpx;
  display: block;
}
.danger-btn {
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  margin-bottom: 16rpx;
}
.danger-btn.delete-data {
  background: #fce4ec;
  color: #c62828;
}
.danger-btn.delete-account {
  background: #f5f5f5;
  color: #bbb;
}
.danger-btn.disabled {
  pointer-events: none;
}
.danger-tip {
  font-size: 22rpx;
  color: #999;
  display: block;
  text-align: center;
}
</style>