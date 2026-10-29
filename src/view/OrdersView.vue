<template>
  <main class="page">
    <PageHeader
      title="订单"
      description="客户确认成交后生成正式订单；订单记录商业承诺，具体执行进度请到「交付」查看。"
    />

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

    <p
      v-if="loading"
      class="loading-state"
      role="status"
    >
      正在加载订单…
    </p>

    <section
      v-else
      class="panel"
    >
      <h2>订单列表 <span>{{ totalElements }}</span></h2>
      <div class="crm-filter-bar">
        <input
          v-model="keyword"
          type="search"
          placeholder="搜索订单号"
          aria-label="搜索订单"
          @keyup.enter="load"
        >
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
        :rows="orders"
        row-key="orderId"
        empty-text="没有匹配的订单；报价确认成交后自动生成订单"
      >
        <template #cell-orderId="{ row }">
          <RouterLink
            class="identity-cell"
            :to="`/orders/${row.orderId}`"
            :title="row.orderId"
          >
            <span class="identity-main">订单 {{ shortId(row.orderId, 'order-') }}</span>
            <span class="identity-code">{{ row.orderId }}</span>
          </RouterLink>
        </template>
        <template #cell-customerId="{ row }">
          <span
            class="identity-cell"
            :title="row.customerId"
          >
            <span class="identity-main">{{ row.customerDisplayName }}</span>
            <span class="identity-code">{{ row.customerId }}</span>
          </span>
        </template>
        <template #cell-total="{ row }">
          {{ row.totalAmount.amount }} {{ row.totalAmount.currency }}
        </template>
        <template #cell-displayState="{ row }">
          <span
            class="status-badge"
            :class="orderStateClass(row.displayState)"
          >
            {{ orderStateLabel(row.displayState) }}
          </span>
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
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { useCrmPagination } from '../ui/useCrmPagination';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import { pageOrders, type CrmOrder } from '../api/crmApi';
import { customerDisplayName } from '../ui/crmNames';
import { orderStateClass, orderStateLabel, shortId } from '../ui/crmDisplay';

const columns: DataTableColumn[] = [
  { key: 'orderId', label: '订单号', width: '34%', nowrap: true },
  { key: 'customerId', label: '客户', width: '30%' },
  { key: 'total', label: '合计', width: '20%' },
  { key: 'displayState', label: '状态', width: '16%' }
];
const keyword = ref('');

function resetFilter(): void {
  keyword.value = '';
  void load();
}

type OrderRow = CrmOrder & { customerDisplayName: string };
const {
  rows: orders, currentPage, pageSize, totalElements, loading, error,
  changePage, changePageSize, retry, search
} = useCrmPagination<OrderRow, { keyword?: string }>(async (page, pageSize, filters) => {
    const result = await pageOrders({ page, pageSize, ...filters });
    const names = new Map(await Promise.all([...new Set(result.items.map(item => item.customerId))]
      .map(async id => [id, await customerDisplayName(id)] as const)));
    return { ...result, items: result.items.map(item => ({ ...item, customerDisplayName: names.get(item.customerId) ?? '客户' })) };
  }, {});

function load(): Promise<void> {
  return search({ keyword: keyword.value.trim() || undefined });
}

onMounted(() => void load());
</script>
