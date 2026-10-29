import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import { crmIdentityVersion } from './auth/pkce';

vi.mock('vite-plugin-qiankun/dist/helper', () => ({ qiankunWindow: { __POWERED_BY_QIANKUN__: true } }));

const Form = defineComponent({
  setup: () => ({ value: ref('') }),
  template: '<input aria-label="当前身份的表单" v-model="value" />'
});

describe('门户身份生命周期', () => {
  async function open(path: string) {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/orders', component: Form }, { path: '/oauth-callback', component: Form }
    ] });
    await router.push(path);
    await router.isReady();
    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    return wrapper;
  }

  it('切换身份后重建页面，清除旧身份表单', async () => {
    const wrapper = await open('/orders');
    await wrapper.get('input').setValue('旧身份待提交命令');
    crmIdentityVersion.value++;
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('');
    wrapper.unmount();
  });

  it('令牌交换完成推进版本时保留当前回调，避免自我取消', async () => {
    const wrapper = await open('/oauth-callback');
    await wrapper.get('input').setValue('当前回调');
    crmIdentityVersion.value++;
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('当前回调');
    wrapper.unmount();
  });
});
