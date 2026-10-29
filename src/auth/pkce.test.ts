import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watch } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import App from '../App.vue';
import FulfillmentView from '../view/FulfillmentView.vue';
import { configureCrmApi, setCrmUnauthorizedHandler } from '../api/crmApi';
import {
  beginCrmAuthorization,
  clearCrmToken,
  crmAccessToken,
  crmChallengeOf,
  configureCrmIdentitySource,
  crmIdentityEpoch,
  crmIdentityVersion,
  synchronizeCrmIdentity,
  handleCrmCallback,
  CRM_AUTH_DEFAULTS
} from './pkce';

vi.mock('vite-plugin-qiankun/dist/helper', () => ({ qiankunWindow: { __POWERED_BY_QIANKUN__: true } }));

function resetSession(): void {
  window.sessionStorage.clear();
}

describe('CRM PKCE', () => {
  beforeEach(() => {
    configureCrmIdentitySource(null);
    resetSession();
    clearCrmToken();
    setCrmUnauthorizedHandler(null);
    vi.stubEnv('VITE_CRM_IAM_CLIENT_ID', 'test-client');
  });
  afterEach(() => {
    configureCrmIdentitySource(null);
    setCrmUnauthorizedHandler(null);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function prepareCallback(target = '/orders'): string {
    const state = `crm.pkce.test.${target}`;
    window.sessionStorage.setItem('crm.pkce.verifier', 'test-verifier');
    window.sessionStorage.setItem('crm.pkce.state', state);
    return '?code=abc&state=' + encodeURIComponent(state);
  }

  it('challenge 是 verifier 的 SHA-256 base64url（标准向量）', () => {
    // RFC 7636 附录 B 向量：verifier dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
    expect(crmChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('begin 写 verifier/state 并跳转授权端点（S256）', () => {
    resetSession();
    clearCrmToken();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, origin: 'http://127.0.0.1:5178' });
    beginCrmAuthorization('/customers');
    expect(assign).toHaveBeenCalledTimes(1);
    const url = String(assign.mock.calls[0][0]);
    expect(url).toContain(`${CRM_AUTH_DEFAULTS.issuer}/oauth2/authorize`);
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('code_challenge=');
    expect(url).toContain(encodeURIComponent('http://127.0.0.1:5178/app/crm/oauth-callback'));
    expect(window.sessionStorage.getItem('crm.pkce.verifier')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('callback 换令牌成功后清除 verifier 并返回目标路由', async () => {
    resetSession();
    window.sessionStorage.setItem('crm.pkce.verifier', 'test-verifier');
    window.sessionStorage.setItem('crm.pkce.state', 'crm.pkce.1./orders');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'token-1', expires_in: 3600 })
    });
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await handleCrmCallback('?code=abc&state=' + encodeURIComponent('crm.pkce.1./orders'));
    expect(outcome.kind === 'authorized' && outcome.target).toBe('/orders');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/oauth2/token');
    expect(String(init.body)).toContain('code_verifier=test-verifier');
    expect(crmAccessToken()).toBe('token-1');
    expect(window.sessionStorage.getItem('crm.pkce.verifier')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('state 不匹配拒绝', async () => {
    resetSession();
    window.sessionStorage.setItem('crm.pkce.verifier', 'v');
    window.sessionStorage.setItem('crm.pkce.state', 'expected');
    const outcome = await handleCrmCallback('?code=abc&state=other');
    expect(outcome.kind).toBe('state-mismatch');
  });

  it('有效令牌必须有有限且未来的到期时间', () => {
    for (const expiresAt of [null, '0', 'NaN', 'Infinity', String(Date.now() - 1)]) {
      window.sessionStorage.setItem('crm.accessToken', 'token');
      if (expiresAt === null) window.sessionStorage.removeItem('crm.tokenExpiresAt');
      else window.sessionStorage.setItem('crm.tokenExpiresAt', expiresAt);
      expect(crmAccessToken()).toBeNull();
      expect(window.sessionStorage.getItem('crm.accessToken')).toBeNull();
    }
  });

  it('身份A→B→A即使恢复原令牌也使用新的请求版本', () => {
    let subject = 'A';
    configureCrmIdentitySource(() => subject);
    window.sessionStorage.setItem('crm.accessToken', 'token-A');
    window.sessionStorage.setItem('crm.tokenExpiresAt', String(Date.now() + 3600000));
    window.sessionStorage.setItem('crm.tokenSubject', 'A');
    const first = crmIdentityEpoch();
    subject = 'B';
    synchronizeCrmIdentity();
    expect(crmAccessToken()).toBeNull();
    subject = 'A';
    synchronizeCrmIdentity();
    window.sessionStorage.setItem('crm.accessToken', 'token-A');
    window.sessionStorage.setItem('crm.tokenExpiresAt', String(Date.now() + 3600000));
    window.sessionStorage.setItem('crm.tokenSubject', 'A');
    expect(crmAccessToken()).toBe('token-A');
    expect(crmIdentityEpoch()).toBeGreaterThan(first);
  });

  it('切换主体时同步监听器读取真实令牌不能递归撤销同一身份', () => {
    let subject = 'A';
    configureCrmIdentitySource(() => subject);
    window.sessionStorage.setItem('crm.accessToken', 'token-A');
    window.sessionStorage.setItem('crm.tokenExpiresAt', String(Date.now() + 3600000));
    window.sessionStorage.setItem('crm.tokenSubject', 'A');
    expect(crmAccessToken()).toBe('token-A');
    const readToken = vi.fn(() => crmAccessToken());
    const stop = watch(crmIdentityVersion, readToken, { flush: 'sync' });
    try {
      subject = 'B';
      synchronizeCrmIdentity();
      expect(readToken).toHaveBeenCalledTimes(1);
      expect(readToken.mock.results[0].value).toBeNull();
      expect(crmAccessToken()).toBeNull();
      expect(readToken).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('真实交付页401重挂后停止无令牌请求并结束加载，不重复覆盖授权请求', async () => {
    configureCrmIdentitySource(() => 'A');
    window.sessionStorage.setItem('crm.accessToken', 'token-A');
    window.sessionStorage.setItem('crm.tokenExpiresAt', String(Date.now() + 3600000));
    window.sessionStorage.setItem('crm.tokenSubject', 'A');
    expect(crmAccessToken()).toBe('token-A');
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 })))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      // 旧实现会继续重挂并发出空凭据请求；限定响应次数，避免回归测试本身无限循环。
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetch);
    configureCrmApi('/api/crm');
    const unauthorized = vi.fn();
    setCrmUnauthorizedHandler(unauthorized);
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/fulfillment', component: FulfillmentView }
    ] });
    const guard = vi.fn(() => true);
    router.beforeEach(guard);
    await router.push('/fulfillment');
    await router.isReady();
    const wrapper = mount(App, { global: { plugins: [router] } });
    try {
      await flushPromises();
      expect(fetch).toHaveBeenCalledTimes(1);
      const filter = wrapper.findComponent(FormSelect);
      filter.vm.$emit('update:modelValue', 'pending_dispatch');
      filter.vm.$emit('change', 'pending_dispatch');
      await flushPromises();
      await flushPromises();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(new URL(fetch.mock.calls[1][0], 'https://portal.example.test').searchParams.get('state'))
        .toBe('pending_dispatch');
      expect(fetch.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer token-A');
      expect(crmAccessToken()).toBeNull();
      expect(unauthorized).toHaveBeenCalledTimes(1);
      // 版本key重挂不会重新进入路由守卫；安全边界必须在业务请求层执行。
      expect(guard).toHaveBeenCalledTimes(1);
      expect(wrapper.get('[role="alert"]').text()).toContain('登录已过期');
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('同一授权请求只允许一次令牌交换', async () => {
    const search = prepareCallback();
    let resolveResponse!: (value: unknown) => void;
    const fetchMock = vi.fn(() => new Promise(resolve => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const first = handleCrmCallback(search);
    expect(await handleCrmCallback(search)).toEqual({ kind: 'state-mismatch' });
    resolveResponse({ ok: true, json: async () => ({ access_token: 'token', expires_in: 3600 }) });
    expect(await first).toEqual({ kind: 'authorized', target: '/orders' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['response', 'payload'])('同主体新授权使等待%s的旧换码失效，保留新请求', async stage => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    let finish!: (value: unknown) => void;
    const deferred = new Promise(resolve => { finish = resolve; });
    const json = vi.fn(() => stage === 'payload' ? deferred : Promise.resolve({ access_token: 'old-token' }));
    const response = { ok: true, json };
    vi.stubGlobal('fetch', vi.fn(() => stage === 'response' ? deferred : Promise.resolve(response)));
    const pending = handleCrmCallback(prepareCallback());
    if (stage === 'payload') await vi.waitFor(() => expect(json).toHaveBeenCalled());
    beginCrmAuthorization('/fulfillment');
    const newState = window.sessionStorage.getItem('crm.pkce.state');
    const newVerifier = window.sessionStorage.getItem('crm.pkce.verifier');
    finish(stage === 'response' ? response : { access_token: 'old-token', expires_in: 3600 });
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(crmAccessToken()).toBeNull();
    expect(window.sessionStorage.getItem('crm.pkce.state')).toBe(newState);
    expect(window.sessionStorage.getItem('crm.pkce.verifier')).toBe(newVerifier);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('缺失verifier不交换令牌', async () => {
    const search = prepareCallback();
    window.sessionStorage.removeItem('crm.pkce.verifier');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await handleCrmCallback(search)).toEqual({ kind: 'state-mismatch' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('回调卸载后迟到的令牌解析不会写入会话', async () => {
    const search = prepareCallback();
    let resolvePayload!: (value: unknown) => void;
    const json = vi.fn(() => new Promise(resolve => { resolvePayload = resolve; }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json }));
    const controller = new AbortController();
    const pending = handleCrmCallback(search, undefined, controller.signal);
    await vi.waitFor(() => expect(json).toHaveBeenCalled());
    controller.abort();
    resolvePayload({ access_token: 'late-token', expires_in: 3600 });
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(crmAccessToken()).toBeNull();
  });

  it('没有旧令牌时也拒绝A→B→A的迟到回调', async () => {
    let subject = 'A';
    configureCrmIdentitySource(() => subject);
    const search = prepareCallback();
    window.sessionStorage.setItem('crm.pkce.subject', 'A');
    let resolveResponse!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveResponse = resolve; })));
    const pending = handleCrmCallback(search);
    subject = 'B';
    synchronizeCrmIdentity();
    subject = 'A';
    synchronizeCrmIdentity();
    resolveResponse({ ok: true, json: async () => ({ access_token: 'late-token', expires_in: 3600 }) });
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(crmAccessToken()).toBeNull();
  });

  it.each([null, {}, { access_token: '' }, { access_token: 'x', expires_in: 0 },
    { access_token: 'x', expires_in: '3600' }, { access_token: 'x', expires_in: Infinity }])(
    '无效令牌响应不污染会话：%j', async payload => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
      await expect(handleCrmCallback(prepareCallback())).rejects.toThrow('令牌响应格式无效');
      expect(crmAccessToken()).toBeNull();
    });

  it.each(['//outside.example', '/\\outside.example', '/oauth-callback?code=x'])('授权目标只允许应用内页面：%s', async target => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'token', expires_in: 3600 })
    }));
    expect(await handleCrmCallback(prepareCallback(target))).toEqual({ kind: 'authorized', target: '/' });
  });
});
