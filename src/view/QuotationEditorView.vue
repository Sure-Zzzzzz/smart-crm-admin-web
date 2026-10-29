<template>
  <main class="page">
    <PageHeader
      :title="headerTitle"
      description="四步推进：草稿录入 → 签发生效 → 确认成交 → 交付完成。"
    >
      <template #actions>
        <RouterLink
          class="button-secondary"
          to="/"
        >
          返回工作台
        </RouterLink>
      </template>
    </PageHeader>

    <div
      class="stepper"
      :class="{ 'stepper-terminal': terminalState }"
      aria-label="报价阶段"
    >
      <div
        class="stepper-item"
        :class="stepClass(1)"
      >
        <span class="stepper-dot">{{ stepIndex >= 2 ? '✓' : '1' }}</span>
        <span class="stepper-title">草稿</span>
        <span class="stepper-desc">录入客户与商品行项</span>
      </div>
      <div
        class="stepper-item"
        :class="stepClass(2)"
      >
        <span class="stepper-dot">{{ stepIndex >= 3 ? '✓' : '2' }}</span>
        <span class="stepper-title">已签发</span>
        <span class="stepper-desc">对外生效，等待客户确认</span>
      </div>
      <div
        class="stepper-item"
        :class="stepClass(3)"
      >
        <span class="stepper-dot">{{ stepIndex >= 4 ? '✓' : '3' }}</span>
        <span class="stepper-title">已成交</span>
        <span class="stepper-desc">订单与交付项已生成</span>
      </div>
      <div
        class="stepper-item"
        :class="stepClass(4)"
      >
        <span class="stepper-dot">{{ stepIndex >= 4 ? '✓' : '4' }}</span>
        <span class="stepper-title">已交付</span>
        <span class="stepper-desc">交付凭证交回，本单闭环</span>
      </div>
    </div>

    <div
      v-if="error"
      class="admin-message error"
      role="alert"
    >
      {{ error }}
    </div>
    <div
      v-if="message"
      class="admin-message success"
      role="status"
    >
      {{ message }}
    </div>

    <p
      v-if="loading"
      class="loading-state"
      role="status"
    >
      正在加载报价…
    </p>
    <div
      v-else-if="loadFailed"
      class="admin-empty-state"
      role="alert"
    >
      <h2>报价暂时无法加载</h2>
      <p>{{ error || '未能读取报价及其版本快照，当前不会提交任何修改。' }}</p>
      <button
        class="button-primary"
        type="button"
        @click="load"
      >
        重新加载
      </button>
    </div>

    <template v-else>
      <section class="card-section">
        <div class="section-heading">
          <h2>基本信息</h2>
        </div>
        <div class="form-grid">
          <div class="quotation-customer-field">
            <span>客户</span>
            <FormSelect
              v-model="customerId"
              :options="customerOptions"
              aria-label="选择客户"
              placeholder="选择建档客户"
              :disabled="!isNew"
            />
          </div>
          <label>报价有效期至
            <input
              v-model="validUntilUI"
              type="datetime-local"
              aria-label="报价有效期至"
              :disabled="stepIndex !== 1"
              required
            >
            <span class="field-hint">到期后客户不能再确认成交（报价自动作废），新建默认 30 天</span>
          </label>
        </div>
      </section>

      <section class="card-section">
        <div class="section-heading">
          <h2>商品行项</h2>
          <button
            class="button-secondary"
            type="button"
            :disabled="stepIndex !== 1"
            @click="addLine"
          >
            加一行
          </button>
        </div>
        <div class="quote-lines">
          <div
            class="quote-line quote-line-head"
            aria-hidden="true"
          >
            <span>商品（必选）</span><span>数量（必填 &gt; 0）</span><span>单位</span>
            <span>单价（必填≥0）</span><span>币种</span><span />
          </div>
          <div
            v-for="(line, index) in lines"
            :key="index"
            class="quote-line-item"
          >
            <div class="quote-line">
              <div class="quote-line-field">
                <span>商品（必选）</span>
                <FormSelect
                  v-model="line.offeringId"
                  :options="offeringOptions"
                  :aria-label="`第 ${index + 1} 行商品`"
                  placeholder="选择在售商品"
                  :disabled="stepIndex !== 1"
                />
              </div>
              <label class="quote-line-field">
                <span>数量（必填 &gt; 0）</span>
                <input
                  v-model="line.quantity"
                  placeholder="数量"
                  aria-label="数量"
                  :disabled="stepIndex !== 1"
                >
              </label>
              <label class="quote-line-field">
                <span>单位</span>
                <input
                  v-model="line.unit"
                  placeholder="单位"
                  aria-label="单位"
                  :disabled="stepIndex !== 1"
                >
              </label>
              <label class="quote-line-field">
                <span>单价（必填≥0）</span>
                <input
                  v-model="line.amount"
                  placeholder="单价"
                  aria-label="单价"
                  :disabled="stepIndex !== 1"
                >
              </label>
              <label class="quote-line-field">
                <span>币种</span>
                <input
                  v-model="line.currency"
                  placeholder="币种"
                  aria-label="币种"
                  :disabled="stepIndex !== 1"
                >
              </label>
              <div class="quote-line-action">
                <button
                  class="icon-button"
                  type="button"
                  title="删除行"
                  :aria-label="`删除第 ${index + 1} 行`"
                  :disabled="stepIndex !== 1"
                  @click="removeLine(index)"
                >
                  <Trash2
                    :size="16"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
            <div class="form-grid">
              <label>交付对象引用（必填）
                <input
                  v-model="line.subjectReference"
                  :aria-label="`第 ${index + 1} 行交付对象引用`"
                  placeholder="填写交付对象的业务编号"
                  :disabled="stepIndex !== 1"
                >
                <span class="field-hint">明确本行交付给哪个项目、部署环境或服务对象。</span>
              </label>
              <label>交付范围（必填）
                <textarea
                  v-model="line.fulfillmentScope"
                  :aria-label="`第 ${index + 1} 行交付范围`"
                  placeholder="填写约定交付的内容或使用范围"
                  rows="2"
                  :disabled="stepIndex !== 1"
                />
                <span class="field-hint">按成交约定填写；每行的对象和范围会随订单交给履约方。</span>
              </label>
            </div>
          </div>
          <p
            v-if="lines.length === 0"
            class="muted"
          >
            尚无行项：每一行对应一件在售商品，成交后按行生成交付项。
          </p>
        </div>
        <p
          v-if="lineError"
          class="admin-message error"
          role="alert"
        >
          {{ lineError }}
        </p>
        <div class="line-total">
          <span>报价合计</span>
          <strong>{{ totalAmount }}</strong>
        </div>
        <div class="quotation-customer-field">
          <span>关联商机（可选）</span>
          <FormSelect
            v-model="opportunityId"
            :options="opportunityOptions"
            aria-label="关联商机"
            placeholder="选择当前客户商机"
            :disabled="!isNew"
          />
          <span class="field-hint">成交确认后，关联商机自动进入已赢单。</span>
        </div>
      </section>

      <section class="card-section">
        <div class="section-heading">
          <h2>推进成交</h2>
        </div>
        <p class="muted">
          {{ stageHint }}
        </p>
        <p
          v-if="stepIndex === 3 && quotation?.confirmedOrderId"
          class="doc-no"
          :title="quotation.confirmedOrderId"
        >
          成交订单 {{ quotation.confirmedOrderId }}：本报价兑现成的正式订单，交付按它执行，订单与履约进度分别在「订单」和「交付履约」页跟踪
        </p>
        <div class="form-footer">
          <span
            v-if="terminalState"
            class="status-badge danger"
          >{{ terminalState === 'withdrawn' ? '已撤回（终态）' : terminalState === 'superseded' ? '已被重议取代（终态）' : '已过期（终态）' }}</span>
          <template v-else>
            <button
              v-if="stepIndex === 1"
              class="button-secondary"
              :disabled="busy"
              @click="save"
            >
              {{ isNew ? '保存草稿' : '保存修改（版本号不变）' }}
            </button>
            <button
              v-if="stepIndex === 1"
              class="button-primary"
              :disabled="busy || !quotation || hasUnsavedChanges"
              @click="issue"
            >
              签发报价
            </button>
            <span
              v-if="hasUnsavedChanges"
              class="field-hint"
              role="status"
            >有未保存的修改，请先保存，再签发报价。</span>
            <button
              v-if="stepIndex === 2 && quotation?.state === 'issued'"
              class="button-primary"
              :disabled="busy"
              @click="dialogKind = 'confirm'"
            >
              确认成交
            </button>
            <button
              v-if="stepIndex === 2"
              class="button-secondary"
              :disabled="busy"
              @click="dialogKind = 'withdraw'"
            >
              客户放弃，撤回
            </button>
            <button
              v-if="stepIndex === 2 && quotation?.state === 'issued'"
              class="button-secondary"
              :disabled="busy"
              @click="renegotiate"
            >
              重议（派生新草稿）
            </button>
            <RouterLink
              v-if="stepIndex >= 3"
              class="button-primary"
              to="/orders"
            >
              查看订单
            </RouterLink>
          </template>
        </div>
      </section>
    </template>

    <Dialog
      :open="dialogKind !== null"
      :variant="dialogKind === 'confirm' ? 'confirm' : 'danger'"
      :title="dialogKind === 'confirm' ? '确认成交' : '撤回报价'"
      :description="dialogKind === 'confirm'
        ? '确认后本报价转为成交终态，同事务生成订单与交付项；此操作不可撤销。'
        : '撤回后本报价进入终态，不能再确认成交；此操作不可撤销。'"
      :confirm-label="dialogKind === 'confirm' ? '确认成交' : '确认撤回'"
      :pending="dialogBusy"
      @close="dialogKind = null"
      @confirm="runDialogAction"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Trash2 } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import FormSelect, { type FormSelectOption } from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import {
  patchQuotation,
  createQuotation,
  editQuotation,
  getQuotation,
  getQuotationVersion,
  pageFulfillmentItems,
  renegotiateQuotation,
  type CrmCustomer,
  type CrmOffering,
  type CrmOpportunity,
  type CrmQuotation,
  type QuotationLineInput
} from '../api/crmApi';
import { loadCustomerDirectory, loadOfferingDirectory, loadOpportunityDirectory } from '../ui/crmNames';
import { formatQuantity } from '../ui/crmDisplay';

