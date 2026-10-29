<template>
  <button
    v-if="item.state === 'failed'"
    class="table-action"
    type="button"
    :disabled="pending"
    @click="open = true"
  >
    重置交付
  </button>
  <ConfirmDialog
    :open="open"
    title="重置失败交付项"
    :description="description"
    variant="confirm"
    :confirm-label="error ? '重试重置' : '确认重置'"
    :pending="pending"
    @close="close"
    @confirm="() => void submitReset()"
  />
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import ConfirmDialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import { CrmApiError, patchFulfillmentItem, type CrmFulfillmentItem } from '../api/crmApi';
import { crmAccessToken, crmIdentityEpoch, crmIdentityVersion } from '../auth/pkce';

const props = defineProps<{ item: CrmFulfillmentItem }>();
const emit = defineEmits<{ completed: [] }>();
const open = ref(false);
const pending = ref(false);
const error = ref('');
const description = computed(() => `交付项 ${props.item.fulfillmentId}（订单行 ${props.item.orderLineId}）将回到待执行，供承接服务重新处理；保留当前序号水位 ${props.item.reportSequence}，不会清空历史回报。${error.value ? ` 重置失败：${error.value}` : ''}`);
// 失败或取消确认后保留同一命令，防止响应丢失时以新键重复执行。
let command: { idempotencyKey: string; fulfillmentId: string; token: string | null; epoch: number } | null = null;
let sequence = 0;
let disposed = false;
onScopeDispose(() => { disposed = true; sequence++; });
watch(crmIdentityVersion, () => {
  sequence++;
  command = null;
  open.value = false;
  pending.value = false;
  error.value = '';
}, { flush: 'sync' });

function close(): void {
  if (!pending.value) open.value = false;
}

async function submitReset(): Promise<void> {
  if (pending.value || props.item.state !== 'failed') return;
  const token = crmAccessToken();
  const epoch = crmIdentityEpoch();
  if (!command || command.token !== token || command.epoch !== epoch || command.fulfillmentId !== props.item.fulfillmentId) {
    command = { idempotencyKey: crypto.randomUUID(), fulfillmentId: props.item.fulfillmentId, token, epoch };
  }
  const snapshot = command;
  const requestId = ++sequence;
  const current = () => !disposed && requestId === sequence && snapshot.epoch === crmIdentityEpoch() && snapshot.token === crmAccessToken();
  pending.value = true;
  error.value = '';
  try {
    await patchFulfillmentItem({ idempotencyKey: snapshot.idempotencyKey }, snapshot.fulfillmentId, { state: 'PENDING_DISPATCH' });
    if (!current()) return;
    open.value = false;
    command = null;
    emit('completed');
  } catch (failure) {
    if (!current()) return;
    error.value = failure instanceof CrmApiError && failure.status === 403
      ? '无权重置此交付项，请联系有授权的管理员。'
      : failure instanceof Error ? failure.message : '重置失败';
  } finally {
    if (current()) pending.value = false;
  }
}
</script>
