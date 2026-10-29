// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OfferingsView from './OfferingsView.vue';
import { CrmApiError, createOffering, pageOfferings, type CrmOffering } from '../api/crmApi';

vi.mock('../auth/pkce', async () => {
  const { ref } = await import('vue');
  return { crmAccessToken: () => 'current-identity', crmIdentityEpoch: () => 0, crmIdentityVersion: ref(0) };
});
vi.mock('../api/crmApi', async importOriginal => ({
  ...await importOriginal<typeof import('../api/crmApi')>(),
  createOffering: vi.fn(), pageOfferings: vi.fn()
}));

const savedOffering: CrmOffering = {
  id: 'offering-server-1', offeringReference: 'catalog-item-001', displayName: '测试服务甲',
  state: 'draft', owner: 'iam:user-1', requiredConsumerCapability: 'implementation-service'
};
let stored: CrmOffering[] = [];
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  stored = [];
  vi.mocked(createOffering).mockReset();
  vi.mocked(pageOfferings).mockImplementation(async () => ({
    items: structuredClone(stored), page: 1, pageSize: 20, total: stored.length
  }));
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

async function openCreate() {
  wrapper = mount(OfferingsView);
  await flushPromises();
  const createButton = wrapper.findAll('button').find(button => button.text() === '新建商品');
  if (!createButton) throw new Error('未找到新建商品按钮');
  await createButton.trigger('click');
  await flushPromises();
  return wrapper;
}

describe('商品业务引用由人员声明并由后端回读', () => {
  it('商品名称与业务引用独立提交，创建后重新查询实际商品并展示引用', async () => {
    vi.mocked(createOffering).mockImplementationOnce(async () => {
      stored = [structuredClone(savedOffering)];
      return structuredClone(savedOffering);
    });
    const view = await openCreate();
    await view.get('[aria-label="商品名称"]').setValue(' 测试服务甲 ');
    await view.get('[aria-label="商品业务引用"]').setValue(' catalog-item-001 ');
    await view.get('[aria-label="承接能力标识"]').setValue(' implementation-service ');
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(createOffering).toHaveBeenCalledWith(
      { idempotencyKey: expect.any(String) }, 'catalog-item-001', '测试服务甲', 'implementation-service');
    expect(pageOfferings).toHaveBeenCalledTimes(2);
    expect(view.find('tbody').text()).toContain('测试服务甲');
    expect(view.find('tbody').text()).toContain('catalog-item-001');
    expect(view.find('tbody').text()).not.toContain('ref-测试服务甲');
    const createButton = view.findAll('button').find(button => button.text() === '新建商品')!;
    await createButton.trigger('click');
    await flushPromises();
    for (const label of ['商品名称', '商品业务引用', '承接能力标识']) {
      expect((view.get(`[aria-label="${label}"]`).element as HTMLInputElement).value).toBe('');
    }
  });

  it('缺业务引用时明确提示，不从商品名称生成引用或发起写请求', async () => {
    const view = await openCreate();
    await view.get('[aria-label="商品名称"]').setValue('测试服务甲');
    await view.get('[aria-label="承接能力标识"]').setValue('implementation-service');
    await view.get('[aria-label="商品业务引用"]').setValue('  ');
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(view.get('[role="alert"]').text()).toBe('请填写商品业务引用');
    expect(createOffering).not.toHaveBeenCalled();
    expect(pageOfferings).toHaveBeenCalledTimes(1);
  });

  it('后端拒绝业务引用时在录入抽屉显示错误，保留录入内容且不伪造列表成功', async () => {
    vi.mocked(createOffering).mockRejectedValueOnce(new CrmApiError('商品业务引用已存在', 409));
    const view = await openCreate();
    await view.get('[aria-label="商品名称"]').setValue('测试服务甲');
    await view.get('[aria-label="商品业务引用"]').setValue('catalog-item-001');
    await view.get('[aria-label="承接能力标识"]').setValue('implementation-service');
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(view.get('form [role="alert"]').text()).toBe('商品业务引用已存在');
    expect((view.get('[aria-label="商品业务引用"]').element as HTMLInputElement).value).toBe('catalog-item-001');
    expect(pageOfferings).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(0);
  });
});