const route = useRoute();
const router = useRouter();
const quotationId = ref<string>(String(route.params.quotationId ?? ''));
const validUntilUI = ref('');
const isNew = computed(() => !route.params.quotationId);
const customerId = ref('');
const opportunityId = ref('');
const lines = ref<Array<{
  offeringId: string; quantity: string; unit: string; amount: string; currency: string;
  subjectReference: string; fulfillmentScope: string;
}>>([]);
const quotation = ref<CrmQuotation | null>(null);
const customers = ref<CrmCustomer[]>([]);
const offerings = ref<CrmOffering[]>([]);
const opportunities = ref<CrmOpportunity[]>([]);
const busy = ref(false);
const loading = ref(true);
const loadFailed = ref(false);
const dialogKind = ref<null | 'confirm' | 'withdraw'>(null);
const dialogBusy = ref(false);
const error = ref('');
const message = ref('');
const savedDraftFingerprint = ref<string | null>(null);
// 签发只作用于已持久化版本；屏幕修改必须先保存，防止按旧价格成交。
const draftFingerprint = computed(() => JSON.stringify({
  customerId: customerId.value,
  opportunityId: opportunityId.value,
  validUntil: validUntilUI.value,
  lines: lines.value
}));
const hasUnsavedChanges = computed(() => quotation.value?.state === 'draft'
  && savedDraftFingerprint.value !== draftFingerprint.value);

