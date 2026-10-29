import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { crmAccessToken, crmIdentityEpoch, crmIdentityVersion } from '../auth/pkce';
import type { CrmNumberedPage } from '../api/crmApi';

/** 请求成功才提交页码；后到的旧响应不能覆盖新查询或已卸载页面。 */
export function useCrmPagination<T, F extends object>(
  fetchPage: (page: number, pageSize: number, filters: F) => Promise<CrmNumberedPage<T>>,
  initialFilters: F,
  initialPageSize = 20
) {
  const rows = shallowRef<T[]>([]);
  const currentPage = ref(1);
  const pageSize = ref(initialPageSize);
  const totalElements = ref(0);
  const totalPages = computed(() => Math.max(1, Math.ceil(totalElements.value / pageSize.value)));
  const loading = ref(false);
  const error = ref('');
  let filters = { ...initialFilters };
  let sequence = 0;
  let disposed = false;
  let lastRequest = { page: 1, size: initialPageSize, filters: { ...initialFilters } };
  if (getCurrentScope()) {
    onScopeDispose(() => { disposed = true; sequence++; });
    watch(crmIdentityVersion, clear, { flush: 'sync' });
  }

  /** 切换订单或身份时立即清空，旧请求及 finally 随序号作废。 */
  function clear(): void {
    sequence++;
    rows.value = [];
    currentPage.value = 1;
    totalElements.value = 0;
    error.value = '';
    loading.value = false;
    filters = { ...initialFilters };
    lastRequest = { page: 1, size: pageSize.value, filters: { ...initialFilters } };
  }

  async function loadPage(page = currentPage.value, size = pageSize.value, snapshot = filters): Promise<void> {
    // 读取令牌可能同步推进身份版本，先完成同步再登记本次请求。
    const identity = crmAccessToken();
    const epoch = crmIdentityEpoch();
    const requestId = ++sequence;
    lastRequest = { page, size, filters: { ...snapshot } };
    const current = () => !disposed && requestId === sequence && epoch === crmIdentityEpoch() && identity === crmAccessToken();
    loading.value = true;
    error.value = '';
    try {
      let result = await fetchPage(page, size, { ...snapshot });
      if (!current()) return;
      const lastPage = Math.max(1, Math.ceil(result.total / size));
      if (page > lastPage) {
        result = await fetchPage(lastPage, size, { ...snapshot });
        if (!current()) return;
      }
      rows.value = result.items;
      currentPage.value = result.page;
      pageSize.value = result.pageSize;
      totalElements.value = result.total;
      filters = { ...snapshot };
    } catch (failure) {
      if (current()) error.value = failure instanceof Error ? failure.message : '加载失败';
    } finally {
      if (current()) loading.value = false;
    }
  }

  return {
    rows, currentPage, pageSize, totalElements, totalPages, loading, error,
    clear,
    search: (snapshot: F) => loadPage(1, pageSize.value, snapshot),
    refresh: () => loadPage(),
    changePage: (page: number) => loadPage(page),
    changePageSize: (size: number) => loadPage(1, size),
    retry: () => loadPage(lastRequest.page, lastRequest.size, lastRequest.filters)
  };
}
