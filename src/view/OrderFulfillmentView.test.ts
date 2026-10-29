// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FulfillmentView from './FulfillmentView.vue';
import OrderDetailView from './OrderDetailView.vue';
import FulfillmentResetAction from '../ui/FulfillmentResetAction.vue';
import { loadOfferingDirectory } from '../ui/crmNames';
import { crmIdentityVersion } from '../auth/pkce';
import { CrmApiError, getOrder, pageFulfillmentItems, patchFulfillmentItem, type CrmFulfillmentItem, type CrmOrderDetail } from '../api/crmApi';

vi.mock('../auth/pkce', async () => {
  const { ref } = await import('vue');
  const version = ref(0);
  return { crmAccessToken: () => 'current-identity', crmIdentityVersion: version, crmIdentityEpoch: () => version.value };
});
vi.mock('../api/crmApi', async importOriginal => ({
  ...await importOriginal<typeof import('../api/crmApi')>(),
  getOrder: vi.fn(), pageFulfillmentItems: vi.fn(), patchFulfillmentItem: vi.fn()
}));
vi.mock('../ui/crmNames', () => ({
  customerDisplayName: vi.fn().mockResolvedValue('测试客户'),
  loadOfferingDirectory: vi.fn().mockResolvedValue([])
}));

const item = (fulfillmentId: string, orderLineId: string): CrmFulfillmentItem => ({
  fulfillmentId, orderLineId, orderId: 'order-001', owner: 'user:1',
  assignedConsumerId: 'test-consumer', state: 'pending_dispatch', reportSequence: 0
});
const order: CrmOrderDetail = {
  orderId: 'order-001', customerId: 'customer-001', sourceQuotationId: 'quotation-001',
  sourceQuotationVersion: 1, settlementCurrency: 'CNY', owner: 'user:1', lines: [],
  totalAmount: { amount: '100', currency: 'CNY' }, displayState: 'pending_fulfillment'
};
const page = (items: CrmFulfillmentItem[]) => ({ items, page: 1, pageSize: 20, total: items.length });
const wrappers: ReturnType<typeof mount>[] = [];

async function open(view: typeof FulfillmentView | typeof OrderDetailView, path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/fulfillment', component: FulfillmentView },
    { path: '/orders', component: { template: '<div />' } },
    { path: '/orders/:orderId', component: OrderDetailView }
  ] });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(view, { global: { plugins: [router] } });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  crmIdentityVersion.value = 0;
  vi.clearAllMocks();
  vi.mocked(getOrder).mockResolvedValue(order);
  vi.mocked(loadOfferingDirectory).mockResolvedValue([]);
  vi.mocked(pageFulfillmentItems).mockResolvedValue(page([]));
});
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

