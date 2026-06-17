<template>
  <view class="card-section">
    <text class="section-title">导入导出</text>
    <view class="btn-row">
      <view :class="['action-btn', exporting ? 'disabled' : '']" @tap="showExportType = true">
        <text>{{ exporting ? '导出中...' : '导出数据' }}</text>
      </view>
      <view :class="['action-btn', importing ? 'disabled' : '']" @tap="showImportType = true">
        <text>{{ importing ? '导入中...' : '导入数据' }}</text>
      </view>
    </view>

    <view v-if="showExportType" class="modal-mask" @tap="showExportType = false">
      <view class="type-modal" @tap.stop>
        <text class="modal-title">导出数据</text>
        <view class="type-list">
          <view class="type-item" @tap="onExport('orders')">
            <text class="type-icon">📋</text>
            <view class="type-info">
              <text class="type-name">清单</text>
              <text class="type-desc">导出订单数据</text>
            </view>
          </view>
          <view class="type-item" @tap="onExport('menu')">
            <text class="type-icon">🍽️</text>
            <view class="type-info">
              <text class="type-name">菜单</text>
              <text class="type-desc">导出菜品数据</text>
            </view>
          </view>
          <view class="type-item" @tap="onExport('members')">
            <text class="type-icon">👥</text>
            <view class="type-info">
              <text class="type-name">人员</text>
              <text class="type-desc">导出成员数据</text>
            </view>
          </view>
        </view>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="showExportType = false"><text>取消</text></view>
        </view>
      </view>
    </view>

    <view v-if="showImportType" class="modal-mask" @tap="showImportType = false">
      <view class="type-modal" @tap.stop>
        <text class="modal-title">导入数据</text>
        <view class="type-list">
          <view class="type-item" @tap="onImport('orders')">
            <text class="type-icon">📋</text>
            <view class="type-info">
              <text class="type-name">清单</text>
              <text class="type-desc">导入订单数据</text>
            </view>
          </view>
          <view class="type-item" @tap="onImport('menu')">
            <text class="type-icon">🍽️</text>
            <view class="type-info">
              <text class="type-name">菜单</text>
              <text class="type-desc">导入菜品数据</text>
            </view>
          </view>
          <view class="type-item" @tap="onImport('members')">
            <text class="type-icon">👥</text>
            <view class="type-info">
              <text class="type-name">人员</text>
              <text class="type-desc">导入成员数据</text>
            </view>
          </view>
        </view>
        <view class="import-tip">
          <text>支持 csv、xlsx 格式</text>
        </view>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="showImportType = false"><text>取消</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  exporting: boolean
  importing: boolean
}>()

const emit = defineEmits<{
  (e: 'export', type: 'orders' | 'menu' | 'members'): void
  (e: 'import', type: 'orders' | 'menu' | 'members'): void
}>()

const showExportType = ref(false)
const showImportType = ref(false)

function onExport(type: 'orders' | 'menu' | 'members') {
  showExportType.value = false
  emit('export', type)
}

function onImport(type: 'orders' | 'menu' | 'members') {
  showImportType.value = false
  emit('import', type)
}
</script>

<style scoped>
.card-section {
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
.btn-row {
  display: flex;
  gap: 24rpx;
}
.action-btn {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  background: #f5f5f5;
  color: #333;
}
.action-btn.disabled {
  color: #999;
}
.modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.type-modal {
  width: 600rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 40rpx;
}
.modal-title {
  display: block;
  font-size: 32rpx;
  font-weight: bold;
  text-align: center;
  margin-bottom: 24rpx;
}
.type-list {
  margin-bottom: 16rpx;
}
.type-item {
  display: flex;
  align-items: center;
  padding: 24rpx 16rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.type-item:last-child {
  border-bottom: none;
}
.type-icon {
  font-size: 40rpx;
  margin-right: 20rpx;
}
.type-info {
  flex: 1;
}
.type-name {
  display: block;
  font-size: 30rpx;
  color: #333;
  font-weight: 500;
}
.type-desc {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-top: 4rpx;
}
.import-tip {
  text-align: center;
  padding: 12rpx 0;
}
.import-tip text {
  font-size: 24rpx;
  color: #999;
}
.modal-actions {
  display: flex;
  gap: 24rpx;
  margin-top: 8rpx;
}
.modal-btn {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
}
.modal-btn.cancel {
  background: #f5f5f5;
  color: #666;
}
</style>