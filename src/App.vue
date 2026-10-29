<template>
  <div
    ref="crmRoot"
    class="crm-admin-app"
    :class="{ 'crm-admin-app--standalone': standalone }"
  >
    <!-- 门户 qiankun 形态：应用菜单由门户侧栏承载，子应用只渲染内容区，不自带导航；
         直开（standalone）形态仅显示标题栏与返回门户出路（IAM 管理台同构） -->
    <header
      v-if="standalone"
      class="crm-standalone-header"
    >
      <h1>CRM 管理台</h1>
      <button
        type="button"
        class="button-secondary"
        @click="backToPortal"
      >
        返回门户
      </button>
    </header>
    <RouterView :key="$route.path === '/oauth-callback' ? 'callback' : crmIdentityVersion" />
  </div>
</template>

<script setup lang="ts">
import { qiankunWindow } from 'vite-plugin-qiankun/dist/helper';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { crmIdentityVersion } from './auth/pkce';
import { installCrmModalLifecycle } from './ui/crmModalLifecycle';

const standalone = !qiankunWindow.__POWERED_BY_QIANKUN__;
const crmRoot = ref<InstanceType<typeof window.HTMLElement> | null>(null);
let releaseModals = () => undefined as void;
onMounted(() => {
  if (crmRoot.value) releaseModals = installCrmModalLifecycle(crmRoot.value);
});
onBeforeUnmount(() => releaseModals());

function backToPortal(): void {
  window.location.assign('/app/');
}
</script>
