<template>
  <view class="page-menu">
    <MenuFilter
      :selectedSupplier="selectedSupplier"
      :selectedMenuName="selectedMenuName"
      :supplierOptions="supplierOptions"
      :menuNameOptions="menuNameOptions"
      @supplier-change="onSupplierChange"
      @menu-name-change="onMenuNameChange"
    />

    <MenuEditBar
      v-if="isAdmin"
      @add="openAdd"
    />

    <scroll-view scroll-y class="menu-scroll">
      <MenuTable
        :visibleItems="displayVisibleItems"
        :hiddenItems="isAdmin ? hiddenItems : []"
        :selectedMenuId="selectedMenuId"
        :isAdmin="isAdmin"
        @select="selectMenuItem"
        @edit="openEdit"
        @delete="deleteItem"
        @move="moveItem"
        @toggle-visible="toggleItemVisible"
      />
    </scroll-view>

    <OrderBar
      :selectedMenuItem="selectedMenuItem"
      :orderFor="orderFor"
      :orderForMemberId="orderForMemberId"
      :orderForName="orderForName"
      :submitting="submitting"
      :showMemberPicker="showMemberPicker"
      :showAddMember="showAddMember"
      :newMemberName="newMemberName"
      :memberList="memberList"
      @switch-self="switchToSelf"
      @switch-help="switchToHelp"
      @submit="submitOrder"
      @pick-member="pickMember"
      @close-picker="showMemberPicker = false"
      @show-add="showAddMember = true; showMemberPicker = false"
      @close-add="showAddMember = false"
      @add-virtual="addVirtualAndPick"
      @update:newMemberName="newMemberName = $event"
    />

    <view v-if="showEditModal" class="modal-mask" @tap="closeEditModal">
      <view class="edit-modal" @tap.stop>
        <text class="modal-title">{{ isEdit ? '编辑菜品' : '添加菜品' }}</text>
        <view class="form-item">
          <text class="form-label">供应商</text>
          <input class="form-input" v-model="editForm.supplier" placeholder="如：享德来" />
        </view>
        <view class="form-item">
          <text class="form-label">餐品名</text>
          <input class="form-input" v-model="editForm.name" placeholder="如：雞腿飯" />
        </view>
        <view class="form-item">
          <text class="form-label">价格</text>
          <input class="form-input" v-model="editForm.price" type="digit" placeholder="如：27" />
        </view>
        <view class="modal-actions">
          <view class="modal-btn cancel" @tap="closeEditModal"><text>取消</text></view>
          <view class="modal-btn confirm" @tap="saveItem"><text>保存</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useStore } from '../../services/store'
import { useAuth } from '../../hooks/useAuth'
import { useMenu } from '../../hooks/useMenu'
import { useMenuFilter } from '../../hooks/useMenuFilter'
import { useMenuEdit } from '../../hooks/useMenuEdit'
import { useOrder } from '../../hooks/useOrder'
import MenuFilter from '../../components/menu/MenuFilter.vue'
import MenuTable from '../../components/menu/MenuTable.vue'
import MenuEditBar from '../../components/menu/MenuEditBar.vue'
import OrderBar from '../../components/menu/OrderBar.vue'

const store = useStore()
const { isAdmin } = useAuth()
const { menuList, visibleItems, hiddenItems, loading, loadMenu } = useMenu()

const {
  selectedSupplier,
  selectedMenuName,
  supplierOptions,
  menuNameOptions,
  filteredList,
  onSupplierChange,
  onMenuNameChange,
} = useMenuFilter(menuList)

const displayVisibleItems = computed(() =>
  filteredList.value.filter((i: any) => i.visible !== false)
)

const {
  editLoading,
  showEditModal,
  editForm,
  isEdit,
  openAdd,
  openEdit,
  closeEditModal,
  saveItem,
  deleteItem,
  moveItem,
  toggleItemVisible,
} = useMenuEdit(loadMenu)

const {
  selectedMenuId,
  selectedMenuItem,
  orderFor,
  orderForMemberId,
  orderForName,
  submitting,
  showMemberPicker,
  showAddMember,
  newMemberName,
  memberList,
  selectMenuItem,
  switchToSelf,
  switchToHelp,
  pickMember,
  addVirtualAndPick,
  submitOrder,
} = useOrder()

onMounted(() => {
  if (menuList.value.length === 0) {
    loadMenu()
  }
})
</script>

<style scoped>
.page-menu {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f8f8f8;
}
.menu-scroll {
  flex: 1;
  overflow: hidden;
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
.edit-modal {
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
  margin-bottom: 32rpx;
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
  margin-top: 32rpx;
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