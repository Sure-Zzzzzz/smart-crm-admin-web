import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageOrders, pageFulfillmentItems, patchFulfillmentItem, configureCrmApi, setCrmUnauthorizedHandler } from './crmApi';

const identity = vi.hoisted(() => ({ token: 'test-token' as string | null, epoch: 0, clear: vi.fn() }));
vi.mock('../auth/pkce', () => ({
  crmAccessToken: () => identity.token,
  crmIdentityEpoch: () => identity.epoch,
  clearCrmToken: () => { identity.token = null; identity.epoch++; identity.clear(); }
}));
beforeEach(() => {
  identity.token = 'test-token';
  identity.epoch = 0;
  identity.clear.mockClear();
  setCrmUnauthorizedHandler(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('管理台真实分页接口', () => {
  it.each([
    ['页码不等于请求', { items: [], page: 2, pageSize: 20, total: 0 }],
    ['页大小不等于请求', { items: [], page: 1, pageSize: 50, total: 0 }],
    ['总数不是整数', { items: [], page: 1, pageSize: 20, total: 1.5 }],
    ['总数越过安全整数', { items: [], page: 1, pageSize: 20, total: Number.MAX_SAFE_INTEGER + 1 }],
    ['条数超过页大小', { items: Array.from({ length: 21 }, () => ({})), page: 1, pageSize: 20, total: 21 }],
    ['条数超过总数', { items: [{}], page: 1, pageSize: 20, total: 0 }],
    ['混入机器游标', { items: [], page: 1, pageSize: 20, total: 0, nextCursor: null }]
  ])('拒绝%s响应，不能把接口故障显示成正常分页', async (_reason, payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 502 });
  });

  it.each([
    { page: 0, pageSize: 20 }, { page: -1, pageSize: 20 }, { page: 1.5, pageSize: 20 },
    { page: Number.MAX_SAFE_INTEGER + 1, pageSize: 20 },
    { page: 1, pageSize: 0 }, { page: 1, pageSize: 101 }, { page: 1, pageSize: 1.5 },
    { page: 1, pageSize: 20, cursor: 'machine-cursor' }, { page: 1, pageSize: 20, limit: 20 }
  ])('非法请求%j在请求前拒绝，不调用后端', async params => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(pageOrders(params)).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('迟到旧401在A→B→A后不撤销当前令牌，不触发重新授权', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; })));
    const unauthorized = vi.fn();
    setCrmUnauthorizedHandler(unauthorized);
    const pending = pageOrders({ page: 1, pageSize: 20 });
    identity.token = 'identity-b';
    identity.epoch++;
    identity.token = 'test-token';
    identity.epoch++;
    finish(new Response('', { status: 401 }));
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(identity.token).toBe('test-token');
    expect(identity.clear).not.toHaveBeenCalled();
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('当前身份401仍撤销令牌并触发一次重新授权', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const unauthorized = vi.fn();
    setCrmUnauthorizedHandler(unauthorized);
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    expect(identity.token).toBeNull();
    expect(identity.clear).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('无有效令牌时不发送业务请求，重复加载只发起一次授权', async () => {
    identity.token = null;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const unauthorized = vi.fn();
    setCrmUnauthorizedHandler(unauthorized);
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(pageFulfillmentItems({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(identity.clear).not.toHaveBeenCalled();
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('当前401后重挂加载不发空凭据请求，也不重复发起授权', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const unauthorized = vi.fn();
    setCrmUnauthorizedHandler(unauthorized);
    await expect(pageFulfillmentItems({ page: 1, pageSize: 20, state: 'pending_dispatch' }))
      .rejects.toMatchObject({ status: 401 });
    await expect(pageFulfillmentItems({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(identity.clear).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('401撤销令牌的同步监听器重入时仍只发起一次授权', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const unauthorized = vi.fn();
    setCrmUnauthorizedHandler(unauthorized);
    let reentered!: Promise<unknown>;
    identity.clear.mockImplementationOnce(() => {
      reentered = pageOrders({ page: 1, pageSize: 20 });
      void reentered.catch(() => undefined);
    });
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    await expect(reentered).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(identity.clear).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('同步撤销期间替换处理器时由新挂载接续授权，不遗留等待锁', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const previousHandler = vi.fn();
    const nextHandler = vi.fn();
    setCrmUnauthorizedHandler(previousHandler);
    identity.clear.mockImplementationOnce(() => setCrmUnauthorizedHandler(nextHandler));
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    expect(previousHandler).not.toHaveBeenCalled();
    expect(nextHandler).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('授权处理器失败后允许再次尝试，不永久阻塞重授权', async () => {
    identity.token = null;
    vi.stubGlobal('fetch', vi.fn());
    const handler = vi.fn().mockImplementationOnce(() => { throw new Error('授权跳转失败'); });
    setCrmUnauthorizedHandler(handler);
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toThrow('授权跳转失败');
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('并发旧401不能撤销新授权令牌，新令牌后再次失效仍发起授权', async () => {
    let finishOld!: (response: Response) => void;
    const fetch = vi.fn().mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 })))
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const unauthorized = vi.fn();
    setCrmUnauthorizedHandler(unauthorized);
    const old = pageOrders({ page: 1, pageSize: 20 });
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    identity.token = 'new-test-token';
    identity.epoch++;
    await expect(pageOrders({ page: 1, pageSize: 20 })).resolves.toMatchObject({ total: 0 });
    finishOld(new Response('', { status: 401 }));
    await expect(old).rejects.toMatchObject({ status: 409 });
    expect(identity.token).toBe('new-test-token');
    expect(unauthorized).toHaveBeenCalledTimes(1);
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    expect(identity.clear).toHaveBeenCalledTimes(2);
    expect(unauthorized).toHaveBeenCalledTimes(2);
  });

  it('卸载释放授权等待，新挂载缺令牌仍能发起授权', async () => {
    identity.token = null;
    vi.stubGlobal('fetch', vi.fn());
    const previousHandler = vi.fn();
    setCrmUnauthorizedHandler(previousHandler);
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    setCrmUnauthorizedHandler(null);
    const nextHandler = vi.fn();
    setCrmUnauthorizedHandler(nextHandler);
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 401 });
    expect(previousHandler).toHaveBeenCalledTimes(1);
    expect(nextHandler).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('人工重置以大写动作参数分派，幂等键与请求体一致发送', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: 'pending_dispatch' })));
    vi.stubGlobal('fetch', fetch);
    await patchFulfillmentItem({ idempotencyKey: 'reset-test-key' }, 'fulfillment-item-1', { state: 'PENDING_DISPATCH' });
    const [path, init] = fetch.mock.calls[0];
    const url = new URL(path, 'https://portal.example.test');
    expect(url.searchParams.get('state')).toBe('PENDING_DISPATCH');
    expect(init.method).toBe('PATCH');
    expect(init.headers.get('Idempotency-Key')).toBe('reset-test-key');
    expect(JSON.parse(init.body)).toEqual({ state: 'PENDING_DISPATCH' });
  });
  it('订单请求只发送页码参数与搜索，不混入机器游标参数', async () => {
    const payload = { items: [], page: 2, pageSize: 50, total: 71 };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetch);
    configureCrmApi('/api/crm');
    expect(await pageOrders({ page: 2, pageSize: 50, keyword: '订单甲' })).toEqual(payload);
    const url = new URL(fetch.mock.calls[0][0], 'https://portal.example.test');
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', pageSize: '50', keyword: '订单甲' });
  });

  it('交付完整订单号使用服务端精确筛选，不在当页做模糊过滤', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 })));
    vi.stubGlobal('fetch', fetch);
    await pageFulfillmentItems({ page: 1, pageSize: 20, orderId: 'order-甲', state: 'failed' });
    const url = new URL(fetch.mock.calls[0][0], 'https://portal.example.test');
    expect(url.searchParams.get('orderId')).toBe('order-甲');
    expect(url.searchParams.get('state')).toBe('failed');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(url.searchParams.has('limit')).toBe(false);
  });

  it('拒绝缺少真实 total 的假分页响应', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], page: 1, pageSize: 20 })));
    vi.stubGlobal('fetch', fetch);
    await expect(pageOrders({ page: 1, pageSize: 20 })).rejects.toThrow('分页响应格式无效');
  });

  it('兼容请求桥 data 封装但仍校验其中的真实分页字段', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { items: [], page: 1, pageSize: 20, total: 0 }
    })));
    vi.stubGlobal('fetch', fetch);
    await expect(pageOrders({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [], page: 1, pageSize: 20, total: 0
    });
  });
});
