<template>
  <view class="page-stats">
    <StatsSummary
      :totalAmount="totalAmount"
      :totalCount="totalCount"
    />

    <StatsBarChart
      :data="barChartData"
      @download="downloadMonthlyData"
    />

    <StatsPieChart
      :data="pieChartData"
    />

    <StatsDetail
      :orders="detailOrders"
      :loading="detailLoading"
      :hasMore="hasMoreDetail"
      @load-more="loadMoreDetail"
    />

    <view :class="['fab-btn', hasActiveFilter ? 'active' : '']" @tap="openFilter">
      <text class="fab-icon">⚙</text>
      <text class="fab-text">筛选</text>
    </view>

    <StatsFilter
      :show="showFilter"
      :filter="filter"
      :yearOptions="yearOptions"
      :memberOptions="memberOptions"
      :supplierOptions="supplierOptions"
      @close="closeFilter"
      @apply="applyFilter"
      @reset="resetFilter"
    />

    <CustomTabBar current="pages/stats/index" />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import StatsSummary from '../../components/stats/StatsSummary.vue'
import StatsBarChart from '../../components/stats/StatsBarChart.vue'
import StatsPieChart from '../../components/stats/StatsPieChart.vue'
import StatsDetail from '../../components/stats/StatsDetail.vue'
import StatsFilter from '../../components/stats/StatsFilter.vue'
import CustomTabBar from '../../components/CustomTabBar/CustomTabBar.vue'
import { useStats } from '../../hooks/useStats'

const {
  loading,
  filter,
  showFilter,
  filteredStats,
  totalAmount,
  totalCount,
  yearOptions,
  memberOptions,
  supplierOptions,
  barChartData,
  pieChartData,
  detailOrders,
  detailLoading,
  hasMoreDetail,
  loadStats,
  refreshStats,
  getStatsLoadTime,
  applyFilter,
  resetFilter,
  openFilter,
  closeFilter,
  searchDetail,
  loadMoreDetail,
  downloadMonthlyData,
} = useStats()

const hasActiveFilter = computed(() => {
  const f = filter.value
  return f.year !== null || f.months.length > 0 || f.members.length > 0 || f.suppliers.length > 0
})

onMounted(() => {
  loadStats()
})

onShow(() => {
  if (!loading.value && Date.now() - getStatsLoadTime() > 30 * 1000) {
    loadStats(true)
  }
})

onPullDownRefresh(() => {
  refreshStats().finally(() => uni.stopPullDownRefresh())
})
</script>

<style scoped>
.page-stats {
  min-height: 100vh;
  background: #f8f8f8;
  padding-bottom: calc(120rpx + env(safe-area-inset-bottom));
}
.fab-btn {
  position: fixed;
  right: 32rpx;
  bottom: calc(120rpx + env(safe-area-inset-bottom));
  width: 96rpx;
  height: 96rpx;
  border-radius: 48rpx;
  background: #1976d2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 16rpx rgba(25, 118, 210, 0.4);
  z-index: 100;
}
.fab-btn.active {
  background: #e65100;
  box-shadow: 0 4rpx 16rpx rgba(230, 81, 0, 0.4);
}
.fab-icon {
  font-size: 32rpx;
  color: #fff;
}
.fab-text {
  font-size: 18rpx;
  color: #fff;
  margin-top: 2rpx;
}
</style>