const customerOptions = computed<FormSelectOption[]>(() =>
  customers.value
    .filter(c => c.state === 'active' || c.id === customerId.value)
    .map(c => ({ label: c.displayName, value: c.id })));
const offeringOptions = computed<FormSelectOption[]>(() =>
  offerings.value
    .filter(o => o.state === 'published' || lines.value.some(line => line.offeringId === o.id))
    .map(o => ({ label: o.displayName, value: o.id })));
const opportunityOptions = computed<FormSelectOption[]>(() =>
  opportunities.value
    .filter(opportunity => opportunity.customerId === customerId.value && !['won', 'lost'].includes(opportunity.stage))
    .map(opportunity => ({ label: `${opportunity.title}（${opportunity.stage}）`, value: opportunity.opportunityId })));

const headerTitle = computed(() => {
  if (isNew.value) {
    return '新建报价';
  }
  const hit = customers.value.find(c => c.id === customerId.value);
  return hit ? `报价单 · ${hit.displayName}` : `报价单`;
});

const fulfillmentDone = ref(false);
const lineError = ref('');

/** 终态（撤回/取代/过期）：只读展示，不再给保存/签发/确认/重议按钮 */
const TERMINAL_STATES = new Set(['withdrawn', 'superseded', 'expired']);
const terminalState = computed(() =>
  TERMINAL_STATES.has(quotation.value?.state ?? '') ? quotation.value!.state : null);

