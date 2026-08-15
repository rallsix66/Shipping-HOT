# Shipping HOT V2 实施方案

> 状态：`V2.0 sealed`; `V2.1 not started`
>
> 本文最初是基于当前 V1 代码、架构文档、ADR、V1 路线图和公开资料形成的 V2 方案。V2.0 Data Trust Foundation 已按本文件的边界实现并验证；V2.1 及以后仍是未启动的规划，不代表其中的 Provider、表结构、路由或规则已经实现。
>
> 方案核对日期：2026-08-14。V2.0 本轮只实现数据可信度基础，不新增 Portcast、Calendarific 或其他 Provider，不申请 Key、不抓取页面、不修改数据库 schema；V2.1 及以后仍仅用于能力与风险评估。另有独立的 NewsNow source metadata 生成副作用修复，范围限于构建脚本和稳定 source 列表。

## 1. V2 Executive Summary

Shipping HOT V2 继续作为个人本地使用的 local-first 航运工作台，保留现有 NewsNow foundation、React/Vite/Nitro/db0/SQLite、Provider、Repository、Event Engine 和 Feed 边界。

V2 的核心不是增加尽可能多的数据源，而是让每一条数据都能回答三个问题：来源是什么、什么时候更新、这条数据是观测、报告、预测、模型、衍生、估算还是计划数据。任何 Provider 失败时，系统必须展示 last-known + stale/failed 状态，不能把旧数据或 Mock 数据伪装成最新数据。

V2 的首要实施顺序建议为：

1. Data Trust Foundation：统一可信度、Provider 状态和 Mock 展示语义。
2. Port Intelligence：只读取 Portcast 公开页面已经展示的港口拥堵指标；不绕过登录、不调用商业 API、不反向工程私有接口。
3. Country Calendar：以 Calendarific 作为常规基础源，以官方来源和 ManualOverride 补充临时/特殊假期，并接入 Event/HOT。
4. Shipping Information Feed：继续复用 NewsNow Source，把行业新闻、港口公告、船公司公告和海事预警统一进入资讯 Feed。
5. Weather Intelligence：扩展现有 Open-Meteo Marine/Forecast 字段，按需增加官方极端天气和海事预警来源。
6. AIS Derived Port Intelligence：在确认 AISStream 的区域订阅、覆盖和资源成本可接受后，再估算全港拥堵；它始终标记为 `dataNature=derived`/`estimated`，不替代 Portcast 的公开数据。

V2 不承诺真实船期。V2 可以支持手工/Mock Planned Schedule，以及 AIS-reported ETA 作为实时补充，但两者不得合并为同一个事实。若没有免费、稳定、许可清晰的船期来源，真实 Planned Schedule 延期，不伪造。

## 2. Current V1 Baseline

### 2.1 当前架构

当前仓库是保留 NewsNow 的 React 19 + Vite + TanStack Router + React Query/Jotai + Nitro + db0/SQLite 模块化单体。Shipping HOT 已经在现有系统旁边形成独立的结构化路径：

```text
UI / Route
  → Shipping API
  → Shipping Store / Service
  → Domain Rules / Event Engine
  → Provider Interface
  → Mock 或已批准的 V1 Adapter
  → Repository / SQLite
```

资讯仍沿用另一条 NewsNow 路径：

```text
shared/pre-sources.ts
  → generated shared/sources.json
  → server/getters.ts glob 收集 server/sources/**
  → /api/s cache / fetch / fallback
  → NewsNow Feed UI
```

Shipping HOT 的 Information Feed 与 Operational Data 通过 Event/HOT 查询汇合，而不是互相复制。FeedItem 是资讯；Vessel、Port、Voyage 是运营实体；Event 是有证据的生命周期事实；HOT 是排序后的运行时视图。

### 2.2 当前已实现的 V1 能力

| 领域 | 当前状态 | 代码证据 | V2 处理 |
| --- | --- | --- | --- |
| Vessel Domain | 已实现 | `shared/shipping.ts`、`shared/shipping-rules.ts` | 保留模型，补可信度语义 |
| Port Domain | 已实现，但数据为 Mock | `shared/shipping-fixtures.ts`、`MockPortProvider` | Portcast Public 作为 V2 真实化入口 |
| Voyage/Schedule | 已实现，但数据为 Mock | `MockScheduleProvider`、`Voyage` baseline/latest 规则 | V2 不伪造真实 Planned Schedule |
| Event Engine | 已实现 | `shared/shipping-engine.ts` | 增加 Calendar、Portcast 版本和 stale 规则 |
| HOT | 已实现 | `rankHotItems`、Shipping UI | 保持为行动视图，不与 Events 重复 |
| AISStream Vessel | V1 已批准并实现 | `createAisStreamVesselProvider` | 继续只服务 Watched Vessel；重连/会话管理后置增强 |
| Open-Meteo Marine/Forecast | V1 已批准并实现 | `createOpenMeteoWeatherProvider` | 增加海况字段和官方预警分层 |
| Mock Providers | 已实现 | `MockVesselProvider`、`MockPortProvider`、`MockScheduleProvider`、`MockWeatherProvider` | 必须始终显式标记 `sourceType=mock` |
| Repository | 已实现 | `server/database/shipping.ts` | 复用 db0/SQLite；Calendar 才评估最小新表 |
| Shipping UI | 已实现 | `src/routes/**`、`src/components/shipping/**` | V2 UI 只在对应阶段实施 |

### 2.3 当前表和持久化边界

现有 Shipping Repository 初始化 `feed_items`、`vessels`、`ports`、`voyages`、`events`、`settings`，NewsNow 另有 `cache`、`user`。当前实体主要以 `data` JSON 保存，同时保留查询和排序所需的少量列。

当前 `shipping-store.ts` 会并行刷新 Vessel、Port、Voyage、Weather，失败时把 last-known 标记为 stale/failed；SQLite 不可用时保留内存 fallback。当前 Mock fixture 仍是产品可用的基础数据，因此 V2.0 必须让页面明确显示 `sourceType=mock`，而不是只显示一个看起来正常的“healthy”。当事件来源变成 stale、degraded、failed、disabled 或 never_succeeded 时，不创建新的事实事件，也不把已有 active 事件误判为 resolved；只有来源重新 fresh 且条件消失时才可 resolve。

### 2.4 当前限制

- 当前 AISStream Provider 每次 `getVessels` 调用会创建一次短连接，并只请求 watched 且有 MMSI 的船舶；它适合个人关注船，不足以统计整个港口。
- 当前 AISStream 订阅使用全世界 Bounding Box + MMSI 过滤，只接收 `PositionReport`；当前没有持久化轨迹，也没有区域订阅会话管理。
- 当前 PortProvider 和 ScheduleProvider 仍是 Mock。
- 当前 Open-Meteo 仅请求当前风速、阵风和波高，并将风险作为 Weather FeedItem 输出。
- 当前 `Freshness` 只有 `updatedAt`、`stale`、`sourceStatus`、`error`，还没有统一的 `sourceType`/`dataNature` 业务标识。
- 当前 NewsNow Source 协议使用 `NewsItem[]` 和独立 cache，缺少 Shipping HOT 所需的完整 `sourceStatus/stale` 语义；V2 应在 Shipping Feed 适配层补齐，不应强行破坏所有 NewsNow Source。

## 3. V2 Goals

### 3.1 产品目标

- 在一个本地工作台里快速回答：我的船有没有异常、重点港口有没有拥堵、近期有哪些影响销售国家的假期、资讯是否值得行动。
- 只围绕八个重点港口，不一开始建设全球港口平台：Shekou/CNSHK、Yantian/CNYTN、Nansha/CNNSA、Laem Chabang/THLCH、Port Klang/MYPKG、Manila/PHMNL、Jakarta/IDJKT、Ho Chi Minh City/VNSGN。
- 让真实数据、衍生数据、估算数据、Mock 数据、过期数据和失败状态在页面上可区分。
- 外部源失败时仍可使用本地 last-known、手工记录和明确的暂无数据状态。
- 通过提前提醒国家节假日、港口公告、天气预警和船舶异常，减少当天才发现问题的情况。

