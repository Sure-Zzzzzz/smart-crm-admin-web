# CRM 管理台可信应用接入手册

CRM 管理台以 Portal（统一门户中的业务子页面）接入，当前候选宿主运行 `simple-crm-server-starter:1.1.0`（领域内核 `simple-crm-server-core:2.1.0`），Web 为 `smart-crm-admin-web:1.0.0`。管理宿主为 Spring Boot 2.7.9 / Java 8。本手册示例域名 `portal.example.test` 需替换为部署域名，不填写真实密钥到本仓。

## 1. 角色分工

| 系统 | 负责内容 |
| --- | --- |
| IAM | 可信应用登记、Portal 可见性、OAuth Client、权限清单、角色规则、人员准入与投影 |
| CRM Server | 商业事实（客户/目录/报价/订单/履约）、API 权限执行、DATA 范围评估、业务审计 |
| CRM Web | PKCE 取人员令牌，以 Bearer 调 CRM Server 管理 API |
| 机器消费者（如 license 服务） | AKP + 客户端五件套拉取回写履约项，不经浏览器 |

CRM Web 不保存 IAM 会话；人员令牌只存当前浏览器会话。机器消费者凭据不进 Web。

管理台列表接口使用独立的页码契约：浏览器请求只带 `page` 和 `pageSize`，服务端返回 `items`、`page`、`pageSize`、`total`；浏览器不把机器接口的 `cursor`、`limit` 与这组参数混用。`total` 是当前身份和筛选条件下的真实总数，Portal 页面据此显示分页。

## 2. IAM 侧注册

使用 IAM 管理台的可信应用创建流程，或调用同等管理 API（`POST /iam/admin/trusted-applications`，创建前先 `GET` 按应用编码查重）。[注册值对照模板](../deploy/iam/portal-registration.example.json) 是登记值的对照，不是批量导入请求体。

调用 IAM 管理 API 使用管理员 Bearer 令牌；涉及写入时，先从 `GET /iam/web/auth/csrf` 获取防跨站请求令牌，并以 `X-CSRF-TOKEN` 请求头提交。防跨站请求令牌不能代替管理员权限。凭据、令牌和实际运行态标识仅保存在部署环境，不写回模板。

| 字段 | CRM 基线值 | 规则 |
| --- | --- | --- |
| 应用编码 | `crm` | IAM 内唯一，与 CRM Server 应用授权编码一致 |
| 应用名称 | `CRM 管理台` | 用于 Portal 与授权页面展示 |
| 应用图标 | `project` | IAM 内置图标编码，用于应用卡片；不要填写 SVG、CSS 类名或外部 URL |
| Portal entry | `https://portal.example.test/app/crm/` | **目录形式，不带 index.html**（qiankun 挂载对 entry 尾部形态敏感） |
| Portal apiBase | `/api/crm` | 浏览器业务路径前缀 |
| Portal targetOrigin | `http://crm-web:80` | Gateway 路由的唯一业务 Nginx origin；页面与 API 共用，不填写 CRM Server 地址，不使用 HTTPS |
| routePrefix | `/app/crm` | IAM 按应用编码自动生成，不在创建请求中填写 |
| 初始 Client id | `<PUBLIC_CLIENT_ID>` | 由部署管理员登记并在构建环境 `VITE_CRM_IAM_CLIENT_ID` 注入；实际值不写回仓库 |
| 初始 Client 类型 | `PUBLIC` | 浏览器公共客户端，不生成 Secret |
| redirect URI | `https://portal.example.test/app/crm/oauth-callback` | 协议、域名、端口和路径须精确匹配 |
| grantTypes | `authorization_code`、`refresh_token` | 授权码流程及 S256 PKCE |
| authenticationMethods | `none` | 浏览器不持有客户端 Secret |
| scopes | `openid`、`profile` | OAuth 请求范围，不代替 API 权限或 DATA |
| requireConsent | 按组织策略 | 授权确认页配置 |

