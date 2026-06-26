<template>
  <view class="danger-zone">
    <text class="section-title">危险操作</text>
    <view class="danger-btn delete-data" @tap="$emit('delete-data')">
      <text>删除数据</text>
    </view>
    <template v-if="isSystemGroup">
      <view class="danger-btn delete-account disabled">
        <text>删除账号</text>
      </view>
      <text class="danger-tip">删除账号不可用：当前组织为系统预设</text>
    </template>
    <template v-else-if="isCreator">
      <view class="danger-btn delete-account delete-org" @tap="$emit('delete-account')">
        <text>删除组织</text>
      </view>
      <text class="danger-tip">将删除本组织所有数据，不可恢复</text>
    </template>
    <template v-else-if="isAdmin">
      <view class="danger-btn delete-account disabled">
        <text>删除账号</text>
      </view>
      <text class="danger-tip">管理员不可删除账号，请联系创建者</text>
    </template>
    <template v-else>
      <view class="danger-btn delete-account" @tap="$emit('delete-account')">
        <text>退出组织</text>
      </view>
      <text class="danger-tip">将退出当前组织，数据保留但不再可见</text>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from '../../services/store'
import { GROUP_ID } from '../../constants/appConfig'

defineEmits<{
  (e: 'delete-data'): void
  (e: 'delete-account'): void
}>()

const store = useStore()
const isSystemGroup = computed(() => store.groupId === GROUP_ID)
const isCreator = computed(() => store.role === 'creator')
const isAdmin = computed(() => store.role === 'admin')
</script>

<style scoped>
.danger-zone {
  margin: 0 32rpx 24rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
}
.section-title {
  font-size: 30rpx;
  font-weight: bold;
  color: #d32f2f;
  margin-bottom: 16rpx;
  display: block;
}
.danger-btn {
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  margin-bottom: 16rpx;
}
.danger-btn.delete-data {
  background: #fce4ec;
  color: #c62828;
}
.danger-btn.delete-account {
  background: #f5f5f5;
  color: #bbb;
}
.danger-btn.delete-org {
  background: #fce4ec;
  color: #c62828;
}
.danger-btn.delete-account:not(.disabled) {
  background: #fff3e0;
  color: #e65100;
}
.danger-btn.disabled {
  pointer-events: none;
}
.danger-tip {
  font-size: 22rpx;
  color: #999;
  display: block;
  text-align: center;
}
</style>