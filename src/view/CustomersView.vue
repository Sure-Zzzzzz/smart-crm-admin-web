<template>
  <main class="page">
    <PageHeader
      title="客户"
      description="业务第一步：先为客户建档，报价与订单都挂在客户名下。"
    >
      <template #actions>
        <button
          class="button-primary"
          type="button"
          :disabled="loading || creating"
          @click="openCreate"
        >
          新建客户
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
      正在加载客户…
    </p>

    <section
      v-else
      class="panel"
    >
      <h2>客户列表 <span>{{ totalElements }}</span></h2>
      <div class="crm-filter-bar">
        <input
          v-model="keyword"
          type="search"
          placeholder="搜索客户名"
          aria-label="搜索客户"
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
        :rows="customers"
        row-key="id"
        empty-text="没有匹配的客户；可通过「新建客户」建立档案"
      >
        <template #cell-name="{ row }">
          <RouterLink
            :to="`/customers/${row.id}`"
            :title="row.id"
          >
            <span class="identity-cell">
              <span class="identity-main">{{ row.displayName }}</span>
              <span class="identity-code">{{ row.id }}</span>
            </span>
          </RouterLink>
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
        <template #cell-state="{ row }">
          <span
            class="status-badge"
            :class="row.state === 'active' ? 'success' : 'neutral'"
          >{{ row.state === 'active' ? '正常' : row.state }}</span>
        </template>
        <template #cell-actions="{ row }">
          <RouterLink
            class="table-action"
            :to="`/customers/${row.id}`"
          >
            查看详情
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

    <Drawer
      :open="createOpen"
      title="新建客户"
      description="客户是报价与订单的归属主体。"
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
        <label>客户名称<input
          v-model="newName"
          :aria-invalid="Boolean(createError)"
          placeholder="例如：某某科技有限公司"
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
            {{ creating ? '正在创建…' : '创建客户' }}
          </button>
        </div>
      </form>
    </Drawer>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useCrmPagination } from '../ui/useCrmPagination';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import { createCustomer, pageCustomers, type CrmCustomer } from '../api/crmApi';
import { ownerLabel } from '../ui/crmDisplay';

const columns: DataTableColumn[] = [
  { key: 'name', label: '客户', width: '42%' },
  { key: 'owner', label: '归属', width: '24%' },
  { key: 'state', label: '状态', width: '18%' },
  { key: 'actions', label: '操作', width: '16%', align: 'right' }
];
const createOpen = ref(false);
const keyword = ref('');

function resetFilter(): void {
  keyword.value = '';
  void load();
}
const creating = ref(false);
const newName = ref('');
const createError = ref('');

function openCreate(): void {
  createError.value = '';
  createOpen.value = true;
}

const {
  rows: customers, currentPage, pageSize, totalElements, loading, error,
  changePage, changePageSize, retry, search, refresh
} = useCrmPagination<CrmCustomer, { keyword?: string }>(
  (page, pageSize, filters) => pageCustomers({ page, pageSize, ...filters }), {}
);

function load(): Promise<void> {
  return search({ keyword: keyword.value.trim() || undefined });
}

async function createOne(): Promise<void> {
  if (creating.value) return;
  const displayName = newName.value.trim();
  if (!displayName) {
    createError.value = '请填写客户名称';
    return;
  }
  creating.value = true;
  createError.value = '';
  error.value = '';
  try {
    await createCustomer({ idempotencyKey: crypto.randomUUID() }, displayName);
    newName.value = '';
    createError.value = '';
    createOpen.value = false;
    await refresh();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '创建失败';
  } finally {
    creating.value = false;
  }
}

onMounted(() => void load());
</script>
