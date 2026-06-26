<template>
  <view class="member-list">
    <view class="section-header" @tap="expanded = !expanded">
      <text class="section-title">成员管理</text>
      <text class="expand-arrow">{{ expanded ? '▼' : '▶' }}</text>
    </view>
    <template v-if="expanded">
      <view
        v-for="member in members"
        :key="member._id"
        :class="['member-item', member.isVirtual ? 'virtual' : '']"
      >
        <view class="member-avatar-wrap">
          <image v-if="member.avatar" class="member-avatar" :src="member.avatar" mode="aspectFill" />
          <view v-else class="member-avatar placeholder">{{ (member.name || member.nickName || '?').charAt(0) }}</view>
        </view>
        <view class="member-info">
          <text class="member-name">{{ member.name || member.nickName || '未命名' }}</text>
          <text v-if="member.role === 'creator'" class="role-tag creator">👑创建者</text>
          <text v-else-if="member.role === 'admin'" class="role-tag admin">🔧管理员</text>
          <text v-if="member.isVirtual" class="virtual-tag">未登录</text>
        </view>
        <view class="member-actions">
          <text
            v-if="member.role !== 'creator'"
            class="action-btn edit"
            @tap="$emit('edit-name', member)"
          >
            ✏️
          </text>
          <text
            v-if="member.role !== 'creator'"
            class="action-btn delete"
            @tap="$emit('delete-member', member)"
          >
            🗑️
          </text>
          <text
            v-if="isCreator && member.role === 'member'"
            class="action-btn set-admin"
            @tap="$emit('set-admin', member._id)"
          >
            设管
          </text>
          <text
            v-if="isCreator && member.role === 'admin'"
            class="action-btn remove-admin"
            @tap="$emit('remove-admin', member._id)"
          >
            撤管
          </text>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  members: any[]
  isCreator: boolean
}>()

defineEmits<{
  (e: 'edit-name', member: any): void
  (e: 'delete-member', member: any): void
  (e: 'set-admin', memberId: string): void
  (e: 'remove-admin', memberId: string): void
}>()

const expanded = ref(false)
</script>

<style scoped>
.member-list {
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
.member-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}
.member-item:last-child {
  border-bottom: none;
}
.member-item.virtual {
  opacity: 0.6;
}
.member-avatar-wrap {
  flex-shrink: 0;
  margin-right: 16rpx;
}
.member-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
}
.member-avatar.placeholder {
  background: #1976d2;
  color: #fff;
  font-size: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.member-info {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex: 1;
  overflow: hidden;
}
.member-name {
  font-size: 28rpx;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-tag {
  font-size: 22rpx;
  padding: 2rpx 12rpx;
  border-radius: 4rpx;
  flex-shrink: 0;
}
.role-tag.creator {
  background: #fff3e0;
  color: #e65100;
}
.role-tag.admin {
  background: #e3f2fd;
  color: #1976d2;
}
.virtual-tag {
  font-size: 22rpx;
  color: #999;
  background: #f0f0f0;
  padding: 2rpx 12rpx;
  border-radius: 4rpx;
  flex-shrink: 0;
}
.member-actions {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}
.action-btn {
  font-size: 28rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}
.action-btn.edit {
  color: #4CAF50;
  background-color: rgba(76,175,80,0.1);
}
.action-btn.delete {
  color: #F44336;
  background-color: rgba(244,67,54,0.1);
}
.action-btn.set-admin {
  background: #e3f2fd;
  color: #1976d2;
  font-size: 24rpx;
  padding: 8rpx 20rpx;
  border-radius: 8rpx;
}
.action-btn.remove-admin {
  background: #fce4ec;
  color: #c62828;
  font-size: 24rpx;
  padding: 8rpx 20rpx;
  border-radius: 8rpx;
}
</style>