const stepIndex = computed(() => {
  if (terminalState.value) {
    return 0;
  }
  if (quotation.value?.confirmedOrderId) {
    return fulfillmentDone.value ? 4 : 3;
  }
  if (quotation.value?.currentConfirmableVersion) {
    return 2;
  }
  return 1;
});

  const TERMINAL_HINTS: Record<string, string> = {
  withdrawn: '已撤回：本报价已终态作废，如需继续推进请重新报价。',
  superseded: '已被重议取代：本报价已终态，重议新草稿确认后本单自动作废。',
  expired: '已过期：超过有效期客户不能再确认成交，如需继续请重议派生新草稿。'
};
const stageHint = computed(() => {
  if (terminalState.value) {
    return TERMINAL_HINTS[terminalState.value];
  }
  if (stepIndex.value === 1) {
    return '第 1 步：录入后保存草稿；确认无误后「签发」对外生效。';
  }
  if (stepIndex.value === 2) {
    return '第 2 步：报价已签发。客户同意后点「确认成交」，系统同事务生成订单与交付项。';
  }
  if (fulfillmentDone.value) {
    return '交付完成：全部交付凭证已交回，本单闭环。';
  }
  return '已成交：交付负责方领取执行中，进度见「交付」页。';
});

function stepClass(step: number): string {
  if (stepIndex.value === 0) {
    return '';
  }
  if (step < stepIndex.value) {
    return 'step-done';
  }
  if (step === stepIndex.value) {
    // 终态步（已交付）同时落 done：连线随 step-done 变绿，圆点绿色实心由 last-child 规则叠加
    return stepIndex.value === 4 ? 'step-done step-current' : 'step-current';
  }
  return '';
}

const totalAmount = computed(() => {
  const currencies = [...new Set(lines.value
    .map(line => line.currency.trim().toUpperCase())
    .filter(Boolean))];
  if (currencies.length > 1) {
    return '币种不一致';
  }
  let sum = 0;
  const currency = currencies[0] ?? 'CNY';
  for (const line of lines.value) {
    const amount = Number(line.amount);
    if (!Number.isNaN(amount)) {
      sum += amount * (Number(line.quantity) || 0);
    }
  }
  return `${sum.toFixed(2)} ${currency}`;
});

