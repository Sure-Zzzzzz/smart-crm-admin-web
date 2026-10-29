<template>
  <main class="page">
    <PageHeader
      title="商品目录"
      description="可对外报价的商品或服务：录入后「上架」才可被选进报价行项。"
    >
      <template #actions>
        <button
          class="button-primary"
          type="button"
          :disabled="loading || creating || publishing || busyDisabling"
          @click="openCreate"
        >
          新建商品
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

    <p
      v-if="loading"
      class="loading-state"
      role="status"
    >
      正在加载目录…
    </p>

    <section
      v-else
      class="panel"
    >
      <h2>商品列表 <span>{{ totalElements }}</span></h2>
      <div class="crm-filter-bar">
        <input
          v-model="keyword"
          type="search"
          placeholder="搜索商品名"
          aria-label="搜索商品"
          @keyup.enter="load"
        >
        <div class="crm-filter-select">
          <FormSelect
            v-model="stateFilter"
            :options="stateOptions"
            aria-label="商品状态"
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
        :rows="offerings"
        row-key="id"
        empty-text="没有匹配的商品；可通过「新建商品」录入目录"
      >
        <template #cell-name="{ row }">
          <span
            class="identity-cell"
            :title="row.id"
          >
            <span class="identity-main">{{ row.displayName }}</span>
            <span class="identity-code">{{ row.offeringReference || '商品引用未返回' }}</span>
          </span>
        </template>
        <template #cell-capability="{ row }">
          <span
            class="identity-cell"
            :title="row.requiredConsumerCapability"
          >
            <span class="identity-main">{{ capabilityLabel(row.requiredConsumerCapability) }}</span>
            <span class="identity-code">{{ row.requiredConsumerCapability || '未声明' }}</span>
          </span>
        </template>
        <template #cell-state="{ row }">
          <span
            class="status-badge"
            :class="stateClass(row.state)"
          >{{ stateLabel(row.state) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <button
            v-if="row.state === 'draft' || row.state === 'disabled'"
            class="table-action"
            :disabled="loading || creating || publishing || busyDisabling"
            @click="publishTarget = row"
          >
            上架
          </button>
          <button
            v-else-if="row.state === 'published'"
            class="table-action danger"
            :disabled="loading || creating || publishing || busyDisabling"
            @click="disableTarget = row"
          >
            下架
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
      title="新建商品"
      description="商品进入报价行项前需先上架。"
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
        <label>商品名称<input
          v-model="newOffering.displayName"
          aria-label="商品名称"
          placeholder="例如：软件授权（一年期）"
          required
        ></label>
        <label>商品业务引用<input
          v-model="newOffering.offeringReference"
          aria-label="商品业务引用"
          placeholder="填写产品或服务目录中的稳定编号"
          required
        ><span class="field-hint">用于对接履约方的商品或服务，不随展示名称生成。</span></label>
        <label>承接能力标识<input
          v-model="newOffering.requiredConsumerCapability"
          aria-label="承接能力标识"
          placeholder="承接能力标识，须与承接服务声明一致"
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
            {{ creating ? '正在创建…' : '创建商品' }}
          </button>
        </div>
      </form>
    </Drawer>

    <Dialog
      :open="publishTarget !== null"
      title="上架商品"
      :description="publishTarget ? `确定上架「${publishTarget.displayName}」？上架后该商品会出现在新建报价的可选商品中。` : ''"
      confirm-label="确认上架"
      :pending="publishing"
      @close="publishTarget = null"
      @confirm="confirmPublish"
    />

    <Dialog
      :open="disableTarget !== null"
      variant="danger"
      title="下架商品"
      :description="disableTarget ? `确定下架「${disableTarget.displayName}」？下架后不能再进入新报价，历史报价不受影响。` : ''"
      confirm-label="确认下架"
      :pending="busyDisabling"
      @close="disableTarget = null"
      @confirm="confirmDisable"
    />
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useCrmPagination } from '../ui/useCrmPagination';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import FormSelect, { type FormSelectOption } from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import {
  createOffering,

  pageOfferings,
  patchOffering,
  type CrmOffering
} from '../api/crmApi';
import { capabilityLabel } from '../ui/crmDisplay';

const columns: DataTableColumn[] = [
  { key: 'name', label: '商品', width: '34%' },
  { key: 'capability', label: '交付能力', width: '28%' },
  { key: 'state', label: '状态', width: '18%' },
  { key: 'actions', label: '操作', width: '16%', align: 'right' }
];
const stateFilter = ref('');
const keyword = ref('');
const createOpen = ref(false);
const disableTarget = ref<CrmOffering | null>(null);
const publishTarget = ref<CrmOffering | null>(null);
const publishing = ref(false);
const busyDisabling = ref(false);
const creating = ref(false);
const createError = ref('');
// 业务引用和能力标识由录入者声明，不从名称推导或预填其他业务的默认值。
const newOffering = reactive({ displayName: '', offeringReference: '', requiredConsumerCapability: '' });

const stateOptions: FormSelectOption[] = [
  { label: '全部状态', value: '' },
  { label: '录入（未上架）', value: 'draft' },
  { label: '可售', value: 'published' },
  { label: '已下架', value: 'disabled' }
];

function stateLabel(state: string): string {
  if (state === 'draft') {
    return '录入';
  }
  if (state === 'published') {
    return '可售';
  }
  return '下架';
}

function stateClass(state: string): string {
  if (state === 'published') {
    return 'success';
  }
  if (state === 'disabled') {
    return 'warning';
  }
  return 'neutral';
}

function resetFilter(): void {
  stateFilter.value = '';
  keyword.value = '';
  void load();
}

function openCreate(): void {
  createError.value = '';
  createOpen.value = true;
}

const {
  rows: offerings, currentPage, pageSize, totalElements, loading, error,
  changePage, changePageSize, retry, search, refresh
} = useCrmPagination<CrmOffering, { keyword?: string; state?: string }>(
  (page, pageSize, filters) => pageOfferings({ page, pageSize, ...filters }), {}
);

function load(): Promise<void> {
  return search({ keyword: keyword.value.trim() || undefined, state: stateFilter.value || undefined });
}

async function confirmPublish(): Promise<void> {
  if (!publishTarget.value || publishing.value || busyDisabling.value || creating.value) {
    return;
  }
  publishing.value = true;
  error.value = '';
  try {
    await patchOffering(
      { idempotencyKey: crypto.randomUUID() }, publishTarget.value.id, { state: 'published' });
    publishTarget.value = null;
    await refresh();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '上架失败';
  } finally {
    publishing.value = false;
  }
}

async function confirmDisable(): Promise<void> {
  if (!disableTarget.value || publishing.value || busyDisabling.value || creating.value) {
    return;
  }
  busyDisabling.value = true;
  error.value = '';
  try {
    await patchOffering(
      { idempotencyKey: crypto.randomUUID() }, disableTarget.value.id,
      { state: 'disabled' });
    disableTarget.value = null;
    await refresh();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '下架失败';
  } finally {
    busyDisabling.value = false;
  }
}

async function createOne(): Promise<void> {
  if (creating.value || publishing.value || busyDisabling.value) return;
  const displayName = newOffering.displayName.trim();
  const offeringReference = newOffering.offeringReference.trim();
  const capability = newOffering.requiredConsumerCapability.trim();
  createError.value = '';
  if (!displayName || !offeringReference || !capability) {
    createError.value = !displayName ? '请填写商品名称'
      : !offeringReference ? '请填写商品业务引用' : '请填写承接能力标识';
    return;
  }
  creating.value = true;
  error.value = '';
  try {
    await createOffering(
      { idempotencyKey: crypto.randomUUID() },
      offeringReference,
      displayName,
      capability
    );
    Object.assign(newOffering, { displayName: '', offeringReference: '', requiredConsumerCapability: '' });
    createOpen.value = false;
    await refresh();
  } catch (e) {
    createError.value = e instanceof Error ? e.message : '创建失败';
  } finally {
    creating.value = false;
  }
}

onMounted(() => void load());
</script>
