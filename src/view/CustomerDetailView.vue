<template>
  <main class="page">
    <PageHeader
      :title="customer ? `客户详情 · ${customer.displayName}` : '客户详情'"
      description="客户档案与联系人。"
    >
      <template #actions>
        <RouterLink
          class="button-secondary"
          to="/customers"
        >
          返回客户列表
        </RouterLink>
      </template>
    </PageHeader>

    <div
      v-if="loading"
      class="loading-state"
      role="status"
    >
      正在加载客户…
    </div>
    <div
      v-else-if="error && !customer"
      class="admin-message error"
      role="alert"
    >
      {{ error }}
      <button
        class="button-secondary"
        type="button"
        @click="loadCustomer"
      >
        重试
      </button>
    </div>
    <template v-else-if="customer">
      <div
        v-if="error"
        class="admin-message error"
        role="alert"
      >
        {{ error }}
      </div>
      <section class="panel">
        <h2>基本信息</h2>
        <dl class="detail-list">
          <dt>名称</dt><dd>{{ customer.displayName }}</dd>
          <dt>状态</dt><dd>
            <span
              class="status-badge"
              :class="customer.state === 'active' ? 'success' : customer.state === 'merged' ? 'warning' : 'neutral'"
            >{{ customer.state === 'active' ? '正常' : customer.state === 'inactive' ? '已停用' : customer.state === 'merged' ? '已合并' : customer.state }}</span>
          </dd>
          <dt>归属</dt><dd>
            <span
              class="identity-cell"
              :title="customer.owner"
            ><span class="identity-main">{{ ownerLabel(customer.owner) }}</span><span class="identity-code">{{ customer.owner }}</span></span>
          </dd>
        </dl>
        <div
          v-if="customer.state !== 'merged'"
          class="admin-page-actions customer-govern-actions"
        >
          <button
            v-if="customer.state === 'active'"
            class="button-danger"
            :disabled="governBusy"
            @click="deactivateOpen = true"
          >
            停用客户
          </button>
          <button
            v-else
            class="button-secondary"
            :disabled="governBusy"
            @click="activate"
          >
            复启客户
          </button>
          <button
            class="button-danger"
            :disabled="governBusy"
            @click="openMerge"
          >
            合并到其他客户
          </button>
          <button
            class="button-secondary"
            :disabled="governBusy"
            @click="openTransfer"
          >
            转移归属
          </button>
        </div>
      </section>

      <section class="panel">
        <h2>联系人 <span>{{ totalElements }}</span></h2>
        <div class="crm-filter-bar">
          <div class="admin-page-actions">
            <button
              class="button-primary"
              type="button"
              :disabled="customer.state !== 'active' || creatingContact || governBusy"
              @click="openContact"
            >
              新建联系人
            </button>
          </div>
        </div>
        <p
          v-if="contactLoading && contacts.length === 0"
          class="loading-state"
          role="status"
        >
          正在加载联系人…
        </p>
        <DataTable
          v-else
          :columns="contactColumns"
          :rows="contacts"
          row-key="id"
          empty-text="暂无联系人"
        >
          <template #cell-title="{ row }">
            <span class="wrap-cell">{{ row.title || '未填写' }}</span>
          </template>
          <template #cell-customer="{ row }">
            <span :title="row.customerId">{{ row.customerId === customerId ? customer.displayName : '客户（名称未加载）' }}</span>
          </template>
          <template #cell-state="{ row }">
            <span
              class="status-badge"
              :class="row.state === 'active' ? 'success' : 'neutral'"
            >{{ row.state === 'active' ? '正常' : row.state }}</span>
          </template>
        </DataTable>
        <div
          v-if="contactError"
          class="admin-message error"
          role="alert"
        >
          {{ contactError }}
          <button
            class="button-secondary"
            type="button"
            @click="retryContacts"
          >
            重试联系人
          </button>
        </div>
        <Pagination
          v-if="totalElements"
          :current="currentPage"
          :total="totalElements"
          :page-size="pageSize"
          @update:current="changePage"
          @update:page-size="changePageSize"
        />
      </section>
    </template>

    <Drawer
      :open="contactOpen"
      title="新建联系人"
      description="联系人挂到当前客户名下，创建后立即出现在列表。"
      :pending="creatingContact"
      @close="contactOpen = false"
    >
      <form
        class="drawer-form"
        @submit.prevent="addContact"
      >
        <p
          v-if="contactCreateError"
          class="admin-message error"
          role="alert"
        >
          {{ contactCreateError }}
        </p>
        <label>姓名<input
          v-model="contactForm.displayName"
          aria-label="联系人姓名"
          placeholder="例如：王工"
          required
        ></label>
        <label>职务（可选）<input
          v-model="contactForm.title"
          aria-label="联系人职务"
          placeholder="例如：运维负责人"
        ></label>
        <div class="drawer-actions">
          <button
            class="button-secondary"
            type="button"
            :disabled="creatingContact"
            @click="contactOpen = false"
          >
            取消
          </button>
          <button
            class="button-primary"
            type="submit"
            :disabled="creatingContact"
          >
            {{ creatingContact ? '正在创建…' : '创建' }}
          </button>
        </div>
      </form>
    </Drawer>

    <Dialog
      :open="deactivateOpen"
      variant="danger"
      title="停用客户"
      :description="customer ? `确定停用「${customer.displayName}」？停用后不能新建报价，历史订单和审计记录仍会保留。` : ''"
      confirm-label="确认停用"
      :pending="governBusy"
      @close="deactivateOpen = false"
      @confirm="confirmDeactivate"
    />

    <Drawer
      :open="mergeOpen"
      title="合并客户"
      description="把当前客户并入目标客户：联系人、未完结报价与订单同事务改挂目标，当前客户置为已合并（终态，不可恢复）。"
      :pending="governBusy"
      @close="mergeOpen = false"
    >
      <form
        class="drawer-form"
        @submit.prevent="requestMerge"
      >
        <p
          v-if="governFormError"
          class="admin-message error"
          role="alert"
        >
          {{ governFormError }}
        </p>
        <label>目标客户
          <select
            v-model="mergeTargetId"
            required
            aria-label="目标客户"
          >
            <option
              value=""
              disabled
            >选择合并目标</option>
            <option
              v-for="c in mergeCandidates"
              :key="c.id"
              :value="c.id"
            >{{ c.displayName }}</option>
          </select>
        </label>
        <div class="drawer-actions">
          <button
            class="button-secondary"
            type="button"
            :disabled="governBusy"
            @click="mergeOpen = false"
          >
            取消
          </button>
          <button
            class="button-danger"
            type="submit"
            :disabled="governBusy"
          >
            核对合并
          </button>
        </div>
      </form>
    </Drawer>

    <Drawer
      :open="transferOpen"
      title="转移客户归属"
      description="把当前客户及其未完结报价移交给新归属（已确认历史不追改）。新归属须是 IAM 人员主体（iam:开头）。"
      :pending="governBusy"
      @close="transferOpen = false"
    >
      <form
        class="drawer-form"
        @submit.prevent="requestTransfer"
      >
        <p
          v-if="governFormError"
          class="admin-message error"
          role="alert"
        >
          {{ governFormError }}
        </p>
        <label>新归属（iam:xxx）<input
          v-model="transferOwner"
          aria-label="新归属"
          placeholder="例如：iam:operator-a"
          required
        ></label>
        <div class="drawer-actions">
          <button
            class="button-secondary"
            type="button"
            :disabled="governBusy"
            @click="transferOpen = false"
          >
            取消
          </button>
          <button
            class="button-danger"
            type="submit"
            :disabled="governBusy"
          >
            核对转移
          </button>
        </div>
      </form>
    </Drawer>

    <Dialog
      :open="mergeConfirmOpen"
      variant="danger"
      title="确认合并客户"
      :description="error || `确定将「${customer?.displayName ?? ''}」并入「${mergeCandidates.find(item => item.id === mergeTargetId)?.displayName ?? ''}」？当前客户将进入不可恢复的合并终态。`"
      confirm-label="确认合并"
      :pending="governBusy"
      @close="mergeConfirmOpen = false"
      @confirm="confirmMerge"
    />

    <Dialog
      :open="transferConfirmOpen"
      variant="danger"
      title="确认转移客户归属"
      :description="error || `确定将「${customer?.displayName ?? ''}」及未完结报价转交给 ${transferOwner.trim()}？已确认历史记录保持原归属。`"
      confirm-label="确认转移"
      :pending="governBusy"
      @close="transferConfirmOpen = false"
      @confirm="confirmTransfer"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { useCrmPagination } from '../ui/useCrmPagination';
