<template>
  <view class="page-group-select">
    <view class="header">
      <text class="title">选择您的组织</text>
      <text class="subtitle">加入已有组织或创建新组织</text>
    </view>

    <!-- 已加入的组列表 -->
    <view v-if="joinedGroups.length > 0" class="section">
      <text class="section-title">我的组织</text>
      <view
        v-for="g in joinedGroups"
        :key="g.groupId"
        class="group-card"
        :class="{ active: g.groupId === currentGroupId }"
        @tap="enterGroup(g)"
      >
        <view class="group-info">
          <text class="group-name">{{ g.groupName }}</text>
          <text class="group-role">{{ roleText(g.role) }}</text>
        </view>
        <text v-if="g.groupId === currentGroupId" class="badge-current">当前</text>
        <text v-else class="enter-arrow">进入 ›</text>
      </view>
    </view>

    <!-- 加入已有组 -->
    <view class="section">
      <text class="section-title">加入已有组织</text>
      <view class="input-row">
        <input
          v-model="joinGroupName"
          placeholder="请输入组织名称"
          class="text-input"
          confirm-type="done"
          maxlength="20"
        >
        <button class="btn-primary" :disabled="loading" @tap="onJoin">加入</button>
      </view>
      <text class="hint">请向组织创建者询问组织名称，输入正确的名称即可加入</text>
    </view>

    <!-- 创建新组 -->
    <view class="section">
      <text class="section-title">创建新组织</text>
      <view class="input-row">
        <input
          v-model="newGroupName"
          placeholder="请输入组织名称（全局唯一）"
          class="text-input"
          confirm-type="done"
          maxlength="20"
        >
        <button class="btn-primary" :disabled="loading" @tap="onCreate">创建</button>
      </view>
      <text class="hint">组织名称不能与已有组织重名</text>
    </view>

    <view v-if="loading" class="loading-mask">
      <text>处理中...</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useStore, setStore, setActiveGroupId, clearAllCache, resetStore, saveSession } from '@/services/store'
import { menuAction } from '@/services/repositories/baseRepository'
import { resetInit, startInit } from '@/services/appInit'

const store = useStore()
const joinedGroups = ref<any[]>([])
const currentGroupId = ref<string>(store.groupId || '')
const joinGroupName = ref('')
const newGroupName = ref('')
const loading = ref(false)

onMounted(async () => {
  await loadJoinedGroups()
})

