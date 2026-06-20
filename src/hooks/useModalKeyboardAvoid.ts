import { ref, computed, getCurrentInstance } from 'vue'

interface UseModalKeyboardAvoidOptions {
  /** 弹窗选择器（用于量高度） */
  modalSelector: string
  /** 弹窗底部与键盘顶部的间距 px，默认 16 */
  gap?: number
  /** 弹窗是否通过 translate(-50%,-50%) 居中，默认 false（flex 居中） */
  centeredByTransform?: boolean
}

/**
 * 弹窗键盘避让：精确计算上移量，仅当弹窗底部被键盘遮挡时上移刚好不被遮挡。
 * 用法：
 *   const { modalStyle, onKeyboardHeightChange, reset } = useModalKeyboardAvoid({ modalSelector: '.my-modal' })
 *   <input @keyboardheightchange="onKeyboardHeightChange" />
 *   <view class="my-modal" :style="modalStyle">...</view>
 *   弹窗关闭时调 reset()
 */
export function useModalKeyboardAvoid(options: UseModalKeyboardAvoidOptions) {
  const { modalSelector, gap = 16, centeredByTransform = false } = options
  // setup 顶层获取组件实例，自定义组件内 selectorQuery 必须绑定 .in() 才能查到节点
  const instance = getCurrentInstance()

  const offset = ref(0)

  function onKeyboardHeightChange(e: any) {
    const kbHeight = e.detail?.height || 0
    if (kbHeight > 0) {
      const q = uni.createSelectorQuery()
      if (instance) q.in(instance.proxy as any)
      q.select(modalSelector).boundingClientRect()
      q.exec((data: any[]) => {
        if (!data || !data[0]) return
        const modalHeight = data[0].height
        const { windowHeight } = uni.getSystemInfoSync()
        // 弹窗居中，原始底部 = 视口中心 + 弹窗高度/2
        const modalBottom = (windowHeight + modalHeight) / 2
        const keyboardTop = windowHeight - kbHeight
        offset.value = modalBottom > keyboardTop - gap
          ? modalBottom - (keyboardTop - gap)
          : 0
      })
    } else {
      offset.value = 0
    }
  }

  function reset() {
    offset.value = 0
  }

  const modalStyle = computed(() => {
    if (offset.value <= 0) return {}
    if (centeredByTransform) {
      return { transform: `translate(-50%, calc(-50% - ${offset.value}px))` }
    }
    return { transform: `translateY(-${offset.value}px)` }
  })

  return { offset, modalStyle, onKeyboardHeightChange, reset }
}
