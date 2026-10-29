<template>
  <main class="page">
    <PageHeader
      title="工作台"
      description="CRM 业务闭环：客户建档 → 商机推进 → 报价签发 → 客户确认成交 → 订单履约。"
    >
      <template #actions>
        <RouterLink
          class="button-primary"
          to="/opportunities"
        >
          查看商机
        </RouterLink>
      </template>
    </PageHeader>

    <div
      v-if="metricError"
      class="admin-message error"
      role="alert"
    >
      {{ metricError }}
      <button
        class="button-secondary"
        type="button"
        :disabled="metricLoading"
        @click="load"
      >
        {{ metricLoading ? '正在重试…' : '重试统计' }}
      </button>
    </div>
    <nav
      class="flow-nav"
      aria-label="业务闭环进度"
    >
      <span
        class="flow-step"
        :class="{ 'step-done': customers > 0 }"
      ><Users
        :size="14"
        aria-hidden="true"
      />客户 {{ countLabel(customers) }}</span>
      <span class="flow-arrow">→</span>
      <span
        class="flow-step"
        :class="{ 'step-done': opportunities > 0 }"
      ><ChartNoAxesCombined
        :size="14"
        aria-hidden="true"
      />商机 {{ countLabel(opportunities) }}</span>
      <span class="flow-arrow">→</span>
      <span
        class="flow-step"
        :class="{ 'step-done': issued > 0 }"
      ><Tag
        :size="14"
        aria-hidden="true"
      />签发报价 {{ countLabel(issued) }}</span>
      <span class="flow-arrow">→</span>
      <span
        class="flow-step"
        :class="{ 'step-done': confirmed > 0, 'step-current': issued > 0 && confirmed === 0 }"
      >
        <Handshake
          :size="14"
          aria-hidden="true"
        />确认成交 {{ countLabel(confirmed) }}
      </span>
      <span class="flow-arrow">→</span>
      <span
        class="flow-step"
        :class="{ 'step-current': confirmed > 0 }"
      ><PackageCheck
        :size="14"
        aria-hidden="true"
      />交付履约 {{ countLabel(fulfillment) }} 项</span>
    </nav>

    <div class="metric-cards">
      <RouterLink
        class="metric-card"
        to="/quotations"
      >
        <strong>{{ countLabel(quotationTotal) }}</strong>
        <span class="metric-label"><FileText
          :size="14"
          aria-hidden="true"
        />报价单</span>
      </RouterLink>
      <RouterLink
        class="metric-card"
        to="/opportunities"
      >
        <strong>{{ countLabel(opportunityTotal) }}</strong>
        <span class="metric-label"><ChartNoAxesCombined
          :size="14"
          aria-hidden="true"
        />商机</span>
      </RouterLink>
      <div class="metric-card">
        <strong>{{ issued }}</strong>
        <span class="metric-label"><Clock3
          :size="14"
          aria-hidden="true"
        />待客户确认</span>
      </div>
      <RouterLink
        class="metric-card"
        to="/orders"
      >
        <strong>{{ confirmed }}</strong>
        <span class="metric-label"><ShoppingCart
          :size="14"
          aria-hidden="true"
        />已成交订单</span>
      </RouterLink>
      <RouterLink
        class="metric-card"
        to="/offerings"
      >
        <strong>{{ offerings }}</strong>
        <span class="metric-label"><Package
          :size="14"
          aria-hidden="true"
        />在售商品</span>
      </RouterLink>
    </div>

    <section class="card-section">
      <div class="section-heading">
        <h2>待办：等客户确认的报价</h2>
        <span class="count">{{ totalElements }} 张</span>
      </div>
      <p
        v-if="loading"
        class="loading-state"
        role="status"
      >
        正在加载…
      </p>
      <div
        v-else-if="error"
        class="admin-message error"
        role="alert"
      >
        {{ error }}
        <button
          class="button-secondary"
          type="button"
          :disabled="loading"
          @click="loadPending"
        >
          重试待办
        </button>
      </div>
      <template v-else-if="pending.length">
        <div
          v-for="quotation in pending"
          :key="quotation.quotationId"
          class="todo-item"
        >
          <div class="todo-main">
            <span class="todo-title">{{ quotation.customerDisplayName }}</span>
            <span class="todo-meta">报价 {{ shortId(quotation.quotationId, 'quotation-') }} · 已签发，等待客户确认成交</span>
          </div>
          <div class="todo-actions">
            <RouterLink
              class="button-secondary"
              :to="`/quotations/${quotation.quotationId}`"
            >
              查看
            </RouterLink>
            <button
              class="button-primary"
              :disabled="confirmBusy || loading"
              @click="confirmTarget = quotation"
            >
              确认成交
            </button>
          </div>
        </div>
      </template>
      <div
        v-else
        class="admin-empty-state"
      >
        <h3>没有待确认的报价</h3>
        <p>已签发的报价会出现在这里等待确认成交；成交后自动生成订单与交付项。</p>
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

    <Dialog
      variant="confirm"
      :open="confirmTarget !== null"
      title="确认成交"
      :description="confirmTarget ? `确认报价 ${shortId(confirmTarget.quotationId, 'quotation-')} 成交？将同事务生成订单与交付项，此操作不可撤销。` : ''"
      confirm-label="确认成交"
      :pending="confirmBusy"
      @close="confirmTarget = null"
      @confirm="runConfirm"
    />
  </main>
