<template>
  <view class="pending-list">
    <view class="section-header">
      <view
        v-if="orders.length > 0"
        :class="['checkbox', isAllSelected ? 'checked' : '']"
        @tap="$emit('toggle-all')"
      >
        <text v-if="isAllSelected" class="check-mark">✓</text>
      </view>
      <text class="section-title">待确认订单</text>
    </view>
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
      <view :class="['confirm-btn', confirming ? 'disabled' : '']" @tap="$emit('batch-confirm')">
        <text>{{ confirming ? '确认中...' : '批量确认' }}</text>
      </view>
      <view :class="['cancel-btn', cancelling ? 'disabled' : '']" @tap="$emit('batch-cancel')">
        <text>{{ cancelling ? '取消中...' : '批量取消' }}</text>
      </view>
    </view>

    <view v-if="historyCount > 0" class="history-entry" @tap="$emit('toggle-history')">
      <text class="history-entry-text">历史订单（{{ historyCount }}条）</text>
      <text class="history-entry-arrow">{{ showHistory ? '▲' : '▼' }}</text>
    </view>
    <view v-if="showHistory" class="history-section">
      <view v-for="group in historyGroups" :key="group.date" class="date-group">
        <text class="date-title">{{ group.date }}</text>
        <view v-for="order in group.orders" :key="order._id" class="order-item">
          <text class="order-name">{{ order.memberName }}</text>
          <text class="order-menu">{{ order.menuName }}</text>
          <text class="order-price">¥{{ order.price }}</text>
        </view>
      </view>
      <view v-if="historyHasMore" class="load-more" @tap="$emit('load-more-history')">
        <text>{{ loadingHistory ? '加载中...' : '加载更多' }}</text>
      </view>
      <view v-if="!historyHasMore && historyOrders.length > 0" class="no-more">
        <text>没有更多了</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  orders: any[]
  selectedIds: string[]
  isAllSelected: boolean
  confirming: boolean
  cancelling: boolean
  historyCount: number
  historyOrders: any[]
  historyHasMore: boolean
  loadingHistory: boolean
  showHistory: boolean
}>()

defineEmits<{
  (e: 'toggle', id: string): void
  (e: 'toggle-all'): void
  (e: 'batch-confirm'): void
  (e: 'batch-cancel'): void
  (e: 'toggle-history'): void
  (e: 'load-more-history'): void
}>()

const historyGroups = computed(() => {
  const map: Record<string, any[]> = {}
  props.historyOrders.forEach(o => {
    const key = o.date || '未知日期'
    if (!map[key]) map[key] = []
    map[key].push(o)
  })
  return Object.entries(map).map(([date, orders]) => ({ date, orders }))
})
</script>

<style scoped>
.pending-list {
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
  flex: 4;
  font-size: 28rpx;
  color: #333;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-menu {
  flex: 6;
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
  gap: 16rpx;
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #f0f0f0;
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
.cancel-btn {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  background: #fff;
  color: #d32f2f;
  border: 1rpx solid #d32f2f;
}
.cancel-btn.disabled {
  color: #ccc;
  border-color: #ccc;
}
.history-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0;
  margin-top: 16rpx;
  border-top: 1rpx dashed #ddd;
}
.history-entry-text {
  font-size: 28rpx;
  color: #1976d2;
}
.history-entry-arrow {
  font-size: 24rpx;
  color: #1976d2;
}
.history-section {
  margin-top: 8rpx;
}
.date-group {
  margin-bottom: 12rpx;
}
.date-title {
  display: block;
  padding: 8rpx 0;
  font-size: 26rpx;
  font-weight: bold;
  color: #999;
  border-bottom: 1rpx solid #f0f0f0;
}
.load-more {
  text-align: center;
  padding: 20rpx 0;
  font-size: 28rpx;
  color: #1976d2;
}
.no-more {
  text-align: center;
  padding: 16rpx 0;
  font-size: 24rpx;
  color: #ccc;
}
</style>