<template>
  <view class="menu-edit-bar">
    <view class="add-btn" @tap="$emit('add')">
      <text class="add-icon">＋</text>
      <text class="add-text">添加菜品</text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineEmits<{
  (e: 'add'): void
}>()
</script>

<style scoped>
.menu-edit-bar {
  padding: 0 24rpx 16rpx;
}
.add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 16rpx;
  background: #e3f2fd;
  border-radius: 12rpx;
}
.add-icon {
  font-size: 32rpx;
  color: #1976d2;
  font-weight: bold;
}
.add-text {
  font-size: 28rpx;
  color: #1976d2;
}
</style>