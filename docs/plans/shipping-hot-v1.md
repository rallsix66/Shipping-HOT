# Shipping HOT v1 Architecture Proposal

状态：`implemented / v1-provider-complete / runtime-verified-on-node22`。本计划的本地 Mock 闭环、八个 V1 重点港口 seed、AISStream Vessel adapter、Open-Meteo Marine Weather adapter 及其 fallback/tests 已实现并验证；SQLite restart persistence 与 fresh runtime smoke 已在 Node 22.23.2 验证，Node 24.15.0 保留 native module ABI fallback caveat。

## 1. 背景

目标是在 NewsNow 现有代码基础上，渐进改造成个人本地航运情报聚合与船舶跟踪工具。产品只关注用户关注的船、港口和可能影响货物的航运信息，不扩展为 ERP、TMS、WMS、全球 AIS 平台或多人 SaaS。

本轮完成 V1 Provider 闭环：UI/API/Domain/Event Engine/Provider orchestration/SQLite Repository 已实现；AISStream 只查询已关注且有 MMSI 的 Vessel，Open-Meteo Marine 只查询八个重点港口坐标并输出风浪风险 FeedItem，Provider 错误沿用 stale/sourceStatus/last-known fallback。Node 22.23.2 已完成 fresh runtime smoke 与 SQLite restart persistence；Node 24.15.0 因 native module ABI 不兼容使用 documented fallback。当前本地 Git 已配置 `origin=https://github.com/rallsix66/Shipping-HOT.git` 和 `upstream=https://github.com/ourongxing/newsnow.git`；GitHub CLI token 仍无效，因此账号级元数据保持 `pending`。

## 2. 当前 NewsNow 架构

### 运行时与构建

`package.json` 表明项目使用 React 19、Vite 7、TypeScript、TanStack Router、React Query、Jotai、Nitro、db0、better-sqlite3、Vitest 和 Vite PWA。`vite.config.ts` 将 React、TanStack Router、UnoCSS、unimport、PWA 和 Nitro 组合起来；`nitro.config.ts` 选择 Node server，并在本地使用 better-sqlite3。

### Source 数据流

```text
shared/pre-sources.ts
  -> scripts/source.ts
  -> shared/sources.json / pinyin.json / updated-sources.ts
server/sources/*.ts
  -> server/getters.ts (glob)
  -> server/api/s/index.ts
  -> Cache/db0
  -> SourceResponse
  -> React Query / News Card
```

`server/utils/source.ts` 提供 `defineSource`、RSS、RSSHub 和 Cloudflare proxy helper。现有 Source 直接返回 `NewsItem[]`；没有统一的结构化业务实体层。

### 数据库与缓存

`server/database/cache.ts` 通过 db0 SQL 初始化 `cache(id, updated, data)`，其中 `data` 是序列化的新闻数组。`server/database/user.ts` 初始化 `user(id, email, data, type, created, updated)`，用户 `data` 是序列化的前端 primitive metadata。`INIT_TABLE` 控制初始化，`ENABLE_CACHE` 控制缓存。

仓库没有迁移目录或 ORM schema。`nitro.config.ts` 未显式给出本地 SQLite 文件路径；Docker 通过 `/usr/app/.data` volume 持久化运行时数据。因此本地 db0 的准确文件位置应在实施 Phase 3 时通过运行时验证确认，不能在本计划中猜测。

### API、路由和状态

当前服务端 API 文件包括 `/api/s`、`/api/s/entire`、`/api/latest`、`/api/enable-login`、`/api/login`、`/api/oauth/github` 和 `/api/me/sync`。前端文件路由只有 `/` 和 `/c/$column`。

前端使用 Jotai 保存关注 Source、栏目排序、主题和登录信息；`primitiveMetadataAtom` 写入 `localStorage`，`useSync` 在有 JWT 时同步到 `user.data`。搜索实际是 Source 选择/关注搜索，不是文章全文搜索。拖拽排序只作用于关注 Source。

### 已存在的失败保护

`server/api/s/index.ts` 在抓取失败且已有缓存时回退旧数据；前端 `NewsCard` 显示“获取失败”。但现有协议没有统一 `stale`、`error`、`sourceStatus`，且 `entire` 响应可能以当前时间表达仍在刷新间隔内，不能直接作为 Shipping HOT 的 freshness 语义。

## 3. 复用矩阵

