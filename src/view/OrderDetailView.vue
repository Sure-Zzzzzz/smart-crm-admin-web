<template>
  <main class="page">
    <PageHeader
      title="订单详情"
      description="成交订单的行明细与履约义务。"
    >
      <template #actions>
        <RouterLink
          class="button-secondary"
          to="/orders"
        >
          返回订单
        </RouterLink>
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
        @click="() => void loadOrder()"
      >
        重试
      </button>
    </div>
    <div
      v-if="loading"
      class="loading-state"
      role="status"
    >
      正在加载订单…
    </div>

    <template v-else-if="order">
      <section class="panel">
        <h2>订单 {{ shortId(order.orderId, 'order-') }}</h2>
        <dl class="detail-list">
          <dt>来源报价</dt><dd>
            <span
              class="identity-cell"
              :title="order.sourceQuotationId"
            ><span class="identity-main">报价 {{ shortId(order.sourceQuotationId, 'quotation-') }}</span><span class="identity-code">{{ order.sourceQuotationId }} · 第 {{ order.sourceQuotationVersion }} 版</span></span>
          </dd>
          <dt>客户</dt><dd>
            <span
              class="identity-cell"
              :title="order.customerId"
            ><span class="identity-main">{{ customerName }}</span><span class="identity-code">{{ order.customerId }}</span></span>
          </dd>
          <dt>合计</dt><dd>{{ order.totalAmount.amount }} {{ order.totalAmount.currency }}</dd>
          <dt>状态</dt><dd>
            <span
              class="status-badge"
              :class="orderStateClass(order.displayState)"
            >{{ stateLabel }}</span>
          </dd>
          <dt>归属</dt><dd>
            <span
              class="identity-cell"
              :title="order.owner"
            ><span class="identity-main">{{ ownerLabel(order.owner) }}</span><span class="identity-code">{{ order.owner }}</span></span>
          </dd>
        </dl>
      </section>

      <section class="panel">
        <h2>行明细 <span>{{ order.lines.length }}</span></h2>
        <DataTable
          :columns="lineColumns"
          :rows="order.lines"
          row-key="orderLineId"
          empty-text="无行明细"
        >
          <template #cell-offeringReference="{ row }">
            <span class="identity-cell">
              <span class="identity-main">{{ offeringNames[row.offeringReference] ?? offeringUnavailableLabel }}</span>
              <span class="identity-code">{{ row.offeringReference }}</span>
            </span>
          </template>
          <template #cell-quantity="{ row }">
            {{ formatQuantity(row.quantity) }} {{ row.unit }}
          </template>
          <template #cell-unitPrice="{ row }">
            {{ row.unitPrice.amount }} {{ row.unitPrice.currency }}
          </template>
          <template #cell-lineTotal="{ row }">
            {{ row.lineTotal.amount }} {{ row.lineTotal.currency }}
          </template>
          <template #cell-obligation="{ row }">
            <span class="wrap-cell"><span class="identity-main">{{ row.obligation.fulfillmentScope === 'default' ? '标准交付范围' : row.obligation.fulfillmentScope }} · 需能力 {{ capabilityLabel(row.obligation.requiredConsumerCapability) }}</span><span class="identity-code">{{ row.obligation.subjectReference }} · {{ row.obligation.requiredConsumerCapability }}</span></span>
          </template>
        </DataTable>
      </section>

      <section class="panel">
        <h2>本单交付项 <span>{{ totalElements }}</span></h2>
        <DataTable
          v-if="!itemLoading || items.length"
          :columns="itemColumns"
          :rows="items"
          :aria-busy="itemLoading"
          row-key="fulfillmentId"
          empty-text="暂无交付项"
        >
          <template #cell-fulfillmentId="{ row }">
            <span
              class="identity-cell"
              :title="row.fulfillmentId"
            >
              <span class="identity-main">交付项 {{ shortId(row.fulfillmentId, 'fulfillment-item-') }}</span>
              <span class="identity-code">{{ row.fulfillmentId }}</span>
              <span class="identity-code">订单行 {{ row.orderLineId }}</span>
            </span>
          </template>
          <template #cell-state="{ row }">
            <span
              class="status-badge"
              :class="fulfillmentStateClass(row.state)"
            >{{ itemStateLabel(row.state) }}</span>
          </template>
          <template #cell-assignedConsumerId="{ row }">
            <span
              class="identity-cell"
              :title="row.assignedConsumerId"
            >
              <span class="identity-main">{{ consumerLabel(row.assignedConsumerId) }}</span>
              <span class="identity-code">{{ row.assignedConsumerId }}</span>
            </span>
          </template>
          <template #cell-resultData="{ row }">
            <FulfillmentResultDisplay :item="row" />
          </template>
          <template #cell-actions="{ row }">
            <FulfillmentResetAction
              :item="row"
              @completed="() => void refreshAfterReset()"
            />
          </template>
        </DataTable>
        <p
          v-if="itemLoading"
          class="loading-state"
          role="status"
        >
          正在加载本单交付项…
        </p>
        <div
          v-if="itemError"
          class="admin-message error"
          role="alert"
        >
          {{ itemError }}
          <button
            class="button-secondary"
            type="button"
            :disabled="itemLoading"
            @click="retryItems"
          >
            重试交付项
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
  </main>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { useCrmPagination } from '../ui/useCrmPagination';
