// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ownerCode, ownerLabel, setCrmCurrentUser } from './crmDisplay';

beforeEach(() => setCrmCurrentUser(null));
afterEach(() => setCrmCurrentUser(null));

describe('人员归属名称只来自当前门户身份', () => {
  it('当前人员优先显示displayName，稳定owner仍可追溯，其他人员和机器不冒用名称', () => {
    setCrmCurrentUser({ subjectId: 'person-a', username: 'user-a', displayName: '测试人员甲' });
    expect(ownerLabel('iam:person-a')).toBe('测试人员甲');
    expect(ownerCode('iam:person-a')).toBe('iam:person-a');
    expect(ownerLabel('iam:person-b')).toBe('IAM 用户');
    expect(ownerLabel('aksk:person-a')).toBe('AKSK 客户端');
    expect(ownerLabel('person-a')).toBe('系统标识');
  });

  it('空显示名回退username，缺少名称或主体时保留明确身份类别', () => {
    setCrmCurrentUser({ subjectId: 'person-a', username: ' user-a ', displayName: '  ' });
    expect(ownerLabel('iam:person-a')).toBe('user-a');
    setCrmCurrentUser({ subjectId: 'person-a', username: '', displayName: null });
    expect(ownerLabel('iam:person-a')).toBe('IAM 用户');
    setCrmCurrentUser({ subjectId: null, username: 'user-a', displayName: '无主体人员' });
    expect(ownerLabel('iam:person-a')).toBe('IAM 用户');
    expect(ownerLabel(null)).toBe('未分配');
  });

  it('名称刷新驱动显示，切换身份和清理立即撤销旧名称，不缓存历史人员映射', async () => {
    const owner = ref('iam:person-a');
    const view = mount(defineComponent({
      setup: () => ({ owner, ownerLabel, ownerCode }),
      template: '<div><span class="identity-main">{{ ownerLabel(owner) }}</span><span class="identity-code">{{ ownerCode(owner) }}</span></div>'
    }));
    try {
      setCrmCurrentUser({ subjectId: 'person-a', username: 'user-a', displayName: '测试人员甲' });
      await flushPromises();
      expect(view.get('.identity-main').text()).toBe('测试人员甲');
      setCrmCurrentUser({ subjectId: 'person-a', username: 'user-a', displayName: '测试人员甲新名称' });
      await flushPromises();
      expect(view.get('.identity-main').text()).toBe('测试人员甲新名称');
      setCrmCurrentUser({ subjectId: 'person-b', username: 'user-b', displayName: '测试人员乙' });
      await flushPromises();
      expect(view.get('.identity-main').text()).toBe('IAM 用户');
      expect(view.get('.identity-code').text()).toBe('iam:person-a');
      owner.value = 'iam:person-b';
      await flushPromises();
      expect(view.get('.identity-main').text()).toBe('测试人员乙');
      setCrmCurrentUser(null);
      await flushPromises();
      expect(view.get('.identity-main').text()).toBe('IAM 用户');
      expect(view.get('.identity-code').text()).toBe('iam:person-b');
    } finally {
      view.unmount();
    }
  });
});
