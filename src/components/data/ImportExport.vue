<template>
  <view class="import-export">
    <text class="section-title">数据备份</text>
    <view class="btn-row">
      <view :class="['action-btn', backingUp ? 'disabled' : '']" @tap="$emit('backup')">
        <text>{{ backingUp ? '备份中...' : '立即备份' }}</text>
      </view>
      <view class="action-btn" @tap="$emit('restore')">
        <text>恢复备份</text>
      </view>
    </view>

    <text class="section-title sub">导入导出</text>
    <view class="btn-row">
      <view :class="['action-btn', exporting ? 'disabled' : '']" @tap="$emit('export')">
        <text>{{ exporting ? '导出中...' : '导出清单' }}</text>
      </view>
      <view :class="['action-btn', importing ? 'disabled' : '']" @tap="$emit('import')">
        <text>{{ importing ? '导入中...' : '导入数据' }}</text>
      </view>
    </view>
    <view class="btn-row" style="margin-top: 16rpx;">
      <view :class="['action-btn', exportingAll ? 'disabled' : '']" @tap="$emit('export-all')">
        <text>{{ exportingAll ? '导出中...' : '全量导出' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  exporting: boolean
  importing: boolean
  backingUp: boolean
  exportingAll: boolean
}>()

defineEmits<{
  (e: 'backup'): void
  (e: 'restore'): void
  (e: 'export'): void
  (e: 'import'): void
  (e: 'export-all'): void
}>()
</script>

<style scoped>
.import-export {
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
.section-title.sub {
  margin-top: 28rpx;
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
</style>