import { loadCustomerDirectory } from '../ui/crmNames';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import { createContact, getCustomer, pageContacts, patchCustomer,
  type CrmContact, type CrmCustomer } from '../api/crmApi';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import { ownerLabel } from '../ui/crmDisplay';

const route = useRoute();
const customerId = computed(() => String(route.params.customerId));
const customer = ref<CrmCustomer | null>(null);
const {
  rows: contacts, currentPage, pageSize, totalElements, loading: contactLoading, error: contactError,
  changePage, changePageSize, retry: retryContacts, clear: clearContacts, refresh: loadContacts
} = useCrmPagination<CrmContact, Record<string, never>>(
  (page, pageSize) => pageContacts({ page, pageSize, customerId: customerId.value }), {}
);
const loading = ref(true);
const contactOpen = ref(false);
const creatingContact = ref(false);
const contactCreateError = ref('');
const contactForm = reactive({ displayName: '', title: '' });

function openContact(): void {
  contactCreateError.value = '';
  contactOpen.value = true;
}

async function addContact(): Promise<void> {
  if (creatingContact.value || governBusy.value) return;
  const name = contactForm.displayName.trim();
  contactCreateError.value = '';
  if (!name) {
    contactCreateError.value = '请填写联系人姓名';
    return;
  }
  creatingContact.value = true;
  error.value = '';
  try {
    await createContact({ idempotencyKey: crypto.randomUUID() }, customerId.value, name,
      contactForm.title.trim() || undefined);
    Object.assign(contactForm, { displayName: '', title: '' });
    contactOpen.value = false;
    await loadContacts();
  } catch (e) {
    contactCreateError.value = e instanceof Error ? e.message : '创建失败';
  } finally {
    creatingContact.value = false;
  }
}
const error = ref('');
const governBusy = ref(false);
const deactivateOpen = ref(false);
const mergeOpen = ref(false);
const mergeTargetId = ref('');
const mergeCandidates = ref<CrmCustomer[]>([]);
const transferOpen = ref(false);
const transferOwner = ref('');
const mergeConfirmOpen = ref(false);
const transferConfirmOpen = ref(false);
const governFormError = ref('');

