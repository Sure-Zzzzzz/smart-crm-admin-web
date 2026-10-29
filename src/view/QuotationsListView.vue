<template>
  <main class="page">
    <PageHeader
      title="报价单"
      description="给客户的价格承诺：草稿 → 签发生效 → 客户确认成交（生成订单）。"
    >
      <template #actions>
        <RouterLink
          class="button-primary"
          to="/quotations/new"
        >
          新建报价
        </RouterLink>
      </template>
    </PageHeader>

    <div
      v-if="error"
      class="admin-message error"
      role="alert"
    >
      {{ error }}
      <button
        class="button-secondary"
        type="button"
        :disabled="loading"
        @click="retry"
      >
        重试
      </button>
    </div>

    <div
      v-if="loading"
      class="loading-state"
      role="status"
    >
      正在加载报价…
    </div>

    <section
      v-else
      class="panel"
    >
      <h2>报价列表 <span>{{ totalElements }} 张</span></h2>
      <div class="crm-filter-bar">
        <input
          v-model="keyword"
          type="search"
          placeholder="搜索客户名 / 报价单号尾8位"
          aria-label="搜索报价"
          @keyup.enter="load"
        >
        <div class="crm-filter-select">
          <FormSelect
            v-model="stateFilter"
            :options="stateOptions"
            aria-label="报价状态"
            @change="load"
          />
        </div>
        <div class="admin-page-actions">
          <button
            class="button-primary"
            type="button"
            :disabled="loading"
            @click="load"
          >
            查询
          </button>
          <button
            class="button-secondary"
            type="button"
            :disabled="loading"
            @click="resetFilter"
          >
            重置
          </button>
        </div>
      </div>
      <DataTable
        :columns="columns"
        :rows="quotations"
        row-key="quotationId"
        empty-text="当前筛选下没有报价"
      >
        <template #cell-customer="{ row }">
          <RouterLink
            :to="`/quotations/${row.quotationId}`"
            :title="row.quotationId"
          >
            <span class="identity-cell">
              <span class="identity-main">{{ row.customerDisplayName }}</span>
              <span class="identity-code">{{ row.customerId }}</span>
            </span>
          </RouterLink>
        </template>
        <template #cell-quotationNo="{ row }">
          <span
            class="doc-no"
            :title="row.quotationId"
          >
            <span class="identity-main">报价 {{ shortId(row.quotationId, 'quotation-') }}</span>
            <span class="identity-code">{{ row.quotationId }}</span>
          </span>
        </template>
        <template #cell-opportunity="{ row }">
          <span
            v-if="row.opportunityId"
            class="identity-cell"
            :title="row.opportunityId"
          >
            <span class="identity-main">已关联商机</span>
            <span class="identity-code">{{ shortId(row.opportunityId, 'opportunity-') }}</span>
          </span>
          <span
            v-else
            class="muted"
          >直接报价</span>
        </template>
        <template #cell-lines="{ row }">
          <span class="wrap-cell">{{ lineSummary(row) }}</span>
        </template>
        <template #cell-total="{ row }">
          {{ totalOf(row) }}
        </template>
        <template #cell-state="{ row }">
          <span
            class="status-badge"
            :class="stateClass(row)"
          >{{ stateOf(row) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <RouterLink
            class="table-action"
            :to="`/quotations/${row.quotationId}`"
          >
            打开
          </RouterLink>
        </template>
      </DataTable>
      <Pagination
        v-if="totalElements"
        :current="currentPage"
        :total="totalElements"
        :page-size="pageSize"
        @update:current="changePage"
        @update:page-size="changePageSize"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useCrmPagination } from '../ui/useCrmPagination';
import { customerDisplayName } from '../ui/crmNames';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import FormSelect, { type FormSelectOption } from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import {
  CrmApiError,
  getQuotationVersion,
  getOffering,
  pageQuotations,
  type CrmQuotation,
  type CrmQuotationVersionView
} from '../api/crmApi';
import { formatQuantity, shortId } from '../ui/crmDisplay';

type QuotationRow = CrmQuotation & { customerDisplayName: string; lineSummary: string; total: string };

async function readVersion(quotation: CrmQuotation): Promise<{ detail: CrmQuotationVersionView | null; unavailable: string }> {
  try {
    return { detail: await getQuotationVersion(quotation.quotationId, quotation.currentVersion), unavailable: '' };
  } catch (failure) {
    if (failure instanceof CrmApiError && (failure.status === 403 || failure.status === 404)) {
      return { detail: null, unavailable: failure.status === 403 ? '报价明细（无权查看）' : '报价明细（不存在或无权查看）' };
    }
    throw failure;
  }
}

async function readOfferingName(offeringId: string): Promise<string> {
  try {
    return (await getOffering(offeringId)).displayName;
  } catch (failure) {
    if (failure instanceof CrmApiError && failure.status === 403) return '商品（无权查看）';
    if (failure instanceof CrmApiError && failure.status === 404) return '商品（已删除或无权查看）';
    throw failure;
  }
}

function lineSummary(quotation: QuotationRow): string { return quotation.lineSummary; }
function totalOf(quotation: QuotationRow): string { return quotation.total; }
const stateFilter = ref('');
const keyword = ref('');
const columns: DataTableColumn[] = [
  { key: 'customer', label: '客户', width: '16%' },
  { key: 'quotationNo', label: '报价单号', width: '16%', nowrap: true },
  { key: 'opportunity', label: '商机', width: '12%' },
  { key: 'lines', label: '商品', width: '20%' },
  { key: 'total', label: '合计', width: '14%' },
  { key: 'state', label: '状态', width: '10%' },
  { key: 'actions', label: '操作', width: '12%', align: 'right' }
];

const stateOptions: FormSelectOption[] = [
  { label: '全部状态', value: '' },
  { label: '草稿（可修改）', value: 'draft' },
  { label: '已签发，待客户确认', value: 'issued' },
  { label: '已成交', value: 'confirmed' },
  { label: '已撤回', value: 'withdrawn' },
  { label: '已被重议取代', value: 'superseded' },
  { label: '已过期', value: 'expired' }
];

function resetFilter(): void {
  stateFilter.value = '';
  keyword.value = '';
  void load();
}

/** 展示态优先用服务端派生 state（终态=版本行真相），旧响应缺字段时按聚合三档退化 */
const STATE_LABELS: Record<string, string> = {
  draft: '草稿',
  issued: '待客户确认',
  confirmed: '已成交',
  withdrawn: '已撤回',
  superseded: '已被重议取代',
  expired: '已过期'
};

function stateOf(quotation: CrmQuotation): string {
  if (quotation.state && STATE_LABELS[quotation.state]) {
    return STATE_LABELS[quotation.state];
  }
  if (quotation.confirmedOrderId) {
    return '已成交';
  }
  return quotation.currentConfirmableVersion ? '待客户确认' : '草稿';
}

function stateClass(quotation: CrmQuotation): string {
  if (quotation.state === 'confirmed') {
    return 'success';
  }
  if (quotation.state === 'withdrawn' || quotation.state === 'superseded' || quotation.state === 'expired') {
    return 'danger';
  }
  if (quotation.state === 'issued') {
    return 'warning';
  }
  return quotation.confirmedOrderId ? 'success' : quotation.currentConfirmableVersion ? 'warning' : 'neutral';
}

const {
  rows: quotations, currentPage, pageSize, totalElements, loading, error,
  changePage, changePageSize, retry, search
} = useCrmPagination<QuotationRow, { state?: string; keyword?: string }>(
  async (page, pageSize, filters) => {
    const result = await pageQuotations({ page, pageSize, ...filters });
    const items = await Promise.all(result.items.map(async quotation => {
      const [customer, version] = await Promise.all([
        customerDisplayName(quotation.customerId)
          .catch(() => `客户（${quotation.customerId}）`),
        readVersion(quotation)
      ]);
      const detail = version.detail;
      const summary = detail ? await Promise.all(detail.lines.map(async line => {
        return `${await readOfferingName(line.offeringId)} ×${formatQuantity(line.quantity)}`;
      })) : [];
      return { ...quotation, customerDisplayName: customer, lineSummary: version.unavailable || summary.join('；') || '—',
        total: detail ? `${detail.totalAmount.amount} ${detail.totalAmount.currency}` : version.unavailable };
    }));
    return { ...result, items };
  }, {}
);

function load(): Promise<void> {
  return search({ state: stateFilter.value || undefined, keyword: keyword.value.trim() || undefined });
}

onMounted(() => void load());
</script>