创建请求可同时携带初始权限清单（roles/pagePermissions/apiPermissions/dataResources）与门户菜单（portal.menuTree），IAM 在创建事务中先登记清单后保存菜单。保存实际返回的 `applicationId`；应用 id、用户 id、角色 id 是运行态值，不写回仓库模板。`portal.menus` 只保留给 1.0 平铺菜单兼容场景，新接入统一使用 `menuTree`。

## 3. Portal 菜单与页面权限

CRM 菜单绑定页面权限 `crmWeb:page`（单码多菜单）。GROUP 表示只收纳子节点的目录，PAGE 表示可导航的页面。目录按业务职责分组，GROUP 不绑定路由和页面权限：

| 上级目录 | 菜单 code | 名称 | 图标 | 子应用 route | 页面权限 |
| --- | --- | --- | --- | --- | --- |
| — | `crm-dashboard` | 工作台 | `dashboard` | `/` | `crmWeb:page` |
| — | `crm-directory` | 客户与商品（GROUP） | `folder` | — | — |
| 客户与商品 | `crm-customers` | 客户 | `users` | `/customers` | `crmWeb:page` |
| 客户与商品 | `crm-offerings` | 商品目录 | `database` | `/offerings` | `crmWeb:page` |
| — | `crm-trading` | 交易管理（GROUP） | `project` | — | — |
| 交易管理 | `crm-opportunities` | 商机 | `analytics` | `/opportunities` | `crmWeb:page` |
| 交易管理 | `crm-quotations` | 报价单 | `document` | `/quotations` | `crmWeb:page` |
| 交易管理 | `crm-orders` | 订单 | `project` | `/orders` | `crmWeb:page` |
| — | `crm-fulfillment-management` | 履约管理（GROUP） | `workflow` | — | — |
| 履约管理 | `crm-fulfillment` | 交付 | `workflow` | `/fulfillment` | `crmWeb:page` |
| 履约管理 | `crm-consumers` | 承接方 | `data-service` | `/consumers` | `crmWeb:page` |
| — | `crm-audit` | 审计记录 | `search` | `/audit` | `crmWeb:page` |

注册模板中的 `menuTree` 是本仓的唯一菜单基线：根级保留工作台和审计记录，其他页面分别放入“客户与商品”“交易管理”“履约管理”三个 GROUP。本仓基线不使用只有一个子项的 GROUP；图标只能使用 IAM 内置编码，当前基线使用 `folder`、`project`、`workflow` 作为 GROUP 图标，页面使用与业务含义对应的内置图标。修改名称或图标不会改变路由 code、页面权限或 API 权限。

根节点按表中顺序设置 `sortOrder=1..5`，三个 GROUP 的子页面按表中顺序设置连续序号。所有 PAGE 的 `presentationMode` 为 `STANDARD`（保留门户顶栏和侧栏）、`children` 为空数组；GROUP 的 `route`、`requiredPagePermission` 为空，省略 `presentationMode`，`children` 为非空数组。整棵树最多四层。PAGE 的 `route` 相对 `/app/crm`，不再重复填写门户前缀。

IAM 支持的图标编码为 `access-control`、`users`、`key`、`settings`、`lock`、`dashboard`、`project`、`message`、`calendar`、`workflow`、`data-service`、`database`、`analytics`、`document`、`folder`、`search`、`cloud`、`network`、`developer`、`application`、`default`。未知编码会被拒绝；不指定图标时 GROUP 回退为文件夹、PAGE 回退为文档，不能用自定义 SVG 或 CSS 类名代替编码。

`/team` 是保留路由，不在登记菜单中。该页与客户、报价列表使用相同的服务端授权范围；不存在由前端额外扩张的团队数据范围。订单与交付使用独立菜单，订单详情中的交付项仅为本单的关联事实。

