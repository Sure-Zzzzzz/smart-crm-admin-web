/** CRM 管理台统一展示口径：业务名称优先，稳定标识作为可追溯的次级信息。 */
import { shallowRef } from 'vue';

/** 门户人员读模型的显示字段子集，不参与 CRM 认证或授权判断。 */
export interface CrmCurrentUser {
  subjectId: string | null;
  username?: string;
  displayName?: string | null;
}

const currentOwner = shallowRef<{ code: string; label: string } | null>(null);

/** 只保存当前门户人员的名称；切换身份或卸载时替换/清空，不缓存历史人员目录。 */
export function setCrmCurrentUser(user: CrmCurrentUser | null): void {
  const label = user?.displayName?.trim() || user?.username?.trim();
  currentOwner.value = user?.subjectId && label
    ? { code: `iam:${user.subjectId}`, label }
    : null;
}

export function shortId(value: string | null | undefined, prefix = ''): string {
  if (!value) {
    return '';
  }
  const normalized = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return normalized.length > 12 ? normalized.slice(-8) : normalized;
}

export function identityKind(value: string | null | undefined): string {
  if (!value) {
    return '未标识';
  }
  if (value.startsWith('iam:')) {
    return 'IAM 用户';
  }
  if (value.startsWith('aksk:')) {
    return 'AKSK 客户端';
  }
  return '系统标识';
}

export function ownerLabel(value: string | null | undefined): string {
  if (!value) {
    return '未分配';
  }
  if (currentOwner.value?.code === value) return currentOwner.value.label;
  return identityKind(value);
}

export function ownerCode(value: string | null | undefined): string {
  return value ?? '';
}

export const ORDER_STATE_LABELS: Record<string, string> = {
  pending_fulfillment: '待履约',
  partially_fulfilled: '部分履约',
  fulfilled: '已履约',
  change_in_progress: '变更中',
  closed: '已关闭'
};

export function orderStateLabel(value: string | null | undefined): string {
  return (value && ORDER_STATE_LABELS[value]) ?? '未知状态';
}

export function orderStateClass(value: string | null | undefined): string {
  if (value === 'fulfilled') {
    return 'success';
  }
  if (value === 'pending_fulfillment' || value === 'partially_fulfilled' || value === 'change_in_progress') {
    return 'warning';
  }
  if (value === 'closed') {
    return 'neutral';
  }
  return 'neutral';
}

export const FULFILLMENT_STATE_LABELS: Record<string, string> = {
  pending_dispatch: '待执行',
  in_progress: '执行中',
  completed: '已完成',
  failed: '失败'
};

export function fulfillmentStateLabel(value: string | null | undefined): string {
  return (value && FULFILLMENT_STATE_LABELS[value]) ?? '未知状态';
}

export function fulfillmentStateClass(value: string | null | undefined): string {
  if (value === 'completed') {
    return 'success';
  }
  if (value === 'failed') {
    return 'danger';
  }
  if (value === 'in_progress') {
    return 'warning';
  }
  return 'neutral';
}

// 能力标识不做业务名映射：统一显示稳定标识，具体含义由录入方的命名自解释
export const CAPABILITY_LABELS: Record<string, string> = {};

export function capabilityLabel(value: string | null | undefined): string {
  if (!value) {
    return '未声明交付能力';
  }
  return CAPABILITY_LABELS[value] ?? '自定义交付能力';
}

export function capabilityCode(value: string | null | undefined): string {
  return value ?? '';
}

export function consumerLabel(_value: string | null | undefined): string {
  return '承接服务';
}

export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  customer: '客户',
  contact: '联系人',
  offering: '商品',
  opportunity: '商机',
  quotation: '报价单',
  order: '订单',
  fulfillment_item: '交付项'
};

export function resourceTypeLabel(value: string | null | undefined): string {
  return (value && RESOURCE_TYPE_LABELS[value]) ?? '业务对象';
}

export const RESULT_LABELS: Record<string, string> = {
  success: '成功',
  ok: '成功',
  failure: '失败',
  error: '失败'
};

export function resultLabel(value: string | null | undefined): string {
  if (!value) {
    return '成功';
  }
  return RESULT_LABELS[value.toLowerCase()] ?? `失败（${value}）`;
}

export function formatQuantity(value: string | number): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? String(amount) : String(value);
}
