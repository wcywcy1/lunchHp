<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { initCloud } from "./services/cloudClient";
import { startInit } from "./services/appInit";
import { restoreSession, restoreFromCache, getActiveGroupId, setStore, flushCache } from "./services/store";

onLaunch(() => {
  initCloud();
  // 启动时把激活组ID同步到 store（session 恢复会覆盖，无 session 时用激活值）
  const activeGroupId = getActiveGroupId();
  setStore({ groupId: activeGroupId });
  restoreSession();
  restoreFromCache();

  // 无 session（未选组）时跳转到选组页
  const hasSession = !!uni.getStorageSync('lunch_session');
  if (!hasSession) {
    // 延迟跳转，等首页加载完成
    setTimeout(() => {
      uni.reLaunch({ url: '/pages/group-select/index' });
    }, 100);
    return;
  }

  startInit();
});
onShow(() => {});
// 切后台时冲刷防抖缓存队列，避免 300ms 窗口内退出的数据丢失
onHide(() => {
  flushCache();
});
</script>
<style></style>