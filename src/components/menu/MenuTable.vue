<template>
  <view class="menu-table">
    <view class="table-header">
      <text class="col-seq">#</text>
      <text class="col-supplier">供应商</text>
      <text class="col-name">餐品</text>
      <text class="col-price">价格</text>
      <text v-if="isAdmin" class="col-action">操作</text>
    </view>

    <view v-if="visibleItems.length === 0" class="empty-tip">
      <text>暂无菜品</text>
    </view>

    <view
      v-for="(item, idx) in visibleItems"
      :key="item._id"
      :class="['table-row', selectedMenuId === item._id ? 'selected' : '']"
      @tap="onSelect(item._id)"
    >
      <text class="col-seq">{{ idx + 1 }}</text>
      <text class="col-supplier">{{ item.supplier }}</text>
      <text class="col-name">{{ item.name }}</text>
      <text class="col-price">¥{{ item.price }}</text>
      <view v-if="isAdmin" class="col-action" @tap.stop>
        <text class="action-btn" @tap.stop="$emit('move', item._id, 'up')">↑</text>
        <text class="action-btn" @tap.stop="$emit('move', item._id, 'down')">↓</text>
        <text class="action-btn edit" @tap.stop="$emit('edit', item)">✏</text>
        <text class="action-btn hide" @tap.stop="$emit('toggle-visible', item._id)">👁</text>
        <text class="action-btn delete" @tap.stop="$emit('delete', item._id)">🗑</text>
      </view>
    </view>

    <view v-if="isAdmin && hiddenItems.length > 0" class="hidden-section">
      <view class="hidden-toggle" @tap="hiddenExpanded = !hiddenExpanded">
        <text class="hidden-label">── 已隐藏（{{ hiddenItems.length }}）{{ hiddenExpanded ? '▼' : '▶' }} ──</text>
      </view>
      <template v-if="hiddenExpanded">
        <view
          v-for="(item, idx) in hiddenItems"
          :key="'h_' + item._id"
          class="table-row hidden-row"
        >
          <text class="col-seq">{{ visibleItems.length + idx + 1 }}</text>
          <text class="col-supplier">{{ item.supplier }}</text>
          <text class="col-name">{{ item.name }}</text>
          <text class="col-price">¥{{ item.price }}</text>
          <view class="col-action" @tap.stop>
            <text class="action-btn restore" @tap.stop="$emit('toggle-visible', item._id)">👁</text>
            <text class="action-btn edit" @tap.stop="$emit('edit', item)">✏</text>
            <text class="action-btn delete" @tap.stop="$emit('delete', item._id)">🗑</text>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  visibleItems: any[]
  hiddenItems: any[]
  selectedMenuId: string
  isAdmin: boolean
}>()

const hiddenExpanded = ref(false)

const emit = defineEmits<{
  (e: 'select', menuId: string): void
  (e: 'edit', item: any): void
  (e: 'delete', menuId: string): void
  (e: 'move', menuId: string, direction: string): void
  (e: 'toggle-visible', menuId: string): void
}>()

function onSelect(menuId: string) {
  emit('select', menuId)
}
</script>

<style scoped>
.menu-table {
  background: #fff;
}
.table-header {
  display: flex;
  align-items: center;
  padding: 16rpx 24rpx;
  background: #fafafa;
  border-bottom: 1rpx solid #eee;
  font-size: 24rpx;
  color: #999;
}
.table-row {
  display: flex;
  align-items: center;
  padding: 20rpx 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
  font-size: 28rpx;
}
.table-row.selected {
  background: #e8f5e9;
  border-left: 6rpx solid #2e7d32;
  font-weight: bold;
}
.table-row.hidden-row {
  background: #f9f9f9;
  color: #aaa;
}
.col-seq {
  width: 60rpx;
  text-align: center;
  flex-shrink: 0;
}
.col-supplier {
  width: 140rpx;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-price {
  width: 100rpx;
  text-align: right;
  flex-shrink: 0;
  color: #e65100;
}
.col-action {
  width: 200rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
  flex-shrink: 0;
}
.action-btn {
  font-size: 28rpx;
  padding: 4rpx 8rpx;
  color: #666;
}
.action-btn.edit {
  color: #1976d2;
}
.action-btn.hide {
  color: #f57c00;
}
.action-btn.restore {
  color: #388e3c;
}
.action-btn.delete {
  color: #d32f2f;
}
.hidden-section {
  border-top: 2rpx dashed #ddd;
}
.hidden-toggle {
  padding: 20rpx 24rpx;
  text-align: center;
}
.hidden-label {
  font-size: 24rpx;
  color: #999;
}
.empty-tip {
  padding: 60rpx 0;
  text-align: center;
  color: #ccc;
  font-size: 28rpx;
}
</style>