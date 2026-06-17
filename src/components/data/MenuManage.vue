<template>
  <view class="menu-manage">
    <view class="section-header" @tap="expanded = !expanded">
      <text class="section-title">菜单管理</text>
      <text class="expand-arrow">{{ expanded ? '▼' : '▶' }}</text>
    </view>
    <template v-if="expanded">
      <view class="add-btn" @tap="$emit('add')">
        <text class="add-icon">＋</text>
        <text class="add-text">添加菜品</text>
      </view>
      <view v-if="menuList.length === 0" class="empty-tip">
        <text>暂无菜品</text>
      </view>
      <view v-for="(item, idx) in menuList" :key="item._id" class="menu-item">
        <view class="menu-info">
          <text class="menu-seq">{{ idx + 1 }}</text>
          <text class="menu-supplier">{{ item.supplier }}</text>
          <text class="menu-name">{{ item.name }}</text>
          <text class="menu-price">¥{{ item.price }}</text>
        </view>
        <view class="menu-actions">
          <text class="action-btn" @tap.stop="$emit('move', item._id, 'up')">↑</text>
          <text class="action-btn" @tap.stop="$emit('move', item._id, 'down')">↓</text>
          <text class="action-btn edit" @tap.stop="$emit('edit', item)">✏</text>
          <text class="action-btn hide" @tap.stop="$emit('toggle-visible', item._id)">👁</text>
          <text class="action-btn delete" @tap.stop="$emit('delete', item._id)">🗑</text>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  menuList: any[]
}>()

defineEmits<{
  (e: 'add'): void
  (e: 'edit', item: any): void
  (e: 'delete', menuId: string): void
  (e: 'move', menuId: string, direction: string): void
  (e: 'toggle-visible', menuId: string): void
}>()

const expanded = ref(false)
</script>

<style scoped>
.menu-manage {
  margin: 0 32rpx 24rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-title {
  font-size: 30rpx;
  font-weight: bold;
  color: #333;
}
.expand-arrow {
  font-size: 24rpx;
  color: #999;
  padding: 8rpx;
}
.add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 16rpx;
  background: #e3f2fd;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
}
.add-icon {
  font-size: 32rpx;
  color: #1976d2;
  font-weight: bold;
}
.add-text {
  font-size: 28rpx;
  color: #1976d2;
}
.empty-tip {
  padding: 40rpx 0;
  text-align: center;
  color: #ccc;
  font-size: 28rpx;
}
.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}
.menu-item:last-child {
  border-bottom: none;
}
.menu-info {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 8rpx;
}
.menu-seq {
  width: 40rpx;
  font-size: 24rpx;
  color: #999;
  text-align: center;
  flex-shrink: 0;
}
.menu-supplier {
  width: 120rpx;
  font-size: 26rpx;
  color: #666;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-name {
  flex: 1;
  font-size: 28rpx;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.menu-price {
  width: 80rpx;
  font-size: 26rpx;
  color: #e65100;
  text-align: right;
  flex-shrink: 0;
}
.menu-actions {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex-shrink: 0;
  margin-left: 12rpx;
}
.action-btn {
  font-size: 26rpx;
  padding: 4rpx 6rpx;
  color: #666;
}
.action-btn.edit {
  color: #1976d2;
}
.action-btn.hide {
  color: #f57c00;
}
.action-btn.delete {
  color: #d32f2f;
}
</style>