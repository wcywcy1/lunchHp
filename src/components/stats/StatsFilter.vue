<template>
  <view v-if="show" class="filter-mask" @tap="onMaskTap">
    <view class="filter-panel" @tap.stop>
      <view class="panel-header">
        <text class="panel-title">筛选条件</text>
        <view class="panel-close" @tap="$emit('close')">
          <text>✕</text>
        </view>
      </view>

      <view class="panel-body">
        <view class="filter-row">
          <view class="filter-field">
            <text class="field-label">年份</text>
            <picker :range="yearDisplayOptions" :value="yearIndex" @change="onYearPick">
              <view class="field-picker">
                <text :class="['picker-text', innerFilter.year !== null ? 'active' : '']">
                  {{ innerFilter.year !== null ? innerFilter.year : '全部' }}
                </text>
                <text class="picker-arrow">▼</text>
              </view>
            </picker>
          </view>
          <view class="filter-field">
            <text class="field-label">月份</text>
            <view class="field-picker" @tap="openMonthPicker">
              <text :class="['picker-text', innerFilter.months.length > 0 ? 'active' : '']">
                {{ monthDisplayText }}
              </text>
              <text class="picker-arrow">▼</text>
            </view>
          </view>
        </view>

        <view class="filter-row">
          <view class="filter-field">
            <text class="field-label">点餐人</text>
            <view class="field-picker" @tap="openMemberPicker">
              <text :class="['picker-text', innerFilter.members.length > 0 ? 'active' : '']">
                {{ memberDisplayText }}
              </text>
              <text class="picker-arrow">▼</text>
            </view>
          </view>
          <view class="filter-field">
            <text class="field-label">供应商</text>
            <view class="field-picker" @tap="openSupplierPicker">
              <text :class="['picker-text', innerFilter.suppliers.length > 0 ? 'active' : '']">
                {{ supplierDisplayText }}
              </text>
              <text class="picker-arrow">▼</text>
            </view>
          </view>
        </view>
      </view>

      <view class="panel-actions">
        <view class="action-btn reset" @tap="onReset"><text>重置</text></view>
        <view class="action-btn confirm" @tap="onConfirm"><text>确认</text></view>
      </view>
    </view>

    <view v-if="showCheckboxPicker" class="checkbox-mask" @tap="closeCheckboxPicker">
      <view class="checkbox-panel" @tap.stop>
        <view class="checkbox-header">
          <text class="checkbox-title">{{ checkboxTitle }}</text>
          <view class="checkbox-close" @tap="closeCheckboxPicker"><text>✕</text></view>
        </view>
        <scroll-view scroll-y class="checkbox-list">
          <view
            v-for="item in checkboxOptions"
            :key="item.value"
            class="checkbox-item"
            @tap="toggleCheckbox(item.value)"
          >
            <view :class="['checkbox-box', item.checked ? 'checked' : '']">
              <text v-if="item.checked" class="checkbox-tick">✓</text>
            </view>
            <text class="checkbox-label">{{ item.label }}</text>
          </view>
        </scroll-view>
        <view class="checkbox-actions">
          <view class="action-btn reset" @tap="clearCheckbox"><text>清空</text></view>
          <view class="action-btn confirm" @tap="closeCheckboxPicker"><text>确定</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

interface FilterState {
  year: number | null
  months: number[]
  members: string[]
  suppliers: string[]
}

const props = defineProps<{
  show: boolean
  filter: FilterState
  yearOptions: number[]
  memberOptions: string[]
  supplierOptions: string[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'apply', filter: FilterState): void
  (e: 'reset'): void
}>()

const innerFilter = ref<FilterState>({ ...props.filter })

watch(() => props.filter, (val) => {
  innerFilter.value = { ...val }
}, { deep: true })

const yearDisplayOptions = computed(() => ['全部', ...props.yearOptions.map(String)])
const yearIndex = computed(() => {
  if (innerFilter.value.year === null) return 0
  const idx = props.yearOptions.indexOf(innerFilter.value.year)
  return idx >= 0 ? idx + 1 : 0
})

function onYearPick(e: any) {
  const idx = e.detail.value
  innerFilter.value.year = idx === 0 ? null : props.yearOptions[idx - 1]
}

const monthDisplayText = computed(() => {
  if (innerFilter.value.months.length === 0) return '全部'
  if (innerFilter.value.months.length <= 3) {
    return innerFilter.value.months.map(m => m + '月').join(' ')
  }
  return `${innerFilter.value.months.length}个月`
})

const memberDisplayText = computed(() => {
  if (innerFilter.value.members.length === 0) return '全部'
  if (innerFilter.value.members.length <= 2) {
    return innerFilter.value.members.join(' ')
  }
  return `${innerFilter.value.members.length}人`
})