| 能力 | 决策 | 证据与边界 |
| --- | --- | --- |
| React/Vite/Nitro 单仓库 | KEEP | `package.json`、`vite.config.ts`、`nitro.config.ts`；作为运行时底座保留 |
| React Query + Jotai | KEEP | `src/main.tsx`、`src/atoms/**`、`src/hooks/query.ts`；分别承担服务端查询和本地 UI 状态 |
| TanStack Router | ADAPT | 当前只有 `/` 与 `/c/$column`，增加 Shipping HOT 路由但不迁移 Next.js |
| 热点/信息流卡片 | ADAPT | `src/components/column/card.tsx` 可保留视觉和时间线模式；字段需扩展 freshness/severity/关联实体 |
| Source 元数据 | ADAPT | `shared/pre-sources.ts` 的 name/type/interval/home/color/disable 可作为资讯 Source metadata 基础 |
| Source getter 注册 | ADAPT | `server/getters.ts` 的 glob 收集可继续用于 News Source；Structured Provider 需要独立但同风格边界 |
| Fetcher/Normalizer helper | ADAPT | `myFetch`、RSS/RSSHub parser、logger 可复用；需补 schema 校验、来源状态和错误封装 |
| cache/db0 | KEEP + ADAPT | `cache` 表继续服务资讯缓存；需要清晰区分缓存时间和真实数据更新时间 |
| SQLite/better-sqlite3 | KEEP | `nitro.config.ts` 已有本地 connector；第一版不换 ORM |
| 用户表/GitHub OAuth | LATER / 依赖后裁剪 | `user`、JWT、OAuth、sync 依赖存在；个人本地版不需要，但本轮不删除 |
| localStorage 关注与排序 | ADAPT | 可迁移关注 Source 为关注 Vessel/Port；结构化实体的权威状态放服务端本地库 |
| 搜索 | ADAPT | 当前只搜 Source；后续改为船名/IMO/港口/航次和资讯过滤 |
| 收藏/关注 | ADAPT | 当前 `focusSourcesAtom` 是事实基础；改造成 Settings 的关注实体集合 |
| PWA | KEEP / LATER | `pwa.config.ts` 和 `usePWA` 可保留；缓存策略不得伪装实时航运数据 |
| Cloudflare/D1 | LATER | `nitro.config.ts` 已有适配，但不属于本地第一版必需条件 |
| Docker | LATER | 有 Dockerfile 和 compose；保留可选开发/部署路径，不作为 Windows 本地前置依赖 |
| Vercel/Bun | LATER | 现有运行时分支暂不裁剪，待依赖分析后决定 |
| 普通新闻源 | ADAPT | 资讯类航运 Source 直接复用 Source contract；非航运源先保留，实施时分批裁剪 |
| AIHOT Source | LATER / ADAPT | 可作为资讯源样例保留，不能作为核心航运数据依赖 |
| 主题/响应式布局 | KEEP | UnoCSS、globals、responsive layout 是可复用 UI 资产 |
| 拖拽排序 | ADAPT | 复用关注项排序交互；不把拖拽作为 Provider 或 Domain 逻辑 |
| MCP/deployment/release | LATER | 不服务本地核心闭环，本轮不删除 |

结论：优先继承现有技术栈和 Source/缓存/UI 资产，使用最小改造增加结构化航运数据边界；不在本轮清理依赖。

### KEEP

React/Vite/Nitro 单仓库、TanStack Router、React Query、Jotai、db0/better-sqlite3、Source metadata/fetch/cache、卡片与响应式布局、主题、PWA、现有测试工具和可选 Docker/Cloudflare 兼容代码先保留。

### ADAPT

Source contract、缓存响应、路由、首页卡片、搜索/关注/拖拽排序、localStorage 偏好和错误展示都在保留基础上扩展为航运资讯与结构化实体的统一体验。

### REMOVE

本轮没有批准删除项。未来可能裁剪 GitHub OAuth/用户同步、云部署专用路径和非航运 Source，但必须先完成 Dependency Analysis、替代方案和回滚方案。

### ADD

增加 Shipping HOT 首页、Vessel/Port/Voyage/Event/Settings 领域边界，有限 Snapshot、Provider interfaces、结构化 freshness/error 状态、Mock Provider、确定性 Event Engine 和本地实体查询。

### LATER

真实 AIS/港口/船期/天气 Provider、Port Call、完整轨迹、AI 摘要、Daily Digest、多 Provider 聚合、OAuth/云部署裁剪、MCP 和通知能力全部后置。

