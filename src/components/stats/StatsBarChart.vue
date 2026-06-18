<template>
  <view class="stats-bar-chart">
    <text class="section-title">月度趋势{{ visibleYear ? ' ' + visibleYear : '' }}</text>
    <view v-if="data.length === 0" class="empty-tip">
      <text>暂无数据</text>
    </view>
    <scroll-view
      v-else
      class="chart-container"
      scroll-x
      :scroll-left="scrollLeft"
      @scroll="onScroll"
    >
      <view class="chart-area">
        <view
          v-for="(item, index) in data"
          :key="index"
          class="bar-group"
        >
          <view class="bar-wrapper">
            <view
              class="bar-fill"
              :style="{ height: barHeight(item.value) + '%' }"
            >
              <text class="bar-label-top">{{ formatAmount(item.amount) }}</text>
            </view>
          </view>
          <text class="bar-label-bottom">{{ item.label }}</text>
        </view>
      </view>
    </scroll-view>
    <view v-if="data.length > 0" class="download-btn" @tap="$emit('download')">
      <text>下载月度数据</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, getCurrentInstance } from 'vue'

const props = defineProps<{
  data: { label: string; value: number; amount: number; year: number }[]
}>()

defineEmits<{
  (e: 'download'): void
}>()

const instance = getCurrentInstance()
const visibleYear = ref<number | null>(null)
const scrollLeft = ref(0)
let containerWidth = 0

watch(() => props.data, (val) => {
  if (val.length > 0) {
    visibleYear.value = val[val.length - 1].year
    nextTick(() => {
      scrollLeft.value = 9999
      measureContainer()
    })
  }
}, { immediate: true })

function measureContainer() {
  const query = uni.createSelectorQuery().in(instance)
  query.select('.chart-container').boundingClientRect((rect: any) => {
    if (rect) containerWidth = rect.width
  }).exec()
}

const maxValue = computed(() => {
  if (props.data.length === 0) return 1
  const m = Math.max(...props.data.map(d => d.value))
  return m > 0 ? m : 1
})

function barHeight(value: number): number {
  return Math.max((value / maxValue.value) * 100, 2)
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('zh-CN')
}

function onScroll(e: any) {
  const scrollLeftVal = e.detail.scrollLeft
  const scrollWidth = e.detail.scrollWidth
  const cw = containerWidth
  if (!scrollWidth || !cw) return

  const midPoint = scrollLeftVal + cw / 2
  const barCount = props.data.length
  if (barCount === 0) return

  const barWidth = scrollWidth / barCount
  const idx = Math.min(Math.floor(midPoint / barWidth), barCount - 1)
  if (idx >= 0 && props.data[idx]) {
    visibleYear.value = props.data[idx].year
  }
}
</script>

<style scoped>
.stats-bar-chart {
  margin: 0 32rpx;
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
.chart-container {
  width: 100%;
}
.chart-area {
  display: flex;
  align-items: flex-end;
  min-height: 360rpx;
  gap: 16rpx;
  padding: 0 8rpx;
}
.bar-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 80rpx;
  max-width: 120rpx;
}
.bar-label-top {
  font-size: 20rpx;
  color: #e65100;
  font-weight: bold;
  white-space: nowrap;
  position: absolute;
  top: -28rpx;
  left: 50%;
  transform: translateX(-50%);
}
.bar-wrapper {
  width: 100%;
  height: 280rpx;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bar-fill {
  width: 60%;
  background: linear-gradient(180deg, #42a5f5, #1976d2);
  border-radius: 8rpx 8rpx 0 0;
  min-height: 8rpx;
  transition: height 0.3s ease;
  position: relative;
}
.bar-label-bottom {
  font-size: 22rpx;
  color: #666;
  margin-top: 8rpx;
  white-space: nowrap;
}
.download-btn {
  margin-top: 24rpx;
  text-align: center;
  padding: 16rpx;
  background: #f5f5f5;
  border-radius: 8rpx;
  font-size: 26rpx;
  color: #1976d2;
}
</style>
