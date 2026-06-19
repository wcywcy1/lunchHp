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

    <TodayOrders
      :orders="todayOrders"
      :notice="showNoticeBanner ? noticeContent : ''"
      :currentMemberId="currentMemberId"
      @cancel-mine="cancelMyOrder"
      @request-cancel="requestCancelOrder"
      @edit-mine="openEditOrder"
    />

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
      <view class="welcome-modal" :style="welcomeModalStyle" @tap.stop>
        <text class="modal-title">欢迎加入！</text>
        <text class="welcome-tip">请输入你的姓名（选填）</text>
        <input
          class="welcome-input"
          v-model="editingName"
          placeholder="不填将使用微信昵称"
          @keyboardheightchange="onWelcomeKeyboard"
        />
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="skipWelcome"><text>跳过</text></view>
          <view class="modal-btn confirm" @tap="saveName"><text>确认</text></view>
        </view>
      </view>
    </view>

    <!-- 编辑我的订单弹窗 -->
    <view v-if="showEditDialog" class="modal-mask" @tap="closeEditDialog">
      <view class="modal-content edit-modal" @tap.stop>
        <text class="modal-title">编辑订单</text>
        <view class="form-item">
          <text class="form-label">菜品</text>
          <picker
            v-if="store.menu && store.menu.length > 0"
            :range="store.menu"
            range-key="name"
            @change="onEditMenuChange"
          >
            <view class="picker-value">{{ editForm.menuName || '请选择菜品' }}</view>
          </picker>
          <input v-else class="form-input" v-model="editForm.menuName" placeholder="请输入菜品" />
        </view>
        <view class="form-item">
          <text class="form-label">供应商</text>
          <input class="form-input" v-model="editForm.supplier" placeholder="供应商" />
        </view>
        <view class="form-item">
          <text class="form-label">价格</text>
          <input class="form-input" type="digit" v-model="editForm.price" placeholder="价格" />
        </view>
        <view class="form-item">
          <text class="form-label">备注</text>
          <input class="form-input" v-model="editForm.note" placeholder="备注（可选）" />
        </view>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="closeEditDialog"><text>取消</text></view>
          <view class="modal-btn confirm" @tap="saveMyOrder"><text>保存</text></view>
        </view>
      </view>
    </view>

    <CustomTabBar current="pages/home/index" />
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onShow, onHide, onPullDownRefresh } from '@dcloudio/uni-app'
import HomeHeader from '../../components/home/HomeHeader.vue'
import MonthlyStats from '../../components/home/MonthlyStats.vue'
import TodayOrders from '../../components/home/TodayOrders.vue'
import NameEditDialog from '../../components/home/NameEditDialog.vue'
import CustomTabBar from '../../components/CustomTabBar/CustomTabBar.vue'
import { useStore } from '../../services/store'
import { useHome } from '../../hooks/useHome'

const store = useStore()

const {
  loading,
  displayName,
  todayDate,
  monthTotal,
  todayAmount,
  todayOrders,
  currentMemberId,
  showPrivacyDialog,
  showNameDialog,
  showWelcomeDialog,
  editingName,
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
  showEditDialog,
  editingOrder,
  editForm,
  openEditOrder,
  onEditMenuChange,
  saveMyOrder,
  closeEditDialog,
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

const welcomeKeyboardHeight = ref(0)

watch(() => showWelcomeDialog.value, (val) => {
  if (!val) welcomeKeyboardHeight.value = 0
})

function onWelcomeKeyboard(e: any) {
  welcomeKeyboardHeight.value = e.detail.height || 0
}

const welcomeModalStyle = computed(() => {
  if (welcomeKeyboardHeight.value > 0) {
    return { transform: `translateY(-${welcomeKeyboardHeight.value / 2}px)` }
  }
  return {}
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
.edit-modal {
  width: 600rpx;
}
.form-item {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}
.form-label {
  width: 120rpx;
  font-size: 28rpx;
  color: #333;
  flex-shrink: 0;
}
.form-input {
  flex: 1;
  height: 72rpx;
  padding: 0 16rpx;
  font-size: 28rpx;
  border: 1rpx solid #ddd;
  border-radius: 8rpx;
  background: #fff;
}
.picker-value {
  flex: 1;
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 16rpx;
  font-size: 28rpx;
  border: 1rpx solid #ddd;
  border-radius: 8rpx;
  background: #fff;
  color: #333;
}
</style>