## 4. 产品边界

### In scope

- HOT 首页：港口异常、船舶异常、航次异常、公告、天气/台风、航运资讯。
- 用户关注的 Vessel、Port、Voyage。
- 确定性 Event 规则和 freshness 展示。
- 本地 SQLite 状态、有限 Snapshot、设置和保留策略。
- Mock Provider 和可替换的真实 Provider 接口。

### Out of scope

- 用户注册、OAuth、多人同步、在线账号、支付、订阅。
- 全球船舶全量数据库、完整轨迹回放、复杂 Port Call 网络模型。
- Redis、Kafka、Event Bus、微服务、CQRS、复杂 DI 容器。
- 本轮真实 API 采购、申请、SDK 安装或接入。

## 5. 目标架构

```text
External Source / Provider
        ↓
Fetcher + Adapter boundary
        ↓ normalized DTO
Application Services
        ↓
Domain rules / Event detectors
        ↓
Storage (db0 + SQLite) and HOT query
        ↓
API handlers
        ↓
TanStack Router pages + React Query + Jotai UI state
```

Information Feed 与 Operational Data 共用 Source status、缓存/存储、Event 和 HOT 查询，但各自保留不同的数据模型。资讯是内容；结构化数据是状态；Event 是可解释的变化或影响。

## 6. 模块划分

### UI / Routes

负责页面和展示状态，不知道 provider 细节、不直接读数据库。沿用 NewsNow 的 `src/routes`、Header、卡片和响应式布局，新增 Vessel/Port/Voyage/Event 页面。

### Domain / Types

负责实体标识、规范化状态、delay/freshness/severity 规则和关系。不得导入 React、Nitro、db0 或供应商 SDK。

### Server / Services

负责 HTTP 输入校验、刷新编排、查询、事件生成和错误映射。资讯抓取与结构化 Provider 调用必须由服务层统一编排。

### Sources / Providers

`NewsSource` 延续 NewsNow Source contract；`VesselProvider`、`PortProvider`、`ScheduleProvider`、`WeatherProvider` 输出规范化快照。adapter 内部处理供应商字段。

### Storage

使用现有 db0 SQL 方式，增加最小表和索引，不引入 ORM。缓存与实体当前状态、Snapshot、Event 分开。

## 7. 数据模型

### FeedItem

```text
id
sourceId
category
type
title
summary?
sourceUrl
publishedAt?
fetchedAt
severity?
relatedPortIds[]
relatedVesselIds[]
relatedVoyageIds[]
rawData?
```

保留与 `NewsItem` 的兼容转换，但不要求所有结构化数据拥有 title/url。

### Vessel

```text
id
name
imo?
mmsi?
callSign?
carrier?
shipType?
isWatched
currentPosition?
speed?
course?
navigationStatus?
statusChangedAt?
destination?
eta?
lastUpdatedAt?
sourceStatus
```

只保存用户关注的船；不保存全球船舶全量。

### Port

```text
id
name
nameEn
unlocode?
country?
isWatched
congestionLevel?
waitingVessels?
containerWaitingVessels?
waitingHours?
weather?
operationalStatus?
lastUpdatedAt?
sourceStatus
```

重点港口是业务种子，不写死在 Domain：Shekou、Yantian、Laem Chabang、Port Klang、Manila、Jakarta、Ho Chi Minh City。

### Voyage

```text
id
vesselId
voyageNumber
originPortId?
destinationPortId?
baselineEtd?
baselineEta?
baselineEtdSource?
baselineEtaSource?
latestEtd?
latestEta?
latestEtdSource?
latestEtaSource?
latestEtaObservedAt?
delayMinutes?
status
lastUpdatedAt?
sourceStatus
```

`baselineEta`/`baselineEtd` 是开始跟踪航次时写入的基准；后续同步只能更新 `latestEta`/`latestEtd`。`delayMinutes = latestEta - baselineEta`，缺少任意一方时为 unknown，不猜测。

### Event

```text
id
type
severity
occurredAt
detectedAt
status
title
summary
dedupeKey
firstDetectedAt
lastDetectedAt
resolvedAt?
feedItemId?
vesselId?
portId?
voyageId?
evidenceJson
sourceStatus
```

