<template>
  <view v-if="visible" class="modal-mask" @tap="close">
    <view class="qrcode-modal" @tap.stop>
      <text class="modal-title">组织邀请二维码</text>
      <text class="group-name">{{ groupName || groupId }}</text>

      <view class="qrcode-wrap">
        <canvas
          type="2d"
          id="groupQrcodeCanvas"
          class="qrcode-canvas"
        ></canvas>
      </view>

      <text class="qrcode-tip">成员用微信扫此二维码即可加入组织</text>
      <text class="group-id-text">组织ID：{{ groupId }}</text>

      <view class="modal-actions">
        <view class="modal-btn cancel" @tap="close"><text>关闭</text></view>
        <view class="modal-btn confirm" @tap="copyGroupId"><text>复制组ID</text></view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { watch, nextTick } from 'vue'
import QRCode from 'weapp-qrcode'

const props = defineProps<{
  visible: boolean
  groupId: string
  groupName?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

watch(() => props.visible, async (val) => {
  if (val && props.groupId) {
    await nextTick()
    await drawQrcode()
  }
})

async function drawQrcode() {
  try {
    const query = (wx as any).createSelectorQuery()
    query.select('#groupQrcodeCanvas').fields({ node: true, size: true }).exec(async (res: any) => {
      if (!res || !res[0] || !res[0].node) return
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = (wx as any).getSystemInfoSync().pixelRatio
      const size = 240
      canvas.width = size * dpr
      canvas.height = size * dpr
      ctx.scale(dpr, dpr)

      // 二维码内容约定：lunch_group:<groupId>
      const content = `lunch_group:${props.groupId}`
      // @ts-ignore
      new QRCode({
        ctx,
        width: size,
        height: size,
        text: content,
      })
    })
  } catch (e) {
    console.error('drawQrcode error:', e)
    uni.showToast({ title: '二维码生成失败', icon: 'none' })
  }
}

function copyGroupId() {
  uni.setClipboardData({
    data: props.groupId,
    success: () => uni.showToast({ title: '组ID已复制', icon: 'success' }),
  })
}

function close() {
  emit('close')
}
</script>

<style lang="scss" scoped>
.modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.qrcode-modal {
  width: 560rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.modal-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
  margin-bottom: 12rpx;
}

.group-name {
  font-size: 28rpx;
  color: #1976d2;
  margin-bottom: 24rpx;
}

.qrcode-wrap {
  width: 240px;
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20rpx;
}

.qrcode-canvas {
  width: 240px;
  height: 240px;
}

.qrcode-tip {
  font-size: 24rpx;
  color: #888;
  margin-bottom: 8rpx;
}

.group-id-text {
  font-size: 22rpx;
  color: #aaa;
  margin-bottom: 28rpx;
  word-break: break-all;
  text-align: center;
}

.modal-actions {
  display: flex;
  gap: 20rpx;
  width: 100%;
}

.modal-btn {
  flex: 1;
  height: 76rpx;
  line-height: 76rpx;
  text-align: center;
  border-radius: 10rpx;
  font-size: 28rpx;

  &.cancel {
    background: #f5f5f5;
    color: #666;
  }

  &.confirm {
    background: #1976d2;
    color: #fff;
  }
}
</style>
