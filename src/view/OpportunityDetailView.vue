<template>
  <main class="page">
    <PageHeader
      :title="opportunity?.title ?? '商机详情'"
      :description="opportunity ? `商机 ${shortId(opportunity.opportunityId, 'opportunity-')} · 客户销售机会事实` : '正在读取商机事实'"
    >
      <template #actions>
        <RouterLink
          class="button-secondary"
          to="/opportunities"
        >
          返回商机
        </RouterLink>
        <RouterLink
          v-if="opportunity && !['won', 'lost'].includes(opportunity.stage)"
          class="button-primary"
          :to="`/quotations/new?opportunityId=${encodeURIComponent(opportunity.opportunityId)}`"
        >
          基于商机新建报价
        </RouterLink>
      </template>
    </PageHeader>
    <p
      v-if="loading"
      class="loading-state"
      role="status"
    >
      正在加载商机…
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
        @click="load"
      >
        重试
      </button>
    </div>
    <template v-else-if="opportunity">
      <section class="card-section">
        <div class="section-heading">
          <h2>商机事实</h2>
          <span
            class="status-badge"
            :class="stageClass(opportunity.stage)"
          >{{ stageLabel(opportunity.stage) }}</span>
        </div>
        <dl class="detail-list">
          <dt>客户</dt>
          <dd>
            <RouterLink :to="`/customers/${opportunity.customerId}`">
              {{ customerName }}
            </RouterLink>
            <span class="identity-code">{{ opportunity.customerId }}</span>
          </dd>
          <dt>归属</dt>
          <dd>
            <span class="identity-main">{{ ownerLabel(opportunity.owner) }}</span>
            <span class="identity-code">{{ opportunity.owner }}</span>
          </dd>
          <dt>预计金额</dt><dd>{{ amountLabel }}</dd>
          <dt>预计成交日期</dt><dd>{{ opportunity.expectedCloseDate || '未设置' }}</dd>
          <dt>聚合版本</dt><dd>{{ opportunity.aggregateVersion }}</dd>
          <template v-if="opportunity.lostReason">
            <dt>输单原因</dt>
            <dd>{{ opportunity.lostReason }}</dd>
          </template>
        </dl>
      </section>
      <p class="field-hint">
        已赢单只能由关联报价确认成交自动派生；商机阶段推进和归属转移请从商机列表执行。
      </p>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import { getOpportunity, type CrmOpportunity } from '../api/crmApi';
import { customerDisplayName } from '../ui/crmNames';
import { ownerLabel, shortId } from '../ui/crmDisplay';

const route = useRoute();
const opportunity = ref<CrmOpportunity | null>(null);
const customerName = ref('客户');
const loading = ref(false);
const error = ref('');
const stageLabels: Record<string, string> = { new: '新建', qualified: '已确认', proposal: '方案中', negotiation: '谈判中', won: '已赢单', lost: '已输单' };
function stageLabel(stage: string): string { return stageLabels[stage] ?? stage; }
function stageClass(stage: string): string { return stage === 'won' ? 'success' : stage === 'lost' ? 'danger' : stage === 'proposal' || stage === 'negotiation' ? 'warning' : 'neutral'; }
const amountLabel = computed(() => {
  if (!opportunity.value?.estimatedAmount) return '未设置';
  return `${opportunity.value.estimatedAmount}${opportunity.value.currency ? ` ${opportunity.value.currency}` : ''}`;
});
async function load(): Promise<void> {
  const opportunityId = String(route.params.opportunityId);
  const sequence = ++loadSequence;
  const current = () => sequence === loadSequence && opportunityId === String(route.params.opportunityId);
  loading.value = true;
  error.value = '';
  opportunity.value = null;
  customerName.value = '客户';
  try {
    const value = await getOpportunity(opportunityId);
    const name = await customerDisplayName(value.customerId);
    if (!current()) return;
    opportunity.value = value;
    customerName.value = name;
  } catch (failure) {
    if (current()) error.value = failure instanceof Error ? failure.message : '加载商机失败';
  } finally {
    if (current()) loading.value = false;
  }
}
let loadSequence = 0;
watch(() => String(route.params.opportunityId), () => void load(), { immediate: true });
</script>