第一版 Event 作为可查询的持久化事实保留有限时间，同时 HOT 是查询/排序结果，不重复存储每一次展示。`dedupeKey` 必须稳定且可预测；首次检测异常创建 Event，持续异常只更新 `lastDetectedAt`，严重程度变化更新 `severity/evidenceJson`，恢复时写入 `resolvedAt` 并将 `status` 设为 `resolved`。

Vessel 状态规则：`navigationStatus` 未变化时不更新 `statusChangedAt`；状态变化时更新 `statusChangedAt`。锚泊持续时间为 `now - statusChangedAt`，用于确定性锚泊异常检测。

### Settings

```text
refreshInterval
sourceEnabled
providerEnabled
eventThresholds
retentionDays
```

API Key 只来自环境变量或本地安全配置，不进入 Settings 普通 JSON。

## 8. 数据流

### Information Feed

```text
External News Source
  → NewsNow Fetcher / cache
  → Normalize
  → feed_items
  → classification/rules
  → optional Event link
  → HOT query
  → UI
```

### Vessel

```text
VesselProvider
  → VesselSnapshot DTO
  → validate + normalize
  → compare previous current state
  → detect anchored/delay/ETA/destination change
  → update vessels + event
  → HOT / vessel page
```

### Port

```text
PortProvider
  → PortSnapshot DTO
  → validate + normalize
  → evaluate congestion / operational status
  → update ports + event
  → HOT / port page
```

### Voyage

```text
Schedule data + Vessel data
  → Voyage state
  → baseline/latest ETA comparison
  → delay = latestEta - baselineEta
  → event
  → HOT / voyage page
```

每条流都必须能单独失败；某一 Provider 失败只更新其 source status，不阻断其他流。

## 9. Provider / Source 架构与数据源评估

### 边界

普通 News Source 返回资讯型 `FeedItem`；Structured Provider 返回 `Snapshot` 或 schedule DTO。两者在 Application Service 中汇合，由规则生成 Event，再由 HOT query 统一展示。

### Data Source Evaluation

| 数据源 | 可能提供 | 官方/API | 个人成本/限制 | 中国访问与 Key | 第一版建议 | 替代方案 |
| --- | --- | --- | --- | --- | --- | --- |
| AIS | 船位、速度、航向、导航状态、目的地、ETA | 取决于供应商；常见为商业 API | 通常有额度/费用 | 需逐家验证 | 先做接口 + Mock；再选一个可负担 Provider | 船公司/港口公开更新、手工 Vessel fixture |
| 港口拥堵 | 等待船数、等待小时、运营状态 | 港口官方或商业数据 | 覆盖和刷新频率差异大 | 需逐家验证 | 先定义 PortProvider | 港口公告 + 手工状态 |
| 船期 | 计划 ETD/ETA、航次、停靠 | 船公司/船期服务 | 变更频繁，可能需订阅 | 需逐家验证 | 先定义 ScheduleProvider | 公告、公开船期页面 |
| 天气/台风 | 预警、风暴路径、影响区域 | 气象机构/公开 API | 部分免费，有调用限制 | 需逐家验证 | 先定义 WeatherProvider | 本地导入/新闻 Source |
| 船公司公告 | blank sailing、port omission、航线调整 | 官方公告 | 多为网页/RSS，抓取稳定性不一 | 一般无需统一 Key | 作为 News Source/规则分类 | 手工订阅列表 |
| 港口公告 | 作业暂停、拥堵、天气影响 | 港口官网/公告 | 页面结构不统一 | 需逐家验证 | 作为 News Source | RSS/手工导入 |
| 航运新闻 | 市场、供应链、罢工、天气影响 | 新闻/RSS/公开站点 | 抓取、版权和频率限制 | 逐源验证 | 复用 NewsNow Source contract | RSS、官方公告 |

本轮不购买、申请、安装或连接 ShipXY、AISStream、VesselFinder、MarineTraffic、Portcast 等真实服务。

## 10. 路由

proposal 路由：

```text
/                  HOT 首页
/vessels           我的船
/vessels/:id       船舶详情
/ports             我的港口
/ports/:id         港口详情
/voyages           我的航次
/voyages/:id       航次详情
/events            事件列表
/settings          本地设置
```

`/news` 暂不独立建立。若后续资讯阅读筛选明显不同于 HOT，才增加独立路由；否则由 HOT 的 category/filter 承载。

## 11. UI 信息架构

首页沿用 NewsNow 的布局和卡片语言：

