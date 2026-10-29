import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OAuthCallbackView from './OAuthCallbackView.vue';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), authorize: vi.fn(), replace: vi.fn() }));
vi.mock('../auth/pkce', () => ({ handleCrmCallback: mocks.handle, beginCrmAuthorization: mocks.authorize }));
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }));

describe('授权回调页面生命周期', () => {
  beforeEach(() => vi.clearAllMocks());

  it('卸载会取消令牌交换，迟到成功不会导航', async () => {
    let resolve!: (value: unknown) => void;
    mocks.handle.mockImplementation(() => new Promise(done => { resolve = done; }));
    const wrapper = mount(OAuthCallbackView);
    const signal = mocks.handle.mock.calls[0][2] as AbortSignal;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    resolve({ kind: 'authorized', target: '/orders' });
    await flushPromises();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('当前回调成功后返回目标页', async () => {
    mocks.handle.mockResolvedValue({ kind: 'authorized', target: '/orders' });
    mocks.replace.mockResolvedValue(undefined);
    const wrapper = mount(OAuthCallbackView);
    await flushPromises();
    expect(mocks.replace).toHaveBeenCalledWith('/orders');
    expect(wrapper.text()).toContain('授权成功');
    wrapper.unmount();
  });

  it('失效授权提供重新授权入口', async () => {
    mocks.handle.mockResolvedValue({ kind: 'state-mismatch' });
    const wrapper = mount(OAuthCallbackView);
    await flushPromises();
    expect(wrapper.text()).toContain('本次授权已失效');
    await wrapper.get('button').trigger('click');
    expect(mocks.authorize).toHaveBeenCalledWith('/');
    wrapper.unmount();
  });
});
