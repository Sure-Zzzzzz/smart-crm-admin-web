<template>
  <main class="page">
    <PageHeader
      title="团队共享"
      description="查看当前身份获准访问的客户与报价；数据范围由 IAM 授权决定。"
    />
    <p
      v-if="customerLoading"
      class="loading-state"
      role="status"
    >
      正在加载客户…
    </p>
    <section
      v-else
      class="panel"
    >
      <h2>客户 <span>{{ customerTotal }}</span></h2>
      <div
        v-if="customerError && !customers.length"
        class="admin-empty-state"
        role="alert"
      >
        <h3>客户暂时无法加载</h3>
        <p>{{ customerError }}</p>
        <button
          class="button-secondary"
          type="button"
          :disabled="customerLoading"
          @click="loadCustomers"
        >
          {{ customerLoading ? '正在重试…' : '重试客户' }}
        </button>
      </div>
      <template v-else>
        <div
          v-if="customerError"
          class="admin-message error"
          role="alert"
        >
          {{ customerError }}
          <button
            class="button-secondary"
            type="button"
            :disabled="customerLoading"
            @click="loadCustomers"
          >
            {{ customerLoading ? '正在重试…' : '重试客户' }}
          </button>
        </div>
        <DataTable
          :columns="customerColumns"
          :rows="customers"
          row-key="id"
          empty-text="暂无客户"
        >
          <template #cell-state="{ row }">
            <span
              class="status-badge"
              :class="row.state === 'active' ? 'success' : 'neutral'"
            >{{ row.state === 'active' ? '正常' : row.state }}</span>
          </template>
        </DataTable>
        <Pagination
          v-if="customerTotal"
          :current="customerPage"
          :total="customerTotal"
          :page-size="customerPageSize"
          @update:current="customerChangePage"
          @update:page-size="customerChangeSize"
        />
      </template>
    </section>

    <p
      v-if="quotationLoading"
      class="loading-state"
      role="status"
    >
      正在加载报价…
    </p>
    <section
      v-else
      class="panel"
    >
      <h2>报价 <span>{{ quotationTotal }}</span></h2>
      <div
        v-if="quotationError && !quotations.length"
        class="admin-empty-state"
        role="alert"
      >
        <h3>报价暂时无法加载</h3>
        <p>{{ quotationError }}</p>
        <button
          class="button-secondary"
          type="button"
          :disabled="quotationLoading"
          @click="loadQuotations"
        >
          {{ quotationLoading ? '正在重试…' : '重试报价' }}
        </button>
      </div>
      <template v-else>
        <div
          v-if="quotationError"
          class="admin-message error"
          role="alert"
        >
          {{ quotationError }}
          <button
            class="button-secondary"
            type="button"
            :disabled="quotationLoading"
            @click="loadQuotations"
          >
            {{ quotationLoading ? '正在重试…' : '重试报价' }}
          </button>
        </div>
        <DataTable
          :columns="quotationColumns"
          :rows="quotations"
          row-key="quotationId"
          empty-text="暂无报价"
        >
          <template #cell-customer="{ row }">
            {{ row.customerDisplayName }}
          </template>
          <template #cell-state="{ row }">
            <span
              class="status-badge"
              :class="quotationStateClass(row)"
            >{{ quotationStateLabel(row) }}</span>
          </template>
        </DataTable>
        <Pagination
          v-if="quotationTotal"
          :current="quotationPage"
          :total="quotationTotal"
          :page-size="quotationPageSize"
          @update:current="quotationChangePage"
          @update:page-size="quotationChangeSize"
        />
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { pageCustomers, pageQuotations, type CrmCustomer, type CrmQuotation } from '../api/crmApi';
import { useCrmPagination } from '../ui/useCrmPagination';
import { customerDisplayName } from '../ui/crmNames';

const QUOTATION_STATE_LABELS: Record<string, string> = {
  draft: '草稿',
  issued: '待客户确认',
  confirmed: '已成交',
  withdrawn: '已撤回',
  superseded: '已被重议取代',
  expired: '已过期'
};

function quotationStateLabel(row: CrmQuotation): string {
  if (row.state && QUOTATION_STATE_LABELS[row.state]) return QUOTATION_STATE_LABELS[row.state];
  if (row.confirmedOrderId) return '已成交';
  return row.currentConfirmableVersion ? '待客户确认' : '草稿';
}

function quotationStateClass(row: CrmQuotation): string {
  if (row.state === 'withdrawn' || row.state === 'superseded' || row.state === 'expired') return 'danger';
  if (row.state === 'confirmed' || row.confirmedOrderId) return 'success';
  if (row.state === 'issued' || row.currentConfirmableVersion) return 'warning';
  return 'neutral';
}

const {
  rows: customers, currentPage: customerPage, pageSize: customerPageSize, totalElements: customerTotal,
  loading: customerLoading, error: customerError, changePage: customerChangePage, changePageSize: customerChangeSize, refresh: loadCustomers
} = useCrmPagination<CrmCustomer, Record<string, never>>(
  (page, pageSize) => pageCustomers({ page, pageSize }), {}
);
const {
  rows: quotations, currentPage: quotationPage, pageSize: quotationPageSize, totalElements: quotationTotal,
  loading: quotationLoading, error: quotationError, changePage: quotationChangePage, changePageSize: quotationChangeSize, refresh: loadQuotations
} = useCrmPagination<CrmQuotation & { customerDisplayName: string }, Record<string, never>>(
  async (page, pageSize) => {
    const result = await pageQuotations({ page, pageSize });
    const items = await Promise.all(result.items.map(async row => ({
      ...row,
      // 客户名称只是展示富化，不能让名称点查故障遮住报价事实与状态。
      customerDisplayName: await customerDisplayName(row.customerId)
        .catch(() => `客户（${row.customerId}）`)
    })));
    return { ...result, items };
  }, {}
);
const customerColumns: DataTableColumn[] = [
  { key: 'displayName', label: '客户', width: '60%' },
  { key: 'state', label: '状态', width: '40%' }
];
const quotationColumns: DataTableColumn[] = [
  { key: 'customer', label: '客户', width: '64%' },
  { key: 'state', label: '状态', width: '36%' }
];
onMounted(() => { void loadCustomers(); void loadQuotations(); });
</script>