更新已有应用时先读 `GET /iam/admin/trusted-applications/{applicationId}` 的当前 Portal 配置，再调用 `PUT /iam/admin/trusted-applications/{applicationId}/portal/configuration` 提交完整快照：须包含 `enabled`、完整 `menuTree` 与读取时的 `configVersion`；`menus` 与 `menuTree` 不能同时提交，空树清空菜单。创建接口不设置默认入口；创建后如需固定工作台为入口，再提交 `defaultEntry`：`{"pageMenuCode":"crm-dashboard","entryPath":"/"}`，且目标必须是树中的 PAGE。菜单可见不代表具备业务 API 权限，隐藏菜单不能代替服务端拒绝。任何菜单树调整（新增 GROUP、调整顺序、改名称或图标）都必须回读保存后的 `menuTree` 和 `configVersion`，再通过正式 Portal 刷新确认。

注册值对照模板的 `entry`、`apiBase`、`targetOrigin` 和 `menuTree` 对应创建请求的 `portal.entry`、`portal.apiBase`、`portal.targetOrigin` 和 `portal.menuTree`；`routePrefix` 由 IAM 生成，不提交；`defaultEntry` 对应创建后 Portal 配置请求的同名字段，不能直接把整份模板当作创建请求体。更新请求须携带回读的 `entry`、`apiBase`、`targetOrigin` 和有效 `configVersion`；现有默认入口不在调整范围时，使用其原值，其中响应的 `path` 映射为请求的 `entryPath`。应用图标另通过 `PUT /iam/admin/trusted-applications/{applicationId}` 的 `icon` 字段更新，不在菜单配置请求中填写。

## 4. 权限清单

[权限清单模板](../deploy/iam/permission-catalog.json) 声明 CRM 全部权限。声明权限码只说明应用支持该能力，不自动授予用户；实际权限由角色规则和用户投影决定。

PAGE 是页面权限；API 是接口操作权限；DATA 是允许读写的数据范围。三者不能互相替代：

| 类型 | 登记值 |
| --- | --- |
| PAGE | `crmWeb:page` |
| API 客户 | `crm.customer.create` `crm.customer.read` `crm.customer.list` `crm.customer.disable` `crm.customer.activate` `crm.customer.merge` `crm.customer.transfer` |
| API 联系人 | `crm.contact.create` `crm.contact.read` `crm.contact.list` |
| API 目录 | `crm.offering.create` `crm.offering.read` `crm.offering.list` `crm.offering.publish` `crm.offering.disable` |
| API 商机 | `crm.opportunity.create` `crm.opportunity.read` `crm.opportunity.list` `crm.opportunity.stage` `crm.opportunity.transfer` |
| API 报价 | `crm.quotation.create` `crm.quotation.read` `crm.quotation.list` `crm.quotation.edit` `crm.quotation.issue` `crm.quotation.confirm` `crm.quotation.withdraw` `crm.quotation.renegotiate` `crm.quotation.transfer` |
| API 订单/履约 | `crm.order.read` `crm.order.list` `crm.fulfillment.read` `crm.fulfillment.list` `crm.fulfillment.report` `crm.fulfillment.reset` `crm.fulfillment.consumer-admin` |
| API 审计 | `crm.audit.read` |
| DATA | 资源 `crm-customer`、动作 `read/write`、维度 `owner`（归属主体）；本仓登记模板声明 `EQ`（等值） |

DATA 授权文档须使用 `simple-data-permission` 协议结构：`{"protocol":"simple-data-permission","version":"1.0","grants":[{"resource":"crm-customer","actions":["read","write"],"all":true,"constraints":[]}]}`。`all=true` 表示覆盖全部归属人，仅适合管理角色；受限角色按实际范围配置。

列表和点查使用服务端 DATA 读范围：全部授权读取全量，受限授权读取本人及授权归属集合。普通写入仍校验业务事实归属，消费者回报还校验派发的 `consumerId`。合并、归属转移等治理动作另有 API 权限码；`all=true` 的读范围不能代替跨归属写权限。交付重置要求 `crm.fulfillment.reset` 和该交付项的业务归属校验；前端仅在失败项展示确认入口，403（无权）及归属拒绝必须作为失败处理。

