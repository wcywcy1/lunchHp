<template>
  <view class="custom-tabbar">
    <view
      v-for="tab in visibleTabs"
      :key="tab.pagePath"
      :class="['tab-item', current === tab.pagePath ? 'active' : '']"
      @tap="switchTab(tab.pagePath)"
    >
      <text class="tab-text">{{ tab.text }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from '../../services/store'
import { ROLE } from '../../constants/orderStatus'

defineProps<{
  current: string
}>()

const store = useStore()

const allTabs = [
  { pagePath: 'pages/home/index', text: '首页' },
  { pagePath: 'pages/menu/index', text: '菜单' },
  { pagePath: 'pages/stats/index', text: '统计' },
  { pagePath: 'pages/data/index', text: '数据' },
]

const visibleTabs = computed(() => {
  const role = store.role
  if (role === ROLE.CREATOR || role === ROLE.ADMIN) {
    return allTabs
  }
  return allTabs.filter(t => t.text !== '数据')
})

function switchTab(pagePath: string) {
  uni.switchTab({ url: `/${pagePath}` })
}
</script>

<style scoped>
.custom-tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 100rpx;
  background: #ffffff;
  border-top: 1rpx solid #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 999;
}
.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8rpx 0;
}
.tab-text {
  font-size: 24rpx;
  color: #999999;
}
.tab-item.active .tab-text {
  color: #333333;
  font-weight: bold;
}
</style>