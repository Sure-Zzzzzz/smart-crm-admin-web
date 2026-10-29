// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerDetailView from './CustomerDetailView.vue';
import { CrmApiError, createContact, getCustomer, pageContacts, patchCustomer, type CrmContact, type CrmCustomer } from '../api/crmApi';

vi.mock('../auth/pkce', async () => {
  const { ref } = await import('vue');
  return { crmAccessToken: () => 'current-identity', crmIdentityEpoch: () => 0, crmIdentityVersion: ref(0) };
});
vi.mock('../api/crmApi', async importOriginal => ({
  ...await importOriginal<typeof import('../api/crmApi')>(),
  createContact: vi.fn(), getCustomer: vi.fn(), pageContacts: vi.fn(), patchCustomer: vi.fn()
}));
vi.mock('../ui/crmNames', () => ({
  loadCustomerDirectory: vi.fn().mockResolvedValue([
    { id: 'customer-target', displayName: '测试客户乙', state: 'active', owner: 'iam:user-1' }
  ])
}));

const sourceCustomer: CrmCustomer = { id: 'customer-source', displayName: '测试客户甲', state: 'active', owner: 'iam:user-1' };
const savedContact: CrmContact = {
  id: 'contact-server-1', customerId: 'customer-source', displayName: '测试联系人甲', title: '项目负责人', state: 'active'
};
let storedCustomer: CrmCustomer;
let storedContacts: CrmContact[];
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  storedCustomer = structuredClone(sourceCustomer);
  storedContacts = [];
  vi.mocked(createContact).mockReset();
  vi.mocked(patchCustomer).mockReset();
  vi.mocked(getCustomer).mockImplementation(async () => structuredClone(storedCustomer));
  vi.mocked(pageContacts).mockImplementation(async () => ({
    items: structuredClone(storedContacts), page: 1, pageSize: 20, total: storedContacts.length
  }));
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

