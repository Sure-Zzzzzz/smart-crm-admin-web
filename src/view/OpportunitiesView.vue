<template>
  <main class="page">
    <PageHeader
      title="商机"
      description="客户建档后的销售机会：从新建推进到报价，成交由报价确认自动派生。"
    >
      <template #actions>
        <button
          class="button-primary"
          type="button"
          :disabled="loading || creating || customerLoading || Boolean(customerLoadError)"
          @click="openCreate"
        >
          新建商机
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
      v-if="customerLoadError"
      class="admin-message error"
      role="alert"
    >
      {{ customerLoadError }}
      <button
        class="button-secondary"
        type="button"
        :disabled="customerLoading"
        @click="loadCustomers"
      >
        {{ customerLoading ? '正在重试…' : '重试客户目录' }}
      </button>
    </div>

    <p
      v-if="loading"
      class="loading-state"
      role="status"
    >
      正在加载商机…
    </p>

    <section
      v-else
      class="panel"
    >
      <h2>商机列表 <span>{{ totalElements }} 条</span></h2>
      <div class="crm-filter-bar">
        <input
          v-model="keyword"
          type="search"
          placeholder="搜索商机标题"
          aria-label="搜索商机"
          @keyup.enter="load"
        >
        <div class="crm-filter-select">
          <FormSelect
            v-model="stageFilter"
            :options="stageOptions"
            aria-label="商机阶段"
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
        :rows="opportunities"
        row-key="opportunityId"
        empty-text="当前筛选下没有商机；可先为客户建档，再新建商机"
      >
        <template #cell-title="{ row }">
          <RouterLink
            class="identity-cell"
            :to="`/opportunities/${row.opportunityId}`"
            :title="row.opportunityId"
          >
            <span class="identity-main">{{ row.title }}</span>
            <span class="identity-code">{{ shortId(row.opportunityId, 'opportunity-') }}</span>
          </RouterLink>
        </template>
        <template #cell-customer="{ row }">
          <RouterLink
            :to="`/customers/${row.customerId}`"
            class="identity-cell"
          >
            <span class="identity-main">{{ customerName(row.customerId) }}</span>
            <span class="identity-code">{{ row.customerId }}</span>
          </RouterLink>
        </template>
        <template #cell-stage="{ row }">
          <span
            class="status-badge"
            :class="stageClass(row.stage)"
          >{{ stageLabel(row.stage) }}</span>
          <span
            v-if="row.lostReason"
            class="identity-code"
          >输单：{{ row.lostReason }}</span>
        </template>
        <template #cell-amount="{ row }">
          {{ amountLabel(row) }}
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
        <template #cell-actions="{ row }">
          <template v-if="!isTerminal(row.stage)">
            <button
              class="table-action"
              type="button"
              @click="openTransition(row)"
            >
              推进阶段
            </button>
            <button
              class="table-action"
              type="button"
              @click="openTransfer(row)"
            >
              转移归属
            </button>
          </template>
          <span
            v-else
            class="muted"
          >已结束</span>
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
      title="新建商机"
      description="商机必须归属已建档客户；确认报价成交后，商机自动进入已赢单。"
      :pending="creating"
      @close="createOpen = false"
    >
      <form
        class="drawer-form"
        @submit.prevent="createOne"
      >
        <label>客户（必选）
          <FormSelect
            v-model="newOpportunity.customerId"
            :options="customerOptions"
            aria-label="商机客户"
            placeholder="选择建档客户"
          />
        </label>
        <label>商机标题（必填）
          <input
            v-model="newOpportunity.title"
            aria-label="商机标题"
            placeholder="例如：年度授权项目"
          >
        </label>
        <label>预计成交日期
          <input
            v-model="newOpportunity.expectedCloseDate"
            aria-label="预计成交日期"
            type="date"
          >
        </label>
        <div class="form-grid">
          <label>预计金额
            <input
              v-model="newOpportunity.estimatedAmount"
              aria-label="预计金额"
              inputmode="decimal"
              placeholder="可选"
            >
          </label>
          <label>币种
            <input
              v-model="newOpportunity.currency"
              aria-label="预计金额币种"
              maxlength="3"
              placeholder="CNY"
            >
          </label>
        </div>
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
            {{ creating ? '正在创建…' : '创建商机' }}
          </button>
        </div>
      </form>
    </Drawer>

    <Drawer
      :open="transitionOpen"
      title="推进商机阶段"
      :description="transitionTarget ? `${transitionTarget.title} 当前为${stageLabel(transitionTarget.stage)}。已赢单由报价确认派生，不能人工选择。` : ''"
      :pending="transitioning"
      @close="transitionOpen = false"
    >
      <form
        class="drawer-form"
        @submit.prevent="transitionOne"
      >
        <label>目标阶段
          <FormSelect
            v-model="transitionStage"
            :options="transitionOptions"
            aria-label="目标阶段"
          />
        </label>
        <label v-if="transitionStage === 'lost'">输单原因（必填）
          <textarea
            v-model="lostReason"
            aria-label="输单原因"
            rows="3"
            placeholder="填写本次输单的业务原因"
          />
        </label>
        <p
          v-if="transitionStage === 'won'"
          class="field-hint"
        >
          已赢单只能由关联报价确认成交自动推进。
        </p>
        <div class="drawer-actions">
          <button
            class="button-secondary"
            type="button"
            :disabled="transitioning"
            @click="transitionOpen = false"
          >
            取消
          </button>
          <button
            class="button-primary"
            type="submit"
            :disabled="transitioning || transitionStage === 'won'"
          >
            {{ transitioning ? '正在保存…' : '保存阶段' }}
          </button>
        </div>
      </form>
    </Drawer>

    <Drawer
      :open="transferOpen"
      title="转移商机归属"
      description="新归属必须是 IAM 人员或 AKSK 服务主体（iam: 或 aksk: 开头）；商机的客户数据范围仍由服务端统一校验。"
      :pending="transferring"
      @close="transferOpen = false"
    >
      <form
        class="drawer-form"
        @submit.prevent="transferOne"
      >
        <label>新归属
          <input
            v-model="transferOwner"
            aria-label="商机新归属"
            placeholder="例如：iam:operator-a 或 aksk:crm-worker"
            required
          >
        </label>
        <div class="drawer-actions">
          <button
            class="button-secondary"
            type="button"
            :disabled="transferring"
            @click="transferOpen = false"
          >
            取消
          </button>
          <button
            class="button-primary"
            type="submit"
            :disabled="transferring"
          >
            {{ transferring ? '正在保存…' : '确认转移' }}
          </button>
        </div>
      </form>
    </Drawer>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import FormSelect, { type FormSelectOption } from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import { useCrmPagination } from '../ui/useCrmPagination';