import FulfillmentResetAction from '../ui/FulfillmentResetAction.vue';
import FulfillmentResultDisplay from '../ui/FulfillmentResultDisplay.vue';
import { customerDisplayName, loadOfferingDirectory } from '../ui/crmNames';
import { crmAccessToken, crmIdentityEpoch, crmIdentityVersion } from '../auth/pkce';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import { CrmApiError, getOrder, pageFulfillmentItems, type CrmFulfillmentItem, type CrmOrderDetail } from '../api/crmApi';
import {
  capabilityLabel,
  formatQuantity,
  consumerLabel,
  fulfillmentStateClass,
  fulfillmentStateLabel,
  orderStateClass,
  orderStateLabel,
  ownerLabel,
  shortId
} from '../ui/crmDisplay';

const route = useRoute();
const order = ref<CrmOrderDetail | null>(null);
const loading = ref(true);
const error = ref('');
const customerName = ref('客户');
const offeringNames = ref<Record<string, string>>({});
const offeringUnavailableLabel = ref('商品（名称不可见）');

const stateLabel = computed(() =>
  orderStateLabel(order.value?.displayState));

const lineColumns: DataTableColumn[] = [
  { key: 'offeringReference', label: '商品', width: '22%', nowrap: true },
  { key: 'quantity', label: '数量', width: '10%' },
  { key: 'unitPrice', label: '单价', width: '14%' },
  { key: 'lineTotal', label: '小计', width: '14%' },
  { key: 'obligation', label: '履约义务（范围·能力）', width: '40%' }
];

const itemColumns: DataTableColumn[] = [
  { key: 'fulfillmentId', label: '交付项 · 订单行', width: '26%' },
  { key: 'assignedConsumerId', label: '交付负责方', width: '22%' },
  { key: 'state', label: '状态', width: '18%' },
  { key: 'resultData', label: '交付结果', width: '24%' },
  { key: 'actions', label: '操作', width: '10%', align: 'right' }
];

function itemStateLabel(state: string): string {
  return fulfillmentStateLabel(state);
}

const {
  rows: items, currentPage, pageSize, totalElements, error: itemError, loading: itemLoading,
  changePage, changePageSize, search: searchItems, retry: retryItems, clear: clearItems, refresh: refreshItems
} = useCrmPagination<CrmFulfillmentItem, { orderId?: string }>(
  (page, pageSize, filters) => pageFulfillmentItems({ page, pageSize, ...filters }), {}
);
let loadSequence = 0;
let disposed = false;
onScopeDispose(() => { disposed = true; loadSequence++; });
/** 关联目录不可见时保留获准订单的冻结事实；网络故障仍走明确错误与重试。 */
async function readOfferingNames(): Promise<{ names: Record<string, string>; unavailable: string }> {
  try {
    const directory = await loadOfferingDirectory();
    return {
      names: Object.fromEntries(directory
        .filter(offering => offering.offeringReference)
        .map(offering => [offering.offeringReference!, offering.displayName])),
      unavailable: '商品（名称不可见）'
    };
  } catch (failure) {
    if (failure instanceof CrmApiError && (failure.status === 403 || failure.status === 404)) {
      return { names: {}, unavailable: failure.status === 403 ? '商品（无权查看）' : '商品（已删除或无权查看）' };
    }
    throw failure;
  }
}
async function refreshAfterReset(): Promise<void> {
  const token = crmAccessToken();
  const epoch = crmIdentityEpoch();
  const sequence = ++loadSequence;
  error.value = '';
  try {
    const refreshed = await getOrder(String(route.params.orderId));
    if (disposed || sequence !== loadSequence || epoch !== crmIdentityEpoch() || token !== crmAccessToken()) return;
    order.value = refreshed;
  } catch (failure) {
    if (!disposed && sequence === loadSequence && epoch === crmIdentityEpoch() && token === crmAccessToken()) {
      error.value = `重置已完成，但订单回读失败：${failure instanceof Error ? failure.message : '加载失败'}`;
    }
    return;
  }
  // 订单回读成功后单独刷新交付项；失败会由交付项区域自己的错误态和重试入口承接。
  await refreshItems();
}
async function loadOrder(): Promise<void> {
  const orderId = String(route.params.orderId);
  const token = crmAccessToken();
  const epoch = crmIdentityEpoch();
  const sequence = ++loadSequence;
  const current = () => !disposed && sequence === loadSequence && epoch === crmIdentityEpoch() && token === crmAccessToken();
  loading.value = true;
  error.value = '';
  order.value = null;
  offeringNames.value = {};
  offeringUnavailableLabel.value = '商品（名称不可见）';
  clearItems();
  try {
    const [orderHit, offeringDirectory] = await Promise.all([getOrder(orderId), readOfferingNames()]);
    const name = await customerDisplayName(orderHit.customerId);
    if (!current()) return;
    order.value = orderHit;
    customerName.value = name;
    offeringNames.value = offeringDirectory.names;
    offeringUnavailableLabel.value = offeringDirectory.unavailable;
    await searchItems({ orderId });
  } catch (failure) {
    if (current()) error.value = failure instanceof Error ? failure.message : '加载失败';
  } finally {
    if (current()) loading.value = false;
  }
}
watch(() => String(route.params.orderId), () => void loadOrder(), { immediate: true });
watch(crmIdentityVersion, () => {
  loadSequence++;
  order.value = null;
  customerName.value = '客户';
  offeringNames.value = {};
  offeringUnavailableLabel.value = '商品（名称不可见）';
  loading.value = false;
  error.value = '';
  clearItems();
  if (crmAccessToken()) void loadOrder();
}, { flush: 'sync' });
</script>