async function loadJoinedGroups() {
  loading.value = true
  try {
    const res = await menuAction('listJoinedGroups', {})
    if (res && res.result && res.result.code === 0) {
      joinedGroups.value = res.result.data || []
      setStore({ joinedGroups: res.result.data || [] })
    }
  } catch {
    uni.showToast({ title: '加载组织列表失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function roleText(role: string) {
  if (role === 'creator') return '创建者'
  if (role === 'admin') return '管理员'
  return '成员'
}

async function enterGroup(g: any) {
  if (g.groupId === currentGroupId.value) {
    uni.switchTab({ url: '/pages/home/index' })
    return
  }
  loading.value = true
  try {
    await switchToGroup(g.groupId, g.groupName)
    uni.showToast({ title: `已进入「${g.groupName}」`, icon: 'success' })
    setTimeout(() => uni.switchTab({ url: '/pages/home/index' }), 800)
  } catch (e: any) {
    uni.showToast({ title: e.message || '进入失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function onJoin() {
  const name = joinGroupName.value.trim()
  if (!name) {
    uni.showToast({ title: '请输入组织名称', icon: 'none' })
    return
  }
  await doJoin(name)
}

// 实际加入逻辑：按组织名称查找并加入
async function doJoin(name: string) {
  loading.value = true
  try {
    const res = await menuAction('joinGroupByName', { groupName: name })
    if (!res || !res.result || res.result.code !== 0) {
      uni.showToast({ title: res?.result?.msg || '加入失败', icon: 'none' })
      return
    }
    const groupId = res.result.data.groupId
    const groupName = res.result.data.groupName
    await switchToGroup(groupId, groupName)
    uni.showToast({ title: `已加入「${groupName}」`, icon: 'success' })
    setTimeout(() => uni.switchTab({ url: '/pages/home/index' }), 800)
  } catch (e: any) {
    uni.showToast({ title: e.message || '加入失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function onCreate() {
  const name = newGroupName.value.trim()
  if (!name) {
    uni.showToast({ title: '请输入组织名称', icon: 'none' })
    return
  }
  loading.value = true
  try {
    const res = await menuAction('createGroup', { groupName: name })
    if (!res || !res.result || res.result.code !== 0) {
      uni.showToast({ title: res?.result?.msg || '创建失败', icon: 'none' })
      return
    }
    const { groupId, groupName } = res.result.data
    await switchToGroup(groupId, groupName)
    uni.showToast({ title: `已创建「${groupName}」`, icon: 'success' })
    setTimeout(() => uni.switchTab({ url: '/pages/home/index' }), 800)
  } catch (e: any) {
    uni.showToast({ title: e.message || '创建失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

// 切换到目标组：清缓存 → 设新组ID → 重新初始化 → joinGroup 获取 member → 保存 session
async function switchToGroup(targetGroupId: string, targetGroupName?: string) {
  clearAllCache()
  resetStore()
  setActiveGroupId(targetGroupId)
  currentGroupId.value = targetGroupId
  resetInit()
  await startInit()
  const joinRes = await menuAction('joinGroup', { nickName: '', name: '' })
  if (joinRes && joinRes.result && joinRes.result.code === 0) {
    const { member } = joinRes.result.data
    setStore({ member, role: member.role, groupId: member.groupId, groupName: targetGroupName || '' })
    saveSession({ groupId: member.groupId, role: member.role, member, groupName: targetGroupName || '' })
  }
}
</script>

<style lang="scss" scoped>
.page-group-select {
  min-height: 100vh;
  background: #f5f6f8;
  padding: 30rpx;
  box-sizing: border-box;
}

.header {
  text-align: center;
  margin-bottom: 40rpx;
  padding-top: 30rpx;
}

.header .title {
  display: block;
  font-size: 40rpx;
  font-weight: 600;
  color: #1976d2;
  margin-bottom: 12rpx;
}

.header .subtitle {
  display: block;
  font-size: 26rpx;
  color: #888;
}

.section {
  background: #fff;
  border-radius: 16rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
}

.section-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #333;
  margin-bottom: 20rpx;
}

.group-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx;
  border-radius: 12rpx;
  background: #f9f9f9;
  margin-bottom: 12rpx;
  border: 2rpx solid transparent;
}

.group-card.active {
  background: #e3f2fd;
  border-color: #1976d2;
}

.group-card .group-info {
  display: flex;
  flex-direction: column;
}

.group-card .group-name {
  font-size: 30rpx;
  color: #222;
  font-weight: 500;
  margin-bottom: 6rpx;
}

.group-card .group-role {
  font-size: 22rpx;
  color: #888;
}

.group-card .badge-current {
  font-size: 22rpx;
  color: #1976d2;
  background: #fff;
  padding: 4rpx 16rpx;
  border-radius: 20rpx;
  border: 2rpx solid #1976d2;
}

.group-card .enter-arrow {
  font-size: 26rpx;
  color: #1976d2;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.text-input {
  flex: 1;
  height: 76rpx;
  padding: 0 20rpx;
  background: #f5f5f5;
  border-radius: 10rpx;
  font-size: 28rpx;
}

.btn-primary {
  background: #1976d2;
  color: #fff;
  font-size: 26rpx;
  padding: 0 28rpx;
  height: 76rpx;
  line-height: 76rpx;
  border-radius: 10rpx;
  border: none;
}

.btn-primary[disabled] {
  background: #bbb;
}

.hint {
  display: block;
  font-size: 22rpx;
  color: #aaa;
  margin-top: 12rpx;
}

.loading-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 28rpx;
  z-index: 999;
}
</style>