```text
Shipping HOT
  今日重点
    severity + freshness 排序的 Event
  信息流
    港口 / 船舶 / 航次 / 天气 / 公告 / 新闻
  我的船
    Anchored / ETA / delay / updatedAt
  我的港口
    congestion / waiting / operational status / freshness
```

直接复用：卡片容器、时间线/热榜列表、主题色、响应式网格、滚动容器、刷新和关注交互。新增：结构化状态 Widget、freshness badge、错误/过期提示、实体关系链接、事件严重程度呈现。

## 12. 本地存储

优先继续使用现有 db0 + SQLite SQL 初始化方式。V1 核心数据表明确为现有两张加新增六张：

1. `cache`：继续复用，存 News Source 短期缓存。
2. `user`：现有 NewsNow 登录/同步遗留能力，后续裁剪，不属于 Shipping HOT 本地核心。
3. `feed_items`：航运资讯结构化持久层，用于去重、severity、实体关联、HOT 排序和后续搜索。
4. `vessels`：必须，存关注船当前状态和 `isWatched`。
5. `ports`：必须，存关注港口当前状态和 `isWatched`。
6. `voyages`：必须，表达关注航次、baseline/latest 时间和 delay。
7. `events`：必须，统一 HOT 异常与资讯关联，并支持生命周期和去重。
8. `settings`：必须，只存刷新、来源/Provider 开关、阈值和保留周期。

因此 V1 核心表就是：`cache`、`user`、`feed_items`、`vessels`、`ports`、`voyages`、`events`、`settings`。其中 `cache` 继续作为 NewsNow 抓取缓存，`feed_items` 作为航运资讯的结构化持久层；`user` 仍是现有遗留能力。

不新增 ORM。没有代码证据表明当前 SQL/db0 不足以支撑上述少量本地表。

## 13. 失败保护

每种 Source/Provider 返回统一状态：

```text
data
updatedAt
stale
error
sourceStatus: healthy | degraded | failed | disabled | never_succeeded
```

规则：

- 有旧值且刷新失败：展示旧值 + 原始 `updatedAt` + stale 标识。
- 无旧值且刷新失败：展示暂无数据 + 错误原因摘要。
- Provider A 失败：只影响 A 的实体和事件，不阻塞 B 或首页。
- UI 不以请求成功时间代替数据更新时间。
- 规则检测没有足够数据时输出 unknown，不生成假异常。

## 14. 数据保留

- Vessel/Port 当前状态：保留最新一份。
- Vessel Snapshot：只有为变化检测和近期审计所需时保存；默认 7 天，按设置可调整。
- Port Snapshot：默认 7 天；若 Provider 只给聚合状态，可仅保存变化点。
- Event：默认 30 天，只保留去重后的事件和 evidence。
- Feed/cache：沿用 Source interval/TTL；`feed_items` 默认 30 天并定期清理。
- 不保存完整 AIS 轨迹，不做无限增长的日志型数据库。

## 15. 安全

- API Key 使用环境变量或本地安全配置，`.env*` 已被 `.gitignore` 忽略；不得写入 Settings JSON、日志或提交。
- 本地服务默认只服务 localhost；若未来开放局域网访问，需新增明确的访问控制决策。
- 保留 OAuth 代码不等于 Shipping HOT 需要登录；删除前先完成依赖分析。
- Provider 响应进行字段校验，避免原始 JSON 进入 Domain。

## 16. 实施阶段

### Phase 0 — NewsNow Audit + Architecture Contract

- Goal：完成证据化审计、复用矩阵、边界和实现前架构文档。
- In Scope：仓库准备、文档、ADR、路线和风险。
- Out of Scope：任何业务代码、依赖、数据库变更。
- Files：`docs/**`，必要时架构权威文件。
- Dependencies：Git、当前 NewsNow 源码。
- Acceptance Criteria：审计证据可定位；本地 Mock 架构边界明确；真实 Provider 保持 deferred。
- Risks：架构与洁癖 Skill 来自外部 Skill 仓库，执行时需读取其真实 `SKILL.md` 和指定参考文件。
- Rollback：删除本轮新增 docs 即可，不影响运行时代码。

### Phase 1 — Brand / UI 精简（implemented-mock）

