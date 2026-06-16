<template>
  <view class="menu-filter">
    <view class="filter-row">
      <view class="filter-item">
        <text class="filter-label">供应商</text>
        <picker :range="supplierDisplayOptions" :value="supplierIndex" @change="onSupplierPick">
          <view class="filter-picker">
            <text :class="['picker-text', selectedSupplier ? 'active' : '']">
              {{ selectedSupplier || '全部' }}
            </text>
            <text class="picker-arrow">▼</text>
          </view>
        </picker>
      </view>
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
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  selectedSupplier: string
  selectedMenuName: string
  supplierOptions: string[]
  menuNameOptions: string[]
}>()

const emit = defineEmits<{
  (e: 'supplier-change', val: string): void
  (e: 'menu-name-change', val: string): void
}>()

const supplierDisplayOptions = computed(() =>
  props.supplierOptions.map(s => s || '全部')
)
const supplierIndex = computed(() =>
  props.supplierOptions.indexOf(props.selectedSupplier)
)
const menuNameDisplayOptions = computed(() =>
  props.menuNameOptions.map(s => s || '全部')
)
const menuNameIndex = computed(() =>
  props.menuNameOptions.indexOf(props.selectedMenuName)
)

function onSupplierPick(e: any) {
  const idx = e.detail.value
  emit('supplier-change', props.supplierOptions[idx] || '')
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
.filter-row {
  display: flex;
  gap: 24rpx;
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