### 3.2 技术目标

- 保留 `External Source → Provider → Normalizer → Repository → Event Engine → HOT/Feed/UI`。
- Provider 输出规范化 DTO；供应商原始字段只能存在于 adapter 内部。
- 继续使用 Node、Nitro、SQLite、db0、本地缓存和本地定时同步，不默认引入云数据库、Redis、Kafka、微服务或 Kubernetes。
- 将刷新频率、数据更新时间、缓存更新时间和事件检测时间分开。
- 对公共网页抓取设置低频、可禁用、可审计和合规边界。

## 4. Non-Goals

- 本轮不实现任何 V2 功能，不接 API，不申请或配置 Key，不修改 Shipping 业务代码、数据库 schema、UI 或 npm dependency；仅修复 NewsNow metadata 生成脚本的既有副作用。
- 不把 Portcast 商业 API、VesselFinder、MarineTraffic 或其他商业 Vessel/Port API 作为 V2 强依赖。
- 不绕过登录、付费墙、访问限制或 robots/ToS；不反向工程 Portcast 私有接口。
- 不创建全球船舶数据库、完整 AIS 轨迹库、复杂 Port Call 网络模型或实时全球港口平台。
- 不把 AIS 推导的拥堵当成官方观测；不把天气模型输出当成航行安全保证。
- 不强行实现真实船期；没有免费稳定来源时 Planned Schedule 保持 Mock/手工并明确标识。
- 不增加“海运新闻”独立页面；航运资讯继续进入现有资讯/Feed。
- 不为了数据源数量堆叠 Provider；每个新增 Provider 必须有明确业务字段、更新频率和回退价值。
- 不在本轮把 V2 标记为 approved；实施仍需要用户明确确认架构和 Phase 1。

## 5. Product Navigation

### 5.1 建议导航

```text
HOT
船舶
港口
航次
资讯
国家日历
事件
设置
```

这个结构保留了当前已有页面，并把“国家日历”作为正式产品功能加入。建议顺序不再增加一个“海运新闻”页面。

### 5.2 页面职责

| 页面 | 责任 | 不负责 |
| --- | --- | --- |
| HOT | 当前需要行动的 active Event、严重 FeedItem、近期高影响日历提醒 | 展示全部历史事件或全部资讯 |
| 船舶 | Watched Vessel 的位置、航速、航向、导航状态、更新时间、AIS 状态 | 统计整个港口船流 |
| 港口 | 拥堵摘要、Portcast 公开指标、天气/海况、港口公告、数据可信度 | 直接调用第三方 API |
| 航次 | Planned Schedule 与 AIS ETA 对照、延误证据 | 把 AIS ETA 改写成计划船期 |
| 资讯 | 行业新闻、港口公告、船公司公告、海事预警的 Feed | 把所有资讯都提升为 HOT |
| 国家日历 | 五个重点国家的节假日、影响等级、来源、验证状态和提前提醒 | 把所有 observance 当作停工 |
| 事件 | Event 生命周期、dedupe、证据、来源和 resolved 历史 | 与 HOT 复制同一套首页卡片 |
| 设置 | Provider 开关、刷新频率、阈值、关注项、日历国家和提醒规则 | 保存 API Key 或供应商原始响应 |

### 5.3 HOT 与事件的边界

`HOT` 是“现在需要我看什么”的行动队列，只展示 active、可解释、按严重程度/关注关系/新鲜度排序的结果；`事件` 是审计和排错页面，展示 active/resolved、首次检测、最后检测、证据和来源。

因此 `事件` 仍有独立价值，但应作为二级审计入口，而不是 HOT 的第二份列表。HOT 卡片进入事件详情；事件页可以反向进入关联船舶、港口、航次、资讯或日历事件。

### 5.4 首页和详情页建议

- 首页增加“未来 14 天重点国家日历”小组件，只显示 medium 及以上业务影响或用户标记的重要日期。
- 港口详情页组合：当前拥堵摘要 + Portcast 来源状态 + Open-Meteo 海况 + 官方天气预警 + 相关港口公告。
- 国家日历第一版使用国家/年份筛选和事件详情抽屉；只有在来源冲突、手工 Override、验证状态需要较多证据时，才增加独立详情 URL。
- Feed 与 HOT 通过事件和关联实体链接，不复制整篇资讯；普通新闻留在 Feed，影响明确且新鲜的公告/预警才进入 HOT。

## 6. Data Source Matrix

> 表中“V2 必须”表示实施 V2 目标时不可缺少的能力，不表示本轮已经接入。所有“公开页面”来源必须在实现前重新核对 robots、ToS、页面结构和可再分发范围。

| 领域 | 来源/Provider | 目标字段 | V2 结论 | 主要限制与回退 |
| --- | --- | --- | --- | --- |
| 船舶 | AISStream / `AisStreamVesselProvider` | MMSI、位置、速度、航向、Navigation Status、更新时间 | V2 必须，继续沿用 V1 | WebSocket、Key、beta/模型稳定性、AIS 漏报；失败回退 last-known，不伪造最新 |
| 港口 | Portcast Public Page / `PortcastPublicPageProvider` | category、median waiting time、previous period、WoW、long-tail、last updated、source URL | V2.1 首选 | 页面结构、公开覆盖、每周更新、robots/ToS、无数据港口；仅低频缓存和公开展示字段 |
| 港口 | `AISDerivedPortProvider` | 锚地等待、低速/静止船、等待数、趋势 | V2.5 条件项 | 当前只看 Watched MMSI 无法统计全港；需 Bounding Box/锚地地理范围；结果 `dataNature=derived`/`estimated` |
| 天气 | Open-Meteo Marine + Forecast | 风、阵风、波高、波向、波周期、涌浪 | V2 必须，V2.4 增强 | 模型/海岸精度限制；需归因；不能替代航海资料或官方预警 |
| 极端天气 | JMA、TMD、BMKG，后续评估 PAGASA/越南官方源 | 台风、海事预警、海况警报、有效期 | V2.4 先做少量高价值源 | 多国语言和格式不一；先用官方链接/公告 Feed，稳定接口确认后再自动化 |
| 节假日 | Calendarific / `CalendarProvider` | 常规 public/local/religious/observance、日期、名称、类型 | V2.2 基础源 | API Key、免费额度、季度更新、未来数据范围、语言/region 限制；年度/季度缓存 |
| 节假日 | OfficialHolidayProvider / ManualOverride | 政府临时假日、银行假日、特殊地区和补充说明 | V2.2 必须的事实补充 | 来源需要人工核验；冲突要保留两边证据和优先级 |
| 资讯 | NewsNow Source contract | 标题、摘要、发布时间、来源链接、分类、关联实体 | V2.3 必须 | 频率、版权、RSS/HTML 变化、来源质量；逐 Source 独立失败 |
| 船期 | 船公司公开页面/手工输入/AIS ETA | Planned ETD/ETA、AIS-reported ETA | V2 暂不承诺真实 Planned Schedule | 公开页面不稳定、许可不清、更新频率高；先保留 Mock/手工和 AIS 补充 |

### 6.1 公开资料核对结果