- Goal：将 NewsNow 品牌和导航最小化改为 Shipping HOT，保留布局、卡片、响应式和 PWA 资产。
- In Scope：名称、首页骨架、导航占位、空状态和视觉文案。
- Out of Scope：真实航运数据、数据库、Provider、OAuth 裁剪。
- Files：现有 `src/**`、PWA metadata、可能的 `public/**`。
- Dependencies：用户已确认架构并授权连续执行 Phase 1–4。
- Acceptance Criteria：现有新闻卡片仍可运行；不引入新框架；路由和品牌行为有测试/手工记录。
- Risks：过早删除登录/部署入口；先保留并通过后续依赖分析处理。
- Rollback：按文件回滚品牌和导航变更。

### Phase 2 — Shipping Information Sources（implemented-mock）

- Goal：把资讯流扩展为航运 Source，并保持 NewsNow Source contract。
- In Scope：公告、航运新闻、天气/台风资讯的 normalized FeedItem；Source status。
- Out of Scope：AIS、港口结构化状态、真实商业 API。
- Files：`shared/**`、`server/sources/**`、`server/utils/**`、相关测试。
- Dependencies：Phase 1；选择首批公开/稳定 Source。
- Acceptance Criteria：Source 可独立失败；能显示更新时间/过期；不破坏现有 Source 流。
- Risks：抓取不稳定、版权、供应商格式变化。
- Rollback：关闭新增 Source metadata/adapter，不删除 NewsNow 原有 Source。

### Phase 3 — Vessel / Port / Voyage Domain（implemented-mock）

- Goal：建立最小本地结构化模型和 SQL 存储。
- In Scope：`feed_items`、`vessels`、`ports`、`voyages`、`events`、`settings` 六张新增核心表，当前状态、baseline/latest ETA/ETD、delay DTO。
- Out of Scope：真实 Provider、完整 Snapshot 历史、Port Call。
- Files：目标 `server/storage`、`server/domain`、`shared/types`、迁移/初始化测试。
- Dependencies：Phase 0 contract；确认 db0 本地路径和表初始化方式。
- Acceptance Criteria：可以创建/查询关注船、港口、航次；计划/当前时间分离；无 ORM。
- Risks：表过度建模、破坏现有 cache/user 初始化。
- Rollback：新增表与服务隔离，不改现有 cache/user schema。

### Phase 4 — Mock Provider + Event Engine（implemented-mock）

- Goal：用 fixture 驱动确定性异常检测。
- In Scope：Mock Vessel/Port/Schedule Provider、snapshot compare、事件去重、freshness。
- Out of Scope：真实 API、AI、全轨迹。
- Files：目标 `server/providers`、`server/domain`、`server/services`、`test/**`。
- Dependencies：Phase 3。
- Acceptance Criteria：ETA +24h、anchored >12h、拥堵阈值等规则有单元测试；Provider 失败可隔离。
- Risks：规则阈值误报；所有事件保留 evidence 和可配置阈值。
- Rollback：关闭 Mock Provider/事件服务，保留数据表。

### Phase 5 — First Real Vessel Provider (`completed`)

- Goal：接入一个经评估的真实 Vessel Provider。
- In Scope：一个 adapter、key 配置、限流/错误映射、状态展示。
- Out of Scope：多供应商聚合、轨迹库、商业采购扩展。
- Files：单一 Provider adapter、配置、contract tests、文档。
- Dependencies：Phase 4；完成 Data Source Evaluation 和用户确认成本/访问性。
- Acceptance Criteria：没有 API Key 时核心 UI 仍可用；失败回退明确；原始供应商格式不泄漏到 Domain。
- Risks：成本、限流、中国访问、许可变化。
- Rollback：禁用 Provider 开关，回退 Mock/last known data。

### Phase 6 — Real Weather Provider (`completed`)

- Goal：接入一个港口或天气 Provider，形成港口异常闭环。
- In Scope：Port/Weather adapter、拥堵/天气规则、状态 freshness。
- Out of Scope：多区域全量覆盖、预测模型、AI。
- Files：Provider adapter、规则、页面 Widget、测试。
- Dependencies：Phase 4；优先选择可公开访问、个人成本低的来源。
- Acceptance Criteria：港口接口失败不影响 Vessel/HOT 资讯；UI 可区分实时/过期/暂无。
- Risks：港口指标定义不一致；保留原始 evidence 和 source metadata。
- Rollback：关闭对应 Provider，继续展示 last known 或暂无。

### Phase 7 — Real Provider → Event → HOT (`completed`)

