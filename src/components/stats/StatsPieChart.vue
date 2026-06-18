<template>
  <view class="stats-pie-chart">
    <text class="section-title">供应商占比</text>
    <view v-if="data.length === 0" class="empty-tip">
      <text>暂无数据</text>
    </view>
    <view v-else class="pie-container">
      <view class="pie-ring-wrapper">
        <view class="pie-ring" :style="conicGradientStyle">
          <view class="pie-ring-inner" />
        </view>
      </view>
      <view class="pie-legend">
        <view
          v-for="(item, index) in data"
          :key="index"
          class="legend-item"
        >
          <view class="legend-dot" :style="{ background: colors[index % colors.length] }" />
          <text class="legend-name">{{ item.name }}</text>
          <text class="legend-amount">{{ item.amount.toLocaleString('zh-CN') }}</text>
          <text class="legend-percent">{{ item.percent }}%</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  data: { name: string; value: number; amount: number; percent: string }[]
}>()

const colors = [
  '#1976d2', '#e65100', '#388e3c', '#7b1fa2',
  '#c62828', '#00838f', '#f9a825', '#4e342e',
  '#1565c0', '#ef6c00',
]

const conicGradientStyle = computed(() => {
  if (props.data.length === 0) return {}
  const total = props.data.reduce((sum, d) => sum + d.value, 0)
  if (total === 0) return {}

  let currentDeg = 0
  const stops: string[] = []
  props.data.forEach((item, index) => {
    const deg = (item.value / total) * 360
    const color = colors[index % colors.length]
    stops.push(`${color} ${currentDeg}deg ${currentDeg + deg}deg`)
    currentDeg += deg
  })
  return { background: `conic-gradient(${stops.join(', ')})` }
})
</script>

<style scoped>
.stats-pie-chart {
  margin: 24rpx 32rpx 0;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
}
.section-title {
  font-size: 30rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 20rpx;
  display: block;
}
.empty-tip {
  padding: 40rpx 0;
  text-align: center;
  color: #ccc;
  font-size: 28rpx;
}
.pie-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
}
.pie-ring-wrapper {
  width: 200px;
  height: 200px;
  flex-shrink: 0;
}
.pie-ring {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}
.pie-ring-inner {
  width: 45%;
  height: 45%;
  background: #fff;
  border-radius: 50%;
  position: relative;
  top: 27.5%;
  left: 27.5%;
}
.pie-legend {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  overflow: hidden;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.legend-dot {
  width: 20rpx;
  height: 20rpx;
  border-radius: 4rpx;
  flex-shrink: 0;
}
.legend-name {
  font-size: 24rpx;
  color: #333;
  flex-shrink: 0;
  max-width: 100rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.legend-amount {
  font-size: 24rpx;
  color: #e65100;
  font-weight: bold;
}
.legend-percent {
  font-size: 22rpx;
  color: #999;
}
</style>
