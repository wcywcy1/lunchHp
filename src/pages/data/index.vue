<template>
  <view class="page-data">
    <scroll-view scroll-y class="data-scroll">
      <PendingList
        :orders="pendingOrders"
        :selectedIds="selectedIds"
        :isAllSelected="isAllSelected"
        :confirming="confirming"
        @toggle="toggleSelect"
        @toggle-all="toggleSelectAll"
        @batch-confirm="batchConfirm"
      />

      <ConfirmedList
        :groups="confirmedBySupplier"
        @download="showDownloadDialog = true"
      />

      <MemberList
        :members="members"
        :isCreator="isCreator"
        @edit-name="openNameEdit"
        @set-admin="setAdminRole"
        @remove-admin="removeAdminRole"
      />

      <ImportExport
        :exporting="exporting"
        :importing="importing"
        @backup="manualBackup"
        @restore="openBackupDialog"
        @export="exportOrders"
        @import="importOrders"
      />
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
      <view class="edit-modal" @tap.stop>
        <text class="modal-title">修改姓名</text>
        <view class="current-name">
          <text class="current-label">当前：</text>
          <text class="current-value">{{ editingMember?.name || editingMember?.nickName || '未设置' }}</text>
        </view>
        <view class="form-item">
          <text class="form-label">新姓名</text>
          <input class="form-input" v-model="editingName" placeholder="输入姓名" />
        </view>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="showNameEditDialog = false"><text>取消</text></view>
          <view class="modal-btn confirm" @tap="saveMemberName"><text>保存</text></view>
        </view>
      </view>
    </view>

    <view v-if="showBackupDialog" class="modal-mask" @tap="showBackupDialog = false">
      <view class="backup-modal" @tap.stop>
        <text class="modal-title">选择备份</text>
        <scroll-view scroll-y class="backup-scroll">
          <view
            v-for="bk in backupList"
            :key="bk._id"
            :class="['backup-item', selectedBackupId === bk._id ? 'selected' : '']"
            @tap="selectedBackupId = bk._id"
          >
            <text class="backup-time">{{ formatTime(bk.createdAt) }}</text>
            <text class="backup-info">{{ bk.type === 'auto' ? '自动' : '手动' }} · 订单:{{ bk.orderCount || 0 }}</text>
          </view>
        </scroll-view>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="showBackupDialog = false"><text>取消</text></view>
          <view :class="['modal-btn confirm', !selectedBackupId || restoring ? 'disabled' : '']" @tap="restoreBackup">
            <text>{{ restoring ? '恢复中...' : '确认恢复' }}</text>
          </view>
        </view>
      </view>
    </view>

    <CustomTabBar current="pages/data/index" />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useStore } from '../../services/store'
import { useAuth } from '../../hooks/useAuth'
import { useDataManage } from '../../hooks/useDataManage'
import PendingList from '../../components/data/PendingList.vue'
import ConfirmedList from '../../components/data/ConfirmedList.vue'
import MemberList from '../../components/data/MemberList.vue'
import ImportExport from '../../components/data/ImportExport.vue'
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
  loadData,
  toggleSelect,
  toggleSelectAll,
  batchConfirm,
  downloadConfirmed,
  openNameEdit,
  saveMemberName,
  setAdminRole,
  removeAdminRole,
  exportOrders,
  importOrders,
  manualBackup,
  openBackupDialog,
  restoreBackup,
} = useDataManage()

const members = computed(() => store.members || [])

function formatTime(ts: any) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onShow(() => {
  if (!isAdmin.value) {
    uni.switchTab({ url: '/pages/home/index' })
    return
  }
  loadData()
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
</style>