import { loadCustomerDirectory } from '../ui/crmNames';
import { ownerLabel, shortId } from '../ui/crmDisplay';
import {
  type CrmOpportunityStage,
  createOpportunity,
  pageOpportunities,
  transitionOpportunity,
  transferOpportunity,
  type CrmCustomer,
  type CrmOpportunity,
  type CreateOpportunityInput
} from '../api/crmApi';

const columns: DataTableColumn[] = [
  { key: 'title', label: '商机', width: '24%' },
  { key: 'customer', label: '客户', width: '20%' },
  { key: 'stage', label: '阶段', width: '16%' },
  { key: 'amount', label: '预计金额', width: '14%' },
  { key: 'owner', label: '归属', width: '14%' },
  { key: 'actions', label: '操作', width: '12%', align: 'right' }
];

const stageLabels: Record<string, string> = {
  new: '新建', qualified: '已确认', proposal: '方案中', negotiation: '谈判中', won: '已赢单', lost: '已输单'
};
const stageOptions: FormSelectOption[] = [
  { label: '全部阶段', value: '' },
  { label: '新建', value: 'new' },
  { label: '已确认', value: 'qualified' },
  { label: '方案中', value: 'proposal' },
  { label: '谈判中', value: 'negotiation' },
  { label: '已赢单', value: 'won' },
  { label: '已输单', value: 'lost' }
];
const transitionOptions = computed<FormSelectOption[]>(() => {
  const nextStages: Record<string, string[]> = {
    new: ['qualified', 'lost'],
    qualified: ['proposal', 'lost'],
    proposal: ['negotiation', 'lost'],
    negotiation: ['lost']
  };
  return (nextStages[transitionTarget.value?.stage ?? ''] ?? [])
    .map(value => ({ label: stageLabels[value], value }));
});
const stageFilter = ref('');
const keyword = ref('');
const customers = ref<CrmCustomer[]>([]);
const customerLoading = ref(false);
const customerLoadError = ref('');
const createOpen = ref(false);
const creating = ref(false);
const transitionOpen = ref(false);
const transitioning = ref(false);
const transferOpen = ref(false);
const transferring = ref(false);
const transitionTarget = ref<CrmOpportunity | null>(null);
const transferTarget = ref<CrmOpportunity | null>(null);
const transferOwner = ref('');
const transitionStage = ref<CrmOpportunityStage>('qualified');
const lostReason = ref('');
const newOpportunity = ref<CreateOpportunityInput>({ customerId: '', title: '', currency: 'CNY' });

