<template>
  <view class="menu-filter">
    <scroll-view scroll-x class="tab-scroll">
      <view class="tab-row">
        <view
          v-for="opt in supplierOptions"
          :key="opt || '__all__'"
          :class="['tab-item', selectedSupplier === opt ? 'active' : '']"
          @tap="onSupplierTap(opt)"
        >
          <text class="tab-text">{{ opt || '全部' }}</text>
        </view>
      </view>
    </scroll-view>
    <view v-if="selectedSupplier" class="filter-row">
      <view class="filter-item">
        <text class="filter-label">餐品</text>
        <picker :range="menuNameDisplayOptions" :value="menuNameIndex" @change="onMenuNamePick">
          <view class="filter-picker">
            <text :class="['picker-text', selectedMenuName ? 'active' : '']">
              {{ selectedMenuName || '全部' }}
            </text>
            <text class="picker-arrow">▼</text>
          </view>
        </picker>
      </view>
    </view>
    <view v-if="keyword" class="keyword-row">
      <text class="keyword-label">语音筛选</text>
      <view class="keyword-tag">
        <text class="keyword-text">{{ keyword }}</text>
        <text class="keyword-close" @tap="$emit('clear-keyword')">×</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  selectedSupplier: string
  selectedMenuName: string
  keyword: string
  supplierOptions: string[]
  menuNameOptions: string[]
}>()

const emit = defineEmits<{
  (e: 'supplier-change', val: string): void
  (e: 'menu-name-change', val: string): void
  (e: 'clear-keyword'): void
}>()

const menuNameDisplayOptions = computed(() =>
  props.menuNameOptions.map(s => s || '全部')
)
const menuNameIndex = computed(() =>
  props.menuNameOptions.indexOf(props.selectedMenuName)
)

function onSupplierTap(val: string) {
  emit('supplier-change', val)
}

function onMenuNamePick(e: any) {
  const idx = e.detail.value
  emit('menu-name-change', props.menuNameOptions[idx] || '')
}
</script>

<style scoped>
.menu-filter {
  padding: 16rpx 24rpx;
  background: #fff;
  border-bottom: 1rpx solid #eee;
}
.tab-scroll {
  white-space: nowrap;
}
.tab-row {
  display: inline-flex;
  gap: 16rpx;
}
.tab-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8rpx 24rpx;
  background: #f5f5f5;
  border-radius: 24rpx;
  flex-shrink: 0;
}
.tab-item.active {
  background: #1976d2;
}
.tab-text {
  font-size: 26rpx;
  color: #666;
  white-space: nowrap;
}
.tab-item.active .tab-text {
  color: #fff;
  font-weight: bold;
}
.filter-row {
  display: flex;
  margin-top: 12rpx;
}
.keyword-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 12rpx;
}
.keyword-label {
  font-size: 24rpx;
  color: #1976d2;
  white-space: nowrap;
}
.keyword-tag {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  padding: 6rpx 16rpx;
  background: #e3f2fd;
  border-radius: 20rpx;
}
.keyword-text {
  font-size: 26rpx;
  color: #1976d2;
}
.keyword-close {
  font-size: 28rpx;
  color: #1976d2;
  padding-left: 4rpx;
}
.filter-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.filter-label {
  font-size: 24rpx;
  color: #666;
  white-space: nowrap;
}
.filter-picker {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8rpx 16rpx;
  background: #f5f5f5;
  border-radius: 8rpx;
  min-width: 0;
}
.picker-text {
  font-size: 24rpx;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-text.active {
  color: #333;
}
.picker-arrow {
  font-size: 20rpx;
  color: #999;
  flex-shrink: 0;
}
</style>