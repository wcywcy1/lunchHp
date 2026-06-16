<template>
  <view class="pending-list">
    <text class="section-title">待确认订单</text>
    <view v-if="orders.length === 0" class="empty-tip">
      <text>暂无待确认订单</text>
    </view>
    <view v-for="order in orders" :key="order._id" class="order-item">
      <view
        :class="['checkbox', selectedIds.includes(order._id) ? 'checked' : '']"
        @tap="$emit('toggle', order._id)"
      >
        <text v-if="selectedIds.includes(order._id)" class="check-mark">✓</text>
      </view>
      <text class="order-name">{{ order.memberName }}</text>
      <text class="order-menu">{{ order.menuName }}</text>
      <text class="order-price">¥{{ order.price }}</text>
    </view>
    <view v-if="orders.length > 0" class="batch-actions">
      <view :class="['select-all-btn', isAllSelected ? 'active' : '']" @tap="$emit('toggle-all')">
        <text>{{ isAllSelected ? '取消全选' : '全选' }}</text>
      </view>
      <view :class="['confirm-btn', confirming ? 'disabled' : '']" @tap="$emit('batch-confirm')">
        <text>{{ confirming ? '确认中...' : '批量确认' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  orders: any[]
  selectedIds: string[]
  isAllSelected: boolean
  confirming: boolean
}>()

defineEmits<{
  (e: 'toggle', id: string): void
  (e: 'toggle-all'): void
  (e: 'batch-confirm'): void
}>()
</script>

<style scoped>
.pending-list {
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
.checkbox {
  width: 40rpx;
  height: 40rpx;
  border: 2rpx solid #ddd;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 16rpx;
  flex-shrink: 0;
}
.checkbox.checked {
  background: #1976d2;
  border-color: #1976d2;
}
.check-mark {
  font-size: 24rpx;
  color: #fff;
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
.batch-actions {
  display: flex;
  gap: 24rpx;
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #f0f0f0;
}
.select-all-btn {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  background: #f5f5f5;
  color: #666;
}
.select-all-btn.active {
  background: #e3f2fd;
  color: #1976d2;
}
.confirm-btn {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  background: #1976d2;
  color: #fff;
}
.confirm-btn.disabled {
  background: #ccc;
}
</style>