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

    <scroll-view scroll-y class="menu-scroll">
      <MenuTable
        :visibleItems="displayVisibleItems"
        :hiddenItems="[]"
        :selectedMenuId="selectedMenuId"
        :isAdmin="false"
        @select="selectMenuItem"
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
      :memberList="memberList"
      @switch-self="switchToSelf"
      @switch-help="switchToHelp"
      @submit="submitOrder"
      @pick-member="pickMember"
      @close-picker="showMemberPicker = false"
      @show-add="showAddMember = true; showMemberPicker = false"
      @close-add="showAddMember = false"
      @add-virtual="addVirtualAndPick"
    />

    <CustomTabBar current="pages/menu/index" />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useStore } from '../../services/store'
import { useMenu } from '../../hooks/useMenu'
import { useMenuFilter } from '../../hooks/useMenuFilter'
import { useOrder } from '../../hooks/useOrder'
import MenuFilter from '../../components/menu/MenuFilter.vue'
import MenuTable from '../../components/menu/MenuTable.vue'
import OrderBar from '../../components/menu/OrderBar.vue'
import CustomTabBar from '../../components/CustomTabBar/CustomTabBar.vue'

const store = useStore()
const { menuList, visibleItems, hiddenItems, loading, loadMenu, checkFreshness } = useMenu()

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
  selectedMenuId,
  selectedMenuItem,
  orderFor,
  orderForMemberId,
  orderForName,
  submitting,
  showMemberPicker,
  showAddMember,
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

onShow(() => {
  if (store.member) {
    checkFreshness()
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
  padding-bottom: 420rpx;
}
</style>