function openMerge(): void {
  error.value = '';
  governFormError.value = '';
  mergeTargetId.value = '';
  mergeOpen.value = true;
}

function openTransfer(): void {
  error.value = '';
  governFormError.value = '';
  transferOwner.value = '';
  transferOpen.value = true;
}

function requestMerge(): void {
  governFormError.value = '';
  if (!mergeTargetId.value) {
    governFormError.value = '请选择合并目标客户';
    return;
  }
  mergeConfirmOpen.value = true;
}

function requestTransfer(): void {
  governFormError.value = '';
  if (!transferOwner.value.trim()) {
    governFormError.value = '请填写新归属';
    return;
  }
  transferConfirmOpen.value = true;
}

async function reloadCustomer(): Promise<void> {
  customer.value = await getCustomer(customerId.value);
}

async function runGovern(action: () => Promise<unknown>): Promise<void> {
  if (governBusy.value || creatingContact.value) return;
  governBusy.value = true;
  error.value = '';
  try {
    await action();
    await reloadCustomer();
    // 合并会移动联系人，治理成功后必须重新查询当前客户的联系人归属事实。
    await loadContacts();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    governBusy.value = false;
  }
}

async function confirmDeactivate(): Promise<void> {
  await runGovern(() => patchCustomer({ idempotencyKey: crypto.randomUUID() }, customerId.value,
    { state: 'inactive' }));
  if (!error.value) {
    deactivateOpen.value = false;
  }
}

function activate(): void {
  void runGovern(() => patchCustomer({ idempotencyKey: crypto.randomUUID() }, customerId.value,
      { state: 'active' }));
}

async function confirmMerge(): Promise<void> {
  const target = mergeTargetId.value;
  if (!target) {
    return;
  }
  await runGovern(() => patchCustomer({ idempotencyKey: crypto.randomUUID() }, customerId.value,
    { state: 'merged', mergeTargetId: target }));
  if (!error.value) {
    mergeConfirmOpen.value = false;
    mergeOpen.value = false;
  }
}

async function confirmTransfer(): Promise<void> {
  const owner = transferOwner.value.trim();
  if (!owner) {
    return;
  }
  await runGovern(() => patchCustomer({ idempotencyKey: crypto.randomUUID() }, customerId.value,
    { owner }));
  if (!error.value) {
    transferConfirmOpen.value = false;
    transferOpen.value = false;
    transferOwner.value = '';
  }
}

const contactColumns: DataTableColumn[] = [
  { key: 'displayName', label: '联系人', width: '30%' },
  { key: 'title', label: '职务', width: '30%' },
  { key: 'customer', label: '所属客户', width: '25%' },
  { key: 'state', label: '状态', width: '15%' }
];

let loadSequence = 0;
async function loadCustomer(): Promise<void> {
  const id = customerId.value;
  const sequence = ++loadSequence;
  const current = () => sequence === loadSequence && id === customerId.value;
  loading.value = true;
  error.value = '';
  customer.value = null;
  mergeCandidates.value = [];
  try {
    const [customerHit, , customerDirectory] = await Promise.all([
      getCustomer(id),
      loadContacts(),
      loadCustomerDirectory('active')
    ]);
    if (!current()) return;
    customer.value = customerHit;
    mergeCandidates.value = customerDirectory.filter(c => c.id !== id);
  } catch (e) {
    if (current()) error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    if (current()) loading.value = false;
  }
}

watch(customerId, () => {
  contactOpen.value = false;
  mergeOpen.value = false;
  transferOpen.value = false;
  deactivateOpen.value = false;
  mergeConfirmOpen.value = false;
  transferConfirmOpen.value = false;
  mergeTargetId.value = '';
  transferOwner.value = '';
  governFormError.value = '';
  clearContacts();
  void loadCustomer();
}, { immediate: true });
</script>
