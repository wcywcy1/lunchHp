<template>
  <view class="monthly-stats">
    <view class="stat-card">
      <text class="stat-label">月合计</text>
      <text class="stat-amount">{{ monthCount }}</text>
    </view>
    <view class="stat-card">
      <text class="stat-label">今日</text>
      <text class="stat-amount today">{{ todayCount }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  monthCount: number
  todayCount: number
}>()
</script>

<style scoped>
.monthly-stats {
  display: flex;
  gap: 24rpx;
  padding: 24rpx 32rpx;
}
.stat-card {
  flex: 1;
  background: #fff;
  border-radius: 16rpx;
  padding: 28rpx 24rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
}
.stat-label {
  font-size: 24rpx;
  color: #999;
}
.stat-amount {
  font-size: 40rpx;
  font-weight: bold;
  color: #e65100;
}
.stat-amount.today {
  color: #1976d2;
}
</style>
