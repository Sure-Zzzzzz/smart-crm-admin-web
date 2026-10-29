import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCrmPagination } from './useCrmPagination';
import type { CrmNumberedPage } from '../api/crmApi';
import { crmIdentityVersion } from '../auth/pkce';

vi.mock('../auth/pkce', async () => {
  const { ref } = await import('vue');
  const version = ref(0);
  return { crmAccessToken: () => 'identity-a', crmIdentityVersion: version, crmIdentityEpoch: () => version.value };
});
beforeEach(() => { crmIdentityVersion.value = 0; });
const result = (page: number, item: string, total = 60): CrmNumberedPage<string> =>
  ({ items: [item], page, pageSize: 20, total });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('管理台页码与请求归属', () => {
  it('A→B→A 即使令牌相同，旧身份响应也不能覆盖新结果', async () => {
    const old = deferred<CrmNumberedPage<string>>();
    const fetchPage = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(result(1, '新身份'));
    const scope = effectScope();
    const pager = scope.run(() => useCrmPagination<string, Record<string, never>>(fetchPage, {}))!;
    const pending = pager.search({});
    crmIdentityVersion.value++;
    crmIdentityVersion.value++;
    expect(pager.loading.value).toBe(false);
    await pager.search({});
    old.resolve(result(1, '旧身份'));
    await pending;
    expect(pager.rows.value).toEqual(['新身份']);
    scope.stop();
  });
  it('切换对象清空旧页，进行中的旧响应不能重新填回', async () => {
    const pending = deferred<CrmNumberedPage<string>>();
    const fetchPage = vi.fn().mockResolvedValueOnce(result(2, '旧订单'))
      .mockReturnValueOnce(pending.promise);
    const scope = effectScope();
    const pager = scope.run(() => useCrmPagination<string, { orderId?: string }>(fetchPage, {}))!;
    await pager.changePage(2);
    const request = pager.search({ orderId: '旧订单' });
    pager.clear();
    expect(pager.rows.value).toEqual([]);
    expect(pager.currentPage.value).toBe(1);
    expect(pager.totalElements.value).toBe(0);
    expect(pager.loading.value).toBe(false);
    pending.resolve(result(1, '迟到旧订单'));
    await request;
    expect(pager.rows.value).toEqual([]);
    scope.stop();
  });
  it('翻页失败保留已显示的页码、数据和查询快照', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(result(1, 'old')).mockRejectedValueOnce(new Error('网络失败'))
      .mockResolvedValueOnce(result(2, 'new'));
    const scope = effectScope();
    const pager = scope.run(() => useCrmPagination<string, { keyword?: string }>(fetchPage, {}))!;
    await pager.search({ keyword: '客户甲' });
    await pager.changePage(2);
    expect(pager.currentPage.value).toBe(1);
    expect(pager.rows.value).toEqual(['old']);
    expect(pager.error.value).toBe('网络失败');
    await pager.changePage(2);
    expect(fetchPage).toHaveBeenLastCalledWith(2, 20, { keyword: '客户甲' });
    expect(pager.currentPage.value).toBe(2);
    scope.stop();
  });

  it('连续搜索旧响应与旧 finally 都不能覆盖当前请求', async () => {
    const first = deferred<CrmNumberedPage<string>>();
    const second = deferred<CrmNumberedPage<string>>();
    const fetchPage = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const scope = effectScope();
    const pager = scope.run(() => useCrmPagination<string, { keyword?: string }>(fetchPage, {}))!;
    const a = pager.search({ keyword: '甲' });
    const b = pager.search({ keyword: '乙' });
    first.resolve(result(1, '甲'));
    await a;
    expect(pager.rows.value).toEqual([]);
    expect(pager.loading.value).toBe(true);
    second.resolve(result(1, '乙'));
    await b;
    expect(pager.rows.value).toEqual(['乙']);
    expect(pager.loading.value).toBe(false);
    scope.stop();
  });

  it('改变页大小从第一页重新查询，卸载后不提交异步结果', async () => {
    const wait = deferred<CrmNumberedPage<string>>();
    const fetchPage = vi.fn().mockResolvedValueOnce(result(3, '第三页')).mockReturnValueOnce(wait.promise);
    const scope = effectScope();
    const pager = scope.run(() => useCrmPagination<string, Record<string, never>>(fetchPage, {}))!;
    await pager.changePage(3);
    const pending = pager.changePageSize(50);
    expect(fetchPage).toHaveBeenLastCalledWith(1, 50, {});
    scope.stop();
    wait.resolve({ items: ['已卸载'], page: 1, pageSize: 50, total: 60 });
    await pending;
    expect(pager.currentPage.value).toBe(3);
    expect(pager.rows.value).toEqual(['第三页']);
  });

  it('删除最后一页后回查新的末页，避免显示不存在的页码', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ items: [], page: 3, pageSize: 20, total: 21 })
      .mockResolvedValueOnce(result(2, '末页', 21));
    const scope = effectScope();
    const pager = scope.run(() => useCrmPagination<string, Record<string, never>>(fetchPage, {}))!;
    await pager.changePage(3);
    expect(fetchPage).toHaveBeenLastCalledWith(2, 20, {});
    expect(pager.currentPage.value).toBe(2);
    expect(pager.totalElements.value).toBe(21);
    scope.stop();
  });

  it('搜索失败后的重试使用失败请求快照，不偷换成此前查询', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(result(1, '甲'))
      .mockRejectedValueOnce(new Error('乙失败')).mockResolvedValueOnce(result(1, '乙'));
    const scope = effectScope();
    const pager = scope.run(() => useCrmPagination<string, { keyword?: string }>(fetchPage, {}))!;
    await pager.search({ keyword: '甲' });
    await pager.search({ keyword: '乙' });
    expect(pager.rows.value).toEqual(['甲']);
    await pager.retry();
    expect(fetchPage).toHaveBeenLastCalledWith(1, 20, { keyword: '乙' });
    expect(pager.rows.value).toEqual(['乙']);
    scope.stop();
  });
});