const supplierDisplayText = computed(() => {
  if (innerFilter.value.suppliers.length === 0) return '全部'
  if (innerFilter.value.suppliers.length <= 2) {
    return innerFilter.value.suppliers.join(' ')
  }
  return `${innerFilter.value.suppliers.length}家`
})

const showCheckboxPicker = ref(false)
const checkboxType = ref<'month' | 'member' | 'supplier'>('month')
const tempChecked = ref<(number | string)[]>([])

const checkboxTitle = computed(() => {
  if (checkboxType.value === 'month') return '选择月份'
  if (checkboxType.value === 'member') return '选择点餐人'
  return '选择供应商'
})

const checkboxOptions = computed(() => {
  if (checkboxType.value === 'month') {
    return Array.from({ length: 12 }, (_, i) => i + 1).map(m => ({
      value: m,
      label: m + '月',
      checked: tempChecked.value.includes(m),
    }))
  }
  if (checkboxType.value === 'member') {
    return props.memberOptions.map(m => ({
      value: m,
      label: m,
      checked: tempChecked.value.includes(m),
    }))
  }
  return props.supplierOptions.map(s => ({
    value: s,
    label: s,
    checked: tempChecked.value.includes(s),
  }))
})

function openMonthPicker() {
  checkboxType.value = 'month'
  tempChecked.value = [...innerFilter.value.months]
  showCheckboxPicker.value = true
}

function openMemberPicker() {
  checkboxType.value = 'member'
  tempChecked.value = [...innerFilter.value.members]
  showCheckboxPicker.value = true
}

function openSupplierPicker() {
  checkboxType.value = 'supplier'
  tempChecked.value = [...innerFilter.value.suppliers]
  showCheckboxPicker.value = true
}

function toggleCheckbox(val: number | string) {
  const idx = tempChecked.value.indexOf(val)
  if (idx >= 0) {
    tempChecked.value.splice(idx, 1)
  } else {
    tempChecked.value.push(val)
  }
}

function clearCheckbox() {
  tempChecked.value = []
}

function closeCheckboxPicker() {
  if (checkboxType.value === 'month') {
    innerFilter.value.months = [...tempChecked.value] as number[]
  } else if (checkboxType.value === 'member') {
    innerFilter.value.members = [...tempChecked.value] as string[]
  } else {
    innerFilter.value.suppliers = [...tempChecked.value] as string[]
  }
  showCheckboxPicker.value = false
}

function onMaskTap() {
  emit('close')
}

function onReset() {
  innerFilter.value = { year: null, months: [], members: [], suppliers: [] }
  emit('reset')
}

function onConfirm() {
  emit('apply', { ...innerFilter.value })
}
</script>

<style scoped>
.filter-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 300;
  display: flex;
  align-items: flex-end;
}
.filter-panel {
  width: 100%;
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  padding: 32rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32rpx;
}
.panel-title {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
}
.panel-close {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: #999;
}
.panel-body {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  margin-bottom: 32rpx;
}
.filter-row {
  display: flex;
  gap: 24rpx;
}
.filter-field {
  flex: 1;
}
.field-label {
  font-size: 24rpx;
  color: #999;
  margin-bottom: 8rpx;
  display: block;
}
.field-picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 16rpx;
  background: #f5f5f5;
  border-radius: 8rpx;
}
.picker-text {
  font-size: 26rpx;
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
  margin-left: 8rpx;
}
.panel-actions {
  display: flex;
  gap: 24rpx;
}
.action-btn {
  flex: 1;
  text-align: center;
  padding: 20rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
}
.action-btn.reset {
  background: #f5f5f5;
  color: #666;
}
.action-btn.confirm {
  background: #1976d2;
  color: #fff;
}
.checkbox-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
}
.checkbox-panel {
  width: 600rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 32rpx;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}
.checkbox-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}
.checkbox-title {
  font-size: 30rpx;
  font-weight: bold;
  color: #333;
}
.checkbox-close {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: #999;
}
.checkbox-list {
  max-height: 50vh;
  margin-bottom: 24rpx;
}
.checkbox-item {
  display: flex;
  align-items: center;
  padding: 16rpx 0;
  gap: 16rpx;
}
.checkbox-box {
  width: 36rpx;
  height: 36rpx;
  border: 2rpx solid #ddd;
  border-radius: 6rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.checkbox-box.checked {
  background: #1976d2;
  border-color: #1976d2;
}
.checkbox-tick {
  font-size: 24rpx;
  color: #fff;
}
.checkbox-label {
  font-size: 28rpx;
  color: #333;
}
.checkbox-actions {
  display: flex;
  gap: 24rpx;
}
</style>