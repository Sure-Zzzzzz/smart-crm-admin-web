// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import QuotationEditorView from './QuotationEditorView.vue';
import {
  CrmApiError,
  createQuotation,
  editQuotation,
  getQuotation,
  getQuotationVersion,
  pageFulfillmentItems,
  patchQuotation,
  renegotiateQuotation,
  type CrmQuotation,
  type CrmQuotationLineView,
  type CrmQuotationVersionView
} from '../api/crmApi';

vi.mock('../auth/pkce', async () => {
  const { ref } = await import('vue');
  return {
    crmAccessToken: () => 'current-identity', crmIdentityEpoch: () => 0,
    crmIdentityVersion: ref(0), clearCrmToken: vi.fn()
  };
});
vi.mock('../api/crmApi', async importOriginal => ({
  ...await importOriginal<typeof import('../api/crmApi')>(),
  createQuotation: vi.fn(), editQuotation: vi.fn(), getQuotation: vi.fn(),
  getQuotationVersion: vi.fn(), pageFulfillmentItems: vi.fn(),
  patchQuotation: vi.fn(), renegotiateQuotation: vi.fn()
}));
vi.mock('../ui/crmNames', () => ({
  loadCustomerDirectory: vi.fn().mockResolvedValue([
    { id: 'customer-1', displayName: '测试客户甲', state: 'active', owner: 'iam:user-1' },
    { id: 'customer-2', displayName: '测试客户乙', state: 'active', owner: 'iam:user-2' }
  ]),
  loadOfferingDirectory: vi.fn().mockResolvedValue([
    { id: 'offering-1', offeringReference: 'product-1', displayName: '测试商品甲', state: 'published', owner: 'iam:user-1' },
    { id: 'offering-2', offeringReference: 'product-2', displayName: '测试商品乙', state: 'published', owner: 'iam:user-1' }
  ]),
  loadOpportunityDirectory: vi.fn().mockResolvedValue([])
}));

const draft: CrmQuotation = {
  quotationId: 'quotation-1', customerId: 'customer-1', owner: 'iam:user-1',
  state: 'draft', aggregateVersion: 1, currentVersion: 1, currentConfirmableVersion: null,
  confirmedOrderId: null, supersedesQuotationId: null
};
const line = (id: string, offeringId: string, quantity: string, amount: string, total: string): CrmQuotationLineView => ({
  quotationLineId: id, offeringId, offeringReference: offeringId === 'offering-1' ? 'product-1' : 'product-2',
  quantity, unit: 'SET', unitPrice: { amount, currency: 'CNY' }, lineTotal: { amount: total, currency: 'CNY' },
  obligation: { subjectReference: `project-${id}`, fulfillmentScope: `交付范围 ${id}`, requiredConsumerCapability: 'service-delivery' }
});
const savedLines = [line('line-1', 'offering-1', '2', '75.00', '150.00'), line('line-2', 'offering-2', '1', '20.00', '20.00')];
const editedLines = [line('line-1', 'offering-1', '3', '88.00', '264.00'), line('line-2', 'offering-2', '1', '20.00', '20.00')];
function version(quotation: CrmQuotation, lines = savedLines, total = '170.00'): CrmQuotationVersionView {
  return {
    quotationId: quotation.quotationId, version: quotation.currentVersion, state: quotation.state,
    settlementCurrency: 'CNY', validUntil: '2031-01-15T10:30:00Z',
    totalAmount: { amount: total, currency: 'CNY' }, issuedAt: null, terminalAt: null, lines
  };
}
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// 写操作安装预先定义的服务端快照；随后 GET 单独读回，避免将表单本身当成持久化事实。
const quotations = new Map<string, CrmQuotation>();
const versions = new Map<string, CrmQuotationVersionView>();
function persist(quotation: CrmQuotation, detail: CrmQuotationVersionView): void {
  quotations.set(quotation.quotationId, copy(quotation));
  versions.set(`${quotation.quotationId}:${detail.version}`, copy(detail));
}
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  quotations.clear();
  versions.clear();
  for (const method of [createQuotation, editQuotation, patchQuotation, renegotiateQuotation]) {
    vi.mocked(method).mockReset();
  }
  vi.mocked(getQuotation).mockImplementation(async id => {
    const hit = quotations.get(id);
    if (!hit) throw new CrmApiError('报价不存在', 404);
    return copy(hit);
  });
  vi.mocked(getQuotationVersion).mockImplementation(async (id, number) => {
    const hit = versions.get(`${id}:${number}`);
    if (!hit) throw new CrmApiError('报价版本不存在', 404);
    return copy(hit);
  });
  vi.mocked(pageFulfillmentItems).mockResolvedValue({ items: [], page: 1, pageSize: 1, total: 0 });
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

