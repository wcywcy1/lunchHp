<template>
  <view v-if="requests.length > 0" class="cancel-request-list">
    <text class="section-title">取消申请 ({{ requests.length }})</text>
    <view v-for="order in requests" :key="order._id" class="order-item">
      <view class="order-info">
        <text class="order-name">{{ order.memberName }}</text>
        <text class="order-menu">{{ order.menuName }}</text>
        <text class="order-price">¥{{ order.price }}</text>
      </view>
      <view class="action-row">
        <view class="action-btn approve" @tap="$emit('approve', order._id)"><text>同意取消</text></view>
        <view class="action-btn reject" @tap="$emit('reject', order._id)"><text>拒绝</text></view>
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
.section-title {
  font-size: 30rpx;
  font-weight: bold;
  color: #d32f2f;
  margin-bottom: 16rpx;
  display: block;
}
.order-item {
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}
.order-item:last-child {
  border-bottom: none;
}
.order-info {
  display: flex;
  align-items: center;
  margin-bottom: 12rpx;
}
.order-name {
  flex: 4;
  font-size: 28rpx;
  color: #333;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-menu {
  flex: 5;
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
}
.action-btn {
  flex: 1;
  text-align: center;
  padding: 12rpx 0;
  border-radius: 8rpx;
  font-size: 26rpx;
}
.action-btn.approve {
  background: #d32f2f;
  color: #fff;
}
.action-btn.reject {
  background: #f5f5f5;
  color: #666;
}
</style>
