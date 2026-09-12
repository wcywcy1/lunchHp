<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { initCloud } from "./services/cloudClient";
import { startInit } from "./services/appInit";
import { restoreSession, restoreFromCache, getActiveGroupId, setStore } from "./services/store";
import { APP_MODE, GROUP_ID } from "./constants/appConfig";

onLaunch(() => {
  initCloud();
  // 启动时把激活组ID同步到 store（session 恢复会覆盖，无 session 时用激活值）
  const activeGroupId = getActiveGroupId();
  setStore({ groupId: activeGroupId });
  restoreSession();
  restoreFromCache();

  if (APP_MODE === 'general') {
    // 通用模式：若无 session（未选组），跳转到选组页
    const hasSession = !!uni.getStorageSync('lunch_session');
    if (!hasSession) {
      // 延迟跳转，等首页加载完成
      setTimeout(() => {
        uni.reLaunch({ url: '/pages/group-select/index' });
      }, 100);
      return;
    }
  }

  startInit();
});
onShow(() => {});
onHide(() => {});
</script>
<style></style>