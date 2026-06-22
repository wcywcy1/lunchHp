<template>
  <view class="page-home">
    <HomeHeader
      :displayName="displayName"
      :todayDate="todayDate"
      :avatar="currentAvatar"
      :memberLoading="memberLoading"
      @click-avatar="openNameEdit"
    />

    <MonthlyStats
      :monthCount="monthCount"
      :todayCount="todayCount"
    />

    <TodayOrders
      :orders="todayOrders"
      :notice="showNoticeBanner ? noticeContent : ''"
      :currentMemberId="currentMemberId"
      @cancel-mine="cancelMyOrder"
      @request-cancel="requestCancelOrder"
    />

    <NameEditDialog
      :show="showNameDialog"
      :currentName="displayName"
      :newName="editingName"
      :avatar="editingAvatar"
      :hasVirtualMembers="virtualMembers.length > 0"
      :showLinkList="showLinkDialog"
      :virtualMembers="virtualMembers"
      :selectedId="selectedVirtualId"
      @close="closeNameDialog"
      @save="saveName"
      @open-link="openLinkDialog"
      @close-link="showLinkDialog = false"
      @select-virtual="selectVirtual"
      @confirm-link="linkVirtualMember"
      @update:newName="editingName = $event"
      @choose-avatar="onChooseAvatar"
    />

    <view v-if="showPrivacyDialog" class="modal-mask" @tap.stop>
      <view class="privacy-modal" @tap.stop>
        <text class="modal-title">隐私协议</text>
        <text class="privacy-text">使用本小程序前，请阅读《隐私保护指引》</text>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="disagreePrivacy"><text>不同意</text></view>
          <view class="modal-btn confirm" @tap="agreePrivacy"><text>同意并继续</text></view>
        </view>
      </view>
    </view>

    <view v-if="showWelcomeDialog" class="modal-mask" @tap.stop>
      <view class="welcome-modal" :style="welcomeModalStyle" @tap.stop>
        <text class="modal-title">欢迎加入！</text>
        <view class="welcome-avatar-section">
          <button class="welcome-avatar-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
            <image v-if="editingAvatar" class="welcome-avatar-img" :src="editingAvatar" mode="aspectFill" />
            <view v-else class="welcome-avatar-placeholder">
              <text class="welcome-avatar-text">选头像</text>
            </view>
          </button>
          <text class="welcome-avatar-hint">点击设置头像（选填）</text>
        </view>
        <text class="welcome-tip">请输入你的姓名（选填）</text>
        <input
          class="welcome-input"
          v-model="editingName"
          placeholder="可点键盘上方使用微信昵称"
          type="nickname"
          @keyboardheightchange="onWelcomeKeyboard"
        />
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="skipWelcome"><text>跳过</text></view>
          <view class="modal-btn confirm" @tap="saveName"><text>确认</text></view>
        </view>
      </view>
    </view>

    <CustomTabBar current="pages/home/index" />
  </view>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { onShow, onHide, onPullDownRefresh } from '@dcloudio/uni-app'
import HomeHeader from '../../components/home/HomeHeader.vue'
import MonthlyStats from '../../components/home/MonthlyStats.vue'
import TodayOrders from '../../components/home/TodayOrders.vue'
import NameEditDialog from '../../components/home/NameEditDialog.vue'
import CustomTabBar from '../../components/CustomTabBar/CustomTabBar.vue'
import { useHome } from '../../hooks/useHome'
import { useModalKeyboardAvoid } from '../../hooks/useModalKeyboardAvoid'

const {
  loading,
  memberLoading,
  displayName,
  todayDate,
  monthCount,
  todayCount,
  todayOrders,
  currentMemberId,
  showPrivacyDialog,
  showNameDialog,
  showWelcomeDialog,
  editingName,
  editingAvatar,
  currentAvatar,
  virtualMembers,
  showLinkDialog,
  selectedVirtualId,
  noticeContent,
  showNoticeBanner,
  onShow: onHomeShow,
  onHide: onHomeHide,
  refreshData,
  cancelMyOrder,
  requestCancelOrder,
  agreePrivacy,
  disagreePrivacy,
  saveName,
  onChooseAvatar,
  skipWelcome,
  openNameEdit,
  closeNameDialog,
  openLinkDialog,
  linkVirtualMember,
  selectVirtual,
} = useHome()

const { modalStyle: welcomeModalStyle, onKeyboardHeightChange: onWelcomeKeyboard, reset: resetWelcomeKb } = useModalKeyboardAvoid({
  modalSelector: '.welcome-modal'
})

watch(() => showWelcomeDialog.value, (val) => {
  if (!val) resetWelcomeKb()
})

onShow(() => {
  onHomeShow()
})

onHide(() => {
  onHomeHide()
})

onPullDownRefresh(() => {
  refreshData()
})
</script>

<style scoped>
.page-home {
  min-height: 100vh;
  background: #f8f8f8;
  padding-bottom: calc(120rpx + env(safe-area-inset-bottom));
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
.privacy-modal,
.welcome-modal {
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
.privacy-text {
  display: block;
  font-size: 28rpx;
  color: #666;
  text-align: center;
  margin-bottom: 32rpx;
  line-height: 1.6;
}
.welcome-tip {
  display: block;
  font-size: 28rpx;
  color: #666;
  margin-bottom: 20rpx;
}
.welcome-avatar-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 24rpx;
}
.welcome-avatar-btn {
  width: 128rpx;
  height: 128rpx;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  line-height: normal;
}
.welcome-avatar-btn::after {
  border: none;
}
.welcome-avatar-img {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
}
.welcome-avatar-placeholder {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  background: #e3f2fd;
  display: flex;
  align-items: center;
  justify-content: center;
}
.welcome-avatar-text {
  font-size: 24rpx;
  color: #1976d2;
}
.welcome-avatar-hint {
  font-size: 22rpx;
  color: #999;
  margin-top: 8rpx;
}
.welcome-input {
  padding: 16rpx;
  border: 1rpx solid #ddd;
  border-radius: 8rpx;
  font-size: 28rpx;
  margin-bottom: 24rpx;
}
.modal-actions {
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