// CRM Server RESTful API 客户端：PKCE 令牌自动附带、401 触发重新授权回调。
import { clearCrmToken, crmAccessToken, crmIdentityEpoch } from '../auth/pkce';

export class CrmApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'CrmApiError';
  }
}

export interface CrmPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CrmCustomer {
  id: string;
  displayName: string;
  state: string;
  owner: string;
}

/** 商机阶段（服务端稳定 code，六阶段；won 只能由报价确认成交派生） */
export type CrmOpportunityStage =
  | 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';

export const CRM_OPPORTUNITY_STAGES: readonly CrmOpportunityStage[] =
  ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

export interface CrmOpportunity {
  opportunityId: string;
  customerId: string;
  owner: string;
  title: string;
  primaryOfferingId: string | null;
  contactId: string | null;
  expectedCloseDate: string | null;
  estimatedAmount: string | null;
  currency: string | null;
  stage: CrmOpportunityStage;
  lostReason: string | null;
  aggregateVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmOffering {
  id: string;
  offeringReference?: string;
  displayName: string;
  state: string;
  owner: string;
  /** 商业能力类型（v1 唯一合法值 fixed_price_fulfillment_v1，领域常量而非业务标识） */
  capabilityType?: string;
  requiredConsumerCapability?: string;
}

export interface CrmQuotation {
  /** 展示态：draft/issued/confirmed/withdrawn/superseded/expired（终态真相=版本行 state） */
  state: string;
  quotationId: string;
  customerId: string;
  opportunityId?: string | null;
  owner: string;
  aggregateVersion: number;
  currentVersion: number;
  currentConfirmableVersion: number | null;
  confirmedOrderId: string | null;
  supersedesQuotationId: string | null;
}

export interface CrmFulfillmentItem {
  fulfillmentId: string;
  orderId: string;
  orderLineId: string;
  owner: string;
  assignedConsumerId: string;
  state: string;
  reportSequence: number;
  resultData?: string | null;
}

let unauthorizedHandler: (() => void) | null = null;
let reauthorizationPending = false;

/** 注册 401 处理器（路由层注入重新授权跳转）。 */
export function setCrmUnauthorizedHandler(handler: (() => void) | null): void {
  if (handler !== unauthorizedHandler || !handler) reauthorizationPending = false;
  unauthorizedHandler = handler;
}

/** 等待新令牌期间只发起一次授权，页面重挂不能覆盖已发出的 PKCE 请求。 */
function requestCrmReauthorization(revokeToken = false): void {
  const handler = reauthorizationPending ? null : unauthorizedHandler;
  // 先登记授权状态，再撤销令牌；同步身份监听器也可能重新请求业务数据。
  if (handler) reauthorizationPending = true;
  if (revokeToken) clearCrmToken();
  if (!handler) return;
  if (handler !== unauthorizedHandler) {
    // 同步撤销期间可能换挂载；交给当前处理器，已由重入发起的授权不重复执行。
    if (!reauthorizationPending) requestCrmReauthorization();
    return;
  }
  try {
    handler();
  } catch (error) {
    reauthorizationPending = false;
    throw error;
  }
}

let apiBase = '/api/crm';

/** 注入 API 基路径（门户挂载参数传入；默认同源 /api/crm，独立调试走 vite 代理）。 */
export function configureCrmApi(base: string): void {
  const normalized = base.replace(/\/$/, '');
  if (!normalized.startsWith('/')) {
    throw new Error('API 基路径必须是同源绝对路径');
  }
  apiBase = normalized;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = crmAccessToken();
  const epoch = crmIdentityEpoch();
  const current = () => epoch === crmIdentityEpoch() && token === crmAccessToken();
  if (!current()) throw new CrmApiError('身份已变化，请重新查询', 409);
  if (!token) {
    requestCrmReauthorization();
    throw new CrmApiError('登录已过期', 401);
  }
  // 新的有效令牌结束上一轮授权等待，后续失效仍能重新授权。
  reauthorizationPending = false;
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Authorization', `Bearer ${token}`);
  // 浏览器业务请求仅 Bearer，禁止附带 Cookie（接入手册形态：带 Cookie 会被资源链会话分支拒绝）
  const response = await fetch(`${apiBase}${path}`, { ...init, credentials: 'omit', headers });
  if (!current()) {
    throw new CrmApiError('身份已变化，请重新查询', 409);
  }
  if (response.status === 401) {
    requestCrmReauthorization(true);
    throw new CrmApiError('登录已过期', 401);
  }
  if (!response.ok) {
    let message = `请求失败: ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) {
        message = body.message;
      }
    } catch {
      // 非 JSON 错误体：保留状态码消息
    }
    if (!current()) throw new CrmApiError('身份已变化，请重新查询', 409);
    throw new CrmApiError(message, response.status);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const body = await response.json() as T | { data: T };
  if (!current()) {
    throw new CrmApiError('身份已变化，请重新查询', 409);
  }
  return body && typeof body === 'object' && 'data' in body ? body.data : body as T;
}

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** PATCH 动作分派查询参数：服务端按 state/owner/sequence 路由并挂接逐动作权限码。 */
function patchRouting(patch: { state?: string; owner?: string; sequence?: number }): string {
  return query({ state: patch.state, owner: patch.owner, sequence: patch.sequence });
}

export interface CrmIdempotency {
  idempotencyKey: string;
  correlationId?: string;
}

function commandHeaders(command: CrmIdempotency): Headers {
  const headers = new Headers();
  headers.set('Idempotency-Key', command.idempotencyKey);
  if (command.correlationId) {
    headers.set('X-Correlation-Id', command.correlationId);
  }
  return headers;
}

// ===== 客户 =====

export function getCustomer(customerId: string): Promise<CrmCustomer> {
  return request(`/customers/${encodeURIComponent(customerId)}`);
}

export interface CrmOrder {
  orderId: string;
  sourceQuotationId: string;
  customerId: string;
  totalAmount: { amount: string; currency: string };
  displayState: string;
}

export interface CrmOrderLine {
  orderLineId: string;
  sourceQuotationLineId: string;
  offeringReference: string;
  quantity: string;
  unit: string;
  unitPrice: { amount: string; currency: string };
  lineTotal: { amount: string; currency: string };
  obligation: CrmFulfillmentObligation;
}

export interface CrmFulfillmentObligation {
  subjectReference: string;
  fulfillmentScope: string;
  requiredConsumerCapability: string;
}

export interface CrmOrderDetail extends CrmOrder {
  sourceQuotationVersion: number;
  settlementCurrency: string;
  owner: string;
  lines: CrmOrderLine[];
}

export function getOrder(orderId: string): Promise<CrmOrderDetail> {
  return request(`/orders/${encodeURIComponent(orderId)}`);
}

export function listOrders(keyword?: string, cursor?: string, limit = 20): Promise<CrmPage<CrmOrder>> {
  return request(`/orders${query({ keyword, cursor, limit })}`).then(body => ({
    items: (body as { items: CrmOrder[] }).items,
    nextCursor: (body as { nextCursor: string | null }).nextCursor ?? null
  }));
}

export function listCustomers(state?: string, cursor?: string, limit = 20, keyword?: string): Promise<CrmPage<CrmCustomer>> {
  return request(`/customers${query({ state, cursor, limit, keyword })}`).then(body => ({
    items: (body as { items: CrmCustomer[] }).items,
    nextCursor: (body as { nextCursor: string | null }).nextCursor ?? null
  }));
}

export function createCustomer(command: CrmIdempotency, displayName: string): Promise<CrmCustomer> {
  return request('/customers', {
    method: 'POST',
    headers: commandHeaders(command),
    body: JSON.stringify({ displayName })
  });
}

export function patchCustomer(
  command: CrmIdempotency,
  customerId: string,
  patch: { state?: string; mergeTargetId?: string; owner?: string }
): Promise<CrmCustomer> {
  return request(`/customers/${encodeURIComponent(customerId)}${patchRouting(patch)}`, {
    method: 'PATCH',
    headers: commandHeaders(command),
    body: JSON.stringify(patch)
  });
}

// ===== 商机 =====

export interface CreateOpportunityInput {
  customerId: string;
  title: string;
  primaryOfferingId?: string;
  contactId?: string;
  expectedCloseDate?: string;
  estimatedAmount?: string;
  currency?: string;
}

export function getOpportunity(opportunityId: string): Promise<CrmOpportunity> {
  return request(`/opportunities/${encodeURIComponent(opportunityId)}`);
}

export function pageOpportunities(params: CrmPageQuery): Promise<CrmNumberedPage<CrmOpportunity>> {
  return numberedPage<CrmOpportunity>('/opportunities', params);
}

export function listOpportunities(stage?: string, cursor?: string, limit = 20, keyword?: string, customerId?: string): Promise<CrmPage<CrmOpportunity>> {
  return request(`/opportunities${query({ stage, cursor, limit, keyword, customerId })}`).then(body => ({
    items: (body as { items: CrmOpportunity[] }).items,
    nextCursor: (body as { nextCursor: string | null }).nextCursor ?? null
  }));
}

export function createOpportunity(command: CrmIdempotency, input: CreateOpportunityInput): Promise<CrmOpportunity> {
  return request('/opportunities', {
    method: 'POST',
    headers: commandHeaders(command),
    body: JSON.stringify(input)
  });
}

export function transitionOpportunity(
  command: CrmIdempotency,
  opportunityId: string,
  stage: CrmOpportunityStage,
  lostReason?: string
): Promise<CrmOpportunity> {
  return request(`/opportunities/${encodeURIComponent(opportunityId)}${query({ stage })}`, {
    method: 'PATCH',
    headers: commandHeaders(command),
    body: JSON.stringify({ stage, ...(lostReason ? { lostReason } : {}) })
  });
}

export function transferOpportunity(command: CrmIdempotency, opportunityId: string, owner: string): Promise<CrmOpportunity> {
  return request(`/opportunities/${encodeURIComponent(opportunityId)}${query({ owner })}`, {
    method: 'PATCH',
    headers: commandHeaders(command),
    body: JSON.stringify({ owner })
  });
}

// ===== 目录 =====

export function listOfferings(state?: string, cursor?: string, limit = 20, keyword?: string): Promise<CrmPage<CrmOffering>> {
  return request(`/offerings${query({ state, cursor, limit, keyword })}`).then(body => ({
    items: (body as { items: CrmOffering[] }).items,
    nextCursor: (body as { nextCursor: string | null }).nextCursor ?? null
  }));
}

export function createOffering(
  command: CrmIdempotency,
  offeringReference: string,
  displayName: string,
  requiredConsumerCapability: string
): Promise<CrmOffering> {
  return request('/offerings', {
    method: 'POST',
    headers: commandHeaders(command),
    body: JSON.stringify({
      offeringReference,
      displayName,
      // v1 唯一商业能力类型（固定单价履约），领域合法值而非业务标识
      capabilityType: 'fixed_price_fulfillment_v1',
      requiredConsumerCapability
    })
  });
}

export function patchOffering(
  command: CrmIdempotency,
  offeringId: string,
  patch: { state: string }
): Promise<CrmOffering> {
  return request(`/offerings/${encodeURIComponent(offeringId)}${patchRouting(patch)}`, {
    method: 'PATCH',
    headers: commandHeaders(command),
    body: JSON.stringify(patch)
  });
}

export interface CrmContact {
  id: string;
  customerId: string;
  displayName: string;
  title: string | null;
  state: string;
}

export function listContacts(customerId: string, cursor?: string, limit = 20): Promise<CrmPage<CrmContact>> {
  return request(`/contacts${query({ customerId, cursor, limit })}`).then(body => ({
    items: (body as { items: CrmContact[] }).items,
    nextCursor: (body as { nextCursor: string | null }).nextCursor ?? null
  }));
}

export function createContact(command: CrmIdempotency, customerId: string, displayName: string, title?: string): Promise<CrmContact> {
  return request('/contacts', {
    method: 'POST',
    headers: commandHeaders(command),
    body: JSON.stringify({ customerId, displayName, title })
  });
}

export interface CrmOperationLog {
  owner: string;
  action: string;
  targetResourceType: string;
  targetResourceId: string;
  correlationId: string | null;
  resultCode: string | null;
  occurredAt: string;
}

export function listOperationLogs(resourceId?: string, cursor?: string, limit = 20): Promise<CrmPage<CrmOperationLog>> {
  return request(`/operation-logs${query({ resourceId, cursor, limit })}`).then(body => ({
    items: (body as { items: CrmOperationLog[] }).items,
    nextCursor: (body as { nextCursor: string | null }).nextCursor ?? null
  }));
}

export interface CrmConsumer {
  consumerId: string;
  capability: string;
  protocolVersion: number;
  enabled: boolean;
}

export function listFulfillmentConsumers(): Promise<CrmConsumer[]> {
  return request('/fulfillment-consumers').then(body => (body as { items: CrmConsumer[] }).items);
}

export function upsertFulfillmentConsumer(command: CrmIdempotency, consumerId: string, capability: string, protocolVersion: number, enabled: boolean): Promise<void> {
  return request('/fulfillment-consumers', {
    method: 'POST',
    headers: commandHeaders(command),
    body: JSON.stringify({ consumerId, capability, protocolVersion, enabled })
  });
}

// ===== 报价 =====

export function getQuotation(quotationId: string): Promise<CrmQuotation> {
  return request(`/quotations/${encodeURIComponent(quotationId)}`);
}

export interface CrmQuotationLineView {
  quotationLineId: string;
  offeringId: string;
  offeringReference: string;
  quantity: string;
  unit: string;
  unitPrice: { amount: string; currency: string };
  lineTotal: { amount: string; currency: string };
  obligation: CrmFulfillmentObligation;
}

export interface CrmQuotationVersionView {
  quotationId: string;
  version: number;
  state: string;
  settlementCurrency: string;
  validUntil: string;
  totalAmount: { amount: string; currency: string };
  issuedAt: string | null;
  terminalAt: string | null;
  lines: CrmQuotationLineView[];
}

export function getQuotationVersion(quotationId: string, version: number): Promise<CrmQuotationVersionView> {
  return request(`/quotations/${encodeURIComponent(quotationId)}/versions/${version}`);
}

export function listQuotations(state?: string, cursor?: string, limit = 20, keyword?: string): Promise<CrmPage<CrmQuotation>> {
  return request(`/quotations${query({ state, cursor, limit, keyword })}`).then(body => ({
    items: (body as { items: CrmQuotation[] }).items,
    nextCursor: (body as { nextCursor: string | null }).nextCursor ?? null
  }));
}

export interface QuotationLineInput {
  offeringId: string;
  quantity: string;
  unit: string;
  unitPrice: { amount: string; currency: string };
  subjectReference: string;
  fulfillmentScope: string;
}

export function createQuotation(
  command: CrmIdempotency,
  customerId: string,
  validUntil: string,
  lines: QuotationLineInput[],
  opportunityId?: string
): Promise<CrmQuotation> {
  return request('/quotations', {
    method: 'POST',
    headers: commandHeaders(command),
    body: JSON.stringify({ customerId, validUntil, lines, ...(opportunityId ? { opportunityId } : {}) })
  });
}

export function editQuotation(
  command: CrmIdempotency,
  quotationId: string,
  validUntil: string,
  lines: QuotationLineInput[]
): Promise<CrmQuotation> {
  return request(`/quotations/${encodeURIComponent(quotationId)}`, {
    method: 'PUT',
    headers: commandHeaders(command),
    body: JSON.stringify({ validUntil, lines })
  });
}

export function patchQuotation(
  command: CrmIdempotency,
  quotationId: string,
  patch: {
    state?: string;
    quotationVersion?: number;
    expectedAggregateVersion?: number;
    owner?: string;
  }
): Promise<CrmQuotation> {
  return request(`/quotations/${encodeURIComponent(quotationId)}${patchRouting(patch)}`, {
    method: 'PATCH',
    headers: commandHeaders(command),
    body: JSON.stringify(patch)
  });
}

export function renegotiateQuotation(
  command: CrmIdempotency,
  sourceQuotationId: string
): Promise<CrmQuotation> {
  return request(`/quotations${query({ sourceQuotationId })}`, {
    method: 'POST',
    headers: commandHeaders(command)
  });
}

// ===== 履约 =====

export function listFulfillmentItems(
  state?: string,
  orderId?: string,
  cursor?: string,
  limit = 20
): Promise<CrmPage<CrmFulfillmentItem>> {
  return request(`/fulfillment-items${query({ state, orderId, cursor, limit })}`).then(body => ({
    items: (body as { items: CrmFulfillmentItem[] }).items,
    nextCursor: (body as { nextCursor: string | null }).nextCursor ?? null
  }));
}

export function patchFulfillmentItem(
  command: CrmIdempotency,
  fulfillmentId: string,
  patch: { sequence?: number; state: string; resultData?: string; note?: string }
): Promise<CrmFulfillmentItem> {
  return request(`/fulfillment-items/${encodeURIComponent(fulfillmentId)}${patchRouting(patch)}`, {
    method: 'PATCH',
    headers: commandHeaders(command),
    body: JSON.stringify(patch)
  });
}

/** 管理台页码模式：与机器游标参数严格分离。 */
export interface CrmNumberedPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CrmPageQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  state?: string;
  orderId?: string;
  resourceId?: string;
  customerId?: string;
}

function numberedPage<T>(path: string, params: CrmPageQuery): Promise<CrmNumberedPage<T>> {
  if (!Number.isSafeInteger(params.page) || params.page < 1
    || !Number.isSafeInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > 100
    || 'cursor' in params || 'limit' in params) {
    return Promise.reject(new CrmApiError('分页参数无效', 400));
  }
  return request<unknown>(`${path}${query({ ...params })}`).then(value => {
    if (!value || typeof value !== 'object') {
      throw new CrmApiError('分页响应格式无效：缺少对象', 502);
    }
    const page = value as Partial<CrmNumberedPage<T>>;
    const pageNumber = page.page;
    const responsePageSize = page.pageSize;
    const total = page.total;
    if (!Array.isArray(page.items)
      || typeof pageNumber !== 'number' || !Number.isSafeInteger(pageNumber) || pageNumber !== params.page
      || typeof responsePageSize !== 'number' || !Number.isSafeInteger(responsePageSize) || responsePageSize !== params.pageSize
      || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0
      || page.items.length > responsePageSize
      || (page.items.length > 0 && (pageNumber - 1) * responsePageSize + page.items.length > total)
      || Object.keys(value).some(key => !['items', 'page', 'pageSize', 'total'].includes(key))) {
      throw new CrmApiError('分页响应格式无效：应包含 items、page、pageSize、total', 502);
    }
    return {
      items: page.items as T[],
      page: page.page as number,
      pageSize: page.pageSize as number,
      total: page.total as number
    };
  });
}

export const pageCustomers = (params: CrmPageQuery) => numberedPage<CrmCustomer>('/customers', params);
export const pageOfferings = (params: CrmPageQuery) => numberedPage<CrmOffering>('/offerings', params);
export const pageQuotations = (params: CrmPageQuery) => numberedPage<CrmQuotation>('/quotations', params);
export const pageOrders = (params: CrmPageQuery) => numberedPage<CrmOrder>('/orders', params);
export const pageFulfillmentItems = (params: CrmPageQuery) => numberedPage<CrmFulfillmentItem>('/fulfillment-items', params);
export const pageConsumers = (params: CrmPageQuery) => numberedPage<CrmConsumer>('/fulfillment-consumers', params);
export const pageOperationLogs = (params: CrmPageQuery) => numberedPage<CrmOperationLog>('/operation-logs', params);
export const pageContacts = (params: CrmPageQuery) => numberedPage<CrmContact>('/contacts', params);

export function getOffering(offeringId: string): Promise<CrmOffering> {
  return request(`/offerings/${encodeURIComponent(offeringId)}`);
}
