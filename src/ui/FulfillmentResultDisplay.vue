<template>
  <div class="crm-result-cell">
    <span class="wrap-cell">{{ result.summary }}</span>
    <button
      v-if="result.available"
      class="table-action"
      type="button"
      @click="open = true"
    >
      查看结果
    </button>
    <Drawer
      :open="open"
      title="交付结果"
      :description="`交付项 ${item.fulfillmentId} · 订单行 ${item.orderLineId}`"
      :pending="false"
      @close="open = false"
    >
      <pre class="crm-result-detail">{{ result.content }}</pre>
    </Drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import type { CrmFulfillmentItem } from '../api/crmApi';
import { crmIdentityVersion } from '../auth/pkce';

const props = defineProps<{ item: CrmFulfillmentItem }>();
const open = ref(false);
const result = computed(() => {
  const raw = props.item.resultData;
  if (!raw?.trim()) return {
    available: false, content: '', summary: props.item.state === 'completed' ? '已完成，未回填结果' : '未回填结果'
  };
  try {
    const parsed: unknown = JSON.parse(raw);
    const count = Array.isArray(parsed) ? ` · ${parsed.length} 项`
      : parsed && typeof parsed === 'object' ? ` · ${Object.keys(parsed).length} 个字段` : '';
    return { available: true, content: JSON.stringify(parsed, null, 2), summary: `结构化结果${count}` };
  } catch {
    const brief = raw.trim().replace(/\s+/g, ' ');
    return { available: true, content: raw, summary: brief.length > 80 ? `${brief.slice(0, 80)}…` : brief };
  }
});
watch(crmIdentityVersion, () => { open.value = false; }, { flush: 'sync' });
</script>
