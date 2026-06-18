<template>
  <view class="page-data">
    <scroll-view scroll-y class="data-scroll">
      <PendingList
        :orders="pendingOrders"
        :selectedIds="selectedIds"
        :isAllSelected="isAllSelected"
        :confirming="confirming"
        :historyCount="historyPendingCount"
        :historyOrders="historyPendingOrders"
        :historyHasMore="historyPendingHasMore"
        :loadingHistory="loadingHistoryPending"
        :showHistory="showHistoryPending"
        @toggle="toggleSelect"
        @toggle-all="toggleSelectAll"
        @batch-confirm="batchConfirm"
        @toggle-history="toggleHistoryPending"
        @load-more-history="loadMoreHistoryPending"
      />

      <view class="notice-section">
        <view class="notice-header" @tap="openNoticeSendDialog">
          <text class="notice-title">发送通知</text>
          <text class="notice-hint">向所有在线成员推送消息</text>
        </view>
        <view class="notice-actions">
          <view class="notice-btn" @tap="openNoticeSendDialog"><text>发送通知</text></view>
          <view class="notice-btn secondary" @tap="clearNotice"><text>清除通知</text></view>
        </view>
      </view>

      <ConfirmedList
        :groups="confirmedBySupplier"
        :historyCount="historyConfirmedCount"
        :historyOrders="historyConfirmedOrders"
        :historyHasMore="historyConfirmedHasMore"
        :loadingHistory="loadingHistoryConfirmed"
        :showHistory="showHistoryConfirmed"
        @download="showDownloadDialog = true"
        @toggle-history="toggleHistoryConfirmed"
        @load-more-history="loadMoreHistoryConfirmed"
      />

      <MemberList
        :members="members"
        :isCreator="isCreator"
        @edit-name="openNameEdit"
        @delete-member="deleteMember"
        @set-admin="setAdminRole"
        @remove-admin="removeAdminRole"
      />

      <MenuManage
        :menuList="menuList"
        @add="openMenuAdd"
        @edit="openMenuEdit"
        @delete="deleteMenuItem"
        @move="moveMenuItem"
        @toggle-visible="toggleMenuVisible"
        @toggle-supplier-visible="toggleSupplierVisible"
      />

      <ImportExport
        :exporting="exporting"
        :importing="importing"
        @export="exportData"
        @import="importData"
      />

      <DataBackup
        :backingUp="backingUp"
        @backup="manualBackup"
        @restore="openBackupDialog"
      />

      <DangerZone @delete-data="clearAllData" />
    </scroll-view>

    <DownloadDialog
      :show="showDownloadDialog"
      :mode="downloadMode"
      :downloading="downloading"
      @close="showDownloadDialog = false"
      @update:mode="downloadMode = $event"
      @confirm="downloadConfirmed"
    />

    <view v-if="showNameEditDialog" class="modal-mask" @tap="showNameEditDialog = false">
      <view class="edit-modal" :style="nameEditModalStyle" @tap.stop>
        <text class="modal-title">修改姓名</text>
        <view class="current-name">
          <text class="current-label">当前：</text>
          <text class="current-value">{{ editingMember?.name || editingMember?.nickName || '未设置' }}</text>
        </view>
        <view class="form-item">
          <text class="form-label">新姓名</text>
          <input class="form-input" v-model="editingName" placeholder="输入姓名" @keyboardheightchange="onNameEditKeyboard" />
        </view>
        <view v-if="editingMember?.isVirtual" class="merge-section" @tap="openMergeDialog(editingMember)">
          <text class="merge-btn">🔗 与微信账号合帐</text>
        </view>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="showNameEditDialog = false"><text>取消</text></view>
          <view class="modal-btn confirm" @tap="saveMemberName"><text>保存</text></view>
        </view>
      </view>
    </view>

    <view v-if="showMergeDialog" class="modal-mask" @tap="showMergeDialog = false">
      <view class="edit-modal" @tap.stop>
        <text class="modal-title">与微信账号合帐</text>
        <view class="merge-info">
          <text class="merge-desc">将虚拟成员「{{ mergingMember?.name || '未命名' }}」与当前微信账号合并。合并后该虚拟成员将绑定到您的微信，您当前的账号数据将转移过去。</text>
        </view>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="showMergeDialog = false"><text>取消</text></view>
          <view class="modal-btn confirm" @tap="mergeWithWechat"><text>确认合帐</text></view>
        </view>
      </view>
    </view>

    <view v-if="showMenuEditModal" class="modal-mask" @tap="showMenuEditModal = false">
      <view class="edit-modal" :style="menuEditModalStyle" @tap.stop>
        <text class="modal-title">{{ isMenuEdit ? '编辑菜品' : '添加菜品' }}</text>
        <view class="form-item">
          <text class="form-label">供应商</text>
          <input class="form-input" v-model="menuEditForm.supplier" placeholder="如：享德来" @keyboardheightchange="onMenuEditKeyboard" />
        </view>
        <view class="form-item">
          <text class="form-label">餐品名</text>
          <input class="form-input" v-model="menuEditForm.name" placeholder="如：雞腿飯" @keyboardheightchange="onMenuEditKeyboard" />
        </view>
        <view class="form-item">
          <text class="form-label">价格</text>
          <input class="form-input" v-model="menuEditForm.price" type="digit" placeholder="如：27" @keyboardheightchange="onMenuEditKeyboard" />
        </view>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="showMenuEditModal = false"><text>取消</text></view>
          <view class="modal-btn confirm" @tap="saveMenuItem"><text>保存</text></view>
        </view>
      </view>
    </view>

    <view v-if="showBackupDialog" class="modal-mask" @tap="showBackupDialog = false">
      <view class="backup-modal" @tap.stop>
        <text class="modal-title">
          {{ backupStep === 'list' ? '选择备份' : backupStep === 'preview' ? '备份预览' : '确认恢复' }}
        </text>

        <scroll-view v-if="backupStep === 'list'" scroll-y class="backup-scroll">
          <view class="backup-section">
            <text class="backup-section-title">🟢 自动备份</text>
            <view
              v-for="bk in autoBackups"
              :key="bk._id"
              class="backup-item"
              @tap="selectBackup(bk)"
            >
              <text class="backup-time">{{ formatTime(bk.createdAt) }}</text>
              <text class="backup-info">订单:{{ bk.orderCount || 0 }} · 菜品:{{ bk.menuCount || 0 }} · 成员:{{ bk.memberCount || 0 }}</text>
            </view>
          </view>
          <view class="backup-section">
            <text class="backup-section-title">🔵 手动备份</text>
            <view
              v-for="bk in manualBackups"
              :key="bk._id"
              class="backup-item"
              @tap="selectBackup(bk)"
            >
              <text class="backup-time">{{ formatTime(bk.createdAt) }}</text>
              <text class="backup-info">订单:{{ bk.orderCount || 0 }} · 菜品:{{ bk.menuCount || 0 }} · 成员:{{ bk.memberCount || 0 }}</text>
              <text v-if="bk.remark" class="backup-remark">备注: {{ bk.remark }}</text>
            </view>
          </view>
        </scroll-view>

        <view v-if="backupStep === 'preview' && selectedBackup" class="preview-content">
          <view class="preview-row">
            <text class="preview-label">类型</text>
            <text class="preview-value">{{ selectedBackup.type === 'auto' ? '自动备份' : '手动备份' }}</text>
          </view>
          <view class="preview-row">
            <text class="preview-label">时间</text>
            <text class="preview-value">{{ formatTime(selectedBackup.createdAt) }}</text>
          </view>
          <view class="preview-row">
            <text class="preview-label">订单数</text>
            <text class="preview-value">{{ selectedBackup.orderCount || 0 }}</text>
          </view>
          <view class="preview-row">
            <text class="preview-label">菜品数</text>
            <text class="preview-value">{{ selectedBackup.menuCount || 0 }}</text>
          </view>
          <view class="preview-row">
            <text class="preview-label">成员数</text>
            <text class="preview-value">{{ selectedBackup.memberCount || 0 }}</text>
          </view>
          <view v-if="selectedBackup.dateRange" class="preview-row">
            <text class="preview-label">数据范围</text>
            <text class="preview-value">{{ selectedBackup.dateRange.start }} ~ {{ selectedBackup.dateRange.end }}</text>
          </view>
          <view v-if="selectedBackup.remark" class="preview-row">
            <text class="preview-label">备注</text>
            <text class="preview-value">{{ selectedBackup.remark }}</text>
          </view>
          <view class="preview-tip">
            <text>恢复前将自动创建一次手动备份，防止误操作</text>
          </view>
        </view>

        <view v-if="backupStep === 'confirm'" class="confirm-content">
          <text class="confirm-warning">⚠️ 确认恢复此备份？</text>
          <text class="confirm-desc">当前所有数据将被替换为备份数据，恢复前已自动创建手动备份。</text>
          <view class="confirm-detail">
            <text>备份时间：{{ formatTime(selectedBackup?.createdAt) }}</text>
            <text>订单数：{{ selectedBackup?.orderCount || 0 }}</text>
          </view>
        </view>

        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="backupStep === 'list' ? (showBackupDialog = false) : (backupStep = backupStep === 'confirm' ? 'preview' : 'list')">
            <text>{{ backupStep === 'list' ? '取消' : '返回' }}</text>
          </view>
          <view v-if="backupStep === 'list'" class="modal-btn confirm disabled">
            <text>请选择</text>
          </view>
          <view v-if="backupStep === 'preview'" class="modal-btn confirm" @tap="confirmRestore">
            <text>下一步</text>
          </view>
          <view v-if="backupStep === 'confirm'" :class="['modal-btn confirm', restoring ? 'disabled' : '']" @tap="restoreBackup">
            <text>{{ restoring ? '恢复中...' : '确认恢复' }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="showNoticeSendDialog" class="modal-mask" @tap="showNoticeSendDialog = false">
      <view class="edit-modal" @tap.stop>
        <text class="modal-title">发送通知</text>
        <text class="notice-send-hint">通知将实时推送给所有在线成员</text>
        <view class="form-item">
          <text class="form-label">内容</text>
          <input class="form-input" v-model="noticeInput" placeholder="如：已停止接单，电话联系" />
        </view>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="showNoticeSendDialog = false"><text>取消</text></view>
          <view :class="['modal-btn confirm', sendingNotice ? 'disabled' : '']" @tap="sendNotice"><text>{{ sendingNotice ? '发送中...' : '发送' }}</text></view>
        </view>
      </view>
    </view>

    <CustomTabBar current="pages/data/index" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { useStore } from '../../services/store'
import { useAuth } from '../../hooks/useAuth'
import { useDataManage } from '../../hooks/useDataManage'
import PendingList from '../../components/data/PendingList.vue'
import ConfirmedList from '../../components/data/ConfirmedList.vue'
import MemberList from '../../components/data/MemberList.vue'
import MenuManage from '../../components/data/MenuManage.vue'
import ImportExport from '../../components/data/ImportExport.vue'
import DataBackup from '../../components/data/DataBackup.vue'
import DangerZone from '../../components/data/DangerZone.vue'
import DownloadDialog from '../../components/data/DownloadDialog.vue'
import CustomTabBar from '../../components/CustomTabBar/CustomTabBar.vue'

const store = useStore()
const { isAdmin, isCreator } = useAuth()
const {
  loading,
  pendingOrders,
  confirmedOrders,
  confirmedBySupplier,
  selectedIds,
  isAllSelected,
  confirming,
  showDownloadDialog,
  downloadMode,
  downloading,
  showNameEditDialog,
  editingMember,
  editingName,
  exporting,
  importing,
  showBackupDialog,
  backupList,
  selectedBackupId,
  restoring,
  backupStep,
  selectedBackup,
  backingUp,
  showMergeDialog,
  mergingMember,
  showMenuEditModal,
  menuEditForm,
  isMenuEdit,
  menuList,
  historyPendingCount,
  historyConfirmedCount,
  historyPendingOrders,
  historyConfirmedOrders,
  showHistoryPending,
  showHistoryConfirmed,
  loadingHistoryPending,
  loadingHistoryConfirmed,
  historyPendingHasMore,
  historyConfirmedHasMore,
  showNoticeSendDialog,
  noticeInput,
  sendingNotice,
  loadData,
  toggleSelect,
  toggleSelectAll,
  batchConfirm,
  downloadConfirmed,
  openNameEdit,
  saveMemberName,
  setAdminRole,
  removeAdminRole,
  deleteMember,
  clearAllData,
  openMergeDialog,
  mergeWithWechat,
  openMenuAdd,
  openMenuEdit,
  saveMenuItem,
  deleteMenuItem,
  moveMenuItem,
  toggleMenuVisible,
  toggleSupplierVisible,
  loadMenuList,
  exportData,
  importData,
  manualBackup,
  openBackupDialog,
  selectBackup,
  confirmRestore,
  restoreBackup,
  toggleHistoryPending,
  toggleHistoryConfirmed,
  loadMoreHistoryPending,
  loadMoreHistoryConfirmed,
  startRealtimeWatch,
  stopRealtimeWatch,
  openNoticeSendDialog,
  sendNotice,
  clearNotice,
} = useDataManage()

const members = computed(() => store.members || [])

const nameEditKeyboardHeight = ref(0)
const menuEditKeyboardHeight = ref(0)

function onNameEditKeyboard(e: any) {
  nameEditKeyboardHeight.value = e.detail.height || 0
}
function onMenuEditKeyboard(e: any) {
  menuEditKeyboardHeight.value = e.detail.height || 0
}

const nameEditModalStyle = computed(() => {
  if (nameEditKeyboardHeight.value > 0) {
    return { transform: `translateY(-${nameEditKeyboardHeight.value / 2}px)` }
  }
  return {}
})
const menuEditModalStyle = computed(() => {
  if (menuEditKeyboardHeight.value > 0) {
    return { transform: `translateY(-${menuEditKeyboardHeight.value / 2}px)` }
  }
  return {}
})

const autoBackups = computed(() => backupList.value.filter((b: any) => b.type === 'auto'))
const manualBackups = computed(() => backupList.value.filter((b: any) => b.type === 'manual'))

function formatTime(ts: any) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onShow(() => {
  if (!store.role) return
  if (!isAdmin.value) {
    uni.switchTab({ url: '/pages/home/index' })
    return
  }
  loadData()
  loadMenuList()
  startRealtimeWatch()
})

onHide(() => {
  stopRealtimeWatch()
})
</script>

<style scoped>
.page-data {
  min-height: 100vh;
  background: #f8f8f8;
  padding-top: 16rpx;
  padding-bottom: calc(120rpx + env(safe-area-inset-bottom));
}
.data-scroll {
  height: calc(100vh - 120rpx - env(safe-area-inset-bottom));
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
.edit-modal,
.backup-modal {
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
.current-name {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}
.current-label {
  font-size: 26rpx;
  color: #999;
}
.current-value {
  font-size: 26rpx;
  color: #333;
}
.form-item {
  display: flex;
  align-items: center;
  margin-bottom: 24rpx;
  gap: 16rpx;
}
.form-label {
  width: 120rpx;
  font-size: 28rpx;
  color: #333;
  flex-shrink: 0;
}
.form-input {
  flex: 1;
  padding: 12rpx 16rpx;
  border: 1rpx solid #ddd;
  border-radius: 8rpx;
  font-size: 28rpx;
}
.merge-section {
  margin-bottom: 24rpx;
}
.merge-btn {
  display: block;
  text-align: center;
  padding: 16rpx;
  background: #e3f2fd;
  border-radius: 12rpx;
  font-size: 28rpx;
  color: #1976d2;
}
.merge-info {
  margin-bottom: 24rpx;
}
.merge-desc {
  font-size: 26rpx;
  color: #666;
  line-height: 1.6;
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
.modal-btn.disabled {
  background: #ccc;
}
.backup-scroll {
  max-height: 500rpx;
}
.backup-section {
  margin-bottom: 16rpx;
}
.backup-section-title {
  display: block;
  font-size: 26rpx;
  font-weight: bold;
  color: #666;
  margin-bottom: 8rpx;
  padding: 0 8rpx;
}
.backup-item {
  padding: 20rpx 16rpx;
  border-bottom: 1rpx solid #f0f0f0;
  border-radius: 8rpx;
}
.backup-item.selected {
  background: #e3f2fd;
}
.backup-time {
  display: block;
  font-size: 28rpx;
  color: #333;
  margin-bottom: 4rpx;
}
.backup-info {
  font-size: 24rpx;
  color: #999;
}
.backup-remark {
  display: block;
  font-size: 22rpx;
  color: #888;
  margin-top: 4rpx;
  font-style: italic;
}
.preview-content {
  padding: 16rpx 0;
}
.preview-row {
  display: flex;
  justify-content: space-between;
  padding: 12rpx 0;
  border-bottom: 1rpx solid #f5f5f5;
}
.preview-label {
  font-size: 28rpx;
  color: #666;
}
.preview-value {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}
.preview-tip {
  margin-top: 20rpx;
  padding: 16rpx;
  background: #fff8e1;
  border-radius: 8rpx;
}
.preview-tip text {
  font-size: 24rpx;
  color: #f57c00;
}
.confirm-content {
  padding: 16rpx 0;
  text-align: center;
}
.confirm-warning {
  display: block;
  font-size: 32rpx;
  font-weight: bold;
  color: #d32f2f;
  margin-bottom: 16rpx;
}
.confirm-desc {
  display: block;
  font-size: 26rpx;
  color: #666;
  margin-bottom: 20rpx;
  line-height: 1.5;
}
.confirm-detail {
  background: #f5f5f5;
  border-radius: 8rpx;
  padding: 16rpx;
}
.confirm-detail text {
  display: block;
  font-size: 26rpx;
  color: #333;
  margin-bottom: 4rpx;
}
.notice-section {
  margin: 16rpx 24rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
}
.notice-header {
  margin-bottom: 16rpx;
}
.notice-title {
  display: block;
  font-size: 28rpx;
  font-weight: bold;
  color: #333;
}
.notice-hint {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-top: 4rpx;
}
.notice-actions {
  display: flex;
  gap: 16rpx;
}
.notice-btn {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  background: #1976d2;
  color: #fff;
}
.notice-btn.secondary {
  background: #f5f5f5;
  color: #666;
}
.notice-send-hint {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-bottom: 20rpx;
  text-align: center;
}
</style>