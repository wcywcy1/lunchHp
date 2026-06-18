<template>
  <view class="today-orders">
    <view class="section-header">
      <text class="section-title">今日点单</text>
      <view v-if="notice" class="notice-scroll-wrap">
        <view class="notice-scroll-inner">
          <text class="notice-scroll-text">{{ notice }}</text>
        </view>
      </view>
    </view>
    <view v-if="orders.length === 0" class="empty-tip">
      <text>暂无点单</text>
    </view>
    <view
      v-for="order in orders"
      :key="order._id"
      class="order-item"
    >
      <text class="order-name">{{ order.memberName }}</text>
      <text class="order-menu">{{ order.menuName }}</text>
      <text class="order-price">¥{{ order.price }}</text>
      <text :class="['order-status', order.status === 'confirmed' ? 'confirmed' : 'pending']">
        {{ order.status === 'confirmed' ? '✅' : '⏳' }}
      </text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  orders: any[]
  notice?: string
}>()
</script>

<style scoped>
.today-orders {
  margin: 0 32rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
}
.section-header {
  display: flex;
  align-items: center;
  margin-bottom: 16rpx;
}
.section-title {
  font-size: 30rpx;
  font-weight: bold;
  color: #333;
  flex-shrink: 0;
  margin-right: 16rpx;
}
.notice-scroll-wrap {
  flex: 1;
  overflow: hidden;
  height: 36rpx;
  line-height: 36rpx;
}
.notice-scroll-inner {
  display: inline-block;
  white-space: nowrap;
  animation: notice-scroll 8s linear infinite;
}
.notice-scroll-text {
  font-size: 24rpx;
  color: #d32f2f;
  font-weight: 500;
}
@keyframes notice-scroll {
  0% { transform: translateX(100%); }
  100% { transform: translateX(-100%); }
}
.empty-tip {
  padding: 40rpx 0;
  text-align: center;
  color: #ccc;
  font-size: 28rpx;
}
.order-item {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}
.order-item:last-child {
  border-bottom: none;
}
.order-name {
  width: 120rpx;
  font-size: 28rpx;
  color: #333;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-menu {
  flex: 1;
  font-size: 28rpx;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-price {
  width: 100rpx;
  text-align: right;
  font-size: 28rpx;
  color: #e65100;
  flex-shrink: 0;
}
.order-status {
  width: 60rpx;
  text-align: center;
  font-size: 28rpx;
  flex-shrink: 0;
}
.order-status.pending {
  color: #f57c00;
}
.order-status.confirmed {
  color: #388e3c;
}
</style>