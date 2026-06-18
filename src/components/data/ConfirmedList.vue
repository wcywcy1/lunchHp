<template>
  <view class="confirmed-list">
    <text class="section-title">已确认订单</text>
    <view v-if="groups.length === 0" class="empty-tip">
      <text>暂无已确认订单</text>
    </view>
    <view v-for="group in groups" :key="group.supplier || '__undefined__'" class="supplier-group">
      <text class="supplier-title">{{ group.supplier || '未定义' }}</text>
      <view v-for="order in group.orders" :key="order._id" class="order-item">
        <text class="order-name">{{ order.memberName }}</text>
        <text class="order-menu">{{ order.menuName }}</text>
        <text class="order-price">¥{{ order.price }}</text>
      </view>
      <view class="subtotal">
        <text class="subtotal-text">小计：¥{{ group.subtotal }}</text>
      </view>
    </view>
    <view v-if="groups.length > 0" class="download-btn" @tap="$emit('download')">
      <text>下载确认单</text>
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
  groups: { supplier: string; orders: any[]; subtotal: number }[]
  historyCount: number
  historyOrders: any[]
  historyHasMore: boolean
  loadingHistory: boolean
  showHistory: boolean
}>()

defineEmits<{
  (e: 'download'): void
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
.confirmed-list {
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
.supplier-group {
  margin-bottom: 20rpx;
  border: 1rpx solid #f0f0f0;
  border-radius: 12rpx;
  overflow: hidden;
}
.supplier-title {
  display: block;
  padding: 16rpx 20rpx;
  background: #f5f5f5;
  font-size: 28rpx;
  font-weight: bold;
  color: #333;
}
.order-item {
  display: flex;
  align-items: center;
  padding: 16rpx 20rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.order-item:last-of-type {
  border-bottom: none;
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
.subtotal {
  padding: 12rpx 20rpx;
  background: #fafafa;
  border-top: 1rpx solid #f0f0f0;
}
.subtotal-text {
  font-size: 26rpx;
  color: #1976d2;
  font-weight: bold;
}
.download-btn {
  margin-top: 20rpx;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  background: #1976d2;
  color: #fff;
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