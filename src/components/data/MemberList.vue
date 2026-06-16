<template>
  <view class="member-list">
    <text class="section-title">成员管理</text>
    <view
      v-for="member in members"
      :key="member._id"
      :class="['member-item', member.isVirtual ? 'virtual' : '']"
    >
      <view class="member-info">
        <text class="member-name">{{ member.name || member.nickName || '未命名' }}</text>
        <text v-if="member.role === 'creator'" class="role-tag creator">👑创建者</text>
        <text v-else-if="member.role === 'admin'" class="role-tag admin">🔧管理员</text>
        <text v-if="member.isVirtual" class="virtual-tag">未登录</text>
      </view>
      <view class="member-actions">
        <view
          v-if="member.role !== 'creator'"
          class="action-btn edit"
          @tap="$emit('edit-name', member)"
        >
          <text>✏</text>
        </view>
        <view
          v-if="isCreator && member.role === 'member'"
          class="action-btn set-admin"
          @tap="$emit('set-admin', member._id)"
        >
          <text>设管</text>
        </view>
        <view
          v-if="isCreator && member.role === 'admin'"
          class="action-btn remove-admin"
          @tap="$emit('remove-admin', member._id)"
        >
          <text>撤管</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  members: any[]
  isCreator: boolean
}>()

defineEmits<{
  (e: 'edit-name', member: any): void
  (e: 'set-admin', memberId: string): void
  (e: 'remove-admin', memberId: string): void
}>()
</script>

<style scoped>
.member-list {
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
  padding: 8rpx 20rpx;
  border-radius: 8rpx;
  font-size: 24rpx;
}
.action-btn.edit {
  color: #666;
}
.action-btn.set-admin {
  background: #e3f2fd;
  color: #1976d2;
}
.action-btn.remove-admin {
  background: #fce4ec;
  color: #c62828;
}
</style>