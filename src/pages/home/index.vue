<template>
  <view class="page-home">
    <HomeHeader
      :displayName="displayName"
      :todayDate="todayDate"
      @click-avatar="openNameEdit"
    />

    <MonthlyStats
      :monthTotal="monthTotal"
      :todayAmount="todayAmount"
    />

    <TodayOrders :orders="todayOrders" />

    <NameEditDialog
      :show="showNameDialog"
      :currentName="displayName"
      :newName="editingName"
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
      <view class="welcome-modal" @tap.stop>
        <text class="modal-title">欢迎加入！</text>
        <text class="welcome-tip">请输入你的姓名（选填）</text>
        <input
          class="welcome-input"
          v-model="editingName"
          placeholder="不填将使用微信昵称"
        />
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="skipWelcome"><text>跳过</text></view>
          <view class="modal-btn confirm" @tap="saveName"><text>确认</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import HomeHeader from '../../components/home/HomeHeader.vue'
import MonthlyStats from '../../components/home/MonthlyStats.vue'
import TodayOrders from '../../components/home/TodayOrders.vue'
import NameEditDialog from '../../components/home/NameEditDialog.vue'
import { useHome } from '../../hooks/useHome'

const {
  loading,
  displayName,
  todayDate,
  monthTotal,
  todayAmount,
  todayOrders,
  showPrivacyDialog,
  showNameDialog,
  showWelcomeDialog,
  editingName,
  virtualMembers,
  showLinkDialog,
  selectedVirtualId,
  onShow: onHomeShow,
  refreshData,
  agreePrivacy,
  disagreePrivacy,
  saveName,
  skipWelcome,
  openNameEdit,
  closeNameDialog,
  openLinkDialog,
  linkVirtualMember,
  selectVirtual,
} = useHome()

onShow(() => {
  onHomeShow()
})

onPullDownRefresh(() => {
  refreshData()
})
</script>

<style scoped>
.page-home {
  min-height: 100vh;
  background: #f8f8f8;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
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