const customerOptions = computed<FormSelectOption[]>(() => customers.value
  .filter(customer => customer.state === 'active')
  .map(customer => ({ label: customer.displayName, value: customer.id })));

const {
  rows: opportunities, currentPage, pageSize, totalElements, loading, error,
  changePage, changePageSize, retry, search, refresh
} = useCrmPagination<CrmOpportunity, { stage?: string; keyword?: string }>(
  (page, size, filters) => pageOpportunities({ page, pageSize: size, ...filters }), {});

function stageLabel(stage: string): string { return stageLabels[stage] ?? stage; }
function stageClass(stage: string): string {
  if (stage === 'won') return 'success';
  if (stage === 'lost') return 'danger';
  if (stage === 'negotiation' || stage === 'proposal') return 'warning';
  return 'neutral';
}
function isTerminal(stage: string): boolean { return stage === 'won' || stage === 'lost'; }
function customerName(customerId: string): string { return customers.value.find(customer => customer.id === customerId)?.displayName ?? '客户（无权查看）'; }
function amountLabel(row: CrmOpportunity): string {
  if (!row.estimatedAmount) return '—';
  return `${row.estimatedAmount}${row.currency ? ` ${row.currency}` : ''}`;
}
function load(): Promise<void> {
  return search({ stage: stageFilter.value || undefined, keyword: keyword.value.trim() || undefined });
}
function resetFilter(): void {
  stageFilter.value = '';
  keyword.value = '';
  void load();
}
function openCreate(): void {
  newOpportunity.value = { customerId: '', title: '', currency: 'CNY' };
  createOpen.value = true;
}
async function createOne(): Promise<void> {
  if (creating.value) return;
  const input = newOpportunity.value;
  if (!input.customerId || !input.title.trim()) {
    error.value = '请选择客户并填写商机标题';
    return;
  }
  creating.value = true;
  error.value = '';
  try {
    await createOpportunity({ idempotencyKey: crypto.randomUUID() }, {
      customerId: input.customerId,
      title: input.title.trim(),
      ...(input.expectedCloseDate ? { expectedCloseDate: input.expectedCloseDate } : {}),
      ...(input.estimatedAmount?.trim() ? { estimatedAmount: input.estimatedAmount.trim() } : {}),
      ...(input.currency?.trim() ? { currency: input.currency.trim().toUpperCase() } : {})
    });
    createOpen.value = false;
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '创建商机失败';
  } finally {
    creating.value = false;
  }
}
function openTransition(row: CrmOpportunity): void {
  transitionTarget.value = row;
  transitionStage.value = (transitionOptions.value[0]?.value as CrmOpportunityStage) ?? 'qualified';
  lostReason.value = '';
  transitionOpen.value = true;
}
function openTransfer(row: CrmOpportunity): void {
  transferTarget.value = row;
  transferOwner.value = '';
  transferOpen.value = true;
}
async function transitionOne(): Promise<void> {
  const target = transitionTarget.value;
  if (!target || transitioning.value || transitionStage.value === 'won') return;
  if (transitionStage.value === 'lost' && !lostReason.value.trim()) {
    error.value = '输单阶段必须填写原因';
    return;
  }
  transitioning.value = true;
  error.value = '';
  try {
    await transitionOpportunity({ idempotencyKey: crypto.randomUUID() }, target.opportunityId, transitionStage.value, lostReason.value.trim() || undefined);
    transitionOpen.value = false;
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '推进商机失败';
  } finally {
    transitioning.value = false;
  }
}
async function transferOne(): Promise<void> {
  const target = transferTarget.value;
  const owner = transferOwner.value.trim();
  if (!target || transferring.value) return;
  if (!(owner.startsWith('iam:') || owner.startsWith('aksk:'))
    || owner.length <= (owner.startsWith('iam:') ? 4 : 5)) {
    error.value = '新归属必须填写 iam: 人员或 aksk: 服务主体';
    return;
  }
  transferring.value = true;
  error.value = '';
  try {
    await transferOpportunity({ idempotencyKey: crypto.randomUUID() }, target.opportunityId, owner);
    transferOpen.value = false;
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '转移商机失败';
  } finally {
    transferring.value = false;
  }
}

async function loadCustomers(): Promise<void> {
  customerLoading.value = true;
  customerLoadError.value = '';
  try {
    customers.value = await loadCustomerDirectory('active');
  } catch (failure) {
    customerLoadError.value = failure instanceof Error ? failure.message : '客户目录加载失败';
  } finally {
    customerLoading.value = false;
  }
}

onMounted(async () => {
  await loadCustomers();
  await load();
});
</script>
