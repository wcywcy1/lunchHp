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
    <template v-else>
      <view v-if="confirmedOrders.length > 0" class="order-group">
        <view class="group-header">
          <text class="group-title confirmed">已确认 ({{ confirmedOrders.length }})</text>
        </view>
        <view
          v-for="order in confirmedOrders"
          :key="order._id"
          class="order-item"
        >
          <text class="order-name">{{ order.memberName }}</text>
          <text class="order-menu">{{ order.menuName }}</text>
          <text class="order-price">¥{{ order.price }}</text>
          <view v-if="isMine(order) && !order.cancelRequested" class="order-action" @tap="$emit('request-cancel', order._id)">
            <text>申请取消</text>
          </view>
          <view v-else-if="isMine(order) && order.cancelRequested" class="order-action pending-tag">
            <text>申请中</text>
          </view>
          <text v-else class="order-status confirmed">✅</text>
        </view>
      </view>

      <view v-if="pendingOrders.length > 0" class="order-group">
        <view class="group-header">
          <text class="group-title pending">待确认 ({{ pendingOrders.length }})</text>
        </view>
        <view
          v-for="order in pendingOrders"
          :key="order._id"
          class="order-item"
        >
          <text class="order-name">{{ order.memberName }}</text>
          <text class="order-menu">{{ order.menuName }}</text>
          <text class="order-price">¥{{ order.price }}</text>
          <view v-if="isMine(order)" class="order-action" @tap="$emit('cancel-mine', order._id)">
            <text>取消</text>
          </view>
          <text v-else class="order-status pending">⏳</text>
        </view>
      </view>

      <view v-if="cancelledOrders.length > 0" class="order-group">
        <view class="group-header">
          <text class="group-title cancelled">已取消 ({{ cancelledOrders.length }})</text>
        </view>
        <view
          v-for="order in cancelledOrders"
          :key="order._id"
          class="order-item cancelled-item"
        >
          <text class="order-name">{{ order.memberName }}</text>
          <text class="order-menu">{{ order.menuName }}</text>
          <text class="order-price">¥{{ order.price }}</text>
          <text class="order-status cancelled">❌</text>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  orders: any[]
  notice?: string
  currentMemberId?: string
}>()

defineEmits<{
  (e: 'cancel-mine', id: string): void
  (e: 'request-cancel', id: string): void
}>()

const confirmedOrders = computed(() =>
  props.orders.filter(o => o.status === 'confirmed')
)
const pendingOrders = computed(() =>
  props.orders.filter(o => o.status === 'pending')
)
const cancelledOrders = computed(() =>
  props.orders.filter(o => o.status === 'cancelled')
)

function isMine(order: any) {
  return props.currentMemberId && order.memberId === props.currentMemberId
}
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
.order-group {
  border-top: 1rpx solid #eee;
  padding-top: 8rpx;
}
.order-group:first-of-type {
  border-top: none;
  padding-top: 0;
}
.group-header {
  padding: 8rpx 0;
}
.group-title {
  font-size: 24rpx;
  font-weight: bold;
}
.group-title.confirmed {
  color: #388e3c;
}
.group-title.pending {
  color: #f57c00;
}
.group-title.cancelled {
  color: #999;
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
.cancelled-item {
  opacity: 0.6;
}
.cancelled-item .order-name,
.cancelled-item .order-menu {
  text-decoration: line-through;
  color: #999;
}
.cancelled-item .order-price {
  color: #999;
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
.order-status.cancelled {
  color: #999;
}
.order-action {
  width: 120rpx;
  text-align: center;
  font-size: 24rpx;
  color: #d32f2f;
  flex-shrink: 0;
  margin-left: 12rpx;
  padding: 6rpx 0;
  border: 1rpx solid #d32f2f;
  border-radius: 8rpx;
}
.order-action.pending-tag {
  color: #999;
  border-color: #ccc;
}
</style>
