<template>
  <view class="page-menu">
    <MenuFilter
      :selectedSupplier="selectedSupplier"
      :selectedMenuName="selectedMenuName"
      :keyword="keyword"
      :supplierOptions="supplierOptions"
      :menuNameOptions="menuNameOptions"
      @supplier-change="onSupplierChange"
      @menu-name-change="onMenuNameChange"
      @clear-keyword="setKeyword('')"
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
      :voiceState="voiceState"
      @switch-self="switchToSelf"
      @switch-help="switchToHelp"
      @submit="submitOrder"
      @voice-toggle="onVoiceToggle"
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
import { useVoiceSearch } from '../../utils/voiceSearch'
import MenuFilter from '../../components/menu/MenuFilter.vue'
import MenuTable from '../../components/menu/MenuTable.vue'
import OrderBar from '../../components/menu/OrderBar.vue'
import CustomTabBar from '../../components/CustomTabBar/CustomTabBar.vue'

const store = useStore()
const { menuList, visibleItems, hiddenItems, loading, loadMenu, checkFreshness } = useMenu()

const {
  selectedSupplier,
  selectedMenuName,
  keyword,
  supplierOptions,
  menuNameOptions,
  filteredList,
  onSupplierChange,
  onMenuNameChange,
  setKeyword,
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

const { state: voiceState, toggle: onVoiceToggle } = useVoiceSearch({
  onStop: (text, keywords) => {
    // 优先：用菜单名反向匹配语音文本（菜名出现在文本中）
    const matchedNames = menuList.value
      .filter((i: any) => i.visible !== false && i.name && text.includes(i.name))
      .map(i => i.name)
    if (matchedNames.length > 0) {
      setKeyword(matchedNames[0])
    } else if (keywords.length > 0) {
      // 回退：用提取的关键词做模糊匹配
      setKeyword(keywords[0])
    }
  },
  onError: (msg) => {
    uni.showToast({ title: msg, icon: 'none' })
  },
})

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