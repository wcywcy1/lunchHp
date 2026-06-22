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

      <view v-for="group in visibleGroups" :key="group.supplier" class="supplier-group">
        <view class="group-header">
          <text class="group-name">{{ group.supplier }}</text>
          <view class="group-header-right">
            <text class="group-count">{{ group.items.length }}道</text>
            <view class="shelf-btn off" @tap.stop="$emit('toggle-supplier-visible', group.supplier, false)">
              <text>下架</text>
            </view>
          </view>
        </view>
        <view v-for="(item, idx) in group.items" :key="item._id" class="menu-item">
          <view class="menu-info">
            <text class="menu-seq">{{ idx + 1 }}</text>
            <text class="menu-name">{{ item.name }}</text>
            <text class="menu-price">¥{{ item.price }}</text>
          </view>
          <view class="menu-actions">
            <text class="action-btn edit" @tap.stop="$emit('edit', item)">✏️</text>
            <text class="action-btn delete" @tap.stop="$emit('delete', item._id)">🗑️</text>
            <text class="action-btn hide" @tap.stop="$emit('toggle-visible', item._id)">👁</text>
          </view>
        </view>
      </view>

      <view v-if="hiddenGroups.length > 0" class="hidden-section">
        <view class="hidden-toggle" @tap="hiddenExpanded = !hiddenExpanded">
          <text class="hidden-label">── 下架（{{ hiddenSupplierCount }}家）{{ hiddenExpanded ? '▼' : '▶' }} ──</text>
        </view>
        <template v-if="hiddenExpanded">
          <view v-for="group in hiddenGroups" :key="group.supplier" class="supplier-group hidden-group">
            <view class="group-header">
              <text class="group-name">{{ group.supplier }}</text>
              <view class="group-header-right">
                <text class="group-count">{{ group.items.length }}道</text>
                <view class="shelf-btn on" @tap.stop="$emit('toggle-supplier-visible', group.supplier, true)">
                  <text>上架</text>
                </view>
              </view>
            </view>
            <view v-for="(item, idx) in group.items" :key="item._id" class="menu-item hidden-item">
              <view class="menu-info">
                <text class="menu-seq">{{ idx + 1 }}</text>
                <text class="menu-name">{{ item.name }}</text>
                <text class="menu-price">¥{{ item.price }}</text>
              </view>
              <view class="menu-actions">
                <text class="action-btn edit" @tap.stop="$emit('edit', item)">✏️</text>
                <text class="action-btn delete" @tap.stop="$emit('delete', item._id)">🗑️</text>
                <text class="action-btn restore" @tap.stop="$emit('toggle-visible', item._id)">👁</text>
              </view>
            </view>
          </view>
        </template>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  menuList: any[]
}>()

defineEmits<{
  (e: 'add'): void
  (e: 'edit', item: any): void
  (e: 'delete', menuId: string): void
  (e: 'toggle-visible', menuId: string): void
  (e: 'toggle-supplier-visible', supplier: string, visible: boolean): void
}>()

const expanded = ref(false)
const hiddenExpanded = ref(false)

function collapse() {
  expanded.value = false
  hiddenExpanded.value = false
}
defineExpose({ collapse })

interface MenuGroup {
  supplier: string
  items: any[]
}

function groupBySupplier(items: any[]): MenuGroup[] {
  const map = new Map<string, any[]>()
  items.forEach(item => {
    const key = item.supplier || '未分类'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  })
  return Array.from(map.entries()).map(([supplier, items]) => ({ supplier, items }))
}

const visibleGroups = computed(() =>
  groupBySupplier(props.menuList.filter(i => i.visible !== false))
)

const hiddenGroups = computed(() =>
  groupBySupplier(props.menuList.filter(i => i.visible === false))
)

const hiddenSupplierCount = computed(() => hiddenGroups.value.length)
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
.supplier-group {
  margin-bottom: 16rpx;
}
.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 16rpx;
  background: #f5f5f5;
  border-radius: 8rpx;
  margin-bottom: 4rpx;
}
.group-name {
  font-size: 28rpx;
  font-weight: bold;
  color: #333;
}
.group-header-right {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.group-count {
  font-size: 24rpx;
  color: #999;
}
.shelf-btn {
  padding: 4rpx 16rpx;
  border-radius: 6rpx;
  font-size: 24rpx;
}
.shelf-btn.off {
  background: #fff3e0;
  color: #e65100;
}
.shelf-btn.on {
  background: #e8f5e9;
  color: #2e7d32;
}
.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14rpx 16rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.menu-item:last-child {
  border-bottom: none;
}
.menu-item.hidden-item {
  color: #aaa;
}
.menu-info {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 12rpx;
}
.menu-seq {
  width: 40rpx;
  font-size: 24rpx;
  color: #999;
  text-align: center;
  flex-shrink: 0;
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
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  color: #666;
}
.action-btn.edit {
  color: #4CAF50;
  background-color: rgba(76,175,80,0.1);
}
.action-btn.hide {
  color: #f57c00;
}
.action-btn.restore {
  color: #388e3c;
}
.action-btn.delete {
  color: #F44336;
  background-color: rgba(244,67,54,0.1);
}
.hidden-section {
  border-top: 2rpx dashed #ddd;
  margin-top: 16rpx;
}
.hidden-toggle {
  padding: 20rpx 0;
  text-align: center;
}
.hidden-label {
  font-size: 24rpx;
  color: #999;
}
.hidden-group .group-header {
  background: #f9f9f9;
}
.hidden-group .group-name {
  color: #999;
}
</style>