- AISStream 官方文档说明 WebSocket 订阅必须包含 BoundingBoxes，可选 `FiltersShipMMSI`，并说明 MMSI 过滤上限为 50；这支持 Watched Vessel，却不能直接证明全港统计可行。参见 [AISStream documentation](https://aisstream.io/documentation.html)。
- Open-Meteo Marine API 当前公开文档列出 wave direction、wave period、swell height/direction/period 等变量，同时明确沿岸精度有限，不能替代航海资料，并要求对 DWD/Open-Meteo 做归因。参见 [Open-Meteo Marine Weather API](https://open-meteo.com/en/docs/marine-weather-api)。
- Portcast 公共港口拥堵页面公开展示港口状态和 median wait，并声明关键港口快照按周更新；这适合低频读取和趋势提醒，不适合高频轮询。参见 [Portcast Global Port Congestion Tracker](https://www.portcast.io/global-port-congestion-tracker)。Portcast 的商业 API、嵌入 token 和私有接口不在 V2 范围内。
- Calendarific 文档说明 Holiday API 需要 API key、国家和年份参数，支持国家/地区、holiday type 等字段；其公开定价页显示免费计划有额度、归因和更新/历史限制。因此它只能作为常规基础源，不能是唯一事实源。参见 [Calendarific API documentation](https://calendarific.com/api-documentation) 和 [Calendarific plans](https://calendarific.com/)。
- 官方补充源具有临时变更价值：泰国央行公开金融机构假日页面包含特殊假日；印尼政府公开 SKB；马来西亚内阁公开公共假日；菲律宾政府公告列出 regular/special days。它们说明国家日历必须保留官方来源和人工 Override，而不能只依赖第三方聚合 API。
- 官方海事天气示例包括 [TMD Shipping Weather Forecast](https://www.tmd.go.th/en/forecast/shipping)、[BMKG Maritime Weather](https://maritim.bmkg.go.id/) 和 [NWS Marine Alerts](https://www.weather.gov/documentation/services-web-alerts)。NWS 不在八个重点港口区域内，作为接口形态参考，不作为 V2 亚洲核心来源。

## 7. Provider Architecture

### 7.1 统一边界

V2 继续使用：

```text
External Source
      ↓
Provider Adapter
      ↓ 规范化 DTO + provenance
Application Service / Normalizer
      ↓
Repository / local cache
      ↓
Event Engine
      ↓
HOT / Feed / Detail UI
```

UI 不访问第三方 API，不访问 SQLite，不解析供应商响应。Nitro server Provider 负责 API Key、公开网页读取、超时、限频、响应校验和错误映射。

### 7.2 Provider 接口建议

当前 `VesselProvider`、`PortProvider`、`ScheduleProvider`、`WeatherProvider` 接口可以保留，但 V2 实现阶段建议增加通用元数据包装，而不是让每个 Provider 自己发明状态字段：

```text
ProviderResult<T>
  data: T[]
  provenance
    sourceType: official | third_party | user | mock
    dataNature: observed | reported | forecast | modelled | derived | estimated | planned
    sourceId
    sourceUrl?
    verified?
  fetchedAt
  sourceUpdatedAt?
  freshness
    updatedAt
    stale
    sourceStatus: healthy | degraded | failed | disabled | never_succeeded
    error?
```

Provider 返回的 `data` 仍然必须是 Domain 可理解的规范化 DTO；供应商原始 JSON 只允许在 adapter 内作为受限 evidence 保存，不能泄漏到 Domain/UI。

建议的新增接口名称：

- `CalendarProvider`：按国家/年份返回 normalized `CalendarEvent`。
- `OfficialHolidayProvider`：读取官方公开页面或受控手工记录。
- `PortcastPublicPageProvider`：读取公开港口页面已经呈现的指标。
- `OfficialWeatherAlertProvider`：将官方预警统一成 `FeedItem`/`AlertEvidence`。
- `AISDerivedPortProvider`：输入区域观测，输出港口的 `dataNature=derived` 统计。

### 7.3 Provider 独立失败

Application Service 应继续使用并行刷新和逐分支 `Promise.allSettled` 语义。Portcast 失败不能清空 Vessel；Calendarific 失败不能让已有日历消失；Weather 失败不能让港口事件变成新鲜事实；AIS 失败不能覆盖 Planned Schedule。

每次刷新至少区分：请求开始时间、请求结束时间、source updatedAt、存入本地的时间、事件 detectedAt。页面显示数据更新时间时只使用 source updatedAt 或明确显示“本地缓存时间”。

## 8. Data Provenance / Trust Model

### 8.1 两层语义：来源类型与数据性质

当前 `Freshness` 已有 `sourceStatus`、`stale`、`updatedAt`、`error`。建议保留它们：

- `sourceStatus` 表示 Provider/Source 的运行状态。
- `stale` 表示数据是否超出该来源的 freshness policy。
- `updatedAt` 表示来源数据时间，不是本地请求时间。
- `error` 表示可安全展示的失败摘要。

新增轻量的 `provenance` 两层模型，不把来源、数据性质和可用性塞进一个大枚举：

```text
provenance
  sourceType: official | third_party | user | mock
  dataNature: observed | reported | forecast | modelled | derived | estimated | planned
  sourceId: string
  sourceUrl?: string
  verified?: boolean

freshness
  updatedAt
  stale
  sourceStatus: healthy | degraded | failed | disabled | never_succeeded
  error?
```

`sourceType` 表示“谁提供了这条数据”：`official` 是政府、港口、气象局或船公司等官方来源；`third_party` 是 Portcast、Calendarific、AISStream、Open-Meteo 等第三方来源；`user` 是人工输入；`mock` 是 fixture/Mock Provider。`dataNature` 表示“这条数据是什么性质”，按实际字段选择，不要求每条记录使用全部值。

`sourceStatus`、`stale` 和 `updatedAt` 继续属于独立的可用性/新鲜度层。`stale` 不是来源类型，`failed`、`disabled` 和 `never_succeeded` 也不能覆盖 provenance。页面可以计算并显示以下用户可读状态：

| 展示状态 | 计算原则 |
| --- | --- |
| 来源/性质标签 | 从 `sourceType` + `dataNature` 显示，例如 `third_party + observed` |
| STALE | 数据仍有值但超出 freshness policy；保留原始 `updatedAt` |
| FAILED | 最近刷新失败；若有 last-known，则同时显示 STALE |
| DISABLED | 用户或配置明确关闭 Provider；不能当作“暂无异常” |
| NEVER_SUCCEEDED | 从未成功取得过该来源的数据；不能用 Mock 或空值冒充成功 |

例如，“Portcast `third_party + derived` + `failed` + `stale`”表示上一次成功数据来自真实第三方来源，但本次读取失败；“AIS `third_party + derived` + `stale`”表示衍生统计仍存在但已过期。

### 8.2 六类数据的可信度规则

- Port：Portcast 拥堵/等待指标为 `sourceType=third_party`、`dataNature=derived`；只有页面明确报告的字段才可标为 `reported`；AIS 推导为 `derived` 或 `estimated`；Mock 为 `sourceType=mock`；港口公告只说明运营事件，不自动替代拥堵数值。
- Vessel：AISStream 规范化位置为 `third_party + observed`；缺失字段的规则补全只能标为 `estimated`；Watched Vessel 以外没有数据时不能推断全港船数。
- Voyage：手工计划为 `user + planned`，Mock Planned Schedule 为 `mock + planned`；AIS ETA 为 `third_party + reported`，不是 Planned Schedule；两者分别展示。
- Weather：Open-Meteo 输出为 `third_party + forecast/modelled`，业务风险分级是 `derived`；JMA/TMD/BMKG 等官方预警为 `official + reported` 且可 `verified=true`；不能把风险阈值当成安全认证。
- Holiday：官方记录为 `official + reported`；Calendarific 常规数据为 `third_party + reported`，默认 `verified=false`；业务影响等级是 `derived`/可配置。
- Feed：公开页面/RSS 的文章事实按来源标为 `official` 或 `third_party + reported`；关联港口、严重程度和 HOT 资格是 `derived`；Mock 资讯的 `sourceType` 始终为 `mock`。

### 8.3 UI 强制规则

任何卡片至少显示 `sourceType`、`dataNature`、数据更新时间和适用的 `STALE/FAILED/DISABLED/NEVER_SUCCEEDED` 状态。没有 `updatedAt` 的数据不能显示“刚刚更新”；没有来源 URL 的外部数据不能标为 `verified`；`mock` 模式必须在首页、详情页和事件证据中一致显示。

## 9. Vessel Strategy

### 9.1 V2 结论

AISStream 足以支撑 V2 的 Watched Vessel：MMSI、位置、速度、航向、Navigation Status、更新时间是当前 V1 已有的主路径。V2 继续只追踪 Watched Vessel，不把 AISStream 直接当成全球或全港数据库。

### 9.2 当前 Provider 的缺口

当前 Provider 每次读取都会创建一次 WebSocket、发送一次订阅、收到足够消息后关闭。页面频繁刷新会产生无意义的重连；当没有 MMSI、没有消息、连接超时或连接关闭时，当前实现只能返回 degraded/stale 的旧状态。

V2.0/V2.5 的实现建议：

- 增加本地 `AisStreamSession`/连接管理器，按 server process 复用连接。
- Watched MMSI 集合变化时 debounce 订阅重建，而不是每次 UI 请求都重建。
- 连接空闲超过本地配置时间后关闭；用户明确点击刷新时允许一次受控重连。
- 连接异常采用有限次指数退避；下次成功前继续返回 last-known + stale/failed。
- 单一共享会话只服务当前关注列表；不为每个 Vessel 创建连接。
- 先保存当前状态和有限变化点，不保存无限轨迹；默认只保留近期变化用于状态持续时间和排错。

### 9.3 AIS 数据限制

- AIS 不是所有船只都稳定广播，存在延迟、缺失、错误识别和岸基覆盖差异。
- 当前 V1 使用 `FiltersShipMMSI`，不能统计没有被关注的船舶。
- 官方文档说明 MMSI 过滤有数量上限；超过限制时必须分组或明确不支持，不能静默丢弃。
- 全世界 Bounding Box 只解决订阅形状，不等于完整、无遗漏的全球观测。
- 目的地/ETA/静态信息不一定和位置消息一起到达，缺失时保持 unknown。

### 9.4 历史轨迹

V2 不做完整轨迹库。只保留：

- 当前 Vessel 状态。
- 为变化检测、锚泊时长和最近排错所需的短期 observation。
- 可配置 retention，默认不超过 7 天，除非后续明确需要更长历史。

当用户需要航迹回放、轨迹导出或全量 AIS 分析时，另做 V3/新架构评估。

## 10. Port Congestion Strategy

### 10.1 Portcast Public Page 的使用边界

V2.1 只读取 Portcast 公共港口拥堵页面中对匿名访问者已经展示的内容，例如：congestion category、median wait、previous period、week-over-week change、long-tail/outlier、last updated、source URL。

明确禁止：

- 绕过登录、付费墙、访问限制或 token。
- 调用 Portcast 商业 API 或 Tableau/私有接口。
- 反向工程浏览器私有请求、隐藏字段或未公开数据结构。
- 模拟付费账户或批量抓取所有港口。
- 将页面没有展示的指标推断成 Portcast 官方数据。

如果公开页面只在浏览器执行脚本后显示数据，而 HTML 中没有可合规读取的公开内容，则 Provider 返回 `failed`/`never_succeeded` 或 `disabled`，不继续追私有接口。

### 10.2 `PortcastPublicPageProvider`

Provider 责任：

1. 输入固定的八个重点港口和允许的公共页面 URL。
2. 以低频 server-side 请求读取公开页面。
3. 只解析已确认的公开 DOM/文本字段。
4. 保存 `sourceUrl`、source updatedAt、抓取时间、解析版本和有限 evidence。
5. 标准化到 `PortCongestionSnapshot`，由 Domain 计算统一 congestion level。
6. 某个港口没有公开数据时返回该港口的明确 `no_public_data`，不复制其他港口值。

建议的规范化字段：

```text
PortCongestionSnapshot
  portId
  category
  medianWaitingHours?
  previousMedianWaitingHours?
  weekOverWeekChangePct?
  longTailWaitingHours?
  waitingVessels?
  sourceUpdatedAt?
  fetchedAt
  sourceUrl
  provenance
    sourceType: third_party
    dataNature: derived
  stale
  sourceStatus
  parserVersion
```

当前 `Port` 的 flat 字段继续作为 UI/Domain 摘要，Portcast 特有指标以可选 congestion detail 存放。第一版不需要完整 `port_snapshots` 历史表，因为公共页面已经提供 previous/WoW；如以后需要多周趋势，再单独评估历史表。

### 10.3 港口事件和去重

- 稳定 `dedupeKey`：`port_congestion:<portId>`。
- 事件 evidence 保存 `sourceUpdatedAt` 和指标 fingerprint。
- 每日检查时，如果页面 source updatedAt 和指标 fingerprint 都未变化，不产生新的 Event，不重复更新 HOT。
- source 更新时间变化但指标未跨阈值时，只更新 Port 状态和 evidence，不一定创建 HOT。
- 指标跨阈值或长尾显著恶化时，更新同一个 active Event 的 severity/evidence/lastDetectedAt，而不是创建第二个事件。
- 数据源失败时不创建新的“拥堵”事件；已有事件保留但标记 stale/failed，等待 fresh 数据确认恢复或升级。

### 10.4 Portcast 覆盖不足时

Portcast 公开页不一定展示八个重点港口的同样指标。每港独立显示：`third_party + derived`、`NO_PUBLIC_DATA`、`STALE` 或 `FAILED`。港口公告可以进入 Feed/HOT，不能在没有拥堵数值时伪造 congestion category。

## 11. Weather Strategy

### 11.1 V2 必须字段

继续使用现有 Open-Meteo Marine 和 Forecast Provider，并优先补充：

- wave direction
- wave period
- swell height
- swell direction
- swell period
- wind speed / gust（现有）
- wave height（现有）

这些字段足以形成港口详情的“未来风险窗口”摘要。每个港口以固定坐标/海上代表点请求，不在每次 UI 渲染时直接访问 API。

### 11.2 条件字段

- precipitation：只有在和港口作业、雷暴或能见度风险有清晰业务规则时增加。
- visibility：如果 Forecast API 对八个港口有稳定、可解释字段，再增加；否则先由官方预警/港口公告表达。
- ocean current/tide：V2 不作为必需字段，Open-Meteo 文档已提示沿岸精度限制；需要航海决策时不能只依赖模型。

### 11.3 风险窗口

Weather Provider 返回未来 24 小时、72 小时和 7 天摘要的原始预报时段；Domain 依据可配置阈值计算 `weather_risk` Feed/Event。风险卡必须显示：预报时间窗、数据更新时间、阈值版本、来源、`third_party + forecast/modelled` 与 `derived` rule 标签。

Open-Meteo 的模型预报不等于官方警报，也不替代航海资料。页面需要同时显示“模型风险”和“官方预警”两种证据，不能将二者合并成一个无法解释的分数。

### 11.4 官方极端天气来源

第一阶段只选择少量高价值来源：

- JMA：西北太平洋台风和区域信息，作为跨境高影响天气源候选。
- TMD：泰国 Shipping Weather Forecast，覆盖泰国湾、安达曼海和相关航线。
- BMKG：印尼海事天气、航运天气公告和高浪预警。

PAGASA、越南官方气象机构等列为后续候选，必须在实现前确认公开接口/页面结构、语言、更新频率和再分发许可。官方来源也经过 server Provider，或先作为人工确认的 Feed Source，不由 UI 直接抓取。

## 12. Information Feed Strategy

### 12.1 统一进入现有 Feed

不新增“海运新闻”独立页面。以下内容都归一到 `FeedItem`：

- 行业媒体新闻。
- 重点港口官方公告。
- 船公司公告、blank sailing、port omission、航线调整。
- 港口关闭、台风停闸、作业窗口变化。
- 运价/供应链重大新闻。
- 海事预警和官方天气公告。

FeedItem 保留标题、摘要、sourceUrl、publishedAt、category、severity、关联港口/船舶/航次和 freshness/provenance。NewsNow 原有 `Source`/getter/cache 继续负责资讯抓取；Shipping 专属分类和关联/可信度在适配层完成。

### 12.2 首批“少而可靠”来源集合

首批建议只启用以下来源组，实际实现前逐一确认 RSS/HTML 可读性、版权/转载边界和 robots/ToS：

1. 行业媒体：The Maritime Executive、The Loadstar。
2. 中国重点港口官方：Shekou、Yantian、Nansha 官方公告源，优先选择有稳定公告列表的页面。
3. 东南亚港口官方：Laem Chabang Port Authority、Port Klang Authority 官方公告源。

Manila、Jakarta、Ho Chi Minh City 官方源和船公司公告列为第二批，不因“覆盖八港”而一次性接入不稳定页面。COSCO、Maersk、CMA CGM、Evergreen、MSC、ONE、Hapag-Lloyd 先建 Source registry 候选，不默认全部启用。

### 12.3 Feed 与 HOT 边界

- 普通行业新闻：只进 Feed。
- 明确影响重点港口、航线或客户日期的官方公告：Feed + 可能生成 Event。
- 高严重度、可验证、仍在有效期内的关闭/预警/大范围调整：进入 HOT。
- 同一 FeedItem 只允许一个 `feed:<feedItemId>` Event；同一公告被多个 Source 转载时以 canonical URL/hash 合并。
- 抓取失败不生成新资讯，不把旧文章的本地抓取时间当作发布时间。

### 12.4 NewsNow 结构适配

继续使用 `shared/pre-sources.ts`、生成的 `shared/sources.json`、`server/getters.ts` 和 `server/sources/**`。不要改变所有 NewsNow Source 的旧协议来迁就 Shipping HOT；可以新增 Shipping Source metadata、normalized adapter 和独立 freshness 映射。资讯源失败时沿用 NewsNow cache，但 Shipping Feed 必须追加明确的 source status/fetchedAt/stale 语义。

## 13. Country Calendar Strategy

### 13.1 产品范围

第一批国家固定为：Thailand/TH、Indonesia/ID、Malaysia/MY、Philippines/PH、Vietnam/VN。日历事件至少支持：

- public_holiday
- observance
- religious
- commercial
- government_special
- company_custom

`isPublicHoliday` 不能由 type 简单推导；同一个宗教日期在不同国家/地区的业务影响可能不同。

### 13.2 Calendarific 角色

Calendarific 作为常规年度基础源：按国家/年份批量同步，写入本地 Repository；页面读取本地数据，不在每次打开页面时请求 API。它是 `sourceType=third_party`、通常 `dataNature=reported` 的常规来源，不是官方事实层。免费额度、归因、季度更新、语言和地区参数在实现前重新核对，默认按“有限额度、可能滞后”的源处理。

使用免费套餐时，国家日历页面必须展示符合当时官方条款的归因，例如 `Powered by Calendarific`，并链接到 Calendarific。最终文字和链接在实现 V2.2 前再次核对；归因要求同时属于产品验收和 UI 合同。

建议同步策略：

- 目标是本地缓存当前年和实际可获得的未来年度数据；不承诺免费套餐一定提供完整的下一年度。
- 每年进入新年度时尝试预抓取当前年和可获得的未来年度。
- 每季度检查一次未来数据更新。
- 每日只检查临近日期或手工触发的变化，不重复下载整年数据。
- Calendarific 失败时保留本地数据并标记 stale，不清空日历；覆盖不足则显示 `coverageStatus=partial` 或 `unknown`，不伪造缺失假期。

### 13.3 官方来源与 ManualOverride

设计 `OfficialHolidayProvider / ManualOverride`，并把事实层与业务层分开：

- 官方政府/央行/主管部门记录：事实层优先级最高，`sourceType=official`、`dataNature=reported`；`verified=true` 需要来源 URL 和核验时间。
- Calendarific：事实层次于官方来源，`sourceType=third_party`、`dataNature=reported`，默认 `verified=false`。
- ManualOverride：可以覆盖业务影响、内部提醒、展示备注和特殊业务日期；必须填写原因、source URL 或内部说明、操作者和 `lastCheckedAt`，不能无痕覆盖官方法定假期事实。
- 普通商业日/公司自定义日：不覆盖法定假日事实，只增加独立 `company_custom` 事件。

如果 ManualOverride 修改 `date`、holiday status 或 `isPublicHoliday`，必须保留原官方记录，标记 `conflictFlag`，并记录原因、操作者、来源和 `lastCheckedAt`。数据冲突不静默覆盖：保留主记录的选定值、冲突来源列表和 conflict flag；ManualOverride 可以改变业务展示日期，但不能删除官方/第三方证据。

### 13.4 Calendar Event 模型

建议的最小模型：

```text
CalendarEvent
  id
  countryCode
  subdivisionCode?
  name
  localName?
  date
  endDate?
  type
  isPublicHoliday
  businessImpact: low | medium | high | critical
  sourceId
  sourceUrl
  sourcePriority
  verified
  coverageStatus: complete | partial | unknown
  lastCheckedAt
  updatedAt
  stale
  provenance
  conflictFlag
  dedupeKey
```

业务影响由可配置规则决定，而不是由 holiday type 硬编码：普通公共假日通常 medium；跨三个工作日以上的连续假期通常 high；政府临时全国假日通常 high/critical；单纯 observance 默认 low；销售/清关/银行明确受影响时可人工上调。

### 13.5 提醒与 Event Engine

- 普通 public holiday：提前 7 天提醒。
- 重要节日或高影响日期：提前 14 天，并在提前 3 天再次提醒。
- 连续假期：以假期区间作为整体，提前 14 天提醒一次。
- 政府临时宣布：发现后立即进入 HOT。
- `dedupeKey` 示例：`calendar:<countryCode>:<date>:<normalizedName>:<type>`。
- 事件 lifecycle 复用现有 `active/resolved`；提醒级别写入 evidence，不能每天创建一条同名 Event。
- 日期过去后事件 resolved，但 Calendar 页面保留历史并显示来源/验证状态。

## 14. Voyage / Schedule Strategy

### 14.1 V2 结论

V2 不实现未经证实的真实 Planned Schedule Provider。当前 `MockScheduleProvider` 和 fixture 保留，并标记 `sourceType=mock`、`dataNature=planned`；用户手工建立的计划标记 `sourceType=user`、`dataNature=planned`；AISStream 提供的 ETA 标记 `sourceType=third_party`、`dataNature=reported`，并单独标记为 AIS-reported ETA。

### 14.2 两类事实必须分开

```text
Planned Schedule
  source: mock-schedule | manual | carrier-public
  baseline ETD/ETA

AIS-reported ETA
  source: AISStream
  observedAt / updatedAt
  latest ETA
```

延误规则只在比较同类且有时间基准时执行：`delay = latestEta - baselineEta`。AIS ETA 缺失、来源不可信或基准不是 Planned Schedule 时输出 unknown，不假定延误。

### 14.3 后续真实船期条件

只有在找到免费/低成本、更新稳定、许可清晰、覆盖重点航线的公开船公司来源，并通过 fixture、失败回退和变更频率验证后，才新增 `CarrierScheduleProvider`。否则真实 Planned Schedule 延期到 V2.1+ 或不做。不能用 Portcast、AIS 或新闻中的推测时间替换计划船期。

## 15. Event Engine Extensions

### 15.1 保留当前生命周期

继续使用 `dedupeKey`、`firstDetectedAt`、`lastDetectedAt`、`resolvedAt`、`evidenceJson` 和 `active/resolved`。Event 是证据事实，不是每次页面查询的临时通知；HOT 继续是查询/排序结果。

### 15.2 新增规则

| 事件 | 触发 | 去重 | 不触发条件 |
| --- | --- | --- | --- |
| `port_congestion` | Portcast sourceUpdatedAt/指标 fingerprint 变化且跨阈值 | `port_congestion:<portId>` | source 更新时间未变、只有抓取时间变化、Provider failed |
| `port_congestion_derived` | AIS 区域统计连续超过阈值 | `ais_port_congestion:<portId>:<window>` | 只有 Watched MMSI、数据不足、区域订阅不完整 |
| `calendar_reminder` | 日期进入 14/7/3 天窗口 | `calendar:<event-id>:<lead>` | 同一 lead 已发出、事件已过期 |
| `government_special_holiday` | verified 官方/手工记录被发现 | 日历 dedupeKey | 未验证的单一第三方猜测 |
| `official_weather_alert` | 官方预警进入有效期且关联区域 | `weather-alert:<source>:<external-id>` | 预警已过期或只剩旧缓存 |
| `weather_risk` | Open-Meteo 预测跨可配置阈值 | `weather-risk:<portId>:<window>` | Provider failed、没有合法 source updatedAt |

### 15.3 Stale 与事件

新鲜数据才能创建或升级事件。Provider 失败时：

- 已存在的 active Event 不立即删除，保留证据并显示 stale/failed。
- 不用失败返回的旧值创建新的事件。
- Fresh 数据确认条件消失时才 resolve。
- 如果旧事件已经超过 retention 且没有新鲜确认，进入 resolved/expired 的审计状态，具体保留周期由实现阶段测试决定。

## 16. Local Persistence / Cache Strategy

### 16.1 本轮结论

本轮不改数据库 schema。现有 `feed_items`、`vessels`、`ports`、`voyages`、`events`、`settings` 足以承载 V2.0 的可信度字段，因为实体数据已经以 JSON 保存，新增字段可在获批实施时通过兼容读写加入。

### 16.2 V2.2 最小新增表

国家日历需要独立的 `calendar_events` 表，原因是它有独立的国家/年份查询、来源冲突、验证、提醒去重和过期策略；不建议把整年假日数组塞进一个 settings blob。

最小字段覆盖：`id`、`country_code`、`subdivision_code`、`date`、`end_date`、`type`、`is_public_holiday`、`business_impact`、`source_id`、`source_url`、`source_priority`、`verified`、`last_checked_at`、`updated_at`、`stale`、`data`。同步状态第一版可放在现有 `settings` 的 `calendarSync` 区域；只有当国家/年份/来源数量增加到难以维护时，才单独增加 `calendar_sync_state`。

### 16.3 不新增的表

- V2.1 不强制新增 `port_snapshots`；Portcast 的 previous/WoW 字段先放在当前 Port 关联的规范化 congestion detail 中。
- V2.5 不创建无限增长的 `ais_tracks`；只保存短期 observation 或变化点。
- 不创建 Redis/Kafka/event bus/云数据库。
- 不把 API Key 写入任何数据库表。

### 16.4 缓存与保留

| 数据 | 本地保存 | 默认保留 |
| --- | --- | --- |
| Vessel 当前状态 | 最新值 | 长期，受关注项控制 |
| AIS 变化点 | 短期审计 | 7 天以内，需配置 |
| Port 当前摘要 | 最新值 | 长期 |
| Portcast 页面 fingerprint/evidence | 当前值 + 有限比较值 | 至少支持 previous/WoW，建议不超过 90 天 |
| Weather 当前/未来窗口 | 最新成功窗口 | 7 天以内，下一次成功覆盖 |
| Calendar Event | 年度本地缓存 | 保留当前年和实际可获得的未来年度；覆盖不足时记录 `coverageStatus` |
| FeedItem | 现有 retention 机制 | 默认 30 天，按 source 更新频率调整 |
| Shipping Event | 现有 lifecycle | 默认 30 天，resolved 后按 retention 清理 |

## 17. Refresh / Scheduler Strategy

### 17.1 设计原则

Local Scheduler 是单进程、本地、可暂停的同步编排器，不是云任务系统。它只负责按 TTL 触发 Provider；页面读取缓存/Repository。服务重启后不假设后台任务一直运行，而是启动时根据 `lastSuccessAt/sourceUpdatedAt` 做一次 catch-up。

每个 Provider 有独立的 `nextDueAt`、最大请求频率、超时、重试和失败退避。手工刷新不能绕过 ToS、频率上限或缓存策略。

### 17.2 建议频率

| 数据 | 正常频率 | 说明 |
| --- | --- | --- |
| Watched AIS | 共享 WebSocket 按需持续；无关注/空闲后关闭 | 不是每次页面刷新新建连接 |
| Open-Meteo | 3 小时 | 活跃官方预警期间可临时缩短到 1 小时 |
| Portcast Public | 每日 1 次 | 页面当前按周更新；source updatedAt/hash 未变化则不产事件 |
| NewsNow Shipping Feed | 30 分钟起步，稳定源可 15–60 分钟 | 每个 Source 有自己的 interval/TTL |
| Calendarific | 每季检查；新年度预抓取 | 页面绝不逐次请求 API |
| Official Holiday/Notice | 30–60 分钟，仅对启用源 | 失败保留旧值并标 stale |
| Official Weather Alerts | 无 active alert 时 3 小时；active 时 30–60 分钟 | 逐国家/区域启用，避免 Provider 堆叠 |

### 17.3 运行约束

- 只允许一个 scheduler loop，避免 Nitro 热重载或多请求重复启动。
- 同一 Provider 同时只能有一个 refresh；后续请求复用进行中的 Promise 或读取 last-known。
- scheduler 任务失败只记录本分支状态，不阻断 API/UI。
- 进程不运行时不保证定时同步；下一次启动或手工刷新执行 catch-up。
- 对 AIS 连接使用 session manager；对 HTTP Provider 使用 TTL + single-flight。

## 18. Failure / Stale / Fallback Rules

### 18.1 通用规则

1. 有 last-known 且刷新失败：保留原始 `updatedAt`，设置 `stale=true`、`sourceStatus=failed`，保留两层 provenance 和错误摘要。
2. 没有 last-known 且刷新失败：返回空集合/暂无数据，`never_succeeded` 或 `failed`，不填充假数据。
3. Provider disabled：返回 `disabled`，不把 disabled 视为 healthy 或 fresh。
4. Mock 模式：明确 `provenance.sourceType=mock`，即使 fixture 时间是当前生成，也不得显示为外部新鲜数据。
5. 请求时间、缓存写入时间和源数据更新时间永不混用。
6. 单源失败不影响其他实体、其他 Provider 或首页基本渲染。

### 18.2 Provider 特定回退

- AISStream：连接失败、超时、无 MMSI 或无 PositionReport 时保留旧 Vessel；不把“无消息”解释为停船。
- Portcast：页面不存在、结构变化、无公开数据、robots/ToS 不允许或解析失败时停止该源，保留最后合法结果并标 stale/failed；不抓隐藏接口。
- Open-Meteo：单港失败只影响该港天气 Feed；旧 forecast 显示 source updatedAt 和 stale；没有预警时不等于天气安全。
- Calendarific：年度缓存仍可读；官方 ManualOverride 可以覆盖业务展示；冲突保留证据和 conflict flag。
- NewsNow Source：沿用 cache fallback，但新 FeedItem 不得使用当前抓取时间覆盖原发布时间。
- Planned Schedule：没有可靠来源时保留 `sourceType=mock`/`user` 的计划，并与 AIS ETA 分栏显示。

### 18.3 Fallback 优先级

```text
事实数据:
fresh verified official
  > fresh third_party/public
  > stale last-known
  > unknown/no data

业务判断:
verified user/manual override
  > derived/default rule

Mock 是显式的 `sourceType=mock` fixture，不是隐形的 Provider 替换。
```

ManualOverride 只在其适用领域覆盖业务判断时生效；它不能把没有来源的数字变成官方事实，也不能掩盖冲突和 stale。事实数据仍按来源与新鲜度独立判断。

## 19. Security / API Key Rules

- AISStream 和 Calendarific Key 只在 Nitro server/provider 使用，来源为环境变量或本地未跟踪安全配置。
- Calendarific 官方协议要求在 server-side outbound request 的 query parameter 中传入 `api_key`；因此允许服务端按协议拼接该参数，但禁止浏览器访问、前端 bundle、客户端 URL、SQLite、settings JSON、FeedItem、Event evidence、Git、文档和任何错误输出中出现真实 Key。
- 所有日志和错误摘要必须先脱敏，例如只允许记录 `https://calendarific.com/api/v2/holidays?api_key=***`，不得记录真实值、完整请求对象或带 Key 的堆栈。
- Portcast 公共页面不需要商业 Key；如果实现所需页面要求登录/token/商业 API，则该 Provider 标记 deferred/disabled。
- 公共页面请求使用低频、可配置 User-Agent、超时和退避；在实现前核对 robots、ToS、版权和再分发要求。
- 原始响应只保留最小、可审计 evidence；不保存整页 HTML 或敏感 token。
- 不新增 OAuth、云权限、局域网暴露或多用户授权模型。
- 如果未来引入 HTML parser、SDK 或其他 npm dependency，必须另做依赖与架构评估；本轮不新增依赖。

## 20. Proposed Data Model Changes

### 20.1 共享字段

在现有 `Freshness` 上增加轻量 `provenance`：`sourceType`、`dataNature`、`sourceId`、可选 `sourceUrl`、`verified`。保留现有 `sourceStatus/stale/updatedAt/error`，不改成一个含义重叠的大状态枚举。

### 20.2 Port

保留现有 `congestionLevel`、`waitingVessels`、`waitingHours`、`operationalStatus` 作为统一摘要；增加可选 `congestionDetail`：

- category
- medianWaitingHours
- previousMedianWaitingHours
- weekOverWeekChangePct
- longTailWaitingHours
- sourceUpdatedAt
- sourceUrl
- fingerprint
- provenance/status

Portcast 不公开某字段时保持 undefined，不用 0 代替未知。

### 20.3 Vessel

增加/明确：

- `lastObservedAt` 与 `updatedAt` 的语义。
- AIS session/observation 的短期 evidence 引用，而不是完整轨迹。
- `positionSource`、`etaSource` 的来源区分。

### 20.4 Voyage

明确增加/保留：

- `scheduleKind: planned | ais_reported | manual | mock`。
- `baselineEtaSource`/`latestEtaSource` 不得混写。
- `latestEtaObservedAt` 只表示 AIS/Provider 观察时间。

### 20.5 CalendarEvent

按第 13.4 节的最小模型新建共享类型和后续 `calendar_events` Repository。日历事件和 ShippingEvent 不要混成同一张业务事实表：CalendarEvent 是日期事实，ShippingEvent 是提醒生命周期；后者通过 `calendarEventId` 或 evidence 引用前者。

### 20.6 Event

现有 Event 增加可选 evidence 约定：

- `sourceUpdatedAt`
- `sourceType/dataNature`
- `fingerprint`
- `leadDays`（日历提醒）
- `conflictFlag`

不要立即增加 provider_runs、event_history、full_snapshots 等表；先用现有 JSON evidence 满足 V2 的可解释性，再用真实查询需求驱动 schema。

## 21. UI Changes

V2.0 已完成最小 UI 信任标识；V2.1 及以后按以下规划改动：

### V2.0

- 所有实体卡片统一显示 `sourceType`、`dataNature` 和 `STALE/FAILED/DISABLED/NEVER_SUCCEEDED`。
- Mock fallback 不再看起来像真实源；provider chip 显示具体来源和更新时间。
- 空数据、失败、过期、disabled、never_succeeded 使用不同状态。
- 已覆盖 HOT、Vessel、Port、Voyage、Event、Feed 及详情页；Mock 明确显示“模拟数据”，真实 V1 来源显示中文来源类型和数据性质。

### V2.1

- 港口详情增加 Portcast congestion detail、source updatedAt、source URL、previous/WoW/long-tail。
- 对公开数据缺失的港口显示“无公开数据”，不显示 0。
- 港口详情组合天气、公告和拥堵证据。

### V2.2

- 新增国家日历页：国家、年份、月份、类型、影响等级、验证状态筛选。
- 首页增加未来 14 天高影响日历。
- 日历详情显示来源冲突、官方/手工优先级、最后核验和提醒 lifecycle。
- 日历页面显示符合当时官方条款的 Calendarific Attribution（例如 `Powered by Calendarific` 和对应链接）；实现 V2.2 前再次核对最终文字与链接。

### V2.3–V2.4

- Feed 增加航运分类、来源类型、关联实体和“进入 HOT 的原因”。
- Weather 卡片增加海况字段、时间窗、官方预警与模型风险区分。

### V2.5

- AIS derived 港口指标单独展示“估算/衍生”，并提供观测窗口、Bounding Box/锚地范围摘要、样本量和覆盖警告。

## 22. V2 Phases

### V2.0 — Data Trust Foundation

- Goal：让所有 V1/V2 数据可判断来源类型、数据性质和新鲜度。
- In Scope：`provenance` 最小模型、统一 ProviderResult/状态映射、Mock 明示、失败/last-known 规则、AIS session 设计、测试契约。
- Out of Scope：Portcast、Calendarific、真实 Port Provider、数据库 migration、UI 大改。
- Dependencies：当前 V1 Provider/Repository/Event Engine；本轮已获得明确实施批准。
- Acceptance：V2.0 已验证六类数据的来源/性质/新鲜度契约；单 Provider 失败不影响其他分支；Mock 不再伪装真实；无 Key 时核心 UI 可用。
- Main risks：字段扩展可能影响 fixtures/API/UI；先兼容读写并保留当前 `sourceStatus/stale`。
- Rollback：关闭 provenance 展示增强，保留旧 Freshness 字段和现有 Mock 闭环。

### V2.1 — Port Intelligence

- Goal：把八个重点港口的公开拥堵信息在合规前提下真实化。
- In Scope：`PortcastPublicPageProvider`、公开页面 parser、低频 cache、Port congestion detail、fingerprint/dedupe、港口详情和公告关联。
- Out of Scope：商业 API、登录、私有接口、全港 AIS 衍生统计、完整历史趋势表。
- Dependencies：V2.0 trust model；逐页确认公开字段、robots/ToS 和页面结构。
- Acceptance：只处理页面公开展示字段；页面失败/不存在/无数据有明确状态；每日最多按策略检查；source updatedAt 未变化不重复创建 Event；Portcast 不可用时不伪造值。
- Main risks：HTML 变化、页面动态渲染、授权限制、字段定义不稳定。
- Rollback：关闭 Portcast Provider，回退 last-known/暂无数据/Mock 明示，不删已有历史 Event。

### V2.2 — Country Calendar

- Goal：提供 TH/ID/MY/PH/VN 的本地年度日历和提前提醒。
- In Scope：Calendarific 年度缓存、OfficialHolidayProvider/ManualOverride、`calendar_events` 最小表、类型/影响等级、冲突、Holiday → Event → HOT。
- Out of Scope：所有国家、自动解释未知宗教日期、企业 ERP 同步、多用户共享日历。
- Dependencies：V2.0 trust model；Calendarific Key 管理确认；五国官方来源清单。
- Acceptance：不打开页面即请求 API；本地可离线读取实际已缓存的年度数据；`coverageStatus` 可区分 complete/partial/unknown；国家日历页面展示符合条款的 Calendarific Attribution；官方事实层优先级最高；ManualOverride 修改事实字段时保留原记录并标记 conflict；普通、高影响、连续假期和政府临时假日提醒不重复；日历不把 observance 默认当作放假。
- Main risks：官方临时变更、地区差异、农历/宗教日期、第三方滞后。
- Rollback：停用自动同步但保留本地 CalendarEvent；关闭提醒规则不删除已核验记录。

### V2.3 — Shipping Information Feed

- Goal：用少量可靠来源补充与航运行动相关的资讯。
- In Scope：首批行业媒体和港口官方 Source、FeedItem normalized adapter、港口/航线/船公司分类、Feed → Event/HOT 规则。
- Out of Scope：海运新闻独立页面、无限 Source、全文镜像、付费墙内容抓取、AI 摘要。
- Dependencies：V2.0 trust model；逐 Source 的 RSS/HTML/robots/版权核对。
- Acceptance：首批 Source 少于无限扩张；每个 Source 独立失败；普通新闻只进 Feed；有效公告/预警可进入 HOT；重复转载可去重；旧缓存明确 stale。
- Main risks：来源质量、版权、抓取频率、来源结构变化。
- Rollback：禁用单个 Source/分类，保留 NewsNow 原有 Source 和 cache。

### V2.4 — Weather Intelligence

- Goal：增强重点港口的海况风险窗口并补充少量官方预警。
- In Scope：Open-Meteo wave/swell 字段、未来窗口、官方 JMA/TMD/BMKG 候选、模型风险与官方预警分层。
- Out of Scope：航行安全认证、复杂气象模型、多国 Provider 全量接入、海流/潮汐决策系统。
- Dependencies：V2.0 trust model；现有 Open-Meteo adapter；官方来源合规核对。
- Acceptance：字段来源和预报时间窗清楚；海况请求按 TTL 缓存；模型风险不能伪装官方预警；官方预警过期可关闭；单港失败不影响其他港口。
- Main risks：沿岸精度、预警格式、重复公告、不同国家定义不一致。
- Rollback：只保留现有 Open-Meteo 风/阵风/波高，关闭官方预警 Provider。

### V2.5 — AIS / Port Derived Intelligence

- Goal：在数据覆盖和资源成本满足条件时估算重点港口的实时拥堵趋势。
- In Scope：区域 Bounding Box/锚地范围、AIS area session、低速/锚泊/等待窗口、样本量和 `dataNature=derived`/`estimated` 展示。
- Out of Scope：把 watched MMSI 结果扩展成全港事实、完整轨迹、全球港口统计、商业 AIS Provider。
- Dependencies：V2.0 AIS session；V2.1 Port entity/threshold；确认 AISStream 区域订阅覆盖、吞吐、许可和运行成本。
- Acceptance：没有区域观测就不输出全港统计；样本量/覆盖不足显示 unknown；衍生值与 Portcast 并列而不覆盖；重复连接受控；短期 observation 可清理。
- Main risks：AIS 漏报、区域边界、港区地理范围、连接/消息量、误报。
- Rollback：关闭 area session，保留 Watched Vessel AIS 和 Portcast/公告路径。

## 23. Risks

| 优先级 | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| P0 | Mock/旧数据被误当成真实数据 | 错误决策 | V2.0 先补 provenance 和 UI 状态；失败不刷新 updatedAt |
| P0 | Portcast 页面或 ToS 不允许自动读取 | 港口真实化无法落地 | 只读公开展示；实现前做合规审查；失败即 disable，不接私有接口 |
| P1 | AISStream 只能看 Watched MMSI | 无法统计全港 | V2.5 条件化区域订阅；在此之前只做 Watched Vessel |
| P1 | Calendarific 数据滞后或额度不足 | 漏掉临时/地区假日 | 年度本地缓存 + 官方/ManualOverride + stale/conflict |
| P1 | 官方预警格式不稳定 | 预警抓取失败 | 少量来源、Feed fallback、手工核验、独立开关 |
| P1 | NewsNow Source 与 Shipping Feed freshness 不一致 | 资讯新鲜度误判 | Shipping adapter 增加 source status，不修改旧 Source 语义 |
| P1 | 真实船期来源不稳定 | 伪造 ETA/延误 | V2 不承诺真实 Planned Schedule；严格分开 AIS ETA |
| P2 | Nitro/本地 scheduler 重复启动 | 高频请求、重复事件 | 单例 loop、single-flight、持久化 last run/TTL |
| P2 | SQLite native module 环境差异 | 本地持久化不一致 | 继续兼容内存 fallback；实施阶段用 Node 22 运行验证 |
| P2 | Provider 增多导致维护成本 | 复杂度和误报上升 | 每个 Provider 必须通过 source matrix、验收和开关；后置低价值来源 |

## 24. Open Questions

以下问题保留给 V2.1 及以后实现前确认；V2.0 的实施批准和边界已经确定：

1. V2.0 已按批准范围完成；后续是否扩展 `Freshness` 之外的可信度字段，留待新的架构确认。
2. Portcast Public Page 的公开页面读取是否接受“仅公开展示字段、每日低频、ToS/robots 不允许就停”的硬边界？
3. 是否接受 Calendarific 只作为常规基础源，官方/ManualOverride 对临时和特殊假期拥有更高优先级？
4. 国家日历第一版是否只覆盖 TH/ID/MY/PH/VN，是否需要地区/subdivision 级假期？
5. 首页的近期国家日历是否只显示 medium 及以上影响，还是也显示用户标记的 low observance？
6. 是否接受 V2 暂不实现真实 Planned Schedule，只提供 Mock/手工计划和 AIS ETA 分栏？
7. 是否接受 V2.5 的 AIS 全港拥堵只是 `dataNature=derived`/`estimated`，并且可以因 AISStream 区域能力不足继续延期？
8. 首批资讯来源是否先采用两家行业媒体 + 中国三港和泰国/马来西亚官方公告，而把 Manila/Jakarta/Ho Chi Minh 和船公司公告放到第二批？
9. 是否接受 V2.2 为 `calendar_events` 增加最小新表；其余阶段优先复用现有 JSON/data 列而不新增表？
10. 本地 scheduler 是否允许在 Nitro 进程运行期间后台同步，还是只允许打开页面/手工刷新时按 TTL 同步？
11. Portcast 公开页面和五国官方节假日来源的最终 URL、robots/ToS、语言和更新频率，需在实现前由谁做最终业务确认？
12. 是否继续保留所有 NewsNow 非航运 Source 作为过渡，还是在 V2.3 之后只把航运 Feed 设为默认关注？

本轮不新增 ADR。若用户批准以后出现新的长期架构决定（例如允许新的真实 Provider、API Key 类别、区域 AIS session 或数据库表/迁移），应在实现前新增对应 ADR；普通字段映射和来源清单不单独建 ADR。

## 25. Acceptance Criteria

### 25.1 方案验收

- 文档覆盖 V2 Executive Summary、V1 baseline、目标/非目标、导航、数据源、Provider、可信度、Vessel、Port、Weather、Feed、Calendar、Voyage、Event Engine、本地存储、Scheduler、失败回退、安全、数据模型、UI、阶段、风险、Open Questions 和 Acceptance Criteria。
- 明确当前哪些已经实现、哪些仍是 V2 proposal、哪些延期或条件化；仅 V2.0 Data Trust Foundation 标记为 approved/implemented。
- 明确 Portcast 只使用公开展示数据，禁止商业 API/私有接口/绕过访问限制。
- 明确 AISStream 继续服务 Watched Vessel，区域全港统计需要独立结构调整且放后置阶段。
- 明确 Weather 的模型风险与官方预警分层，且不把 Open-Meteo 当成航海安全保证。
- 明确资讯不新增独立海运新闻页，继续复用 NewsNow Source/Feed。
- 明确 Calendarific + OfficialHolidayProvider/ManualOverride 的优先级、冲突、验证和缓存策略。
- 明确 Planned Schedule 与 AIS-reported ETA 分离，并允许真实船期延期。
- 明确 V2.2 最小新增 `calendar_events` 表；本轮没有 schema 变更。

### 25.2 未来实现验收

- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 按项目规则执行；任何环境限制必须标记 pending。
- Provider fixture 覆盖成功、超时、结构变化、无数据、disabled、last-known、stale 和 no-credential 场景。
- Domain/Event 单元测试覆盖 Portcast fingerprint、Calendar lead window、dedupe/reopen/resolve、stale 不新建事件和 severity 规则。
- SQLite 测试覆盖 calendar_events 初始化、读写、冲突字段和 retention；不引入 ORM。
- UI 测试覆盖四类 `sourceType`、七类 `dataNature` 中实际使用的值、STALE/FAILED/DISABLED/NEVER_SUCCEEDED、暂无数据和来源链接。
- AIS 测试证明 watched-only 不会被误报为全港统计；如果启用 area session，必须测试 Bounding Box、样本量不足、连接复用和退避。
- Portcast 测试证明只解析允许的公开字段，页面 source updatedAt 不变时不会产生重复 Event。
- 断网或没有 Key 时，核心本地工作台仍可启动；Mock/last-known/暂无数据状态清晰可见。

### 25.3 本轮最终状态

```text
V2.0 implemented and verified
V2.1 not started
```

本文件仍是方案与边界产物；V2.0 已完成实现、验证和文档同步。V2.1 及以后仍需新的范围确认和架构批准后才能开始。
