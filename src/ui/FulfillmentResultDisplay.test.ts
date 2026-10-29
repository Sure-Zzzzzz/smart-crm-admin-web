// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FulfillmentResultDisplay from './FulfillmentResultDisplay.vue';
import { crmIdentityVersion } from '../auth/pkce';
import type { CrmFulfillmentItem } from '../api/crmApi';

vi.mock('../auth/pkce', async () => {
  const { ref } = await import('vue');
  return { crmIdentityVersion: ref(0) };
});
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));
const item: CrmFulfillmentItem = {
  fulfillmentId: 'fulfillment-item-1', orderId: 'order-1', orderLineId: 'line-1',
  owner: 'iam:user-1', assignedConsumerId: 'custom-delivery', state: 'completed', reportSequence: 3
};
function render(resultData: string | null, state = 'completed') {
  const wrapper = mount(FulfillmentResultDisplay, { props: { item: { ...item, state, resultData } } });
  wrappers.push(wrapper);
  return wrapper;
}

describe('通用交付结果完整展示', () => {
  it('自定义嵌套JSON完整格式化显示，包括多个字段、数组、布尔与空值', async () => {
    const payload = { customReceipt: { sites: ['site-a', 'site-b'], valid: true }, externalId: 'custom-12', note: null };
    const wrapper = render(JSON.stringify(payload));
    expect(wrapper.text()).toContain('结构化结果 · 3 个字段');
    await wrapper.find('button').trigger('click');
    expect(wrapper.find('pre').text()).toBe(JSON.stringify(payload, null, 2));
    expect(wrapper.find('[role="dialog"]').text()).toContain('line-1');
  });

  it('普通文本摘要截短，详情保留换行及完整原文', async () => {
    const text = `自定义交付已完成\n${'长结果'.repeat(50)}`;
    const wrapper = render(text);
    expect(wrapper.find('.wrap-cell').text()).toHaveLength(81);
    await wrapper.find('button').trigger('click');
    expect(wrapper.find('pre').text()).toBe(text);
  });

  it.each([null, '', '  '])('无结果%s明确标识，不能伪造交付凭证', resultData => {
    const wrapper = render(resultData);
    expect(wrapper.text()).toContain('已完成，未回填结果');
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('未完成且无结果显示未回填结果', () => {
    expect(render(null, 'failed').text()).toBe('未回填结果');
  });

  it('恶意HTML仅作为原文展示，身份变化立即关闭结果抽屉', async () => {
    const raw = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const wrapper = render(raw);
    await wrapper.find('button').trigger('click');
    expect(wrapper.find('pre').text()).toBe(raw);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('script').exists()).toBe(false);
    crmIdentityVersion.value++;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
});
