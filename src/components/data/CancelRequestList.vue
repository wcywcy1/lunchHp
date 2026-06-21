<template>
  <view class="cancel-request-list">
    <view class="section-header">
      <text class="section-title">取消申请</text>
    </view>
    <view v-if="requests.length === 0" class="empty-tip">
      <text>暂无取消申请</text>
    </view>
    <view v-for="order in requests" :key="order._id" class="request-item">
      <view class="order-item">
        <text class="order-name">{{ order.memberName }}</text>
        <text class="order-menu">{{ order.menuName }}</text>
        <text class="order-price">¥{{ order.price }}</text>
      </view>
      <view class="action-row">
        <view class="approve-btn" @tap="$emit('approve', order._id)"><text>同意取消</text></view>
        <view class="reject-btn" @tap="$emit('reject', order._id)"><text>拒绝</text></view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  requests: any[]
}>()

defineEmits<{
  (e: 'approve', id: string): void
  (e: 'reject', id: string): void
}>()
</script>

<style scoped>
.cancel-request-list {
  margin: 0 32rpx 24rpx;
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
}
.empty-tip {
  padding: 40rpx 0;
  text-align: center;
  color: #ccc;
  font-size: 28rpx;
}
.request-item {
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}
.request-item:last-of-type {
  border-bottom: none;
}
.order-item {
  display: flex;
  align-items: center;
}
.order-name {
  width: 240rpx;
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
.action-row {
  display: flex;
  gap: 16rpx;
  margin-top: 16rpx;
}
.approve-btn {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  background: #d32f2f;
  color: #fff;
}
.reject-btn {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  background: #fff;
  color: #666;
  border: 1rpx solid #ddd;
}
</style>
