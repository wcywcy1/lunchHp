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
          <text class="tab-text">{{ opt === '' ? '全部' : opt === '__recent__' ? '常点' : opt }}</text>
        </view>
      </view>
    </scroll-view>
    <view class="search-row">
      <view class="search-box">
        <text class="search-icon">🔍</text>
        <input
          class="search-input"
          type="text"
          :value="keyword"
          placeholder="搜索餐品 / 语音输入"
          placeholder-class="search-placeholder"
          @input="onSearchInput"
          @confirm="onSearchConfirm"
        />
        <text v-if="keyword" class="search-clear" @tap="$emit('clear-keyword')">×</text>
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
  (e: 'keyword-change', val: string): void
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

function onSearchInput(e: any) {
  emit('keyword-change', e.detail.value)
}

function onSearchConfirm(e: any) {
  emit('keyword-change', e.detail.value)
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
.search-row {
  margin-top: 12rpx;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 8rpx 16rpx;
  background: #f5f5f5;
  border-radius: 8rpx;
}
.search-icon {
  font-size: 24rpx;
  color: #999;
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  font-size: 26rpx;
  color: #333;
  min-width: 0;
}
.search-placeholder {
  color: #bbb;
  font-size: 26rpx;
}
.search-clear {
  font-size: 32rpx;
  color: #999;
  padding-left: 8rpx;
  flex-shrink: 0;
}
</style>