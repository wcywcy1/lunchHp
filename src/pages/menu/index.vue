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
      @keyword-change="updateKeyword"
    />

    <scroll-view scroll-y class="menu-scroll">
      <MenuTable
        :visibleItems="displayVisibleItems"
        :hiddenItems="[]"
        :selectedMenuId="selectedMenuId"
        :isAdmin="false"
        :flat="selectedSupplier === '__recent__'"
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
      :voiceVolume="voiceVolume"
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
import { computed, onMounted, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useStore } from '../../services/store'
import { useMenu } from '../../hooks/useMenu'
import { useMenuFilter } from '../../hooks/useMenuFilter'
import { useOrder } from '../../hooks/useOrder'
import { useVoiceSearch } from '../../utils/voiceSearch'
import { orderAction } from '../../services/repositories/baseRepository'
import MenuFilter from '../../components/menu/MenuFilter.vue'
import MenuTable from '../../components/menu/MenuTable.vue'
import OrderBar from '../../components/menu/OrderBar.vue'
import CustomTabBar from '../../components/CustomTabBar/CustomTabBar.vue'

const store = useStore()
const { menuList, visibleItems, hiddenItems, loading, loadMenu, checkFreshness } = useMenu()

// 帮他人点餐时，"最近点过"按被帮人的频率排；self 模式用 menu 自带的当前用户统计
const statsOverride = ref<Record<string, { count: number; lastAt: any }>>({})

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
  updateKeyword,
  resetFilter,
} = useMenuFilter(menuList, statsOverride)

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
  orderJustSucceeded,
  selectMenuItem,
  switchToSelf,
  switchToHelp,
  pickMember,
  addVirtualAndPick,
  submitOrder,
} = useOrder()

// 帮他人点餐时拉取被帮人的点餐统计，self 模式清空回退到当前用户统计
watch([orderFor, orderForMemberId], async () => {
  if (orderFor.value === 'help' && orderForMemberId.value) {
    try {
      const res = await orderAction('getUserMenuStats', { memberId: orderForMemberId.value })
      if (res.result.code === 0) {
        statsOverride.value = res.result.data.stats || {}
        return
      }
    } catch (e) {
      console.error('getUserMenuStats error:', e)
    }
  }
  statsOverride.value = {}
}, { immediate: true })

const { state: voiceState, volume: voiceVolume, toggle: onVoiceToggle } = useVoiceSearch({
  onStop: async (text, keywords) => {
    // menuList 为空时等待加载完成，避免语音结果匹配为空
    if (menuList.value.length === 0) {
      uni.showLoading({ title: '加载菜单中...', mask: true })
      await loadMenu()
      uni.hideLoading()
    }
    // 优先：用菜单名反向匹配语音文本（菜名出现在文本中）
    const matchedNames = menuList.value
      .filter((i: any) => i.visible !== false && i.name && text.includes(i.name))
      .map(i => i.name)
    if (matchedNames.length > 0) {
      setKeyword(matchedNames[0])
    } else if (keywords.length > 0) {
      // 回退：用提取的关键词做模糊匹配
      setKeyword(keywords[0])
    } else {
      uni.showToast({ title: '未匹配到菜品', icon: 'none' })
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
  // 上次点餐成功后，进入餐单页时清空筛选，回到初始状态（"常点"tab，无关键词）
  if (orderJustSucceeded.value) {
    orderJustSucceeded.value = false
    resetFilter()
  }
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
  padding-bottom: 460rpx;
}
</style>