<template>
  <view class="stats-summary">
    <view class="summary-card">
      <text class="summary-label">总金额</text>
      <text class="summary-amount">{{ formattedAmount }}</text>
    </view>
    <view class="summary-card">
      <text class="summary-label">订单数</text>
      <text class="summary-count">{{ totalCount }}笔</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  totalAmount: number
  totalCount: number
}>()

const formattedAmount = computed(() => {
  const n = props.totalAmount || 0
  return n.toLocaleString('zh-CN')
})
</script>

<style scoped>
.stats-summary {
  display: flex;
  gap: 24rpx;
  padding: 24rpx 32rpx;
}
.summary-card {
  flex: 1;
  background: #fff;
  border-radius: 16rpx;
  padding: 28rpx 24rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
}
.summary-label {
  font-size: 24rpx;
  color: #999;
}
.summary-amount {
  font-size: 40rpx;
  font-weight: bold;
  color: #e65100;
}
.summary-count {
  font-size: 40rpx;
  font-weight: bold;
  color: #1976d2;
}
</style>