</template>

<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from 'vue';
import { ChartNoAxesCombined, Clock3, FileText, Handshake, Package, PackageCheck, ShoppingCart, Tag, Users } from 'lucide-vue-next';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { useCrmPagination } from '../ui/useCrmPagination';
import { customerDisplayName } from '../ui/crmNames';
import { crmAccessToken } from '../auth/pkce';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import {
  patchQuotation,
  pageCustomers,
  pageOfferings,
  pageQuotations,
  pageOrders,
  pageOpportunities,
  pageFulfillmentItems,
  type CrmQuotation
} from '../api/crmApi';
import { shortId } from '../ui/crmDisplay';

const customers = ref(0);
const offerings = ref(0);
const opportunities = ref(0);
const opportunityTotal = ref(0);
const fulfillment = ref(0);
const confirmTarget = ref<CrmQuotation | null>(null);
const confirmBusy = ref(false);
const metricError = ref('');
const metricLoading = ref(false);
const metricReady = ref(false);

const issued = ref(0);
const confirmed = ref(0);
const quotationTotal = ref(0);
const {
  rows: pending, currentPage, pageSize, totalElements, loading, error,
  changePage, changePageSize, refresh: loadPending
} = useCrmPagination<CrmQuotation & { customerDisplayName: string }, Record<string, never>>(
  async (page, pageSize) => {
    const result = await pageQuotations({ page, pageSize, state: 'issued' });
    const items = await Promise.all(result.items.map(async row => ({
      ...row, customerDisplayName: await customerDisplayName(row.customerId)
    })));
    return { ...result, items };
  }, {}
);

function countLabel(count: number): string { return metricReady.value ? String(count) : '—'; }

let sequence = 0;
onScopeDispose(() => { sequence++; });
async function load(): Promise<void> {
  const currentSequence = ++sequence;
  const token = crmAccessToken();
  metricError.value = '';
  metricReady.value = false;
  metricLoading.value = true;
  void loadPending();
  try {
    const [quotePage, customerPage, offeringPage, orderPage, issuedPage, opportunityPage, fulfillmentPage] = await Promise.all([
      pageQuotations({ page: 1, pageSize: 1 }),
      pageCustomers({ page: 1, pageSize: 1 }),
      pageOfferings({ page: 1, pageSize: 1, state: 'published' }),
      pageOrders({ page: 1, pageSize: 1 }),
      pageQuotations({ page: 1, pageSize: 1, state: 'issued' }),
      pageOpportunities({ page: 1, pageSize: 1 }),
      pageFulfillmentItems({ page: 1, pageSize: 1 })
    ]);
    if (currentSequence !== sequence || token !== crmAccessToken()) return;
    quotationTotal.value = quotePage.total;
    customers.value = customerPage.total;
    offerings.value = offeringPage.total;
    opportunities.value = opportunityPage.total;
    opportunityTotal.value = opportunityPage.total;
    confirmed.value = orderPage.total;
    issued.value = issuedPage.total;
    fulfillment.value = fulfillmentPage.total;
    metricReady.value = true;
  } catch (e) {
    if (currentSequence === sequence && token === crmAccessToken()) {
      metricError.value = e instanceof Error ? e.message : '统计加载失败';
    }
  } finally {
    if (currentSequence === sequence && token === crmAccessToken()) {
      metricLoading.value = false;
    }
  }
}

async function runConfirm(): Promise<void> {
  if (!confirmTarget.value || confirmBusy.value) {
    return;
  }
  confirmBusy.value = true;
  await confirm(confirmTarget.value);
  confirmBusy.value = false;
  if (!error.value) confirmTarget.value = null;
}

async function confirm(quotation: CrmQuotation): Promise<void> {
  error.value = '';
  try {
    await patchQuotation(
      { idempotencyKey: crypto.randomUUID() }, quotation.quotationId,
      { state: 'confirmed', quotationVersion: quotation.currentVersion,
        expectedAggregateVersion: quotation.aggregateVersion }
    );
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '确认失败';
  }
}

onMounted(() => void load());
</script>
