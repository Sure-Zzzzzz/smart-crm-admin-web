import { CrmApiError, getCustomer, pageCustomers, pageOfferings, pageOpportunities, type CrmCustomer, type CrmOffering, type CrmOpportunity } from '../api/crmApi';

/** 按实际引用查询客户，避免第一页客户目录决定其他页的名称。 */
export async function customerDisplayName(customerId: string): Promise<string> {
  try {
    return (await getCustomer(customerId)).displayName;
  } catch (failure) {
    if (failure instanceof CrmApiError && failure.status === 403) {
      return '客户（无权查看）';
    }
    if (failure instanceof CrmApiError && failure.status === 404) {
      return '客户（已删除或无权查看）';
    }
    throw failure;
  }
}

/** 单次加载目录全部页，返回请求局部缓存；引用编码不当作内部 ID 点查。 */
export async function loadOfferingDirectory(state?: string): Promise<CrmOffering[]> {
  const items: CrmOffering[] = [];
  let page = 1;
  while (true) {
    const result = await pageOfferings({ page, pageSize: 100, state });
    items.push(...result.items);
    if (page * result.pageSize >= result.total) return items;
    page++;
  }
}

export async function loadCustomerDirectory(state?: string): Promise<CrmCustomer[]> {
  const items: CrmCustomer[] = [];
  let page = 1;
  while (true) {
    const result = await pageCustomers({ page, pageSize: 100, state });
    items.push(...result.items);
    if (page * result.pageSize >= result.total) return items;
    page++;
  }
}

export async function loadOpportunityDirectory(customerId?: string, stages?: string[]): Promise<CrmOpportunity[]> {
  const items: CrmOpportunity[] = [];
  let page = 1;
  while (true) {
    const result = await pageOpportunities({ page, pageSize: 100, customerId, ...(stages?.length === 1 ? { stage: stages[0] } : {}) });
    items.push(...result.items);
    if (page * result.pageSize >= result.total) return items;
    page++;
  }
}
