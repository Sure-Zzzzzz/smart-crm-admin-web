// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuotationsListView from './QuotationsListView.vue';
import { CrmApiError, getOffering, getQuotationVersion, pageQuotations, type CrmQuotation, type CrmQuotationVersionView } from '../api/crmApi';

vi.mock('../auth/pkce', async () => {
  const { ref } = await import('vue');
  return { crmAccessToken: () => 'current-identity', crmIdentityEpoch: () => 0, crmIdentityVersion: ref(0) };
});
vi.mock('../api/crmApi', async importOriginal => ({
  ...await importOriginal<typeof import('../api/crmApi')>(),
  pageQuotations: vi.fn(), getQuotationVersion: vi.fn(), getOffering: vi.fn()
}));
vi.mock('../ui/crmNames', () => ({ customerDisplayName: vi.fn().mockResolvedValue('测试客户') }));

const quotation: CrmQuotation = {
  quotationId: 'quotation-1', customerId: 'customer-1', owner: 'iam:user-1', state: 'issued',
  aggregateVersion: 1, currentVersion: 1, currentConfirmableVersion: 1,
  confirmedOrderId: null, supersedesQuotationId: null
};
const detail: CrmQuotationVersionView = {
  quotationId: 'quotation-1', version: 1, state: 'issued', settlementCurrency: 'CNY',
  validUntil: '2030-01-01T00:00:00Z', issuedAt: null, terminalAt: null,
  totalAmount: { amount: '100', currency: 'CNY' },
  lines: [{ quotationLineId: 'line-1', offeringId: 'offering-1', offeringReference: 'product-1',
    quantity: '1', unit: '件', unitPrice: { amount: '100', currency: 'CNY' }, lineTotal: { amount: '100', currency: 'CNY' },
    obligation: { subjectReference: 'project-1', fulfillmentScope: '实施与验收', requiredConsumerCapability: 'service-delivery' } }]
};
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pageQuotations).mockResolvedValue({ items: [quotation], page: 1, pageSize: 20, total: 1 });
  vi.mocked(getQuotationVersion).mockResolvedValue(detail);
  vi.mocked(getOffering).mockResolvedValue({ id: 'offering-1', displayName: '测试商品', state: 'published', owner: 'iam:user-1' });
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

async function open() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/quotations', component: QuotationsListView },
    { path: '/quotations/:quotationId', component: { template: '<div />' } }
  ] });
  await router.push('/quotations');
  await router.isReady();
  wrapper = mount(QuotationsListView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('报价关联数据错误不能伪装名称查询成功', () => {
  it.each(['version', 'offering'])('%s 的5xx显示错误，重试成功后才提交完整报价行', async endpoint => {
    if (endpoint === 'version') vi.mocked(getQuotationVersion).mockRejectedValueOnce(new CrmApiError('报价明细服务不可用', 503));
    else vi.mocked(getOffering).mockRejectedValueOnce(new CrmApiError('商品服务不可用', 503));
    const view = await open();
    expect(view.find('[role="alert"]').text()).toContain('服务不可用');
    expect(view.text()).not.toContain('商品（名称不可见）');
    await view.find('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(view.find('[role="alert"]').exists()).toBe(false);
    expect(view.find('tbody').text()).toContain('测试商品');
    expect(view.find('tbody').text()).toContain('100 CNY');
    expect(pageQuotations).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, state: undefined, keyword: undefined });
  });

  it('真实403明细明确不可访问，不当成空明细或通用错误', async () => {
    vi.mocked(getQuotationVersion).mockRejectedValue(new CrmApiError('拒绝访问', 403));
    const view = await open();
    expect(view.find('[role="alert"]').exists()).toBe(false);
    expect(view.find('tbody').text()).toContain('报价明细（无权查看）');
    expect(getOffering).not.toHaveBeenCalled();
  });

  it('真实404商品保留数量与金额，明确名称不存在或不可访问', async () => {
    vi.mocked(getOffering).mockRejectedValue(new CrmApiError('不可见', 404));
    const view = await open();
    expect(view.find('[role="alert"]').exists()).toBe(false);
    expect(view.find('tbody').text()).toContain('商品（已删除或无权查看） ×1');
    expect(view.find('tbody').text()).toContain('100 CNY');
  });
});