- Goal：把资讯 Event 和结构化 Event 聚合成可操作的 HOT 首页，并可选生成 Daily Digest。
- In Scope：优先级排序、实体关联、去重、事件确认/关闭、规则摘要。
- Out of Scope：AI 强依赖、复杂消息队列、多人通知系统。
- Files：HOT query/service、首页 Widget、事件列表、可选 digest 服务。
- Dependencies：Phase 2–6。
- Acceptance Criteria：首页回答三个产品问题；每项有来源、更新时间、严重程度和关联实体；无数据时可用。
- Risks：重复事件和噪音；通过去重键、severity 和 retention 控制。
- Rollback：退回独立 Source/实体页面，不删除已采集的有限事件。

## 17. 风险

1. GitHub CLI API 认证仍无效：本地 `origin` 已可读，但账号级元数据无法由 `gh` 验证。
2. NewsNow 上游持续变化：后续修改前需重新对比 upstream，避免盲目依赖生成文件。
3. 本地 db0 文件位置尚未通过运行时确认：实施 Phase 3 前必须安装现有依赖并验证，不得猜测。
4. Source 抓取失败/限流/版权：Provider 和 Source 必须隔离、限频、可禁用。
5. 结构化数据定义不一致：所有 Provider 必须输出规范化 DTO 和 evidence。
6. 过度建模：第一版不做完整 Port Call 和轨迹库。
7. OAuth/Cloudflare/Docker 依赖关系不清：本轮保留，实施前做 Dependency Analysis。

## 18. 验收条件

本轮文档验收：

- 已记录仓库、远端、分支和工作树状态。
- 已给出 NewsNow 当前架构证据和不存在项。
- 已给出 KEEP/ADAPT/REMOVE/ADD/LATER。
- 已区分 Information Feed 与 Operational Data，并画出四条数据流。
- 已回答 Snapshot、Event、Voyage、delay、freshness、Provider 隔离、ORM 和最小表数量问题。
- 已给出目标目录职责与依赖方向。
- 已给出每个 Phase 的 Goal/In Scope/Out of Scope/Files/Dependencies/Acceptance/Risk/Rollback。
- 新增内容只在 `docs/**`，没有改动业务源码、依赖、锁文件或数据库。
- 本地 Mock 闭环与 V1 AISStream/Open-Meteo Provider 标记为 `implemented / verified`；持久化 SQLite 在 Node 22.23.2 标记为 `verified`，Node 24.15.0 仍保留 ABI fallback caveat。

## 19. 明确不做

- 不迁移 Next.js、Prisma、Supabase。
- 不安装 AIS SDK，不连接 ShipXY、AISStream、VesselFinder、MarineTraffic、Portcast。
- 不删除微博、知乎、Bilibili、AIHOT、OAuth、Cloudflare 或 Docker。
- 不做真实 Provider、数据库 migration、业务 API、页面或组件。
- 不创建全球船舶数据库、完整轨迹库、复杂队列或微服务。

## 20. 待确认事项

1. 是否接受当前本地 `origin` 与 GitHub 仓库已存在、但 `gh` 账号级验证仍 pending 的状态？
2. 本地第一版是否保留 NewsNow 的全部非航运 Source 作为过渡，还是 Phase 1 后仅显示航运资讯？
3. 事件默认阈值与 Snapshot/Event 保留天数是否接受本计划的初始值？
4. 首个真实 Vessel/Port Provider 的成本、访问性、许可和 API Key 是否满足本地使用？
5. `/news` 是否需要独立资讯阅读模式？当前提案暂不建立。

## 架构问题 Q1–Q17