async function open(path: string) {
  wrapper?.unmount();
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/quotations/new', component: QuotationEditorView },
    { path: '/quotations/:quotationId', component: QuotationEditorView },
    { path: '/orders', component: { template: '<div />' } }
  ] });
  await router.push(path);
  await router.isReady();
  wrapper = mount(QuotationEditorView, { global: { plugins: [router] } });
  await flushPromises();
  return { view: wrapper, router };
}
function button(view: ReturnType<typeof mount>, label: string) {
  const hit = view.findAll('button').find(candidate => candidate.text() === label);
  if (!hit) throw new Error(`未找到按钮：${label}`);
  return hit;
}
async function click(view: ReturnType<typeof mount>, label: string): Promise<void> {
  await button(view, label).trigger('click');
  await flushPromises();
}
async function select(view: ReturnType<typeof mount>, index: number, value: string): Promise<void> {
  view.findAllComponents(FormSelect)[index].vm.$emit('update:modelValue', value);
  await flushPromises();
}

describe('报价人员写流程与服务端版本快照', () => {
  it('多行草稿保存后回读，编辑持久化后携版本锁签发和成交，展示返回订单号', async () => {
    vi.mocked(createQuotation).mockImplementationOnce(async () => {
      persist(draft, version(draft));
      return copy(draft);
    });
    const edited = { ...draft, aggregateVersion: 2 };
    vi.mocked(editQuotation).mockImplementationOnce(async () => {
      persist(edited, version(edited, editedLines, '284.00'));
      return copy(edited);
    });
    const issued = { ...edited, state: 'issued', aggregateVersion: 3, currentConfirmableVersion: 1 };
    const confirmed = { ...issued, state: 'confirmed', aggregateVersion: 4, confirmedOrderId: 'order-backend-701' };
    vi.mocked(patchQuotation)
      .mockImplementationOnce(async () => {
        persist(issued, version(issued, editedLines, '284.00'));
        return copy(issued);
      })
      .mockImplementationOnce(async () => {
        persist(confirmed, version(confirmed, editedLines, '284.00'));
        return copy(confirmed);
      });
    const { view, router } = await open('/quotations/new');
    await select(view, 0, 'customer-1');
    await view.get('[aria-label="报价有效期至"]').setValue('2031-01-15T10:30');
    await select(view, 1, 'offering-1');
    await view.findAll('[aria-label="数量"]')[0].setValue('2');
    await view.findAll('[aria-label="单价"]')[0].setValue('75');
    await view.get('[aria-label="第 1 行交付对象引用"]').setValue('project-line-1');
    await view.get('[aria-label="第 1 行交付范围"]').setValue('交付范围 line-1');
    await click(view, '加一行');
    await select(view, 2, 'offering-2');
    await view.findAll('[aria-label="单价"]')[1].setValue('20');
    await view.get('[aria-label="第 2 行交付对象引用"]').setValue('project-line-2');
    await view.get('[aria-label="第 2 行交付范围"]').setValue('交付范围 line-2');
    await click(view, '保存草稿');
    expect(createQuotation).toHaveBeenCalledWith(
      { idempotencyKey: expect.any(String) }, 'customer-1',
      expect.stringMatching(/^2031-01-15T10:30:00[+-]\d{2}:\d{2}$/),
      [
        expect.objectContaining({ offeringId: 'offering-1', quantity: '2', unit: 'SET', unitPrice: { amount: '75', currency: 'CNY' },
          subjectReference: 'project-line-1', fulfillmentScope: '交付范围 line-1' }),
        expect.objectContaining({ offeringId: 'offering-2', quantity: '1', unit: 'SET', unitPrice: { amount: '20', currency: 'CNY' },
          subjectReference: 'project-line-2', fulfillmentScope: '交付范围 line-2' })
      ]
    );
    expect(router.currentRoute.value.path).toBe('/quotations/quotation-1');
    expect(view.find('.admin-message.success').text()).toContain('草稿已创建');
    expect(getQuotation).toHaveBeenLastCalledWith('quotation-1');
    expect(getQuotationVersion).toHaveBeenLastCalledWith('quotation-1', 1);
    expect((view.findAll('[aria-label="单价"]')[0].element as HTMLInputElement).value).toBe('75.00');
    expect(view.findAll('[aria-label="数量"]')).toHaveLength(2);
    expect((view.get('[aria-label="第 1 行交付对象引用"]').element as HTMLInputElement).value).toBe('project-line-1');
    expect((view.get('[aria-label="第 2 行交付范围"]').element as HTMLTextAreaElement).value).toBe('交付范围 line-2');

    await view.findAll('[aria-label="数量"]')[0].setValue('3');
    await view.findAll('[aria-label="单价"]')[0].setValue('88');
    await click(view, '保存修改（版本号不变）');
    expect(editQuotation).toHaveBeenCalledWith(
      { idempotencyKey: expect.any(String) }, 'quotation-1', expect.any(String),
      [
        expect.objectContaining({ offeringId: 'offering-1', quantity: '3', unitPrice: { amount: '88', currency: 'CNY' },
          subjectReference: 'project-line-1', fulfillmentScope: '交付范围 line-1' }),
        expect.objectContaining({ offeringId: 'offering-2', quantity: '1',
          subjectReference: 'project-line-2', fulfillmentScope: '交付范围 line-2' })
      ]
    );
    expect(quotations.get('quotation-1')).toMatchObject({ currentVersion: 1, aggregateVersion: 2 });
    const { view: persistedView } = await open('/quotations/quotation-1');
    expect((persistedView.findAll('[aria-label="数量"]')[0].element as HTMLInputElement).value).toBe('3');
    expect((persistedView.findAll('[aria-label="单价"]')[0].element as HTMLInputElement).value).toBe('88.00');
    await click(persistedView, '签发报价');
    expect(patchQuotation).toHaveBeenNthCalledWith(1,
      { idempotencyKey: expect.any(String) }, 'quotation-1',
      { state: 'issued', quotationVersion: 1, expectedAggregateVersion: 2 });
    expect(persistedView.findAll('[aria-label="单价"]').every(input => input.attributes('disabled') !== undefined)).toBe(true);
    expect(persistedView.get('[aria-label="第 1 行交付对象引用"]').attributes('disabled')).toBeDefined();
    expect(persistedView.get('[aria-label="第 2 行交付范围"]').attributes('disabled')).toBeDefined();
    await click(persistedView, '确认成交');
    await persistedView.get('[role="alertdialog"] .button-primary').trigger('click');
    await flushPromises();
    expect(patchQuotation).toHaveBeenNthCalledWith(2,
      { idempotencyKey: expect.any(String) }, 'quotation-1',
      { state: 'confirmed', quotationVersion: 1, expectedAggregateVersion: 3 });
    expect(persistedView.get('[role="status"]').text()).toContain('order-backend-701');
    expect(persistedView.find('[role="alertdialog"]').exists()).toBe(false);
    expect(buttonExists(persistedView, '确认成交')).toBe(false);
    expect(quotations.get('quotation-1')).toMatchObject({ confirmedOrderId: 'order-backend-701', aggregateVersion: 4 });
  });

  it.each(['issued', 'confirmed'] as const)('%s 遇到版本冲突不能显示写成功或成交订单', async action => {
    const loaded = { ...draft, currentVersion: 7, aggregateVersion: 12,
      state: action === 'issued' ? 'draft' : 'issued', currentConfirmableVersion: action === 'issued' ? null : 7 };
    persist(loaded, version(loaded));
    vi.mocked(patchQuotation).mockRejectedValue(new CrmApiError('报价版本已变化，请重新查询', 409));
    const { view } = await open('/quotations/quotation-1');
    if (action === 'issued') await click(view, '签发报价');
    else {
      await click(view, '确认成交');
      await view.get('[role="alertdialog"] .button-primary').trigger('click');
      await flushPromises();
    }
    expect(patchQuotation).toHaveBeenCalledTimes(1);
    expect(patchQuotation).toHaveBeenCalledWith(
      { idempotencyKey: expect.any(String) }, 'quotation-1',
      { state: action, quotationVersion: 7, expectedAggregateVersion: 12 });
    expect(view.get('[role="alert"]').text()).toContain('报价版本已变化');
    expect(view.find('[role="status"]').exists()).toBe(false);
    expect(view.findAll('a').some(link => link.text() === '查看订单')).toBe(false);
    expect(quotations.get('quotation-1')?.confirmedOrderId).toBeNull();
    if (action === 'issued') expect(buttonExists(view, '确认成交')).toBe(false);
    else expect(view.find('[role="alertdialog"]').exists()).toBe(true);
  });

  it('已签发报价确认撤回后进入只读终态，不出现成交与重议入口', async () => {
    const issued = { ...draft, state: 'issued', aggregateVersion: 5, currentConfirmableVersion: 1 };
    persist(issued, version(issued));
    const withdrawn = { ...issued, state: 'withdrawn', aggregateVersion: 6, currentConfirmableVersion: null };
    vi.mocked(patchQuotation).mockImplementationOnce(async () => {
      persist(withdrawn, version(withdrawn));
      return copy(withdrawn);
    });
    const { view } = await open('/quotations/quotation-1');
    await click(view, '客户放弃，撤回');
    await view.get('[role="alertdialog"] .button-danger').trigger('click');
    await flushPromises();
    expect(patchQuotation).toHaveBeenCalledWith(
      { idempotencyKey: expect.any(String) }, 'quotation-1', { state: 'withdrawn' });
    expect(view.text()).toContain('已撤回（终态）');
    expect(buttonExists(view, '确认成交')).toBe(false);
    expect(buttonExists(view, '重议（派生新草稿）')).toBe(false);
    expect(view.find('[role="alertdialog"]').exists()).toBe(false);
    expect(view.findAll('[aria-label="单价"]').every(input => input.attributes('disabled') !== undefined)).toBe(true);
  });

  it('重议跳转真实派生ID并回读新草稿，不将旧报价当成新对象或自动成交', async () => {
    const issued = { ...draft, state: 'issued', aggregateVersion: 5, currentConfirmableVersion: 1 };
    persist(issued, version(issued));
    const derived = { ...draft, quotationId: 'quotation-derived-802', supersedesQuotationId: issued.quotationId };
    vi.mocked(renegotiateQuotation).mockImplementationOnce(async () => {
      persist(derived, version(derived, [line('line-derived', 'offering-2', '4', '66.00', '264.00')], '264.00'));
      return copy(derived);
    });
    const { view, router } = await open('/quotations/quotation-1');
    await click(view, '重议（派生新草稿）');
    expect(renegotiateQuotation).toHaveBeenCalledWith({ idempotencyKey: expect.any(String) }, 'quotation-1');
    expect(router.currentRoute.value.path).toBe('/quotations/quotation-derived-802');
    expect(getQuotation).toHaveBeenLastCalledWith('quotation-derived-802');
    expect(getQuotationVersion).toHaveBeenLastCalledWith('quotation-derived-802', 1);
    expect(view.findAll('[aria-label="数量"]')).toHaveLength(1);
    expect((view.get('[aria-label="数量"]').element as HTMLInputElement).value).toBe('4');
    expect((view.get('[aria-label="单价"]').element as HTMLInputElement).value).toBe('66.00');
    expect(buttonExists(view, '保存修改（版本号不变）')).toBe(true);
    expect(buttonExists(view, '确认成交')).toBe(false);
    expect(patchQuotation).not.toHaveBeenCalled();
    expect(quotations.get('quotation-1')?.state).toBe('issued');
  });

  it('未保存改价时禁用签发并提示先保存，不能签发屏幕金额之外的旧快照', async () => {
    persist(draft, version(draft));
    const issued = { ...draft, state: 'issued', aggregateVersion: 2, currentConfirmableVersion: 1 };
    vi.mocked(patchQuotation).mockResolvedValue(issued);
    const { view } = await open('/quotations/quotation-1');
    await view.findAll('[aria-label="单价"]')[0].setValue('999.00');
    const issue = button(view, '签发报价');
    const disabledBeforeClick = issue.attributes('disabled') !== undefined;
    await issue.trigger('click');
    await flushPromises();
    expect(patchQuotation).not.toHaveBeenCalled();
    expect(disabledBeforeClick).toBe(true);
    expect(view.text()).toContain('先保存');
    expect((view.findAll('[aria-label="单价"]')[0].element as HTMLInputElement).value).toBe('999.00');
    expect(versions.get('quotation-1:1')?.lines[0].unitPrice.amount).toBe('75.00');
  });

  it.each([
    { missing: '对象', filledLabel: '第 1 行交付范围', filledValue: '约定的服务范围', error: '第 1 行：请填写交付对象引用' },
    { missing: '范围', filledLabel: '第 1 行交付对象引用', filledValue: 'project-local-1', error: '第 1 行：请填写交付范围' }
  ])('新建报价缺交付$missing时不生成替代值、不提交', async ({ filledLabel, filledValue, error }) => {
    const { view } = await open('/quotations/new');
    await select(view, 0, 'customer-1');
    await select(view, 1, 'offering-1');
    await view.get(`[aria-label="${filledLabel}"]`).setValue(filledValue);
    await click(view, '保存草稿');
    expect(view.get('[role="alert"]').text()).toBe(error);
    expect(createQuotation).not.toHaveBeenCalled();
  });

  it.each([
    { field: 'subjectReference' as const, label: '第 1 行交付对象引用', value: 'project-revised' },
    { field: 'fulfillmentScope' as const, label: '第 1 行交付范围', value: '变更后的服务范围\n包含实施与验收' }
  ])('只改$field也须先保存，重读保留多行交付约定', async ({ field, label, value }) => {
    persist(draft, version(draft));
    const edited = { ...draft, aggregateVersion: 2 };
    const expectedLines = copy(savedLines);
    expectedLines[0].obligation[field] = value;
    vi.mocked(editQuotation).mockImplementationOnce(async () => {
      persist(edited, version(edited, expectedLines));
      return copy(edited);
    });
    const { view } = await open('/quotations/quotation-1');
    await view.get(`[aria-label="${label}"]`).setValue(value);
    expect(button(view, '签发报价').attributes('disabled')).toBeDefined();
    await click(view, '签发报价');
    expect(patchQuotation).not.toHaveBeenCalled();
    await click(view, '保存修改（版本号不变）');
    expect(editQuotation).toHaveBeenCalledWith(
      { idempotencyKey: expect.any(String) }, 'quotation-1', expect.any(String),
      expectedLines.map(item => ({ offeringId: item.offeringId, quantity: item.quantity, unit: item.unit,
        unitPrice: item.unitPrice, subjectReference: item.obligation.subjectReference,
        fulfillmentScope: item.obligation.fulfillmentScope }))
    );
    const { view: reopened } = await open('/quotations/quotation-1');
    expect((reopened.get(`[aria-label="${label}"]`).element as HTMLInputElement).value).toBe(value);
    expect((reopened.get('[aria-label="第 2 行交付对象引用"]').element as HTMLInputElement).value).toBe('project-line-2');
    expect((reopened.get('[aria-label="第 2 行交付范围"]').element as HTMLTextAreaElement).value).toBe('交付范围 line-2');
    expect(button(reopened, '签发报价').attributes('disabled')).toBeUndefined();
  });

  it('后端详情缺失交付约定时明确加载失败，禁止空值覆盖旧报价', async () => {
    const incomplete = version(draft);
    delete (incomplete.lines[0] as Partial<CrmQuotationLineView>).obligation;
    persist(draft, incomplete);
    const { view } = await open('/quotations/quotation-1');
    expect(view.get('[role="alert"]').text()).toBe('报价交付约定未完整返回，请检查后端版本后重新查询');
    expect(view.findAll('[aria-label="数量"]')).toHaveLength(0);
    expect(buttonExists(view, '重新加载')).toBe(true);
    expect(buttonExists(view, '保存修改（版本号不变）')).toBe(false);
    expect(buttonExists(view, '签发报价')).toBe(false);
    expect(editQuotation).not.toHaveBeenCalled();
    expect(patchQuotation).not.toHaveBeenCalled();
  });
});

function buttonExists(view: ReturnType<typeof mount>, label: string): boolean {
  return view.findAll('button').some(candidate => candidate.text() === label);
}