## 5. 角色规则与人员准入

按部门、组织或用户组等稳定关系配置应用准入，不逐个人 ID 硬编码。以下四档角色由部署管理员在 IAM 创建并配置规则，权限清单登记不会自动创建角色或授予人员：

| 角色 | 定位 | API 面 | DATA |
| --- | --- | --- | --- |
| `crm-admin` | 全权限（运维/超管） | 本仓 API 清单全量（含审计、消费者注册管理） | read/write `all=true` |
| `crm-supervisor` | 主管团队治理 | 销售操作及合并、归属转移、审计；不含消费者注册管理 | read/write，按管理范围配置 |
| `crm-sales` | 销售日常 | 建档、目录、报价流程、订单和交付；不授审计、合并、客户/报价归属转移、消费者注册管理 | read/write，按业务归属配置 |
| `crm-viewer` | 只读观察 | 查询 API 与审计；不授写入 API | read，按可见范围配置 |

配置顺序（官方 API 链路；SQL 直插不触发投影重算，禁止）：

1. `POST /iam/admin/roles` 建角色（按角色编码查重后建），保存实际 `roleId`。
2. 按用户对外 `subjectId`（不是数字 id）先读 `GET /iam/admin/users/{subjectId}/application-authorizations/{applicationId}`。没有授权记录时，先用同路径 `PUT` 建立 `admitted=true` 准入；空角色、页面、API 和 DATA 仅适用于首次建记录。已有记录若需调整准入，必须保留回读的完整角色、页面、API 和 DATA 内容，不得提交空权限覆盖已有授权。
3. `PUT /iam/admin/roles/{roleId}/authorization-rules/{applicationId}` 提交该角色完整规则（pagePermissions/apiPermissions/dataGrantTemplate），触发已关联用户投影重算；重复配置前先读取实际规则，避免覆盖。已有角色关联的用户建立准入后，同样通过保存规则重算投影。
4. `POST /iam/admin/users/{subjectId}/roles/{roleId}` 分配尚未关联的角色，触发投影重算；重复分配已有角色不会再次重算，不能将其作为修复投影的操作。
5. 重读用户应用授权核对准入、角色、页面、API 与 DATA 投影。不要在投影完成后再用空权限的完整授权 `PUT` 建立准入，该操作会清空已生成的权限。

机器消费者不是业务角色：持 AKP 获取 CRM 应用准入，只消费履约项时授予 `crm.fulfillment.read/list/report`，不授 PAGE。DATA 使用已登记的 `crm-customer` 资源及所需 `read/write` 动作；机器履约点查、列表和回报另按真实 AKP `clientId` 强制匹配冻结的派发归属，DATA 全范围也不能越过该关系。

消费方若还需点查订单补齐客户、商品和数量，例如 License 宿主的履约适配器，还须申领 `crm.order.read`，并将该订单实际 `owner` 纳入 `crm-customer/read` 的 DATA 范围。订单读取仍按业务归属判定，履约派发给该消费方不会自动授予订单读取权限；不要为此默认授予全部客户、订单列表、消费者治理或 PAGE 权限。接入用客户端五件套：`simple-crm-aksk-resttemplate-client-starter` 或 `simple-crm-aksk-feign-client-starter`（各带 jakarta 变体，按运行线与传输偏好选择）。

## 6. 宿主和网关

管理宿主属性前缀为 `io.github.surezzzzzz.sdk.crm.server`，明确配置 `enable=true`；HTTP 路径固定为 `/api/crm`，Web `apiBase` 与该路径保持一致。宿主显式安装公共 Resource Server（业务 API 的统一验证入口）与人员/机器两个 Provider；公共资源链 `protectedPaths` 包含精确 `/api/crm/**`。

浏览器业务路径 `/api/crm/**` 经 Gateway 原样转发到 CRM Web Nginx，再由 Nginx 转发到管理宿主（不做 SPA 兜底）；页面 `/app/crm/**` 与 API 共用该 Nginx。身份授权和令牌交换 `/oauth2/authorize`、`/oauth2/token` 走同源身份网关，不改写为业务路径。宿主侧人员令牌与机器令牌验证配置以其各自 Provider 已发布契约为准，本仓不虚构验证字段。

