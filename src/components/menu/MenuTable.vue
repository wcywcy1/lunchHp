<template>
  <view class="menu-table">
    <view v-if="groups.length === 0 && !flat" class="empty-tip">
      <text>暂无菜品</text>
    </view>

    <!-- 常点模式：平铺不分组 -->
    <view v-if="flat">
      <view v-if="visibleItems.length === 0" class="empty-tip">
        <text>暂无常点记录</text>
      </view>
      <view
        v-for="item in visibleItems"
        :key="item._id"
        :class="['table-row', selectedMenuId === item._id ? 'selected' : '']"
        @tap="onSelect(item._id)"
      >
        <text class="col-name">{{ item.name }}</text>
        <text class="col-supplier">{{ item.supplier }}</text>
      </view>
    </view>

    <!-- 分组模式：按供应商分组 -->
    <view v-for="group in groups" v-else :key="group.supplier" class="supplier-group">
      <view class="group-header">
        <text class="group-name">{{ group.supplier }}</text>
      </view>
      <view
        v-for="item in group.items"
        :key="item._id"
        :class="['table-row', selectedMenuId === item._id ? 'selected' : '']"
        @tap="onSelect(item._id)"
      >
        <text class="col-name">{{ item.name }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  visibleItems: any[]
  hiddenItems: any[]
  selectedMenuId: string
  isAdmin: boolean
  flat?: boolean
}>()

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

const groups = computed(() => groupBySupplier(props.visibleItems))

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
.supplier-group {
  margin-bottom: 8rpx;
}
.group-header {
  display: flex;
  align-items: center;
  padding: 16rpx 24rpx;
  background: #fafafa;
  border-bottom: 1rpx solid #eee;
}
.group-name {
  font-size: 26rpx;
  font-weight: bold;
  color: #666;
}
.table-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
  font-size: 30rpx;
}
.table-row.selected {
  background: #e8f5e9;
  border-left: 6rpx solid #2e7d32;
  font-weight: bold;
}
.col-name {
  flex: 1;
  min-width: 0;
  padding-left: 2em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-supplier {
  font-size: 22rpx;
  color: #999;
  flex-shrink: 0;
  margin-left: 12rpx;
}
.empty-tip {
  padding: 60rpx 0;
  text-align: center;
  color: #ccc;
  font-size: 28rpx;
}
</style>