describe('订单与交付可辨识和错误恢复', () => {
  it('身份A→B→A关闭确认并丢弃旧重置响应，再次提交使用新幂等键', async () => {
    const failed = { ...item('fulfillment-item-aaa', 'order-line-a'), state: 'failed' };
    let finish!: (result: CrmFulfillmentItem) => void;
    vi.mocked(patchFulfillmentItem).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ ...failed, state: 'pending_dispatch' });
    const wrapper = mount(FulfillmentResetAction, { props: { item: failed } });
    wrappers.push(wrapper);
    await wrapper.find('button').trigger('click');
    await wrapper.find('[role="alertdialog"] .button-primary').trigger('click');
    crmIdentityVersion.value++;
    crmIdentityVersion.value++;
    await flushPromises();
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    finish({ ...failed, state: 'pending_dispatch' });
    await flushPromises();
    expect(wrapper.emitted('completed')).toBeUndefined();
    await wrapper.find('button').trigger('click');
    await wrapper.find('[role="alertdialog"] .button-primary').trigger('click');
    await flushPromises();
    expect(vi.mocked(patchFulfillmentItem).mock.calls[1][0].idempotencyKey)
      .not.toBe(vi.mocked(patchFulfillmentItem).mock.calls[0][0].idempotencyKey);
    expect(wrapper.emitted('completed')).toHaveLength(1);
  });
  it('同订单多个交付项分别显示交付编号和关联订单行', async () => {
    vi.mocked(pageFulfillmentItems).mockResolvedValue(page([
      item('fulfillment-item-aaa', 'order-line-a'), item('fulfillment-item-bbb', 'order-line-b')
    ]));
    const wrapper = await open(FulfillmentView, '/fulfillment');
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('fulfillment-item-aaa');
    expect(rows[0].text()).toContain('order-line-a');
    expect(rows[1].text()).toContain('fulfillment-item-bbb');
    expect(rows[1].text()).toContain('order-line-b');
    expect(wrapper.findAll('tbody button')).toHaveLength(0);
  });

  it('订单详情加载失败可重试，成功后读取本单交付项', async () => {
    vi.mocked(getOrder).mockRejectedValueOnce(new Error('订单暂时不可用')).mockResolvedValue(order);
    const wrapper = await open(OrderDetailView, '/orders/order-001');
    expect(wrapper.find('[role="alert"]').text()).toContain('订单暂时不可用');
    await wrapper.find('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('测试客户');
    expect(pageFulfillmentItems).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, orderId: 'order-001' });
  });

  it('交付项加载失败可单独重试，不重新加载已成功的订单', async () => {
    vi.mocked(pageFulfillmentItems).mockRejectedValueOnce(new Error('交付项加载失败'))
      .mockResolvedValue(page([item('fulfillment-item-aaa', 'order-line-a')]));
    const wrapper = await open(OrderDetailView, '/orders/order-001');
    expect(wrapper.text()).toContain('测试客户');
    await wrapper.find('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('order-line-a');
    expect(getOrder).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, '商品（无权查看）'],
    [404, '商品（已删除或无权查看）']
  ])('关联商品目录返回%s时仍展示获准订单、冻结义务及本单交付项', async (status, label) => {
    vi.mocked(loadOfferingDirectory).mockRejectedValueOnce(new CrmApiError('关联目录不可访问', Number(status)));
    vi.mocked(getOrder).mockResolvedValue({ ...order, lines: [{
      orderLineId: 'order-line-a', sourceQuotationLineId: 'quotation-line-a', offeringReference: 'product-reference-a', quantity: '2', unit: '套',
      unitPrice: { amount: '50', currency: 'CNY' }, lineTotal: { amount: '100', currency: 'CNY' },
      obligation: { subjectReference: 'delivery-subject-a', fulfillmentScope: 'default', requiredConsumerCapability: 'offline-issue' }
    }] });
    vi.mocked(pageFulfillmentItems).mockResolvedValue(page([item('fulfillment-item-aaa', 'order-line-a')]));
    const wrapper = await open(OrderDetailView, '/orders/order-001');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('测试客户');
    expect(wrapper.text()).toContain(label);
    expect(wrapper.text()).toContain('product-reference-a');
    expect(wrapper.text()).toContain('2 套');
    expect(wrapper.text()).toContain('100 CNY');
    expect(wrapper.text()).toContain('delivery-subject-a');
    expect(wrapper.text()).toContain('fulfillment-item-aaa');
  });

  it('订单自身无权时不展示业务事实或读取交付项', async () => {
    vi.mocked(getOrder).mockRejectedValueOnce(new CrmApiError('订单无权访问', 403));
    const wrapper = await open(OrderDetailView, '/orders/order-001');
    expect(wrapper.find('[role="alert"]').text()).toContain('订单无权访问');
    expect(wrapper.text()).not.toContain('测试客户');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(pageFulfillmentItems).not.toHaveBeenCalled();
  });

  it('关联商品目录网络故障显示可重试错误，恢复后回读真实名称', async () => {
    vi.mocked(loadOfferingDirectory).mockRejectedValueOnce(new CrmApiError('商品目录暂时不可用', 503))
      .mockResolvedValueOnce([{ id: 'offering-a', offeringReference: 'product-reference-a', displayName: '测试商品', state: 'published', owner: 'user:1' }]);
    vi.mocked(getOrder).mockResolvedValue({ ...order, lines: [{
      orderLineId: 'order-line-a', sourceQuotationLineId: 'quotation-line-a', offeringReference: 'product-reference-a', quantity: '2', unit: '套',
      unitPrice: { amount: '50', currency: 'CNY' }, lineTotal: { amount: '100', currency: 'CNY' },
      obligation: { subjectReference: 'delivery-subject-a', fulfillmentScope: 'default', requiredConsumerCapability: 'offline-issue' }
    }] });
    const wrapper = await open(OrderDetailView, '/orders/order-001');
    expect(wrapper.find('[role="alert"]').text()).toContain('商品目录暂时不可用');
    expect(wrapper.text()).not.toContain('商品（无权查看）');
    await wrapper.find('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('测试商品');
    expect(pageFulfillmentItems).toHaveBeenCalledTimes(1);
  });

  it('无权重置显示明确错误，重试沿用同键同参数，成功后回读列表', async () => {
    const failed = { ...item('fulfillment-item-aaa', 'order-line-a'), state: 'failed', reportSequence: 7 };
    vi.mocked(pageFulfillmentItems).mockResolvedValueOnce(page([failed])).mockResolvedValue(page([]));
    vi.mocked(patchFulfillmentItem).mockRejectedValueOnce(new CrmApiError('拒绝访问', 403))
      .mockResolvedValue({ ...failed, state: 'pending_dispatch' });
    const wrapper = await open(FulfillmentView, '/fulfillment');
    await wrapper.find('tbody button').trigger('click');
    expect(wrapper.find('[role="alertdialog"]').text()).toContain('保留当前序号水位 7');
    await wrapper.find('[role="alertdialog"] .button-primary').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alertdialog"]').text()).toContain('无权重置此交付项');
    expect(pageFulfillmentItems).toHaveBeenCalledTimes(1);
    await wrapper.find('[role="alertdialog"] .button-primary').trigger('click');
    await flushPromises();
    expect(patchFulfillmentItem).toHaveBeenCalledTimes(2);
    expect(vi.mocked(patchFulfillmentItem).mock.calls[1]).toEqual(vi.mocked(patchFulfillmentItem).mock.calls[0]);
    expect(patchFulfillmentItem).toHaveBeenLastCalledWith(
      { idempotencyKey: expect.any(String) }, failed.fulfillmentId, { state: 'PENDING_DISPATCH' });
    expect(pageFulfillmentItems).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.findAll('tbody button')).toHaveLength(0);
  });

  it('重置执行时禁止重复提交，完成后回读订单与当前交付页', async () => {
    const failed = { ...item('fulfillment-item-aaa', 'order-line-a'), state: 'failed' };
    vi.mocked(pageFulfillmentItems).mockResolvedValueOnce(page([failed]))
      .mockResolvedValue(page([{ ...failed, state: 'pending_dispatch' }]));
    let finish!: (result: CrmFulfillmentItem) => void;
    vi.mocked(patchFulfillmentItem).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const wrapper = await open(OrderDetailView, '/orders/order-001');
    await wrapper.find('tbody button').trigger('click');
    await wrapper.find('[role="alertdialog"] .button-primary').trigger('click');
    expect(wrapper.find('[role="alertdialog"] .button-primary').attributes('disabled')).toBeDefined();
    await wrapper.find('[role="alertdialog"] .button-primary').trigger('click');
    expect(patchFulfillmentItem).toHaveBeenCalledTimes(1);
    finish({ ...failed, state: 'pending_dispatch' });
    await flushPromises();
    expect(getOrder).toHaveBeenCalledTimes(2);
    expect(pageFulfillmentItems).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('待执行');
    expect(wrapper.findAll('tbody button')).toHaveLength(0);
  });

  it('重置成功但订单回读失败时显示准确错误，不误称交付项刷新失败', async () => {
    const failed = { ...item('fulfillment-item-aaa', 'order-line-a'), state: 'failed' };
    vi.mocked(getOrder).mockResolvedValueOnce(order)
      .mockRejectedValueOnce(new Error('订单回读暂时不可用'));
    vi.mocked(pageFulfillmentItems).mockResolvedValueOnce(page([failed]));
    vi.mocked(patchFulfillmentItem).mockResolvedValue({ ...failed, state: 'pending_dispatch' });
    const wrapper = await open(OrderDetailView, '/orders/order-001');
    await wrapper.find('tbody button').trigger('click');
    await wrapper.find('[role="alertdialog"] .button-primary').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('重置已完成，但订单回读失败');
    expect(wrapper.find('[role="alert"]').text()).toContain('订单回读暂时不可用');
    expect(wrapper.find('[role="alert"]').text()).not.toContain('交付项刷新失败');
    expect(pageFulfillmentItems).toHaveBeenCalledTimes(1);
  });
});
