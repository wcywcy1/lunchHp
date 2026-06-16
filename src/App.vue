<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { initCloud } from "./services/cloudClient";
import { startInit } from "./services/appInit";
onLaunch(() => {
  initCloud();
  startInit();
});
onShow(() => {
  console.log("App Show");
});
onHide(() => {
  console.log("App Hide");
});
</script>
<style></style>