async function open() {
  wrapper?.unmount();
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/customers/:customerId', component: CustomerDetailView },
    { path: '/customers', component: { template: '<div />' } }
  ] });
  await router.push('/customers/customer-source');
  await router.isReady();
  wrapper = mount(CustomerDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

async function click(view: ReturnType<typeof mount>, label: string) {
  const button = view.findAll('button').find(item => item.text() === label);
  if (!button) throw new Error(`未找到按钮：${label}`);
  await button.trigger('click');
  await flushPromises();
}

describe('联系人录入、所属客户与职务回读', () => {
  it('填写职务后提交给当前客户，重新查询后展示真实职务与客户名', async () => {
    vi.mocked(createContact).mockImplementationOnce(async () => {
      storedContacts = [structuredClone(savedContact)];
      return structuredClone(savedContact);
    });
    const view = await open();
    await click(view, '新建联系人');
    await view.get('[aria-label="联系人姓名"]').setValue(' 测试联系人甲 ');
    await view.get('[aria-label="联系人职务"]').setValue(' 项目负责人 ');
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(createContact).toHaveBeenCalledWith(
      { idempotencyKey: expect.any(String) }, 'customer-source', '测试联系人甲', '项目负责人');
    expect(pageContacts).toHaveBeenCalledTimes(2);
    expect(pageContacts).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, customerId: 'customer-source' });
    expect(view.find('tbody').text()).toContain('测试联系人甲');
    expect(view.find('tbody').text()).toContain('项目负责人');
    expect(view.find('tbody').text()).toContain('测试客户甲');
    expect(view.find('tbody [title="customer-source"]').exists()).toBe(true);
    const reopened = await open();
    expect(reopened.find('tbody').text()).toContain('项目负责人');
  });

  it('可不填写职务，回读空职务显示未填写而不编造业务值', async () => {
    vi.mocked(createContact).mockImplementationOnce(async () => {
      storedContacts = [{ ...savedContact, title: null }];
      return structuredClone(storedContacts[0]);
    });
    const view = await open();
    await click(view, '新建联系人');
    await view.get('[aria-label="联系人姓名"]').setValue('测试联系人甲');
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(createContact).toHaveBeenCalledWith(
      { idempotencyKey: expect.any(String) }, 'customer-source', '测试联系人甲', undefined);
    expect(view.find('tbody').text()).toContain('未填写');
  });

  it('合并客户后重新查询联系人，不继续展示已迁往目标客户的旧联系人', async () => {
    storedContacts = [structuredClone(savedContact)];
    vi.mocked(patchCustomer).mockImplementationOnce(async () => {
      storedCustomer = { ...sourceCustomer, state: 'merged' };
      storedContacts = [];
      return structuredClone(storedCustomer);
    });
    const view = await open();
    expect(view.find('tbody').text()).toContain('测试联系人甲');
    await click(view, '合并到其他客户');
    await view.get('[aria-label="目标客户"]').setValue('customer-target');
    await view.get('[aria-label="合并客户"] form').trigger('submit');
    await flushPromises();
    expect(patchCustomer).not.toHaveBeenCalled();
    await view.get('[role="alertdialog"] .button-danger').trigger('click');
    await flushPromises();
    expect(patchCustomer).toHaveBeenCalledWith(
      { idempotencyKey: expect.any(String) }, 'customer-source', { state: 'merged', mergeTargetId: 'customer-target' });
    expect(pageContacts).toHaveBeenCalledTimes(2);
    expect(view.text()).not.toContain('测试联系人甲');
    const newContact = view.findAll('button').find(button => button.text() === '新建联系人')!;
    expect(newContact.attributes('disabled')).toBeDefined();
  });

  it('转移归属表单实际可输入，经最终确认后提交并重新查询客户与联系人', async () => {
    storedContacts = [structuredClone(savedContact)];
    vi.mocked(patchCustomer).mockImplementationOnce(async () => {
      storedCustomer = { ...sourceCustomer, owner: 'iam:user-2' };
      return structuredClone(storedCustomer);
    });
    const view = await open();
    await click(view, '转移归属');
    await view.get('[aria-label="新归属"]').setValue('iam:user-2');
    await view.get('[aria-label="转移客户归属"] form').trigger('submit');
    await flushPromises();
    expect(patchCustomer).not.toHaveBeenCalled();
    expect(view.get('[role="alertdialog"]').text()).toContain('iam:user-2');
    await view.get('[role="alertdialog"] .button-danger').trigger('click');
    await flushPromises();
    expect(patchCustomer).toHaveBeenCalledWith(
      { idempotencyKey: expect.any(String) }, 'customer-source', { owner: 'iam:user-2' });
    expect(getCustomer).toHaveBeenCalledTimes(2);
    expect(pageContacts).toHaveBeenCalledTimes(2);
    expect(view.find('[role="alertdialog"]').exists()).toBe(false);
    expect(view.find('[aria-label="新归属"]').exists()).toBe(false);
    expect(view.get('[title="iam:user-2"]').text()).toContain('iam:user-2');
    expect(view.find('tbody').text()).toContain('项目负责人');
  });

  it.each(['merge', 'transfer'] as const)('%s 被后端拒绝时错误在顶层确认中可见，不关闭表单或伪造治理成功', async action => {
    storedContacts = [structuredClone(savedContact)];
    vi.mocked(patchCustomer).mockRejectedValueOnce(new CrmApiError('无权执行客户治理', 403));
    const view = await open();
    if (action === 'merge') {
      await click(view, '合并到其他客户');
      await view.get('[aria-label="目标客户"]').setValue('customer-target');
      await view.get('[aria-label="合并客户"] form').trigger('submit');
    } else {
      await click(view, '转移归属');
      await view.get('[aria-label="新归属"]').setValue('iam:user-2');
      await view.get('[aria-label="转移客户归属"] form').trigger('submit');
    }
    await flushPromises();
    await view.get('[role="alertdialog"] .button-danger').trigger('click');
    await flushPromises();
    expect(view.get('[role="alertdialog"]').text()).toContain('无权执行客户治理');
    expect(view.find(action === 'merge' ? '[aria-label="目标客户"]' : '[aria-label="新归属"]').exists()).toBe(true);
    expect(getCustomer).toHaveBeenCalledTimes(1);
    expect(pageContacts).toHaveBeenCalledTimes(1);
    expect(view.find('tbody').text()).toContain('测试联系人甲');
    expect(storedCustomer).toEqual(sourceCustomer);
  });
});
