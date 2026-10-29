<template>
  <main class="page">
    <PageHeader
      title="审计记录"
      description="全程审计事实：谁在什么时候对哪个对象做了什么。按资源号可精确追溯。"
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

    <div
      v-if="loading && records.length === 0"
      class="loading-state"
      role="status"
    >
      正在加载…
    </div>

    <section
      v-else
      class="panel"
    >
      <h2>审计记录 <span>{{ totalElements }}</span></h2>
      <div class="crm-filter-bar">
        <input
          v-model="targetResourceId"
          type="search"
          placeholder="按资源号过滤（客户/报价/订单/交付项 ID）"
          aria-label="按资源号过滤"
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
        :rows="records"
        row-key="rowKey"
        empty-text="没有匹配的审计记录"
      >
        <template #cell-action="{ row }">
          <span class="status-badge neutral">{{ actionLabel(row.action) }}</span>
        </template>
        <template #cell-owner="{ row }">
          <span
            class="identity-cell"
            :title="row.owner"
          >
            <span class="identity-main">{{ ownerLabel(row.owner) }}</span>
            <span class="identity-code">{{ row.owner }}</span>
          </span>
        </template>
        <template #cell-targetResourceType="{ row }">
          {{ resourceTypeLabel(row.targetResourceType) }}
        </template>
        <template #cell-targetResourceId="{ row }">
          <span
            class="identity-cell"
            :title="row.targetResourceId"
          >
            <span class="identity-main">{{ resourceTypeLabel(row.targetResourceType) }} {{ shortId(row.targetResourceId) }}</span>
            <span class="identity-code">{{ row.targetResourceId }}</span>
          </span>
        </template>
        <template #cell-resultCode="{ row }">
          <span
            class="status-badge"
            :class="row.resultCode ? 'danger' : 'success'"
          >{{ resultLabel(row.resultCode) }}</span>
        </template>
        <template #cell-occurredAt="{ row }">
          {{ formatTime(row.occurredAt) }}
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
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { pageOperationLogs, type CrmOperationLog } from '../api/crmApi';
import { ownerLabel, resourceTypeLabel, resultLabel, shortId } from '../ui/crmDisplay';

type AuditRow = CrmOperationLog & { rowKey: string };
const targetResourceId = ref('');


const columns: DataTableColumn[] = [
  { key: 'occurredAt', label: '时间', width: '16%', nowrap: true },
  { key: 'action', label: '动作', width: '15%' },
  { key: 'owner', label: '操作者', width: '16%' },
  { key: 'targetResourceType', label: '对象类型', width: '11%' },
  { key: 'targetResourceId', label: '对象', width: '24%' },
  { key: 'resultCode', label: '结果', width: '10%' }
];

const ACTION_LABELS: Record<string, string> = {
  customer_create: '建档', customer_deactivate: '停用', customer_activate: '复启',
  customer_merge: '合并', customer_transfer: '转移',
  contact_create: '加联系人',
  offering_create: '录商品', offering_publish: '上架', offering_disable: '下架',
  opportunity_create: '建商机', opportunity_stage: '推进商机', opportunity_transfer: '转商机',
  quotation_create: '建报价', quotation_edit: '改报价', quotation_issue: '签发',
  quotation_confirm: '确认成交', quotation_withdraw: '撤回', quotation_renegotiate: '重议',
  quotation_transfer: '转报价',
  fulfillment_report: '交付回写', fulfillment_reset: '交付重置',
  fulfillment_consumer_admin: '登记承接方'
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function formatTime(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(0, 19) : '';
}

function resetFilter(): void {
  targetResourceId.value = '';
  void load();
}

const {
  rows: records, currentPage, pageSize, totalElements, loading, error,
  changePage, changePageSize, retry, search
} = useCrmPagination<AuditRow, { resourceId?: string }>(
  async (page, pageSize, filters) => {
    const result = await pageOperationLogs({ page, pageSize, ...filters });
    return { ...result, items: result.items.map((record, index) => ({
      ...record, rowKey: `${record.occurredAt}:${record.action}:${record.targetResourceId}:${page}:${index}`
    })) };
  }, {}
);

function load(): Promise<void> {
  return search({ resourceId: targetResourceId.value.trim() || undefined });
}

onMounted(() => void load());
</script>
