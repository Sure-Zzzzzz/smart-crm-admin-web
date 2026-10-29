<template>
  <main class="page">
    <PageHeader
      title="交付"
      description="按交付项查看履约进度、承接方和交付结果；订单本身请到「订单」查看。"
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
      正在加载交付项…
    </p>

    <section
      v-else
      class="panel"
    >
      <h2>交付项 <span>{{ totalElements }}</span></h2>
      <div class="crm-filter-bar">
        <input
          v-model="keyword"
          type="search"
          placeholder="输入完整订单号"
          aria-label="搜索交付项"
          @keyup.enter="load"
        >
        <div class="crm-filter-select">
          <FormSelect
            v-model="stateFilter"
            :options="stateOptions"
            aria-label="交付状态"
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
        :rows="items"
        row-key="fulfillmentId"
        empty-text="没有匹配的交付项；报价确认成交后按能力生成交付任务"
      >
        <template #cell-fulfillment="{ row }">
          <span class="identity-cell">
            <span class="identity-main">交付项 {{ shortId(row.fulfillmentId, 'fulfillment-item-') }}</span>
            <span class="identity-code">{{ row.fulfillmentId }}</span>
          </span>
        </template>
        <template #cell-order="{ row }">
          <RouterLink
            class="identity-cell"
            :to="`/orders/${row.orderId}`"
            :title="row.orderId"
          >
            <span class="identity-main">订单 {{ shortId(row.orderId, 'order-') }}</span>
            <span class="identity-code">{{ row.orderId }}</span>
            <span class="identity-code">订单行 {{ row.orderLineId }}</span>
          </RouterLink>
        </template>
        <template #cell-consumer="{ row }">
          <span class="wrap-cell">{{ consumerLabel(row.assignedConsumerId) }}</span>
        </template>
        <template #cell-state="{ row }">
          <span
            class="status-badge"
            :class="stateClass(row.state)"
          >{{ stateLabel(row.state) }}</span>
        </template>
        <template #cell-result="{ row }">
          <FulfillmentResultDisplay :item="row" />
        </template>
        <template #cell-actions="{ row }">
          <FulfillmentResetAction
            :item="row"
            @completed="refresh"
          />
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
import FulfillmentResetAction from '../ui/FulfillmentResetAction.vue';
import FulfillmentResultDisplay from '../ui/FulfillmentResultDisplay.vue';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import FormSelect, { type FormSelectOption } from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import { pageFulfillmentItems, type CrmFulfillmentItem } from '../api/crmApi';
import {
  fulfillmentStateClass,
  fulfillmentStateLabel,
  consumerLabel as displayConsumerLabel,
  shortId
} from '../ui/crmDisplay';

const columns: DataTableColumn[] = [
  { key: 'fulfillment', label: '交付项', width: '20%' },
  { key: 'order', label: '所属订单 · 订单行', width: '22%' },
  { key: 'consumer', label: '交付负责方', width: '16%' },
  { key: 'state', label: '交付进度', width: '12%' },
  { key: 'result', label: '交付结果', width: '20%' },
  { key: 'actions', label: '操作', width: '10%', align: 'right' }
];
const stateOptions: FormSelectOption[] = [
  { label: '全部状态', value: '' },
  { label: '待执行', value: 'pending_dispatch' },
  { label: '执行中', value: 'in_progress' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' }
];
const stateFilter = ref('');
const keyword = ref('');

function stateLabel(state: string): string {
  return fulfillmentStateLabel(state);
}

function stateClass(state: string): string {
  return fulfillmentStateClass(state);
}

function consumerLabel(consumerId: string): string {
  return `${displayConsumerLabel(consumerId)}（${consumerId}）`;
}

function resetFilter(): void {
  stateFilter.value = '';
  keyword.value = '';
  void load();
}

const {
  rows: items, currentPage, pageSize, totalElements, loading, error,
  changePage, changePageSize, retry, search, refresh
} = useCrmPagination<CrmFulfillmentItem, { state?: string; orderId?: string }>((page, pageSize, filters) => pageFulfillmentItems({ page, pageSize, ...filters }), {});

function load(): Promise<void> {
  return search({ state: stateFilter.value || undefined, orderId: keyword.value.trim() || undefined });
}

onMounted(() => void load());
</script>
