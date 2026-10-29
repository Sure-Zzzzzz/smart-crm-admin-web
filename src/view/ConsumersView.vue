<template>
  <main class="page">
    <PageHeader
      title="承接方"
      description="登记能够承接交付的系统；客户确认成交时按商品声明的交付能力匹配启用中的服务。"
    >
      <template #actions>
        <button
          class="button-primary"
          type="button"
          :disabled="loading || creating || toggling"
          @click="openCreate"
        >
          登记承接方
        </button>
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
      v-if="message"
      class="admin-message success"
      role="status"
    >
      {{ message }}
    </div>

    <div
      v-if="loading"
      class="loading-state"
      role="status"
    >
      正在加载…
    </div>

    <section
      v-else
      class="panel"
    >
      <h2>已登记承接方 <span>{{ totalElements }}</span></h2>
      <DataTable
        :columns="columns"
        :rows="consumers"
        row-key="consumerId"
        empty-text="尚未登记承接方"
      >
        <template #cell-enabled="{ row }">
          <span
            class="status-badge"
            :class="row.enabled ? 'success' : 'neutral'"
          >{{ row.enabled ? '启用中' : '已停用' }}</span>
        </template>
        <template #cell-consumerId="{ row }">
          <span
            class="identity-cell"
            :title="row.consumerId"
          >
            <span class="identity-main">{{ consumerDisplayName(row.consumerId) }}</span>
            <span class="identity-code">{{ row.consumerId }}</span>
          </span>
        </template>
        <template #cell-capability="{ row }">
          <span
            class="identity-cell"
            :title="row.capability"
          >
            <span class="identity-main">{{ capabilityLabel(row.capability) }}</span>
            <span class="identity-code">{{ row.capability }}</span>
          </span>
        </template>
        <template #cell-actions="{ row }">
          <button
            class="table-action"
            :class="{ danger: row.enabled }"
            :disabled="loading || creating || toggling"
            @click="toggleTarget = row"
          >
            {{ row.enabled ? '停用' : '启用' }}
          </button>
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

    <Drawer
      :open="createOpen"
      title="登记承接方"
      description="系统标识须与其 AKP clientId 一致（服务端校验）。"
      :pending="creating"
      @close="createOpen = false"
    >
      <form
        class="drawer-form"
        @submit.prevent="createOne"
      >
        <p
          v-if="createError"
          class="admin-message error"
          role="alert"
        >
          {{ createError }}
        </p>
        <label>系统标识<input
          v-model="newConsumerId"
          :aria-invalid="Boolean(createError)"
          placeholder="例如：capability-system-a"
          required
        ></label>
        <label>承接能力标识<input
          v-model="newCapability"
          :aria-invalid="Boolean(createError)"
          placeholder="例如：capability-a"
          required
        ></label>
        <div class="drawer-actions">
          <button
            class="button-secondary"
            type="button"
            :disabled="creating"
            @click="createOpen = false"
          >
            取消
          </button>
          <button
            class="button-primary"
            type="submit"
            :disabled="creating"
          >
            {{ creating ? '正在登记…' : '登记' }}
          </button>
        </div>
      </form>
    </Drawer>

    <Dialog
      :open="toggleTarget !== null"
      :variant="toggleTarget?.enabled ? 'danger' : 'confirm'"
      :title="toggleTarget && toggleTarget.enabled ? '停用承接方' : '启用承接方'"
      :description="toggleTarget ? `确定${toggleTarget.enabled ? '停用' : '启用'}「${toggleTarget.consumerId}」？${toggleTarget.enabled ? '停用后新成交的对应商品将无法生成交付。' : ''}` : ''"
      :confirm-label="toggleTarget && toggleTarget.enabled ? '确认停用' : '确认启用'"
      :pending="toggling"
      @close="toggleTarget = null"
      @confirm="confirmToggle"
    />
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { useCrmPagination } from '../ui/useCrmPagination';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import { pageConsumers, upsertFulfillmentConsumer, type CrmConsumer } from '../api/crmApi';
import { capabilityLabel, consumerLabel } from '../ui/crmDisplay';

const creating = ref(false);
const createOpen = ref(false);
const newConsumerId = ref('');
const newCapability = ref('');
const createError = ref('');
const toggleTarget = ref<CrmConsumer | null>(null);
const toggling = ref(false);
const message = ref('');

function openCreate(): void {
  createError.value = '';
  createOpen.value = true;
}

const columns: DataTableColumn[] = [
  { key: 'consumerId', label: '承接方', width: '30%' },
  { key: 'capability', label: '交付能力', width: '30%' },
  { key: 'enabled', label: '状态', width: '16%' },
  { key: 'actions', label: '操作', width: '14%', align: 'right' }
];

function consumerDisplayName(value: string): string {
  return consumerLabel(value);
}

const {
  rows: consumers, currentPage, pageSize, totalElements, loading, error,
  changePage, changePageSize, retry, refresh: load
} = useCrmPagination<CrmConsumer, Record<string, never>>(
  (page, pageSize) => pageConsumers({ page, pageSize }), {}
);

async function createOne(): Promise<void> {
  if (creating.value) return;
  const consumerId = newConsumerId.value.trim();
  const capability = newCapability.value.trim();
  if (!consumerId || !capability) {
    createError.value = '请填写系统标识和承接能力标识';
    return;
  }
  creating.value = true;
  createError.value = '';
  error.value = '';
  message.value = '';
  try {
    await upsertFulfillmentConsumer(
      { idempotencyKey: crypto.randomUUID() }, consumerId, capability, 1, true);
    message.value = `承接方 ${consumerId} 已登记启用`;
    newConsumerId.value = '';
    newCapability.value = '';
    createError.value = '';
    createOpen.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登记失败';
  } finally {
    creating.value = false;
  }
}

async function confirmToggle(): Promise<void> {
  if (!toggleTarget.value || toggling.value) {
    return;
  }
  toggling.value = true;
  error.value = '';
  try {
    await upsertFulfillmentConsumer(
      { idempotencyKey: crypto.randomUUID() }, toggleTarget.value.consumerId,
      toggleTarget.value.capability, toggleTarget.value.protocolVersion,
      !toggleTarget.value.enabled);
    toggleTarget.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    toggling.value = false;
  }
}

onMounted(() => void load());
</script>
