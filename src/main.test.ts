// @vitest-environment jsdom
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pkce from './auth/pkce';
import { ownerLabel, type CrmCurrentUser } from './ui/crmDisplay';
import './main';

interface TestMountProps {
  getCurrentUser?: () => CrmCurrentUser | null;
}
interface TestLifecycle {
  mount(props: TestMountProps): void;
  update(props: TestMountProps): void;
  unmount(): void;
}
const lifecycle = vi.hoisted(() => ({ hooks: null as TestLifecycle | null }));
vi.mock('vite-plugin-qiankun/dist/helper', () => ({
  qiankunWindow: { __POWERED_BY_QIANKUN__: true },
  renderWithQiankun: (hooks: TestLifecycle) => { lifecycle.hooks = hooks; }
}));
vi.mock('./App.vue', async () => {
  const { defineComponent } = await import('vue');
  const { ownerLabel } = await import('./ui/crmDisplay');
  return {
    default: defineComponent({
      setup: () => ({ ownerLabel }),
      template: '<div><span data-owner="a">{{ ownerLabel("iam:person-a") }}</span><span data-owner="b">{{ ownerLabel("iam:person-b") }}</span></div>'
    })
  };
});

function hooks(): TestLifecycle {
  if (!lifecycle.hooks) throw new Error('CRM未注册乾坤生命周期');
  return lifecycle.hooks;
}
beforeEach(() => {
  window.history.replaceState({}, '', '/app/crm/');
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(pkce, 'crmAccessToken').mockReturnValue('test-token');
});
afterEach(() => {
  hooks().unmount();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('门户人员名称跟随CRM挂载生命周期', () => {
  it('同一getCurrentUser中的名称刷新与主体切换更新显示，卸载清空旧映射', async () => {
    const current = ref<CrmCurrentUser | null>({ subjectId: 'person-a', username: 'user-a', displayName: '测试人员甲' });
    hooks().mount({ getCurrentUser: () => current.value });
    await flushPromises();
    expect(document.querySelector('[data-owner="a"]')?.textContent).toBe('测试人员甲');
    current.value = { subjectId: 'person-a', username: 'user-a', displayName: '测试人员甲新名称' };
    await flushPromises();
    expect(document.querySelector('[data-owner="a"]')?.textContent).toBe('测试人员甲新名称');
    current.value = { subjectId: 'person-b', username: 'user-b', displayName: null };
    await flushPromises();
    expect(document.querySelector('[data-owner="a"]')?.textContent).toBe('IAM 用户');
    expect(document.querySelector('[data-owner="b"]')?.textContent).toBe('user-b');
    hooks().unmount();
    expect(ownerLabel('iam:person-b')).toBe('IAM 用户');
    current.value = { subjectId: 'person-a', username: 'user-a', displayName: '卸载后旧宿主更新' };
    expect(ownerLabel('iam:person-a')).toBe('IAM 用户');
  });

  it('非响应式宿主通过update刷新名称，撤销当前人员后不保留旧姓名', async () => {
    let current: CrmCurrentUser | null = { subjectId: 'person-a', username: 'user-a', displayName: '测试人员甲' };
    const getCurrentUser = () => current;
    hooks().mount({ getCurrentUser });
    await flushPromises();
    current = { subjectId: 'person-a', username: 'user-a', displayName: '更新后的人员姓名' };
    hooks().update({ getCurrentUser });
    await flushPromises();
    expect(document.querySelector('[data-owner="a"]')?.textContent).toBe('更新后的人员姓名');
    current = null;
    hooks().update({ getCurrentUser });
    await flushPromises();
    expect(document.querySelector('[data-owner="a"]')?.textContent).toBe('IAM 用户');
  });
});
