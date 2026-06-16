<template>
  <view class="stats-pie-chart">
    <text class="section-title">供应商占比</text>
    <view v-if="data.length === 0" class="empty-tip">
      <text>暂无数据</text>
    </view>
    <view v-else class="pie-container">
      <view class="pie-canvas-wrapper">
        <canvas
          canvas-id="pieCanvas"
          id="pieCanvas"
          class="pie-canvas"
          :style="{ width: '200px', height: '200px' }"
        />
      </view>
      <view class="pie-legend">
        <view
          v-for="(item, index) in data"
          :key="index"
          class="legend-item"
        >
          <view class="legend-dot" :style="{ background: colors[index % colors.length] }" />
          <text class="legend-name">{{ item.name }}</text>
          <text class="legend-amount">¥{{ item.amount.toLocaleString('zh-CN') }}</text>
          <text class="legend-percent">{{ item.percent }}%</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { watch, nextTick, onMounted } from 'vue'

const props = defineProps<{
  data: { name: string; value: number; amount: number; percent: string }[]
}>()

const colors = [
  '#1976d2', '#e65100', '#388e3c', '#7b1fa2',
  '#c62828', '#00838f', '#f9a825', '#4e342e',
  '#1565c0', '#ef6c00',
]

function drawPie() {
  if (props.data.length === 0) return
  const query = wx.createSelectorQuery()
  query.select('#pieCanvas')
    .fields({ node: true, size: true })
    .exec((res: any) => {
      if (!res || !res[0]) {
        drawPieFallback()
        return
      }
      const canvas = res[0].node
      if (!canvas) {
        drawPieFallback()
        return
      }
      const ctx = canvas.getContext('2d')
      const dpr = wx.getWindowInfo().pixelRatio
      canvas.width = res[0].width * dpr
      canvas.height = res[0].height * dpr
      ctx.scale(dpr, dpr)
      drawPieWithCtx(ctx, res[0].width, res[0].height)
    })
}

function drawPieFallback() {
  const ctx = wx.createCanvasContext('pieCanvas')
  drawPieWithCtx(ctx, 200, 200)
  ctx.draw()
}

function drawPieWithCtx(ctx: any, w: number, h: number) {
  const total = props.data.reduce((sum, d) => sum + d.value, 0)
  if (total === 0) return

  const cx = w / 2
  const cy = h / 2
  const r = Math.min(cx, cy) - 8
  let startAngle = -Math.PI / 2

  props.data.forEach((item, index) => {
    const sliceAngle = (item.value / total) * 2 * Math.PI
    const endAngle = startAngle + sliceAngle

    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r, startAngle, endAngle)
    ctx.closePath()
    ctx.fillStyle = colors[index % colors.length]
    ctx.fill()

    startAngle = endAngle
  })

  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
}

onMounted(() => {
  nextTick(() => drawPie())
})

watch(() => props.data, () => {
  nextTick(() => drawPie())
}, { deep: true })
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
  align-items: center;
  gap: 24rpx;
}
.pie-canvas-wrapper {
  flex-shrink: 0;
}
.pie-canvas {
  width: 200px;
  height: 200px;
}
.pie-legend {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
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
  margin-left: auto;
}
</style>