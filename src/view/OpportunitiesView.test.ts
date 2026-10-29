// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import OpportunitiesView from './OpportunitiesView.vue';
import { createOpportunity, pageOpportunities, transitionOpportunity, type CrmOpportunity } from '../api/crmApi';

vi.mock('../auth/pkce', async () => {
  const { ref } = await import('vue');
  return { crmAccessToken: () => 'current-identity', crmIdentityEpoch: () => 0, crmIdentityVersion: ref(0) };
});
vi.mock('../api/crmApi', async importOriginal => ({
  ...await importOriginal<typeof import('../api/crmApi')>(),
  createOpportunity: vi.fn(), pageOpportunities: vi.fn(), transitionOpportunity: vi.fn()
}));
vi.mock('../ui/crmNames', () => ({
  loadCustomerDirectory: vi.fn().mockResolvedValue([
    { id: 'customer-1', displayName: '测试客户甲', state: 'active', owner: 'iam:user-1' }
  ])
}));

const opportunity: CrmOpportunity = {
  opportunityId: 'opportunity-1', customerId: 'customer-1', owner: 'iam:user-1', title: '猎鹰授权项目',
  primaryOfferingId: null, contactId: null, expectedCloseDate: null, estimatedAmount: '100.00', currency: 'CNY',
  stage: 'new', lostReason: null, aggregateVersion: 1, createdAt: '2031-01-01T00:00:00Z', updatedAt: '2031-01-01T00:00:00Z'
};
let stored: CrmOpportunity[] = [];
let wrapper: ReturnType<typeof mount> | undefined;

function page() {
  return { items: structuredClone(stored), page: 1, pageSize: 20, total: stored.length };
}
async function open() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/opportunities', component: OpportunitiesView }, { path: '/opportunities/:id', component: { template: '<div />' } }, { path: '/customers/:id', component: { template: '<div />' } }] });
  await router.push('/opportunities');
  await router.isReady();
  wrapper = mount(OpportunitiesView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}
function selectByLabel(view: ReturnType<typeof mount>, label: string, value: string): void {
  const component = view.findAllComponents(FormSelect).find(item => item.find(`button[aria-label="${label}"]`).exists());
  if (!component) throw new Error(`未找到选择器：${label}`);
  component.vm.$emit('update:modelValue', value);
}
beforeEach(() => {
  vi.clearAllMocks();
  stored = [];
  vi.mocked(pageOpportunities).mockImplementation(async () => page());
  vi.mocked(createOpportunity).mockImplementation(async () => {
    stored = [structuredClone(opportunity)];
    return structuredClone(opportunity);
  });
  vi.mocked(transitionOpportunity).mockImplementation(async (_command, _id, stage, lostReason) => {
    stored = [{ ...opportunity, stage, lostReason: lostReason ?? null }];
    return structuredClone(stored[0]);
  });
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

describe('商机真实业务操作', () => {
  it('创建商机必须提交客户和标题，成功后重新回读列表', async () => {
    const view = await open();
    await view.get('button').trigger('click');
    selectByLabel(view, '商机客户', 'customer-1');
    await view.get('[aria-label="商机标题"]').setValue('猎鹰授权项目');
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(createOpportunity).toHaveBeenCalledWith({ idempotencyKey: expect.any(String) }, expect.objectContaining({ customerId: 'customer-1', title: '猎鹰授权项目' }));
    expect(view.text()).toContain('猎鹰授权项目');
    expect(pageOpportunities).toHaveBeenCalledTimes(2);
  });

  it('输单阶段没有原因时不发送写请求', async () => {
    stored = [structuredClone(opportunity)];
    const view = await open();
    await view.find('button.table-action').trigger('click');
    selectByLabel(view, '目标阶段', 'lost');
    await flushPromises();
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(transitionOpportunity).not.toHaveBeenCalled();
    expect(view.text()).toContain('输单阶段必须填写原因');
  });

  it('推进阶段提交真实动作与输单原因', async () => {
    stored = [structuredClone(opportunity)];
    const view = await open();
    await view.find('button.table-action').trigger('click');
    selectByLabel(view, '目标阶段', 'lost');
    await flushPromises();
    await view.get('[aria-label="输单原因"]').setValue('预算延期');
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(transitionOpportunity).toHaveBeenCalledWith({ idempotencyKey: expect.any(String) }, 'opportunity-1', 'lost', '预算延期');
  });
});
