<template>
  <view class="order-bar">
    <view v-if="selectedMenuItem" class="selected-info">
      <text class="selected-name">{{ selectedMenuItem.name }}</text>
      <text class="selected-price">¥{{ selectedMenuItem.price }}</text>
    </view>
    <view v-else class="selected-info">
      <text class="no-selection">请选择菜品</text>
    </view>

    <view class="order-for-row">
      <view
        :class="['order-for-tab', orderFor === 'self' ? 'active' : '']"
        @tap="$emit('switch-self')"
      >
        <text>为自己点</text>
      </view>
      <view
        :class="['order-for-tab', orderFor === 'help' ? 'active' : '']"
        @tap="$emit('switch-help')"
      >
        <text>{{ orderFor === 'help' && orderForName ? '帮 ' + orderForName + ' 点' : '帮人点' }}</text>
      </view>
    </view>

    <view
      :class="['submit-btn', (!selectedMenuItem || submitting) ? 'disabled' : '']"
      @tap="$emit('submit')"
    >
      <text>{{ submitting ? '提交中...' : '提交点餐' }}</text>
    </view>

    <view v-if="showMemberPicker" class="member-picker-mask" @tap="$emit('close-picker')">
      <view class="member-picker" @tap.stop>
        <text class="picker-title">选择同事</text>
        <scroll-view scroll-y class="picker-list">
          <view
            v-for="m in memberList"
            :key="m._id"
            :class="['picker-item', orderForMemberId === m._id ? 'picked' : '']"
            @tap="$emit('pick-member', m._id)"
          >
            <text>{{ m.name || m.nickName || '未命名' }}</text>
            <text v-if="m.isVirtual" class="virtual-tag">未登录</text>
          </view>
          <view class="picker-item add-member" @tap="$emit('show-add')">
            <text class="add-member-text">＋新增同事</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <view v-if="showAddMember" class="member-picker-mask" @tap="$emit('close-add')">
      <view class="add-member-modal" :style="addModalStyle" @tap.stop>
        <text class="modal-title">新增同事</text>
        <input class="add-input" :value="newMemberName" @input="onNameInput" placeholder="输入姓名" @keyboardheightchange="onKeyboardHeightChange" />
        <view class="modal-btns">
          <view class="modal-btn cancel" @tap="$emit('close-add')"><text>取消</text></view>
          <view class="modal-btn confirm" @tap="$emit('add-virtual')"><text>添加</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{
  selectedMenuItem: any
  orderFor: string
  orderForMemberId: string
  orderForName: string
  submitting: boolean
  showMemberPicker: boolean
  showAddMember: boolean
  newMemberName: string
  memberList: any[]
}>()

const emit = defineEmits<{
  (e: 'switch-self'): void
  (e: 'switch-help'): void
  (e: 'submit'): void
  (e: 'pick-member', memberId: string): void
  (e: 'close-picker'): void
  (e: 'show-add'): void
  (e: 'close-add'): void
  (e: 'add-virtual'): void
  (e: 'update:newMemberName', val: string): void
}>()

const keyboardHeight = ref(0)

watch(() => props.showAddMember, (val) => {
  if (!val) keyboardHeight.value = 0
})

function onKeyboardHeightChange(e: any) {
  keyboardHeight.value = e.detail.height || 0
}

const addModalStyle = computed(() => {
  if (keyboardHeight.value > 0) {
    return { transform: `translate(-50%, calc(-50% - ${keyboardHeight.value / 2}px))` }
  }
  return {}
})

function onNameInput(e: any) {
  emit('update:newMemberName', e.detail.value)
}
</script>

<style scoped>
.order-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(100rpx + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1rpx solid #eee;
  padding: 16rpx 24rpx 16rpx;
  z-index: 100;
}
.selected-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8rpx 0 8rpx 16rpx;
  border-left: 6rpx solid #1976d2;
}
.selected-name {
  font-size: 28rpx;
  color: #333;
  font-weight: bold;
}
.selected-price {
  font-size: 28rpx;
  color: #e65100;
  font-weight: bold;
}
.no-selection {
  font-size: 28rpx;
  color: #ccc;
}
.order-for-row {
  display: flex;
  gap: 16rpx;
  margin: 12rpx 0;
}
.order-for-tab {
  flex: 1;
  text-align: center;
  padding: 20rpx 0;
  font-size: 28rpx;
  color: #666;
  background: #f5f5f5;
  border-radius: 8rpx;
}
.order-for-tab.active {
  background: #e3f2fd;
  color: #1976d2;
  font-weight: bold;
}
.submit-btn {
  text-align: center;
  padding: 28rpx 0;
  background: #1976d2;
  color: #fff;
  border-radius: 12rpx;
  font-size: 30rpx;
  font-weight: bold;
}
.submit-btn.disabled {
  background: #ccc;
}
.member-picker-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 150;
  display: flex;
  align-items: flex-end;
}
.member-picker {
  width: 100%;
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  max-height: 60vh;
  padding-bottom: calc(240rpx + env(safe-area-inset-bottom));
}
.picker-title {
  display: block;
  text-align: center;
  padding: 24rpx;
  font-size: 30rpx;
  font-weight: bold;
  border-bottom: 1rpx solid #eee;
}
.picker-list {
  max-height: 50vh;
}
.picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx;
  border-bottom: 1rpx solid #f0f0f0;
  font-size: 28rpx;
}
.picker-item.picked {
  background: #e8f5e9;
  color: #2e7d32;
}
.virtual-tag {
  font-size: 22rpx;
  color: #999;
  background: #f0f0f0;
  padding: 2rpx 12rpx;
  border-radius: 4rpx;
}
.picker-item.add-member {
  justify-content: center;
}
.add-member-text {
  color: #1976d2;
  font-weight: bold;
}
.add-member-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 600rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 40rpx;
}
.modal-title {
  display: block;
  text-align: center;
  font-size: 32rpx;
  font-weight: bold;
  margin-bottom: 24rpx;
}
.add-input {
  padding: 16rpx;
  border: 1rpx solid #ddd;
  border-radius: 8rpx;
  font-size: 28rpx;
  margin-bottom: 24rpx;
}
.modal-btns {
  display: flex;
  gap: 24rpx;
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
.modal-btn.confirm {
  background: #1976d2;
  color: #fff;
}
</style>