Web 构建前将 `.env.example` 复制为 `.env.local`，注入与 IAM 登记一致的公共客户端标识。正式 Portal 只加载 `pnpm build` 产生的 `dist/`，不使用 Vite 开发服务。生产/统一入口由 `simple-crm-server-runtime/deploy/docker-compose.yml` 同时启动 `crm-web` 与 `crm-server`；`deploy/nginx.conf` 中的 `crm-server:8080` 只允许在业务内部网络解析，不能登记为 Gateway `targetOrigin`，也不能发布宿主端口。身份网关继续由 Portal 入口承接。

本仓 `deploy/docker-compose.yml` 仅提供显式 `diagnostic` profile 的本机 Nginx 配置检查，不作为 Gateway 形态的生产启动入口；它只绑定 `127.0.0.1`，不接 `portal-gateway-upstream`。统一入口部署必须使用 runtime 仓 Compose，确保只有一个 `crm-web` 接入 `portal-gateway-upstream`。如需单独做 Nginx 配置检查，使用 `docker compose --profile diagnostic config`，不要为业务 Web 重新绑定宿主全地址端口。

## 7. 完整验收

1. 人员从门户进入工作台，报价与计数只覆盖该身份获准的 DATA 范围；待确认计数与对应筛选列表一致。
2. 销售：客户建档→创建商机→阶段推进（qualified/proposal/negotiation）→关联报价→编辑草稿→签发→确认成交（商机由成交事务派生为 `won`，订单号回显）；每写操作带幂等键，重复提交返回同一结果。
3. 撤回/重议入口仅已签发态可见；确认后的历史归属不追改。
4. 机器消费者持 AKP 拉取待执行履约项，首次回写 `in_progress` 认领，终态 `completed` 后不可再报。
5. 审计查询可按资源定位操作人（人员 `iam:`/凭据 `aksk:` 前缀区分）。
6. 订单与交付分别进入独立菜单；订单、交付项和审计记录超过一页时，翻页及页大小以服务端总数为准。同订单多个交付项通过交付编号与订单行区分。
7. 失败交付项经确认重置，说明保留序号水位；禁止重复提交。失败重试携带同一幂等键与请求体，成功自动回读交付项和订单详情；无权失败不显示成功。
8. 切换人员身份、令牌失效或卸载页面时清空旧结果与确认命令；旧响应及旧401不能影响当前身份。关联客户、商品或报价明细的网络错误显示可重试错误；403/404（不存在或不可访问）明确标识，不能伪装成成功查得名称。订单详情的关联商品目录不可见时，仍显示获准订单的金额、行明细与冻结履约义务；订单自身拒绝访问时不展示这些事实。

## 8. 常见错误

| 现象 | 优先检查 |
| --- | --- |
| Portal 看不到 CRM | Portal 集成是否开启、用户应用准入及页面权限是否已投影 |
| 子应用挂载空白无报错 | entry 是否目录形式（带 `/` 结尾）；`index.html` 形态挂载失败且无日志 |
| PKCE 回调失败 | PUBLIC Client id 与 `VITE_CRM_IAM_CLIENT_ID` 一致、S256、redirect URI 协议/域名/端口/路径精确匹配 |
| 清单已登记但 API 仍 403 | 角色规则和用户投影是否实际授予该 API；申报清单不等于授予 |
| 能看页面但写操作 404 | DATA 归属校验：人员仅能操作本人事实（安全 not-found）；治理动作需要对应角色 |
| 升级后操作仍被拒 | Server 与 Web 版本是否匹配、应用准入与实际用户投影是否满足，不能仅看清单已登记 |
| 消费者拉不到履约项 | consumerId 是否与 AKP clientId 一致（派发归属匹配）、DATA 派发归属是否授予 |
