<template>
  <view class="home-header">
    <view class="header-left" @tap="$emit('switch-group')">
      <text class="app-title">🍚 {{ groupName || APP_NAME }}</text>
      <text class="today-date">{{ todayDate }}</text>
    </view>
    <view class="header-right" @tap="$emit('click-avatar')">
      <view class="avatar-circle">
        <image v-if="avatar" class="avatar-img" :src="avatar" mode="aspectFill" />
        <text v-else class="avatar-text">{{ initial }}</text>
      </view>
      <text class="display-name" :class="{ 'name-loading': memberLoading }">{{ displayName }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { APP_NAME } from '../../constants/appConfig'

const props = defineProps<{
  displayName: string
  todayDate: string
  avatar: string
  memberLoading?: boolean
  groupName?: string
}>()

defineEmits<{
  (e: 'click-avatar'): void
  (e: 'switch-group'): void
}>()

const initial = computed(() => {
  const name = props.displayName
  return name ? name.charAt(0) : '?'
})
</script>

<style scoped>
.home-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 32rpx;
  background: #fff;
}
.header-left {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.app-title {
  font-size: 36rpx;
  font-weight: bold;
  color: #333;
}
.today-date {
  font-size: 24rpx;
  color: #999;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.avatar-circle {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #1976d2;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.avatar-img {
  width: 64rpx;
  height: 64rpx;
}
.avatar-text {
  font-size: 28rpx;
  color: #fff;
  font-weight: bold;
}
.display-name {
  font-size: 28rpx;
  color: #333;
  max-width: 160rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name-loading {
  color: #999;
}
</style>