- **Q1：** 可直接作为底座的是 Vite/Nitro/React/TanStack Router/React Query/Jotai、db0/SQLite、Source metadata/fetch/cache、卡片/响应式/PWA 资产。
- **Q2：** 当前没有足够依赖证据支持立即删除任何 NewsNow 功能；OAuth、Cloudflare、Docker、普通 Source 先保留，实施阶段按依赖裁剪。
- **Q3：** News Source 返回 FeedItem；AIS/Port Provider 返回规范化 Snapshot；Application Service 通过 Event/HOT query 汇合。
- **Q4：** Event 是有证据的持久化领域事实；HOT 是排序/过滤后的运行时查询结果。
- **Q5：** Vessel Snapshot 不是全量轨迹必需；仅为变化检测/短期审计有限保存。
- **Q6：** Port Snapshot 同理；如果只需当前拥堵等级，可先保存变化点或当前状态。
- **Q7：** Voyage 通过 `vesselId` 关联 Vessel；不把船舶字段复制成航次实体。
- **Q8：** `baselineEta`/`baselineEtd` 是开始跟踪时的基准，`latestEta`/`latestEtd` 是最新值；基准不得被自动同步覆盖。
- **Q9：** delay = `latestEta - baselineEta`；缺少任意一方时为 unknown。
- **Q10：** FeedItem 是资讯；Vessel/Port/Voyage 是运营实体；Event 引用其中一个或多个；HOT 展示 Event 和相关 FeedItem。
- **Q11：** 每个 Provider 独立刷新、状态和回退；服务层捕获错误，UI 展示 stale/error，不让单分支异常冒泡成整站失败。
- **Q12：** 以 provider `updatedAt` 为准，统一输出 stale/error/sourceStatus；请求时间不是数据时间。
- **Q13：** 对第一版本地单用户模型，现有 db0/SQLite 足够；需复用 cache、保留 user，增加最小结构化表，不换 ORM。
- **Q14：** 没有证据需要 ORM；当前 db0 SQL 初始化直接可用，新增 ORM 只会增加迁移和依赖成本。
- **Q15：** V1 核心表为 `cache`、`user`、`feed_items`、`vessels`、`ports`、`voyages`、`events`、`settings`；其中 `user` 是遗留能力，`feed_items` 是正式 V1 航运资讯持久层。
- **Q16：** 最小范围是资讯 Source + 本地关注实体 + Mock Provider + 确定性 Event + HOT freshness 展示，不接真实 API。
- **Q17：** 完整 Port Call、AIS 轨迹、AI 摘要、Daily Digest、多 Provider 聚合、OAuth/云部署裁剪和所有真实数据采购均后置。

## Architecture Contract（proposal）

以下合同描述提议中的 Shipping HOT 边界，不代表当前代码已实现或已经批准。

### Product Boundary

个人、单用户、Windows 优先、localhost 运行；只服务于关注船、关注港口和影响货物的航运信息。

### Runtime Architecture

保留 NewsNow 的 React/Vite/Nitro 模块化单体和单仓库；默认本地 Node + db0/SQLite，Provider 和 AI 都不是核心启动依赖。

### Repository Boundary

目标逻辑边界为 UI、Routes、Domain、Server、Sources、Providers、Storage、Services、Types、Config、Tests、Docs；本轮不创建业务目录或移动现有源码。

### Module Boundary

UI 只展示；Routes 只组合页面；Application/Services 编排；Domain 持有规则；Sources/Providers 负责外部适配；Storage 负责 db0/SQLite；Types 提供共享 DTO。

### Data Boundary

Information Feed 使用 FeedItem；Operational Data 使用 Vessel、Port、Voyage 和有限 Snapshot；Event 保存两者关系和可解释证据；HOT 是查询/排序结果。

### Provider Boundary

NewsSource、VesselProvider、PortProvider、ScheduleProvider、WeatherProvider 只输出规范化 DTO；供应商原始格式必须止步于 adapter。

### Storage Boundary

复用现有 db0/SQLite 和 cache；新增结构化表必须以最小必要模型为准；不引入 Prisma，不做无限 AIS 轨迹库，不把 API Key 写入数据库。

### UI Boundary

复用 NewsNow 卡片、响应式布局、主题、滚动和拖拽交互；新增 HOT、我的船、我的港口、航次和 freshness/error Widget。

### Dependency Rules

依赖方向为 `UI → Application/Services → Domain → Provider Interface → Adapter → External API`；UI 不调用外部 API/SQLite，Domain 不引用供应商名称或 SDK。

### Failure Rules

每个 Source/Provider 独立失败；输出 `lastKnownData`、原始 `updatedAt`、`stale`、`error`、`sourceStatus`；旧数据不得伪装成实时数据。

### Security Rules

API Key 只来自环境变量或本地安全配置；第一版不需要注册、登录、OAuth、在线账号、RLS、支付或权限体系。

### Testing Rules

Domain 规则使用确定性单元测试；Provider 使用 fixture/mock；Storage 验证初始化、回退和清理；UI 验证最新/过期/失败/暂无数据状态。

### Change Rules

已确认的本地 Mock 范围允许继续维护；删除 NewsNow 能力、改数据库/认证/部署、引入框架或接入真实 Provider 需要新的架构变更确认；所有未确认目标保持 `proposal` 或 `deferred`。