function defaultValidUntilUI(): string {
  const due = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return toLocalInput(due);
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toInstantString(localValue: string): string {
  // 输入值为浏览器本地时间（datetime-local），偏移取自浏览器实际时区，不写死 +08:00
  if (!localValue || localValue.length !== 16) {
    return localValue;
  }
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return localValue + ':00' + offset;
}

function fromInstantString(instant: string): string {
  if (!instant) {
    return '';
  }
  return toLocalInput(new Date(instant));
}

function addLine(): void {
  lines.value.push({ offeringId: '', quantity: '1', unit: 'SET', amount: '0.00', currency: 'CNY',
    subjectReference: '', fulfillmentScope: '' });
}

function removeLine(index: number): void {
  lines.value.splice(index, 1);
}

/** 行项校验：商品必选、数量>0、单价≥0（十进制），通过返回空串否则返回中文提示 */
function validateLines(): string {
  if (!customerId.value) {
    return '请先选择客户';
  }
  if (lines.value.length === 0) {
    return '至少添加一行商品';
  }
  let settlementCurrency = '';
  for (let i = 0; i < lines.value.length; i++) {
    const line = lines.value[i];
    const row = `第 ${i + 1} 行`;
    if (!line.offeringId) {
      return `${row}：请选择商品`;
    }
    const qty = Number(line.quantity);
    if (!line.quantity.trim() || !Number.isFinite(qty) || qty <= 0) {
      return `${row}：数量必须是大于 0 的数字`;
    }
    const amount = Number(line.amount);
    if (!line.amount.trim() || !Number.isFinite(amount) || amount < 0) {
      return `${row}：单价必须是大于等于 0 的数字`;
    }
    const currency = line.currency.trim().toUpperCase();
    if (!currency) {
      return `${row}：币种不能为空`;
    }
    if (!settlementCurrency) {
      settlementCurrency = currency;
    } else if (settlementCurrency !== currency) {
      return '报价中的所有商品行必须使用同一币种';
    }
    if (!line.unit.trim()) {
      return `${row}：请填写单位`;
    }
    if (!line.subjectReference.trim()) {
      return `${row}：请填写交付对象引用`;
    }
    if (!line.fulfillmentScope.trim()) {
      return `${row}：请填写交付范围`;
    }
  }
  return '';
}

function wirePayload(): QuotationLineInput[] {
  return lines.value.map(line => ({
    offeringId: line.offeringId,
    quantity: line.quantity,
    unit: line.unit.trim(),
    unitPrice: { amount: line.amount, currency: line.currency.trim().toUpperCase() },
    subjectReference: line.subjectReference,
    fulfillmentScope: line.fulfillmentScope
  }));
}

async function loadCatalogs(): Promise<{ customers: CrmCustomer[]; offerings: CrmOffering[]; opportunities: CrmOpportunity[] }> {
  const [customers, offerings, opportunities] = await Promise.all([
    loadCustomerDirectory(), loadOfferingDirectory(), loadOpportunityDirectory()
  ]);
  return { customers, offerings, opportunities };
}

/** 对象序号守卫：重议跳转/切换对象时，旧对象的慢响应不得覆盖新页面 */
let loadSeq = 0;
onScopeDispose(() => { loadSeq++; });

async function load(): Promise<void> {
  const seq = ++loadSeq;
  quotationId.value = String(route.params.quotationId ?? '');
  error.value = '';
  loadFailed.value = false;
  loading.value = true;
  try {
    const catalogs = await loadCatalogs();
    if (seq !== loadSeq) return;
    customers.value = catalogs.customers;
    offerings.value = catalogs.offerings;
    opportunities.value = catalogs.opportunities;
    if (isNew.value) {
      validUntilUI.value = defaultValidUntilUI();
      lines.value = [];
      addLine();
      const requestedOpportunityId = typeof route.query.opportunityId === 'string' ? route.query.opportunityId : '';
      const requestedOpportunity = opportunities.value.find(item => item.opportunityId === requestedOpportunityId
        && !['won', 'lost'].includes(item.stage));
      if (requestedOpportunity) {
        opportunityId.value = requestedOpportunity.opportunityId;
        customerId.value = requestedOpportunity.customerId;
      }
      return;
    }
    const hit = await getQuotation(quotationId.value);
    const [versionView, completed, allItems] = await Promise.all([
      getQuotationVersion(hit.quotationId, hit.currentVersion),
      hit.confirmedOrderId ? pageFulfillmentItems({ page: 1, pageSize: 1, orderId: hit.confirmedOrderId, state: 'completed' }) : null,
      hit.confirmedOrderId ? pageFulfillmentItems({ page: 1, pageSize: 1, orderId: hit.confirmedOrderId }) : null
    ]);
    if (seq !== loadSeq) return;
    // 旧接口若未返回冻结交付约定，禁止将空值当成可编辑快照覆盖原数据。
    if (versionView.lines.some(line => !line.obligation
      || typeof line.obligation.subjectReference !== 'string'
      || typeof line.obligation.fulfillmentScope !== 'string')) {
      throw new Error('报价交付约定未完整返回，请检查后端版本后重新查询');
    }
    quotation.value = hit;
    customerId.value = hit.customerId;
    opportunityId.value = hit.opportunityId ?? '';
    fulfillmentDone.value = !!allItems && allItems.total > 0 && completed?.total === allItems.total;
    validUntilUI.value = fromInstantString(versionView.validUntil);
    lines.value = versionView.lines.map(line => ({
      offeringId: line.offeringId, quantity: formatQuantity(line.quantity),
      unit: line.unit, amount: line.unitPrice.amount, currency: line.unitPrice.currency,
      subjectReference: line.obligation.subjectReference, fulfillmentScope: line.obligation.fulfillmentScope
    }));
    savedDraftFingerprint.value = draftFingerprint.value;
  } catch (e) {
    if (seq === loadSeq) {
      error.value = e instanceof Error ? e.message : '加载失败';
      loadFailed.value = true;
    }
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function validateValidUntil(): string {
  if (!validUntilUI.value) {
    return '请填写报价有效期';
  }
  const due = new Date(validUntilUI.value);
  if (Number.isNaN(due.getTime())) {
    return '报价有效期格式无效';
  }
  if (due.getTime() <= Date.now()) {
    return '报价有效期必须晚于当前时间';
  }
  return '';
}

async function save(): Promise<void> {
  if (busy.value || dialogBusy.value || loading.value || loadFailed.value) return;
  const invalid = validateValidUntil() || validateLines();
  if (invalid) {
    lineError.value = invalid;
    return;
  }
  lineError.value = '';
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const payload = wirePayload();
    const submittedFingerprint = draftFingerprint.value;
    if (isNew.value) {
      const command = { idempotencyKey: crypto.randomUUID() };
      const created = opportunityId.value
        ? await createQuotation(command, customerId.value, toInstantString(validUntilUI.value), payload, opportunityId.value)
        : await createQuotation(command, customerId.value, toInstantString(validUntilUI.value), payload);
      quotation.value = created;
      quotationId.value = created.quotationId;
      // 切到已创建对象的 URL：刷新可恢复、二次保存不再新建
      await router.replace(`/quotations/${created.quotationId}`);
      // 路由监听会重置旧对象状态；导航完成后再落一次成功反馈，避免提示一闪而过。
      message.value = '草稿已创建';
    } else {
      const edited = await editQuotation(
        { idempotencyKey: crypto.randomUUID() },
        quotationId.value as string, toInstantString(validUntilUI.value), payload);
      quotation.value = edited;
      // 仅确认本次提交的内容；请求期间产生的新修改仍保持未保存状态。
      savedDraftFingerprint.value = submittedFingerprint;
      message.value = '草稿已保存（版本号不变，聚合版本递增）';
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    busy.value = false;
  }
}

async function issue(): Promise<void> {
  if (busy.value || dialogBusy.value || loading.value || loadFailed.value) return;
  if (hasUnsavedChanges.value) {
    error.value = '有未保存的修改，请先保存，再签发报价。';
    return;
  }
  const invalid = validateValidUntil() || validateLines();
  if (invalid) {
    lineError.value = invalid;
    return;
  }
  lineError.value = '';
  if (!quotation.value) {
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    quotation.value = await patchQuotation({ idempotencyKey: crypto.randomUUID() }, quotation.value.quotationId, { state: 'issued', quotationVersion: quotation.value.currentVersion, expectedAggregateVersion: quotation.value.aggregateVersion });
    message.value = '已签发：报价对外生效，等待客户确认';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '签发失败';
  } finally {
    busy.value = false;
  }
}

async function runDialogAction(): Promise<void> {
  if (busy.value || dialogBusy.value) return;
  const kind = dialogKind.value;
  if (kind === 'confirm') {
    await confirm();
  } else if (kind === 'withdraw') {
    await withdraw();
  }
  if (!error.value) {
    dialogKind.value = null;
  }
}

async function confirm(): Promise<void> {
  if (!quotation.value) {
    return;
  }
  dialogBusy.value = true;
  error.value = '';
  try {
    quotation.value = await patchQuotation({ idempotencyKey: crypto.randomUUID() }, quotation.value.quotationId, { state: 'confirmed', quotationVersion: quotation.value.currentVersion, expectedAggregateVersion: quotation.value.aggregateVersion });
    message.value = `已成交：订单 ${quotation.value.confirmedOrderId ?? ''} 与交付项已生成`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '确认失败';
  } finally {
    dialogBusy.value = false;
  }
}

async function withdraw(): Promise<void> {
  if (!quotation.value) {
    return;
  }
  dialogBusy.value = true;
  error.value = '';
  try {
    quotation.value = await patchQuotation({ idempotencyKey: crypto.randomUUID() }, quotation.value.quotationId, { state: 'withdrawn' });
    message.value = '已撤回（终态）';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '撤回失败';
  } finally {
    dialogBusy.value = false;
  }
}

async function renegotiate(): Promise<void> {
  if (!quotation.value) {
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const derived = await renegotiateQuotation(
      { idempotencyKey: crypto.randomUUID() }, quotation.value.quotationId);
    message.value = `已派生新草稿 ${derived.quotationId}（确认新报价时旧报价自动作废）`;
    await router.push(`/quotations/${derived.quotationId}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '重议失败';
  } finally {
    busy.value = false;
  }
}

// 路由参数变化时重载对象（重议跳转/保存后 replace 都走到这里）
watch(() => route.params.quotationId, (newId, oldId) => {
  if (newId !== oldId) {
    quotation.value = null;
    savedDraftFingerprint.value = null;
    fulfillmentDone.value = false;
    error.value = '';
    message.value = '';
    lines.value = [];
    void load();
  }
});

onMounted(() => void load());
</script>
