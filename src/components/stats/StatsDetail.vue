<template>
  <view class="stats-detail">
    <text class="section-title">详单</text>
    <view v-if="orders.length === 0 && !loading" class="empty-tip">
      <text>点击筛选后查看详单</text>
    </view>
    <view v-else class="detail-table">
      <view class="detail-header">
        <text class="col-date">日期</text>
        <text class="col-name">姓名</text>
        <text class="col-menu">餐品</text>
        <text class="col-price">金额</text>
        <text class="col-supplier">供应商</text>
      </view>
      <view
        v-for="order in orders"
        :key="order._id"
        class="detail-row"
      >
        <text class="col-date">{{ formatDate(order.date) }}</text>
        <text class="col-name">{{ order.memberName }}</text>
        <text class="col-menu">{{ order.menuName }}</text>
        <text class="col-price">{{ order.price }}</text>
        <text class="col-supplier">{{ order.supplier || '未定义' }}</text>
      </view>
    </view>
    <view v-if="loading" class="loading-tip">
      <text>加载中...</text>
    </view>
    <view v-else-if="hasMore" class="more-btn" @tap="$emit('load-more')">
      <text>展开更多</text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  orders: any[]
  loading: boolean
  hasMore: boolean
}>()

defineEmits<{
  (e: 'load-more'): void
}>()

function formatDate(date: string) {
  if (!date) return ''
  const parts = date.split('-')
  if (parts.length === 3) {
    return `${parts[1]}-${parts[2]}`
  }
  return date
}
</script>

<style scoped>
.stats-detail {
  margin: 24rpx 32rpx 0;
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
.empty-tip {
  padding: 40rpx 0;
  text-align: center;
  color: #ccc;
  font-size: 28rpx;
}
.detail-table {
  width: 100%;
  overflow: hidden;
}
.detail-header {
  display: flex;
  padding: 12rpx 0;
  border-bottom: 2rpx solid #eee;
}
.detail-header text {
  font-size: 22rpx;
  color: #999;
  font-weight: bold;
}
.detail-row {
  display: flex;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f5f5f5;
  align-items: center;
}
.detail-row:last-child {
  border-bottom: none;
}
.detail-row text {
  font-size: 24rpx;
  color: #333;
}
.col-date {
  width: 100rpx;
  flex-shrink: 0;
  color: #666 !important;
}
.col-name {
  width: 160rpx;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-menu {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-price {
  width: 80rpx;
  flex-shrink: 0;
  text-align: right;
  color: #e65100 !important;
}
.col-supplier {
  width: 90rpx;
  flex-shrink: 0;
  text-align: right;
  font-size: 22rpx !important;
  color: #999 !important;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.loading-tip {
  padding: 24rpx 0;
  text-align: center;
  color: #999;
  font-size: 26rpx;
}
.more-btn {
  margin-top: 16rpx;
  text-align: center;
  padding: 16rpx;
  background: #f5f5f5;
  border-radius: 8rpx;
  font-size: 26rpx;
  color: #1976d2;
}
</style>