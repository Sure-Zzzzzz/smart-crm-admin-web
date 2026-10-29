import { createApp, watch, type App as VueApp } from 'vue';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { qiankunWindow, renderWithQiankun } from 'vite-plugin-qiankun/dist/helper';
import {
  applyTheme,
  createLightThemePreference,
  type ThemeSnapshot
} from '@sure-zzzzzz/simple-iam-theme-contract';
import '@sure-zzzzzz/simple-iam-theme-contract/theme.css';
import App from './App.vue';
import { beginCrmAuthorization, configureCrmIdentitySource, crmAccessToken, synchronizeCrmIdentity } from './auth/pkce';
import { configureCrmApi, setCrmUnauthorizedHandler } from './api/crmApi';
import DashboardView from './view/DashboardView.vue';
import CustomersView from './view/CustomersView.vue';
import OpportunitiesView from './view/OpportunitiesView.vue';
import OpportunityDetailView from './view/OpportunityDetailView.vue';
import CustomerDetailView from './view/CustomerDetailView.vue';
import OfferingsView from './view/OfferingsView.vue';
import QuotationEditorView from './view/QuotationEditorView.vue';
import QuotationsListView from './view/QuotationsListView.vue';
import OrdersView from './view/OrdersView.vue';
import FulfillmentView from './view/FulfillmentView.vue';
import OrderDetailView from './view/OrderDetailView.vue';
import TeamView from './view/TeamView.vue';
import AuditView from './view/AuditView.vue';
import ConsumersView from './view/ConsumersView.vue';
import OAuthCallbackView from './view/OAuthCallbackView.vue';
import { setCrmCurrentUser, type CrmCurrentUser } from './ui/crmDisplay';
import './style.css';

let app: VueApp<Element> | null = null;
let router: Router | null = null;
let root: HTMLElement | null = null;
let releaseTheme = () => undefined as void;
let releaseIdentity = () => undefined as void;
let currentUserSource: MountProps['getCurrentUser'];

interface MountProps {
  container?: Element | Document;
  routePrefix?: string;
  apiBase?: string;
  getCurrentUser?: () => CrmCurrentUser | null;
  theme?: { current(): ThemeSnapshot; subscribe(listener: (snapshot: ThemeSnapshot) => void): () => void };
}

function createCrmRouter(base: string) {
  const instance = createRouter({
    history: createWebHistory(base),
    routes: [
      { path: '/', component: DashboardView },
      { path: '/customers', component: CustomersView },
      { path: '/customers/:customerId', component: CustomerDetailView },
      { path: '/opportunities', component: OpportunitiesView },
      { path: '/opportunities/:opportunityId', component: OpportunityDetailView },
      { path: '/offerings', component: OfferingsView },
      { path: '/quotations', component: QuotationsListView },
      { path: '/quotations/new', component: QuotationEditorView },
      { path: '/quotations/:quotationId', component: QuotationEditorView },
      { path: '/orders', component: OrdersView },
      { path: '/orders/:orderId', component: OrderDetailView },
      { path: '/fulfillment', component: FulfillmentView },
      { path: '/team', component: TeamView },
      { path: '/audit', component: AuditView },
      { path: '/consumers', component: ConsumersView },
      { path: '/oauth-callback', component: OAuthCallbackView },
      { path: '/:pathMatch(.*)*', redirect: '/' }
    ]
  });
  instance.beforeEach(to => {
    if (to.path === '/oauth-callback') {
      return true;
    }
    if (!crmAccessToken()) {
      beginCrmAuthorization(to.fullPath);
      return false;
    }
    return true;
  });
  return instance;
}

function applyCrmTheme(props: MountProps): void {
  releaseTheme();
  releaseTheme = () => undefined as void;
  if (root) {
    applyTheme(root, props.theme?.current() ?? createLightThemePreference());
    if (props.theme) {
      releaseTheme = props.theme.subscribe(snapshot => {
        if (root) {
          applyTheme(root, snapshot);
        }
      });
    }
  }
}

function bindCrmIdentity(props: MountProps): void {
  releaseIdentity();
  currentUserSource = props.getCurrentUser;
  setCrmCurrentUser(props.getCurrentUser?.() ?? null);
  configureCrmIdentitySource(props.getCurrentUser
    ? () => props.getCurrentUser?.()?.subjectId ?? null : null);
  releaseIdentity = watch(() => {
    const user = props.getCurrentUser?.();
    return [user?.subjectId, user?.username, user?.displayName];
  }, () => {
    setCrmCurrentUser(props.getCurrentUser?.() ?? null);
    synchronizeCrmIdentity();
  }, { flush: 'sync' });
}

function render(props: MountProps = {}) {
  bindCrmIdentity(props);
  router = createCrmRouter(qiankunWindow.__POWERED_BY_QIANKUN__
    ? `${props.routePrefix || '/app/crm'}/`
    : '/app/crm/');
  configureCrmApi(props.apiBase ?? '/api/crm');
  setCrmUnauthorizedHandler(() => {
    if (router) {
      beginCrmAuthorization(router.currentRoute.value.fullPath);
    }
  });
  app = createApp(App);
  app.use(router);
  const container = props.container?.querySelector('#app') || document.querySelector('#app');
  if (container instanceof HTMLElement) {
    app.mount(container);
    root = container;
    applyCrmTheme(props);
  }
}

renderWithQiankun({
  bootstrap() {},
  mount(props) {
    render(props as MountProps);
  },
  unmount() {
    releaseIdentity();
    releaseIdentity = () => undefined as void;
    currentUserSource = undefined;
    setCrmCurrentUser(null);
    configureCrmIdentitySource(null);
    releaseTheme();
    releaseTheme = () => undefined as void;
    setCrmUnauthorizedHandler(null);
    app?.unmount();
    app = null;
    router = null;
    root = null;
  },
  update(props) {
    applyCrmTheme(props as MountProps);
    if ((props as MountProps).getCurrentUser !== currentUserSource) {
      bindCrmIdentity(props as MountProps);
    }
    setCrmCurrentUser((props as MountProps).getCurrentUser?.() ?? null);
    synchronizeCrmIdentity();
  }
});

if (!qiankunWindow.__POWERED_BY_QIANKUN__) {
  render();
}
