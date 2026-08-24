# Shipping HOT V3 — Real Data Migration

> 文档状态：`accepted / P2A search foundation + P2B Identity Seal + P2C Background Runtime Foundation complete / sealed / AIS tracking runtime deferred`
>
> 审查日期：2026-08-24（Asia/Shanghai）
>
> 代码基线：`codex/shipping-hot-v3-real-data`（P2B 本轮）
>
> 实施状态：**P0 Persistence、P1A Real Port Directory Foundation、P1B Mock Isolation、P2A Search Foundation、P2B Identity Seal 与 P2C Background Runtime Foundation 已完成、封板并通过本地验证**。本轮完成统一 Runtime、migration v6 复合 identity、cadence-safe `runNow`、失败安全 bootstrap、SQLite execution history/provider health、启动/关闭接线和测试 Job 验证；不实现 AIS 长连接、Tracking Runtime、Feed、Calendar、Voyage、Translation 或其他后续 Provider 业务。
>
> 本轮修订：根据官方页面复核、代码边界复核和 V3 方案交叉审查，收窄 VesselAPI 能力边界、增加可切换 TranslationProvider/Usage/Secret 合同、补齐 Feed 三层 freshness gate、Calendar 启动链路和 P0 schema 预留。外部价格/额度是 2026-08-20 的公开页面快照；只有具体 endpoint entitlement、地区/账号资格等未确认事项保持 `unknown/pending`。
>
> 实施门槛：Architecture Approval 已完成，ADR-005 状态为 `Accepted`，且用户已确认开始执行。本轮落实获批的 P2C Background Runtime Foundation；不创建账号、不购买服务、不实现 AIS 长连接、Tracking Runtime、Feed/Calendar/Voyage/Translation Adapter 或真实业务 Job。

## 1. 背景与当前问题

Shipping HOT V2 已经建立了 Provider、Domain、Repository、Event/HOT 和来源可信度边界，但当前系统仍是“部分真实数据 + Mock 身份/配置 + 内存 fallback + 请求触发同步”。它可以证明单个真实适配器和 Mock 隔离规则，却还不是一个进程重启后可靠、默认只展示真实数据的个人航运情报系统。

本轮审查结合了当前代码、当前 Node 运行时、SQLite 原生模块加载结果、最近 15 次提交、V1/V2 文档和 Provider 官方资料。关键结论是：V3 不能继续在 V2 的请求链上追加搜索、翻译和更多 Provider；必须先修复持久化所有权、运行模式和同步调度三个基础边界。

当前最严重的问题不是“少一个 API”，而是以下问题同时存在：

1. Node 24.15.0 运行时需要 ABI 137，但工作区安装的 `better-sqlite3` 二进制是 Node 22 ABI 127；原生 SQLite 无法加载。
2. `server/shipping-store.ts` 捕获 SQLite 初始化异常后，静默继续使用模块级 `fallbackSnapshot`，且该快照初始来自完整 Mock 数据。
3. Repository 是否为空只检查 `vessels` 行数。Real Mode 的 AIS 没有观测时 `vessels=[]`，因此每次重启都可能再次 seed，并用默认设置/默认关注状态覆盖其他已经存在的表。
4. `INSERT OR REPLACE` 同时写 Provider 数据和用户 `isWatched`，没有字段所有权隔离；Replace 语义也不适合作为未来外键表的更新方式。
5. `/api/shipping` 每次 GET 都会发起 Provider 工作；Watched AIS 是请求内创建、等待、关闭的 WebSocket，不是服务器长期订阅。
6. 港口身份、天气坐标和 AIS Area bbox 来自 `shared/shipping-fixtures.ts`；即使动态值来自 Portcast/Open-Meteo/AISStream，其真实链路仍依赖 Mock fixture。
7. Schedule 在所有运行模式中都固定为 `MockScheduleProvider`，并被 Real Mode operational source context 明确允许；V3 只能先清除 Mock，再按已获准的 carrier entitlement 接入。
8. Feed 没有 7/14 天年龄闸门；失效的 Feed Event 在缺少当前 source trust 时会继续保持 active，可能长期进入 Events/HOT。
9. Calendarific 只有手工同步 API，没有启动自动维护当前年 + 下一年的后台调度。
10. Provider Runtime 只是当前响应中的临时摘要，无法回答最后请求、最后成功、最后源更新时间、缓存年龄和连续失败次数；也没有本地 Provider 用量/估算成本账本。

## 2. 当前系统真实状态审查

### 2.1 模块状态矩阵

| 模块 | 当前 Provider / 代码 | 当前真实度 | 是否持久化 | 当前问题 | V3 目标 |
| --- | --- | --- | --- | --- | --- |
| 船舶身份/搜索 | 无全球搜索；Real Mode 仅 `AISStreamVesselProvider`，初始 Watch Target 来自已存数据或 Mock fixture | 混合；AIS PositionReport 可真实，但默认身份种子是 Mock，当前实测无 PositionReport | 设计上写 `vessels`；当前 Node 24 实际为内存 | 无搜索；无观测时 `vessels=[]`；请求内短连接；重启可能重新 seed | VesselAPI 只负责低频 Vessel Discovery/静态元数据与已证实的补充事件；AISStream 只长期跟踪已关注 MMSI，不把 VesselAPI 当实时船位源 |
| 港口身份 | 八个 `mockPorts` 身份；Portcast 只覆盖硬编码的八个 public page URL | 混合；名称/UNLOCODE/坐标来自 fixture，部分拥堵字段真实 | 设计上写 `ports`；当前实际为内存 | provenance 被整体标为 Portcast，无法表达身份字段的 fixture 来源；全球搜索不存在 | 本地 UNECE UN/LOCODE + 中文别名 + 坐标补充目录为默认；VesselAPI Port API 只作可选 enrichment，不把 entitlement 写成默认前提 |
| 港口拥堵 | `PortcastPublicPageProvider` | 八港部分真实 derived；7 fresh / 1 stale 是历史探测证据 | 同上 | 仅硬编码八港；公开页面脆弱；不能承诺新增港口均有拥堵数据 | 独立 Port Intelligence 能力；没有覆盖就显示“暂无真实拥堵数据” |
| Watched AIS | AISStream | Provider 真实；连接已验证、观测仍 pending | Vessel 当前状态计划写库；当前实际为内存 | 每个 GET 打开最长 5 秒的全世界 bbox + MMSI WebSocket；多客户端会重复连接 | 长期 `AisTrackingService` 单例；只订阅已关注 MMSI，watchlist 变化增量重订阅，观测立即持久化 |
| AIS Area | AISStream Area PositionReport + derived engine | 原始消息可真实，指标为 derived；当前外部观测 0 | `ais_port_metrics` 当前/last-known 设计，当前实际为内存 | bbox 从 fixture 坐标生成；只覆盖八港；不是官方拥堵 | 从真实 Port 坐标/配置生成并保留边界证据；只展示为 AIS 估算信号 |
| 天气模型 | Open-Meteo Marine + Forecast | 响应真实 forecast；目标坐标来自 Mock fixture | 作为 `feed_items`；当前实际为内存 | `portWeatherConfig` 只含八港；无通用坐标路径 | 直接使用真实 Port 经纬度；30–60 分钟自动刷新；失败保留同 Provider last-known |
| 官方气象预警 | JMA/TMD/BMKG adapters | Provider 边界存在，但 `public` 模式没有任何 `verified_live` active source | 作为 `feed_items` | 适配器存在不等于启用；当前 UI 只显示模式值 | 每源独立 live gate、生命周期、覆盖和 health；未启用明确显示“不可用/未验证” |
| 行业资讯 | The Loadstar active；Maritime Executive disabled；其他 registry 项未启用 | Loadstar 真实；Maritime Executive failed；无 Mock fallback 时边界正确 | `feed_items` 设计持久化；当前实际为内存 | 无发布时间年龄闸门、future/异常日期校验和 current/history 分层 | 拆成 Ingestion Gate、Current Feed Query Gate、HOT/Event Freshness Gate；默认 7 天，重大资讯最多 14 天，历史单独查询 |
| 港口公告 | Shekou `/ywgg/` active；其他港口 registry 多为 pending/deferred | Shekou 页面真实；多数条目 publication time unknown | 同 Feed | 发布时间未知仍出现在 Feed；是否仍有效不可判断 | 官方公告与行业新闻分层；基于有效期/撤回状态，未知时间默认不进当前流 |
| 国家日历 | Calendarific + 空的 Official/Manual composition | Calendarific transport/parser 真实且 partial；Official/Manual 当前没有实数据 | `calendar_events` + `settings.calendarSync` 设计；当前实际为内存 | 启动不自动同步；seed 可重置 coverage；只手工维护单年 | 启动先读库，后台维护当前年 + 下一年，约 7 天 TTL，失败保留 last-known |
| 当前航程 | AIS 目的地/ETA 字段和 Mock Voyage 分散存在 | 混合，未形成真实 Current Voyage | `voyages` 当前只保存 Mock schedule | AIS ETA 与官方班期没有分层；无 port-call 事实 | 先用 AIS observed + 已验证 port-call evidence 形成 Current Voyage；VesselAPI ETA/events 只能作为账号验证后的可选 enrichment |
| 商业班期 | `MockScheduleProvider` | 全 Mock | `voyages` | Real Mode 也始终 operational；无真实 ScheduleProvider adapter | DCSA 规范化合同；按获准船公司逐个接入；无 Provider 时为空 |
| Events | `detectShippingEvents()` | derived；显式 sourceId 过滤能排除多数 Mock，但 `mock-schedule` 被允许 | `events` 设计持久化；当前实际为内存 | orphan active Event 无当前 source trust 时不会 resolve/expire；混合 fixture lineage 未被识别 | 所有 evidence 必须是 real/user/derived-from-real；有明确有效期、source identity 和可追溯链 |
| HOT | `rankHotItems()` | derived；可含 Mock schedule Event 和长期 active 的旧 Event | 查询结果，不单独持久化 | 没有强制 `all evidence real`；stale active Event 仍可出现 | 只消费通过 Real Evidence Gate 的 Event/Feed，逐条可追溯 |
| 关注/设置 | `POST /watch` toggle、`POST /settings` | 用户真实操作 | Repository 可用时写库；当前 Node 24 实际内存 | API 返回成功并不代表可跨重启保存；watch 与 Provider 行同表 | 独立 watchlist/settings 表，事务提交成功后才返回成功，DB 不可用时 503 |
| 中文 UI | 大部分固定 UI 已中文 | UI chrome 多数中文；外部内容、船型、国家、标签和 Provider mode 仍英文 | 无翻译缓存 | 无 Translation Layer；原文/译文未分离 | zh-CN 默认；外部可翻译字段异步翻译并缓存；标准标识永不翻译 |
| Provider Runtime | `providerFreshness` 临时对象 + sidebar mode | 请求级状态 | 不持久化 | sidebar 颜色主要看 mode，不看真实 health；无 last success/request/source update | `provider_runtime` + `sync_runs`，展示正常/降级/不可用、时间、缓存和原因 |

### 2.2 已存在的 API

当前 Shipping API 包括：

- `GET /api/shipping`：读取、触发所有 Provider、写入快照、计算 Event/HOT。
- `POST /api/shipping/watch`：对既有 Vessel/Port 做 toggle。
- `GET /api/shipping/search/vessels`：读取 Vessel Search 结果。
- `GET /api/shipping/search/vessels/watchlist`：读取搜索 Vessel 的 user-owned Watchlist。
- `POST/DELETE /api/shipping/search/vessels/watch`：添加/取消搜索 Vessel 关注。
- `POST /api/shipping/settings`：更新刷新/阈值/retention。
- `GET /api/shipping/calendar`：读取已缓存日历。
- `POST /api/shipping/calendar/sync`：手工同步指定年/国家。

仍不存在 Current Voyage/Port Call、Provider Health、历史 Feed 搜索、翻译状态和同步运行记录 API；AIS Tracking Runtime 也仍 deferred。

### 2.3 Provider 已存在但未真正启用的部分

- JMA、TMD、BMKG：代码和 parser 存在，但 `public` 模式只激活 `verified_live`，当前三者均仍为 `live_pending`。
- Maritime Executive：registry 存在但 `failed_live` 且 disabled。
- Laem Chabang、Port Klang 官方港口公告：registry 存在但 parser pending。
- Yantian、Nansha 官方公告：registry 存在但 deferred。
- `OfficialHolidayProvider` / `ManualHolidayProvider`：composition 存在，但默认 `events=[]`，不是自动真实来源。
- ScheduleProvider 接口存在，但唯一实现是 Mock。

### 2.4 最近 15 次提交反映出的真实演进

审查范围为 `c292be4` 至 `b6730ac` 的最近 15 次提交：

- V2.5 完成 AIS Area 的 bounded aggregate、可信时间和重连生命周期。
- Calendar 修复了 process-like restart 时的 persisted baseline 和 operational source isolation。
- Feed/官方预警修复了单源 timeout、unknown publication time 和 warning lifecycle。
- Real Mode 修复了环境变量加载和 requested provider mode 显示。
- 这些提交封住了显式 Mock record 的 operational sourceId 泄漏，但没有改变 SQLite ABI fallback、请求触发刷新、fixture 坐标依赖、Mock Schedule 或全局搜索缺失。

因此 V3 应视为新的运行架构阶段，而不是 V2.5 的小型 follow-up。

### 2.5 文档与代码的差异

| 文档说法 | 当前代码证据 | V3 处理 |
| --- | --- | --- |
| `Mock isolation: complete` | 显式 Mock sourceId 的过滤基本成立，但 `shared/ais-area.ts` 和 Open-Meteo 生产路径仍引用 `shared/shipping-fixtures.ts` 的港口坐标；Portcast 身份也从 Mock Port 派生 | 将表述收窄为“显式 Mock record isolation 已实现”；P1 去除正式代码对 fixture 的依赖 |
| Real Mode 不回退 Mock | Provider failure 的 same-source last-known 规则成立，但 SQLite 初始化失败会回到初始 Mock `fallbackSnapshot`，Schedule 也固定 Mock | P0 禁止静默 memory fallback；P1 Real Mode 禁止任何 Mock Provider/seed/schedule |
| Provider Runtime 已显示 | UI 显示 requested mode 和一次请求的 freshness；不持久化 last success/request、错误次数或 next sync | P0 只保留 schema/interface/contract placeholder；P7 或单独批准的 Provider 阶段才建立完整 Runtime Health |
| `README` 要求 Node `>=20` | 当前安装物只能在 ABI 127 运行，Node 24.15.0 实测加载失败 | P0 固定一个支持的 Node 24 LTS 工具链并重装原生依赖 |
| Calendar restart persistence 已 sealed | Repository 可用时的 Calendar sync baseline 测试成立；当前实际运行因 native SQLite 失败仍无法跨进程保存，且空 vessels 会触发重复 seed | P0 先修真实数据库和 seed，再做 P4 自动同步 |

## 3. V3 总体目标

V3 的最终产品合同是：

- 正式本地/生产运行以真实数据为唯一业务数据来源。
- SQLite 是用户状态、last-known、缓存、Event、Provider Runtime 和同步状态的唯一持久化真相。
- 外部 Provider 按各自频率后台自动同步，页面 GET 只读 Repository，不发起全量外部请求。
- 用户可以按船名、IMO、MMSI、Callsign 和港口中文名、英文名、UN/LOCODE 搜索并关注。
- Current Voyage 与 Commercial Schedule 明确分层；AIS ETA 不冒充官方班期。
- Feed 当前流只展示具有运营时效的数据，历史数据进入独立历史查询。
- 当前年 + 下一年的国家日历自动维护。
- UI 默认中文；外部内容保存原文和中文译文；标准航运标识保持原样。
- 每一条 Event/HOT 都能追溯到 Provider、source URL/API、sourceUpdatedAt、fetchedAt 和 evidence。
- 翻译 Provider 可在 Settings 中切换，且不把某一家厂商或某一把 key 写死为 V3 架构前提；用量、cache hit、失败和估算成本可审计。
- Feed 的“采集成功”“当前可展示”“仍可进入 HOT”是三道独立闸门；Calendar 的启动恢复和后台同步也是独立生命周期。
- Provider、数据库或翻译失败均独立隔离；未知就是未知。

## 4. 非目标

V3 不做以下事项：

- 不迁移 Next.js、Prisma、Supabase、微服务、Kafka、Redis 或云优先架构。
- 不建立完整全球 AIS 轨迹库，不无限保存原始 AIS 消息。
- 不承诺每个全球港口都有真实拥堵统计；搜索成功与动态情报覆盖是两个能力。
- 不一次接入所有船公司 Schedule；先建立 DCSA-compatible contract，再接入已经拿到正式访问权的 Carrier。
- 不抓取需要登录、绕过限制或违反站点条款的页面。
- 不把 LLM 作为数据抓取、Event 规则或系统启动的硬依赖。
- 不把机器翻译内容当作新事实；事实判断始终基于原文和原 Provider 数据。
- 不在本轮方案任务中创建账号、购买套餐、写入密钥、迁移数据库或实现代码。
- 不把 VesselAPI Port API、商业 Schedule Provider 或单一翻译 Provider 当作必然可申请、必然可用或持续免费。
- 不把 LocalStorage、前端 bundle、Git、docs、fixture 或数据库明文列作为个人模式的 secret store。

## 5. V3 最终数据架构

```text
External Providers
  ├─ VesselAPI / carrier APIs / AISStream
  ├─ Open-Meteo / official weather alerts
  ├─ Industry feeds / official notices
  └─ Calendarific / UN/LOCODE snapshot
          │
          ▼
Server Adapters (vendor DTO stops here)
          │
          ▼
Normalize + Identity Resolution + Provenance
          │
          ├──────────────► Translation jobs ─► Translation cache
          │                                      │
          ▼                                      ▼
SQLite Repository (original facts + translation cache + last-known)
          │
          ├─ Query APIs ─────────────────────────────► Chinese UI
          │
          └─ Real Evidence Gate
                    │
                    ▼
               Event Engine
                    │
                    ▼
                 HOT Query
```

关键变化：

1. Query 与 Sync 分离：页面读取不再触发 Provider。
2. Translation 是 normalization 后的可恢复异步 enrichment；原文先持久化，翻译失败不阻塞采集。
3. Watchlist 是用户拥有的数据；Provider 不能覆盖。
4. Event/HOT 只消费通过 Real Evidence Gate 的记录。
5. 同一 UI 聚合多个 Provider 时，每个字段/事实保留自己的 provenance，不用“另一个 Provider 的值”掩盖失败。
6. 业务事实表只保存原文；中文译文统一由 `translation_cache` 提供，避免业务表与缓存形成两个真相。

## 6. 数据可信度规则

### 6.1 运行模式

新增明确的 `SHIPPING_DATA_MODE=mock|real`，并与 `NODE_ENV` 组合校验：

| 环境 | Mock 规则 |
| --- | --- |
| `NODE_ENV=test` | 允许 Mock；默认禁止真实网络 |
| `NODE_ENV=development` + `SHIPPING_DATA_MODE=mock` | 允许本地演示，页面永久显示“模拟环境” |
| `NODE_ENV=development` + `SHIPPING_DATA_MODE=real` | 禁止 Mock，等同本地 Real Mode |
| `NODE_ENV=production` | 只允许 `SHIPPING_DATA_MODE=real`；配置 Mock 时启动失败 |

未知、空白或拼错的 Provider mode 不得默认成 Mock；在 real/production 中必须变为 `misconfigured/unavailable`。

### 6.2 Real Evidence Gate

一条数据可进入正式 Event/HOT 必须同时满足：

- `provenance.sourceType` 是 `official | third_party | user`，不能是 `mock`，且记录的 `originEnvironment` 不能是 `test`。
- `provenance.dataNature=derived` 的记录，其全部 evidence 都通过同一规则。
- Provider identity、source record identity、source URL/API、sourceUpdatedAt（若 Provider 提供）、fetchedAt 存在并语义正确。
- 数据仍在其业务有效期内，或明确标记为 last-known stale。
- 规则需要的字段真实存在；缺字段不以默认值、fixture 或另一个 Provider 静默补齐。

### 6.3 Provider 失败规则

```text
Provider request fails
  ├─ same provider has last-known real data
  │      └─ return it as stale/degraded + original sourceUpdatedAt
  └─ no same-provider real history
         └─ return [] / unavailable / unknown
```

禁止：

- Real → Mock fallback。
- Provider A 失败后用 Provider B 填充同一事实并继续标为 A。
- 用 fetchedAt 伪造 sourceUpdatedAt/publishedAt。
- 将 AIS ETA 标为 official schedule ETA。
- 将 AIS Area 估算标为官方港口拥堵。

### 6.4 多源组合

允许把不同来源的独立事实并列展示，例如 AISStream position 与 VesselAPI static metadata；不允许把它们合成一个没有字段级 provenance 的“完整 Provider 记录”。Current Voyage 的 derived 结论必须列出每条输入 evidence 及 confidence。

### 6.5 字段所有权

同一实体的字段按所有权隔离，任何 Provider upsert 都只能写入自己的列：

| 所有权 | 示例 | 可被谁修改 |
| --- | --- | --- |
| Provider-owned | `provider_record_id`、registered name、IMO/MMSI、source URL、source timestamps、AIS observation | 对应 Provider 的 adapter；用户只能通过重新解析/删除关注表达意图 |
| User-owned | watch/unwatch、中文别名、标签、阈值、translation preference、手工 calendar override | 用户设置/事务 API；Provider 不得覆盖 |
| Directory-owned | UN/LOCODE、标准港口名称、目录坐标、别名来源 | UN/LOCODE snapshot 或明确的目录维护流程 |
| Translation-owned | `source_hash`、provider/model、translated text、状态、错误和时间 | Translation service；不能改写原文事实 |

`INSERT OR REPLACE`、整行 JSON 覆盖和“先读 Provider 再把用户字段拼回去”的隐式合并都不符合该合同。

### 6.6 Feed 三层 freshness gate

Feed 和 HOT 不共用一个模糊的“新鲜”布尔值，而是按顺序执行：

1. **Ingestion Gate**：验证 URL/source identity、解析日期、时区、未来偏差、内容 hash、撤回/有效期；失败记录 quarantine 或 source failure，不进入 operational current。
2. **Current Feed Query Gate**：基于 `publishedAt/effectiveAt/expiresAt/currentUntil` 和类别窗口（普通 7 天、重大 14 天、官方公告按有效期/上限）决定是否出现在当前 Feed；历史仍可查询。
3. **HOT/Event Freshness Gate**：只有 current Feed/official fact、未过期且所有 evidence 通过 Real Evidence Gate 的事实，才能驱动 Event/HOT；stale last-known 只能带降级标签，不能绕过 expiry。

Calendar 的 freshness 独立使用 `sourceYear/country/coverage/lastSuccessAt/nextDueAt`，不得用 Feed 的年龄窗口替代。

## 7. SQLite 持久化方案

### 7.1 Node 与原生依赖

推荐固定 Node 24 LTS 的一个已验证补丁线，并同时提交：

- `package.json#engines.node`：`>=24 <25`。
- `.nvmrc` 或 `.node-version`：固定团队/本机入口。
- `packageManager` 继续固定 pnpm。
- 在该 Node 版本下重新 `pnpm install`/rebuild `better-sqlite3`，运行真实读写/restart smoke。

不再声明笼统的 Node `>=20`。如果 P0 实测 `better-sqlite3` 当前版本对所选 Node 24 补丁线不稳定，再通过单独批准的小版本升级解决；不同时支持 Node 20/22/24 三套 native ABI。

### 7.2 数据库运行状态

新增 `DatabaseRuntimeState`：

- `healthy`：SQLite 可读写，migration 完成。
- `read_only_degraded`：运行中数据库写失败，但保留启动时从 SQLite 读取的 last-known；所有 mutation 返回 503。
- `unavailable`：启动无法打开 SQLite；不创建可变 memory store，不 seed Mock；GET 只返回可即时取得的真实数据或空数据，并携带数据库不可用状态。

UI 全局显示：`数据库不可用，修改无法保存。`。任何 watch/settings/manual refresh 写操作必须在事务提交后才返回成功。

### 7.3 初始化与 seed

- 使用 schema version/migration，不以 `vessels COUNT(*)` 判断整个数据库是否为空。
- 新增单行 `app_metadata`（或等价 metadata 表），至少保存 `schema_version`、`bootstrap_completed_at`、`database_id`、`last_migration_at` 和 `data_mode`；启动只根据 migration/bootstrap 状态决定是否需要初始化。
- `bootstrap_completed_at` 只表示 P0 的 App/DB 基础初始化完成：schema/migration、默认 settings、用户表和运行时 metadata 成功提交后写入；它不等待 Port Directory baseline，也不表示目录已 ready。AIS 没有观测不代表未 bootstrap。
- Port Directory 使用独立的 `port_directory_status`、`port_directory_version`、`port_directory_imported_at` 状态/元数据；P1A 负责导入和校验 baseline，只有成功后才将 status 置为 `ready`。P0 的 bootstrap 不得依赖该状态。
- Real Mode 不运行 Mock seed。
- Demo/Test seed 只在独立测试数据库执行，且只用 `INSERT ... ON CONFLICT DO NOTHING`。
- Provider upsert 使用 `INSERT ... ON CONFLICT DO UPDATE SET provider_owned_columns...`，禁止 `INSERT OR REPLACE`。
- Watchlist/settings/manual calendar 是 user-owned 表，Provider 无权更新。
- 每个 migration 在事务内执行；升级前复制数据库文件并记录 checksum。

### 7.4 重启合同

重启后按 `Server Start → SQLite open/migrate → restore snapshot → UI read → background checks → provider sync` 顺序运行。SQLite 首先恢复 watchlists、settings、目录、日历、Voyage/Port Call、Feed current/history、Events、AIS aggregate、Provider Runtime、translation cache、provider usage 和 sync schedule；恢复完成后 UI 可立即读取，后台检查随后运行。页面 GET 不得承担首次同步副作用。

## 8. Vessel Search / Watch 方案

### 8.1 推荐 Provider

VesselAPI 的 V3 定位是 **Vessel Discovery / Static Metadata**：公开文档的 `GET /v1/search/vessels` 支持按 name、callsign、MMSI、IMO 等检索，返回的 identity/particulars 可用于确认候选船和建立 watchlist。配额按 account 计算，使用 billing-date monthly window；Free 为 150 calls，Basic 为 $14.99/月、1,500 calls，并列出 Port data。成功的 2xx 请求计入额度，错误响应（包括 404/429）不计入；可读 `X-RateLimit-Remaining` 时优先展示官方剩余额度。只有具体 endpoint entitlement（例如当前账号是否可用某个 Port/ETA/事件 endpoint）仍需账号 contract test，不能从“能搜索”推导“能实时跟踪”。

AISStream 是 V3 唯一的 watched-vessel tracking session：它接收已关注 MMSI 的 `PositionReport`，以及可用时的 `ShipStaticData`/`StaticDataReport`，并由长期 `AisTrackingService` 维护连接、退避和增量重订阅。VesselAPI 不承担实时船位，AISStream 也不承担全球身份搜索；两者通过字段级 provenance 并列。

### 8.1.1 AIS tracking runtime contract

- `AisTrackingService` 是服务端进程级单例；HTTP GET、页面挂载和 React Query 刷新都不能创建或关闭 WebSocket。
- 连接建立后在规定窗口内发送订阅；watchlist 变化采用替换式订阅更新，并保持至少约 1 秒的更新节流。
- AIS static message 的字段映射必须保持消息类型边界：

  | AIS 消息 | 可使用字段 | 不得假设 |
  | --- | --- | --- |
  | `ShipStaticData` | `IMO`、`Callsign`、`Name`、`Type`、`ETA`、`Draught`、`Destination`、`Dimensions` | — |
  | `StaticDataReport` | `Name`、`Callsign`、`ShipType`、`Dimensions` 等该消息实际声明的静态字段 | 不得假设具有 `ETA`、`Destination` 或 `Draught`；缺失值保持 unknown |

- Position facts 保存位置、速度、航向、导航状态及可靠的 source timestamp；上述静态/航次字段使用 `source=AISStream`、`factNature=observed|reported`。AIS ETA 永远不升级为官方班期 ETA。
- V3 第一版最多同时订阅 50 个 MMSI（官方 `FiltersShipMMSI` 当前限制）；超过上限返回可解释的 capacity 状态，不提前实现多 session/sharding。超过 50 艘的扩展另行走架构决策。
- 断线只按有限退避重连；无观测不伪造 fresh，已有同源数据按 stale/degraded 展示。

### 8.2 搜索流程

1. 服务端规范化 `q`，识别 IMO/MMSI/Callsign/Name。
2. 先查本地 `search_cache`；仅在用户按 Enter 或点击“搜索”后，才允许向 `VesselDiscoveryProvider.search()` 发出外部请求。输入框逐字变化、debounce 提示和页面打开都不能调用外部 API。
3. 结果缓存 24 小时，保留 provider record key，并将本次 request/cache hit 写入 usage ledger。
4. 返回 normalized `VesselSearchResult`。如果结果已含建立 watch 所需的 identity/static 字段，用户选择后直接在同一事务中 watch，不默认再调用 Detail。
5. 仅当必需字段缺失，或本地 Detail 缓存过期且需要确认时，才调用 `VesselDiscoveryProvider.detail()`；Search 与 Detail 不默认各调用一次。
6. P2B 当前只持久化 Watchlist 关系并提供列表/变更 API；通知长期 AISStream `AisTrackingService` 增量重订阅属于后续 AIS Tracking Runtime，不在本轮实现。
7. AIS 尚未观测时，仍保留真实搜索身份并显示“暂无 AIS 观测”，不能消失或变成 Mock。

### 8.3 身份规则

- 内部 `vessel_id` 稳定，不直接等于可变 MMSI。
- 优先 IMO；没有 IMO 时优先使用 MMSI 作为当前搜索/去重键，再退回 provider + provider record id 或规范化 name；MMSI 同时保存为 AIS lookup target。
- official registered name 永远保留，不翻译。
- Callsign、IMO、MMSI 的唯一冲突必须进入人工确认，不自动合并两艘船。

### 8.4 VesselAPI 配额节流与可见性

按 2026-08-20 可访问的 VesselAPI 官方文档/价格页快照，V3 记录以下配额口径：quota per account，按 billing-date monthly window 计算；Free 为 150 calls，Basic 为 $14.99/月、1,500 calls，并增加 Port data。成功的 2xx 请求才计入月度额度，错误响应（包括 404/429）不计入；可读 `X-RateLimit-Remaining` 时优先展示官方剩余额度。页面还列出约 500 requests/5 分钟/IP、3,000 requests/5 分钟/key、location 约 300 requests/5 分钟和并发 20 等限制。只有具体 endpoint entitlement（例如当前账号是否可用某个 Port/ETA/事件 endpoint）保持 `unknown/pending`，以实际账号 contract test 为准。

节流合同：

- 搜索先查本地 `vessel_metadata/search_cache`；24 小时内同一 normalized query 直接返回，不调用 Provider；只有 Enter/“搜索”按钮可以产生外部 Search 请求。
- 搜索结果字段足够时，选择结果直接进入 watch；Detail 只在字段缺失或缓存过期时请求，不能把 Search→Detail 写成固定双调用。
- Search、Detail、Refresh 分别计入 `provider_usage` 的本地 request/cache-hit；UI 显示“当前 billing-date window 本地统计 xx calls”，若没有官方 Remaining 则显示“本地估算”，不把本地数伪装成 Free quota/余额。
- 自动刷新只针对已关注身份，默认数天级；实时位置由 AISStream 长连接承担，VesselAPI 不做分钟级轮询。

### 8.5 P2B Watchlist Integration / Identity Seal

- P2B 使用现有 user-owned `vessel_watchlist(vessel_id, watched_at, ais_enabled)`；静态 name/IMO/MMSI/callsign/source 继续由 P2A `vessel_metadata` 保存，不能把 `isWatched` 写回 Provider-owned 表。
- `/api/shipping/search/vessels/watch` 提供 POST add / DELETE remove；`/api/shipping/search/vessels/watchlist` 提供 GET list。页面只调用这些 server API，不直接访问 SQLite。
- Watch identity 优先使用 IMO identity；跨 name/IMO/MMSI 搜索按 IMO、MMSI、无标识时的 source+normalized-name 去重，同一真实船舶只保留一个 Watchlist entry。
- 无 MMSI 的搜索结果允许关注，`aisTrackingAvailable=false`，不伪造 MMSI；AIS Tracking Runtime、WebSocket 和后台长连接保持 pending。

## 9. Port Search / Watch 方案

### 9.1 推荐来源

- 基础真实目录：定期同步 UNECE UN/LOCODE 官方快照到本地，只保存 Function 含港口/码头的记录。
- API enrichment（可选）：Basic 套餐虽列出 Port data，具体 Port endpoint 仍只有在用户账号通过 entitlement contract test 后才启用；不能把任何商业计划写成 Port Search 的默认前提。
- 中文别名：本地 `port_aliases`，由明确来源/人工确认维护。`蛇口`、`Shekou`、`CNSHK` 都归一到同一 `port_id`。

Port Search 的默认链路是本地 UN/LOCODE snapshot → normalized name/alias match → 坐标补充目录。它即使没有 VesselAPI key 也必须可用；VesselAPI enrichment 失败只影响补充字段，不得清空或伪造本地目录结果。

### 9.2 关注后的能力协商

关注港口并不等于所有动态 Provider 都有覆盖。保存后为每个能力显示：

- Weather：有真实坐标即可启用 Open-Meteo。
- AIS Area：有坐标时可以生成候选 bbox，但必须标为 heuristic 并允许用户确认/调整。
- Portcast congestion：只有已验证 URL/Provider coverage 时启用；否则明确 `provider unavailable`。
- Official notices：只有 source registry 中有该港口的 verified adapter 时启用。

这样不会为新增港口制造等待船数、拥堵等级或公告。

## 10. Feed 时效方案

### 10.1 当前旧新闻出现的代码原因

1. `parseFeedRss()` 只解析日期，不校验过旧或异常 future date。
2. Provider 返回的最多 30 条全部进入当前响应，未按 7/14 天过滤。
3. `pruneExpired()` 在 current snapshot 已构建并保存之后执行；即使数据库随后删除，当前响应仍会显示旧条目，下次抓取又会重新带回。
4. 默认 retention 是 30 天，不等于“当前资讯窗口”。
5. Feed item 从当前抓取中消失时，普通 Feed Event 缺少 source trust；现有 Event Engine 会保留 active Event，而不是过期/关闭。
6. HOT 对 active Event 没有统一的 evidence age gate，因此历史 active Event 可能继续出现。

### 10.2 当前流规则

执行顺序固定为 `Ingestion Gate → Current Feed Query Gate → HOT/Event Freshness Gate`。第一道决定这条记录能否进入 operational store，第二道决定当前 Feed 是否可见，第三道决定是否可产生/保留 Event/HOT；UI 隐藏不能替代前两道 gate。

| 数据类型 | 当前流窗口 | 超出后的处理 |
| --- | --- | --- |
| 普通行业新闻 | publishedAt 最近 7 天 | 进入历史搜索 |
| warning/critical 行业新闻 | 最多 14 天，且仍有运营相关性 | 进入历史；相关 Event 过期或 resolve |
| 官方运营公告 | 显式 active/effective 状态优先；无结束时间时默认最多 30 天 | history；不能无限 active |
| 天气模型 | 当前/未来 forecast window | window 结束即 history/expire |
| 官方天气预警 | effective ≤ now < expires；无可靠 expires 使用 source-specific TTL | expire/history，不能继续 HOT |
| publishedAt unknown | 不进默认当前流和 HOT | 存 history/quarantine，等待详情页补时间 |
| future date | 允许小于 6 小时时区偏差；更远进入 quarantine | 人工/下一次抓取复核 |

所有规则在 ingestion/query 层执行，不能只在 UI 过滤。

### 10.3 Calendar / Feed 不共用 freshness

Calendar 按国家/年份 coverage 和同步成功时间独立维护；Feed 的 7/14 天窗口、官方公告有效期和天气预警 expiry 不能用于推断 Calendar 新鲜度。Feed source 消失时，相关 Event 必须在下一次 HOT gate 评估中 resolve/expire，而不是因为没有新抓取记录就永久 active。

### 10.4 来源分层

- 行业新闻：The Loadstar、Splash247、gCaptain、Seatrade Maritime、Maritime Executive（连接恢复后重新 probe）。可信度是 third-party reported。
- 官方运营公告：港口、船公司、海事局、气象机构。可信度是 official reported，但 parser、发布时间和有效期仍需验证。

每个来源必须有 registry：format、legal/robots review、parser version、refresh cadence、publication timezone、current-window policy、live status 和 failure isolation。

## 11. Calendar 自动同步方案

### 11.1 启动流程

1. **Server Start**：打开 SQLite、执行 migration，并读取 `app_metadata.bootstrap_completed_at`；Port Directory 另读自身的 `port_directory_status/version/imported_at`，两条状态链不互相替代。
2. **SQLite → UI**：先读取已持久化日历和 coverage；页面无需等待外部 API，显示 last-known/coverage/status。
3. **后台检查**：scheduler 检查当前年和下一年 × TH/ID/MY/PH/VN；coverage 缺失、`lastSuccessAt` 超过约 7 天、年份变化或 provider version 变化时入队。年份变化是强制检查，不受 TTL 抑制。
4. **同步**：每个 country/year 独立成功或失败；成功事务更新 events + coverage + `provider_usage`，失败保留同源 last-known 并写 runtime/sync_runs。
5. **UI 更新**：通过 React Query invalidation/SSE 可选通知刷新；手工“立即刷新”保留但有 rate limit 和 cooldown。

Calendarific Free 官方公开额度为 500 calls/月。默认约 7 天 TTL 下，五国 × 两年 × 每月约 4.3 次检查约 43 calls/月（约 40–50 calls/月），为首次启动、失败重试和手工刷新保留足够余量。数据集按较低频率更新，coverage 仍必须标 partial/unknown，不能宣称完整；手工“立即刷新”保留并受 cooldown 限制。

### 11.2 年份滚动

- 2026 年维护 2026 + 2027。
- 进入 2027 年后维护 2027 + 2028；2026 保留为 history，不再日常刷新。
- 下一年若 Free entitlement 暂无数据，记录 `partial/unknown`，不删除当前 last-known，也不创建 Mock。

## 12. Voyage / Schedule 真实数据方案

### 12.1 两类事实

**Current Voyage** 是 observed/derived：上一港、当前位置、AIS 目的地、AIS ETA、下一港候选、当前状态。V3 优先使用 AISStream 的 PositionReport + 按消息类型映射的 ShipStaticData/StaticDataReport 及真实 Port Directory/已验证 port-call evidence；VesselAPI 可作为经账号 entitlement 验证后的低频 static/event enrichment。AIS position、AIS static/voyage facts 分开保存 evidence。任何 VesselAPI ETA/事件能力都必须标明“已配置且已验证”，未知能力返回 unknown，不得把搜索 API 直接宣传为实时航程。

**Commercial Schedule** 是 carrier planned：service/voyage number、rotation、scheduled ETA/ETD、更新后的 estimated ETA/ETD、actual ATA/ATD。只能来自船公司/获授权聚合 Schedule，不可由 AIS ETA 替代。

### 12.2 统一合同

```ts
interface CurrentVoyageProvider {
  getCurrentVoyage: (vesselIdentity: VesselIdentity) => Promise<CurrentVoyageFact | undefined>
  getPortCalls: (vesselIdentity: VesselIdentity, range: TimeRange) => Promise<PortCallFact[]>
}

interface ScheduleProvider {
  searchVoyage: (query: VoyageSearchQuery) => Promise<CommercialVoyage[]>
  getVesselSchedule: (query: VesselScheduleQuery) => Promise<CommercialVoyage[]>
  getPortSchedule: (query: PortScheduleQuery) => Promise<CommercialVoyage[]>
}
```

内部 Voyage/Leg 必须区分：

- `scheduledEta/Etd`：官方 schedule。
- `baselineEta/Etd`：开始跟踪时冻结的比较基准，带 source。
- `latestEstimatedEta/Etd`：同一 schedule source 的最新预计。
- `actualAta/Atd`：observed port event。
- `aisReportedEta`：船员通过 AIS 报告，单独字段。
- `source`、`sourceUpdatedAt`、`fetchedAt`、`confidence`、`factNature=planned|observed|derived`。

### 12.3 分阶段 Provider

- P5-A Current Voyage：先以 AISStream observed position/ETA + 已验证的 port-call evidence 建立合同；若用户账号确实具备 VesselAPI ETA/port-event entitlement，再作为可选 enrichment。Vessel Discovery key 与 Current Voyage entitlement 不自动视为同一能力。
- P5-B Commercial Schedule：使用 DCSA Commercial Schedules 作为 normalization 标准，不把 DCSA 当作数据供应商。
- 首个 Carrier candidate：Maersk Integration Hub 等官方 portal 仅作为候选入口；需要合作/onboarding、用途许可、sandbox/production entitlement 和价格确认后，才建立对应 `ScheduleProvider`。
- Hapag-Lloyd、CMA CGM、MSC、COSCO、ONE、Evergreen、PIL：只有在官方 portal、认证、用途许可、价格和样例覆盖验证后才逐个批准适配器。
- INTTRA/e2open、project44、Kpler/MarineTraffic：更适合企业聚合/预测，公开资料通常要求 demo/询价，不作为个人项目 P5 默认依赖。

若没有任何 Carrier entitlement，V3 可以完成已验证的 Current Voyage，但 Commercial Schedule 页面必须显示“未配置真实班期 Provider”，不能保留 `mock-schedule`。V3 不提前锁死某个商业 Schedule Provider，也不把 DCSA 标准误写成数据供应商。

## 13. Translation 中文化方案

### 13.1 可切换 TranslationProvider

V3 只定义稳定的 `TranslationProvider` 合同，不把 Azure、OpenAI 或任何单一厂商写死为架构依赖。候选实现包括：

- DeepSeek、Qwen-MT、Gemini、OpenAI、Claude：上下文翻译/术语约束/结构化输出能力强，按各自 token 或字符计费；正式接入前必须复核官方价格、区域可用性、数据处理条款和模型版本。
- Google Cloud Translation、DeepL、Azure Translator：专用翻译 API，适合批量 NMT；额度和免费政策随计划变化，按账号/地区确认。
- Custom OpenAI-compatible：允许用户接入自托管或兼容 API；必须配置 base URL、model 和数据处理说明，不能假设与 OpenAI 价格相同。

推荐默认不是“永久首选 Provider”，而是 Settings 中的可切换策略：`disabled`（零外部翻译）、用户已配置的专用 NMT、用户已配置的 LLM、Custom OpenAI-compatible。若未配置 Provider，采集照常成功，UI 显示原文和“未配置翻译”。

OpenAI 官方价格页（2026-08-20 读取）按模型分别列 input、cached input、cache writes、output 的每 1M tokens 价格；方案只应保存 `provider/model/version` 并以实际 usage 估算，不应在文档中复制可能过期的单一模型价格。任何 LLM 翻译都必须有 prompt/version、术语保护和成本上限。

### 13.2 字段策略

允许翻译：新闻 title/summary、公告、天气预警、日历名称、国家名、船型、航行状态、港口状态、Event/HOT 解释。

禁止翻译：registered vessel name、IMO、MMSI、Callsign、Voyage number、SCAC、UN/LOCODE、Container number、Carrier/service codes。

实体允许显示人工/可靠中文别名，例如：`东方福 / DONG FANG FU`，但 official registered name 永远保留。

### 13.3 Settings 的 AI 翻译中心

Settings 增加“AI 翻译中心”，包括：

- Provider 下拉框、启用/停用、model、endpoint（Custom 时）、源语言/目标语言、批大小和并发上限。
- 按内容类型开关自动翻译：航运新闻、港口公告、天气预警、国家日历、Event/HOT；默认目标为简体中文。
- 当前配置状态：`未配置/已配置未验证/可用/降级/停用`；测试连接只返回脱敏结果，不回显 key。
- 本地统计：请求数、成功/失败、cache hit、字符/token 数、估算成本、最近调用时间、最近错误；没有官方余额接口时必须明确标注“本地统计/估算”，不能显示成账户余额。
- 预算保护：每日/月度软上限、超限后停用翻译 job、原文 fallback；不在页面打开时调用 API。

密钥只允许 server-only `.env.local`/`.env.server` 或等价 secret manager；禁止 LocalStorage、前端 bundle、Git、docs、fixture 和 SQLite 明文列。UI 只显示 `configured=true` 或掩码末四位；日志、错误和 provider_runtime 不得包含完整 key、Authorization header 或带 key 的 URL。

### 13.4 两阶段持久化与单一事实源

1. Normalizer 先保存原文事实，确保抓取成功不依赖翻译。
2. Translation job 根据 allowlist 批量翻译。
3. `translation_cache` key = entity + field + provider + model/version + source language + target language + content hash；缓存状态和 usage 统一写 ledger。
4. 业务表只保存 `title_original`、`summary_original`、`name_original`、`content_original` 等原文事实；不再保存 `title_zh`/`summary_zh` 或其他业务表级中文列作为第二份 truth。
5. UI 查询时返回原文并 join 当前 preferred translation。若 preferred 版本缺失，先显示最近成功的任意中文译文；随后后台按 preferred Provider/model 生成新版本，成功后切换显示。若没有任何成功中文译文，则显示原文并排队生成。
6. 打开页面不调用翻译 API；只读缓存。切换 Provider 不删除旧版本；只有源文本变化、用户点击“重新翻译”或缓存版本失效时才生成新版本，所有 provider/model/timestamp 保留可审计。

内部 Event/HOT 模板直接使用中文，不需要为确定性系统文案调用外部翻译。

## 14. Provider Runtime / Health 方案

每个 Provider 持久化：

- `provider_id`、requested mode、configuration state。
- `status=healthy|degraded|stale|unavailable|misconfigured|disabled`。
- `last_request_at`、`last_success_at`、`last_failure_at`。
- `last_source_updated_at`、`last_fetched_at`。
- cache state/age、TTL、`next_sync_at`。
- consecutive failures、sanitized error code/message、rate-limit reset。
- 当前数据量和 coverage summary。

侧栏/设置页使用该状态，不再用 `provider !== mock` 决定绿色或蓝色。错误信息不得包含 key、完整请求 header 或敏感 URL 参数。

### 14.1 Provider Usage / Cost Ledger

新增 `provider_usage`，按 Provider、能力、时间窗口记录：

- `request_count`、`success_count`、`failure_count`、`cache_hit_count`；
- `characters_in/out`、`tokens_in/out`（Provider 返回时记录，否则为 unknown）；
- `estimated_cost`、`currency`、`pricing_reference`、`last_called_at`；
- `source_scope`（例如 vessel discovery、calendar country/year、translation field）和脱敏错误码。

Usage ledger 只代表本机已发出的请求和按公开价/账号计划推算的成本；没有官方余额/账单接口时，Settings 必须写“本地统计/估算”，不能冒充账户剩余额度。Provider 的官方 `X-RateLimit-*` 或 dashboard 数值若可读，可单独显示为“官方返回”，不能与本地估算混合。

## 15. 数据库 Schema 调整

### 15.1 设计原则

- 保留 db0 + SQLite + 手写 SQL，不引入 ORM。
- 高频查询和身份/所有权字段拆列；Provider 扩展字段保留受 schema 校验的 JSON。
- user-owned、provider-owned、derived 三类数据分表/分列。
- 不保存无限 AIS raw track。

### 15.2 建议表

| 表 | 用途 | 关键决定 |
| --- | --- | --- |
| `schema_migrations` | schema version | P0 必需，替代 ad-hoc startup rebuild |
| `app_metadata` | bootstrap/runtime metadata | `schema_version`、`bootstrap_completed_at`、`database_id`、`data_mode`；只表示 P0 App/DB 基础初始化，不以 vessels 是否为空判定 seed |
| `port_directory_status` | Port Directory baseline 状态 | 独立保存 `port_directory_status`、`port_directory_version`、`port_directory_imported_at`；P1A 成功校验后才为 `ready` |
| `vessels` | 真实船舶身份/静态元数据 | IMO/MMSI/Callsign 索引；registered name 原样保存 |
| `vessel_watchlist` | 用户关注 | 与 Provider upsert 隔离；watch 时间和 AIS enabled |
| `ports` | Shipping operational port facts | Provider-owned operational fields；不再承担 Port Directory 的身份/坐标真相 |
| `port_directory` | P1A 真实港口基础目录 | `unlocode`、`name_en`/`name_zh`、`country_code`、lat/lon、timezone、JSON aliases、`source`、`verified_at`、`is_active`；Real Mode 过滤 `source=mock` |
| `port_watchlist` | 用户关注 | 独立 user-owned |
| `voyages` | Current/Commercial Voyage 头 | `kind`、vessel、voyage number、source/confidence |
| `voyage_legs` | 商业 rotation legs | scheduled/estimated/actual 分列 |
| `port_calls` | observed arrival/departure | Provider event identity + time |
| `feed_items` | 原文资讯、当前/历史状态 | 只保存 original/effective/expiry/current_until；中文从 `translation_cache` 查询 |
| `calendar_events` | 当前/历史日历 | 保留 scope/coverage/source；中文从 `translation_cache` 查询 |
| `events` | derived lifecycle | evidence JSON schema、expires_at、real_evidence flag |
| `provider_runtime` | health + scheduler cursor | UI 和失败恢复真相 |
| `settings` | 用户设置与 `ProviderConfig` | 可保存 provider/model/baseUrl/enabled/budget/preferred translation；绝不保存 API key |
| `ais_port_metrics` | bounded aggregate | 继续 current/last-known，不存 raw AIS |
| `translation_cache` | 唯一中文翻译事实源 | 至少包含 `id/entity_type/entity_id/field_name/source_text/source_hash/source_language/target_language/provider/model/translated_text/translated_at/status/error_message`；唯一键覆盖实体、字段、hash、语言、provider/model；保留 preferred 与最近成功选择所需索引 |
| `provider_usage` | 本地请求/结果/估算账本 | request/success/failure/cache hit、字符/token、估算成本、币种、pricing reference、last called；余额未知时不伪造 |
| `sync_runs` | 最近同步执行/错误 | 有界保留，例如 90 天/每源最近 N 次 |

`feed_translations` 不单独建表：所有业务实体统一使用 `translation_cache`，不在 `feed_items`/`calendar_events` 等事实表复制中文列。若未来需要多目标语言，只扩展通用缓存键或通过新 ADR 拆表。`provider_usage` 不承担账单真相，只记录本机可验证的调用和估算。

`ProviderConfig` 与 `ProviderSecret` 永远分离：前者是可持久化、可审计的非敏感运行配置；后者只通过 `SecretStore` 解析。P0 只建立这两个 contract、registry 刷新和脱敏 API，不实现 DeepSeek/Qwen-MT/Gemini/OpenAI 等全部实际 adapter；具体 adapter 在 P6 或对应 Provider 阶段按批准范围加入。

## 16. 自动刷新策略

| 数据 | 建议频率 | 缓存/失败策略 |
| --- | --- | --- |
| AIS watched vessels | 长期 WebSocket | 单例连接消费 PositionReport，并按消息类型分别处理 ShipStaticData/StaticDataReport；断线指数退避；事实立即落库；无消息不伪造 fresh |
| AIS Area | 长期独立 WebSocket，会话按 watched ports 更新 | 保留 15 分钟 bounded observation memory；只持久化 aggregate |
| Vessel static/search cache | 3–7 天；搜索结果 24 小时 | 手工关注时强校验；静态数据慢更新 |
| Current Voyage / port calls | 2–6 小时；关注后立即一次 | 同 Provider last-known；AIS ETA 与 port events 分字段 |
| Commercial Schedule | 4–6 小时或 Provider webhook | 遵守 carrier rate limit；baseline 不被自动覆盖 |
| Port congestion | 15–30 分钟仅对 API 型 Provider；Portcast public page 维持 24 小时 | per-port isolation；无覆盖即 unavailable |
| Weather model | 30–60 分钟 | ETag/TTL；按 port 隔离 |
| Official weather alerts | 10–30 分钟 | source-specific lifecycle/expiry |
| Industry news | 15–30 分钟 | ETag/Last-Modified；7/14 天 current gate |
| Official notices | 10–30 分钟 | 有效状态优先；未知时间不进 current |
| Calendar | 启动检查 + 约 7 天 TTL；年份变化强制检查 | 5 国 × 2 年约 40–50 calls/月；同源 last-known；手工刷新保留 |
| Translation | ingestion 后批处理；最多每分钟一批 | cache hit 不调用；失败指数退避，不阻塞 ingestion |
| Provider health | 每次 job 写入 | 保留最近 success/failure 和 next due |

使用一个本地 `ShippingSyncCoordinator`，不引入队列系统。SQLite 中的 `provider_runtime.next_sync_at` 和单进程 in-flight guard 防重复；timer 使用 jitter，程序退出时优雅关闭 WebSocket/timer。

## 17. API 设计

### 17.1 查询

- `GET /api/shipping`：只聚合 SQLite 当前状态，不直接调用外部 Provider。
- `GET /api/shipping/search/vessels?q=&limit=`。
- `GET /api/shipping/search/ports?q=&limit=`。
- `GET /api/shipping/watchlist/vessels`。
- `GET /api/shipping/watchlist/ports`。
- `GET /api/shipping/feed?scope=current&category=&cursor=`。
- `GET /api/shipping/feed/history?q=&from=&to=&cursor=`。
- `GET /api/shipping/voyages/:id`。
- `GET /api/shipping/providers/runtime`。
- `GET /api/shipping/providers/usage?provider=&from=&to=`：只返回本地 usage ledger 和估算标识。
- `GET /api/shipping/translation/status`：返回 provider/model 配置状态、队列、cache hit 和脱敏错误。
- `GET /api/shipping/health`：数据库、scheduler、Provider 摘要，不泄露密钥。

### 17.2 Mutation

- `POST /api/shipping/watchlist/vessels`：body 使用 selected provider identity，不接受客户端伪造完整 Vessel。
- `DELETE /api/shipping/watchlist/vessels/:id`：只取消关注，不级联删除历史事实。
- `POST /api/shipping/watchlist/ports`。
- `DELETE /api/shipping/watchlist/ports/:id`。
- `PATCH /api/shipping/settings`：替代当前全局 POST 语义。
- `POST /api/shipping/sync/:provider`：手工立即刷新；有权限白名单、cooldown 和 202/运行记录。
- `POST /api/shipping/calendar/refresh`：当前年 + 下一年或显式 year，仍走同一 scheduler job。
- `PATCH /api/shipping/settings/translation`：切换 TranslationProvider、模型、locale、预算和启用状态；保存后只影响后台 translation job。
- `POST /api/shipping/translation/test`：服务端短请求验证配置；默认不发送业务内容，响应不得暴露 secret。
- `GET /api/shipping/providers/secrets/status`：只返回 provider、`configured`、source（environment/file/missing）和掩码末四位。
- `PUT /api/shipping/providers/:provider/secret` / `DELETE /api/shipping/providers/:provider/secret`：经过 `SecretStore` 修改本地 secret；环境变量管理的 provider 返回 `managed_by_environment`，不能被 UI 覆盖。成功后立即刷新 Provider Registry。
- `POST /api/shipping/providers/:provider/test`：服务端测试连接，响应只含脱敏状态/错误码和 usage，不回传 key 或业务内容。

所有 mutation 在 SQLite unavailable 时返回 `503 persistence_unavailable`，UI 不显示“已保存”。搜索 Provider unavailable 返回可解释的 503/200 空结果 envelope，不回退 Mock。

## 18. UI 调整

### 18.1 Vessel / Port

- 列表页顶部新增搜索框、输入提示、搜索结果 drawer、来源和匹配字段。
- “添加关注”成功后显示数据库已提交状态；失败不做乐观持久化。
- 未观测 AIS 的真实 Vessel 显示“已关注 · 暂无 AIS 观测”。
- Port 页面显示能力矩阵：天气、AIS Area、拥堵、公告分别为正常/未覆盖/未配置。

### 18.2 Feed / Calendar / Voyage

- Feed 默认“当前资讯”，另设“历史搜索”；行业新闻与官方运营公告分组。
- Calendar 启动直接显示缓存，并显示“后台已检查/下次检查/最后成功”，手工刷新作为备用。
- Voyage 页面以明显区块区分“当前航程（观测/衍生）”与“商业班期（官方计划）”。

### 18.3 中文化和状态

- 建立集中 `zh-CN` label map，不在组件散落 `if english then translate()`。
- technical brand 如 AISStream、VesselAPI、Open-Meteo 保留英文。
- `mock/off/public/experimental/healthy/degraded/stale` 等 raw enum 不直接显示。
- 全局数据库 banner 和 Provider Health drawer 必须可见。
- 页面 footer 从 V2/Mock 描述更新为当前 V3 mode 和数据库状态。

### 18.4 AI 翻译中心

Settings 页面新增 AI 翻译中心和 Provider Secret 区：Provider/model/endpoint（仅 Custom 显示）、启用状态、目标语言、预算、队列和最近错误集中管理；用户可添加、修改、删除和测试 DeepSeek/Gemini/OpenAI/VesselAPI 等 key，但密钥输入永不回显，前端只接收掩码/配置状态。环境变量管理的 key 显示“不可覆盖”，本地 FileSecretStore 修改成功后立即生效。Usage 面板把“本地统计/估算”与 Provider 官方剩余额度分栏；无官方余额时只显示前者。Feed、公告、天气预警和日历可展开原文，registered name、IMO、MMSI、Callsign、Voyage number、SCAC、UN/LOCODE 等标准标识始终原样。

## 19. Migration 方案

### 19.1 原则

V2 数据库可能同时含 Mock、真实 last-known 和用户状态，不能原地把所有 JSON 当成真实数据。推荐 side-by-side migration：

1. 停止 V2 写入，复制 `.data/db.sqlite3` 为时间戳备份并计算 checksum。
2. 创建新的 `.data/shipping-hot-v3.sqlite3`，运行 V3 schema migration。
3. 导入 settings 和手工 calendar；不导入密钥。
4. V2 watched vessels 使用 IMO/MMSI 在 VesselAPI 重新解析；只有 exact identity match 才进入 V3 watchlist，未解析项进入 migration report，不能作为业务 Vessel。
5. V2 watched ports 使用 UN/LOCODE 在真实目录重新解析；exact match 后导入 watchlist/alias。
6. `mock-schedule` Voyage、Mock Feed、Mock Calendar 和 Mock-derived active Event 不进入 V3 operational tables。
7. 真实 Feed 重新执行 current/history 时间分类；异常日期进入 quarantine/history。
8. Calendarific/official/manual 真记录可复制，保留 provenance/coverage；Mock Calendar 不复制。
9. AIS real aggregate 可复制为 stale last-known，但必须验证 sourceId 和数据 shape。
10. Events 不直接继承 active 状态；保留 legacy audit export，V3 从当前真实事实重新生成 active Event。

### 19.2 Migration lineage 与 Real Mode 读取策略

迁移边界统一使用 `source_type`，枚举固定为 `real | mock | imported | derived`：

| `source_type` | 含义 | Real Mode 行为 |
| --- | --- | --- |
| `real` | 已批准真实 Provider 返回、保留 provenance 的事实 | 在 Provider/source 允许且 freshness 合约满足时可读 |
| `mock` | Mock Provider、fixture、demo seed 或 Mock-derived operational row | Real Mode 永不读取为当前数据；最多保留在 audit/quarantine |
| `imported` | 经用户批准、完成 identity/provenance 检查后导入的 V2/manual/official snapshot | 只有迁移策略接受并保留来源后才可读 |
| `derived` | 从允许的 `real` 或 `imported` 事实派生的 Domain/Event/aggregate | 仅当输入 lineage 可读时可读；Real Mode 不得从 `mock` 派生 |

Real Mode 可以读取 `real`、获准的 `imported` 和满足 lineage/freshness 条件的 `derived`，但绝不读取 `mock`。旧 Mock vessel/port 不因表为空而升级，也不做盲目整表复制；无法 exact identity match 的用户 watch 进入 migration report。`mock-schedule`、Mock Feed、Mock Calendar、Mock operational Event 及其他 Mock-derived rows 不进入 V3 当前 operational read。迁移失败或来源不明的记录保留在报告/quarantine，不伪装成真实数据。

`source_type` 是迁移 lineage 字段，与现有 V2 `provenance.sourceType`（Provider 来源）和 `dataNature`（事实性质）分开；不得用一个字段替代另一个字段。

### 19.3 回滚

- V3 migration 不修改 V2 原文件。
- 回滚时停止 V3、恢复配置指向 V2 文件并回退代码；V3 新写数据不会反向写入 V2。
- 用户确认 V3 验收和备份后，才讨论旧 DB/Mock 残留清理；本文不授权删除。

## 20. P0–P7 实施阶段

依赖审查结论：P0 只实现 SQLite persistence foundation：SQLite 正常启动、migration runner、schema version、App/DB bootstrap state、Repository persistence、user-owned data persistence 和 memory fallback removal。经批准的 `translation_cache`、`provider_usage`、`provider_runtime/sync_runs` schema placeholder 以及 `ProviderConfig`/`ProviderSecret`/`SecretStore`/`TranslationProvider` interface/contract 可以存在，但不实现 Provider Runtime 完整业务、Provider Usage 完整统计或任何实际 Translation Adapter；AIS WebSocket、VesselAPI 也只保留后续接口/contract。P0 不等待目录 ready；P1A 负责把目录状态推进到 `ready`，P1B 明确依赖 `port_directory_status=ready` 后才移除 Real Mode 对 Mock fixture/seed 的正式依赖；P2 依赖 P1A 与 P1B 均完成。

### P0 — Persistence

| 项目 | 内容 |
| --- | --- |
| 目标 | 只实现 SQLite persistence foundation：SQLite 正常启动、migration runner、schema version、App/DB bootstrap state、Repository persistence、user-owned data persistence 和 memory fallback removal；允许铺设后续 schema/interface/contract placeholder，但不实现 AIS WebSocket、VesselAPI、Translation Adapter、Provider Runtime 完整业务或 Provider Usage 完整统计 |
| 修改文件 | `package.json`、`nitro.config.ts`、`example.env.server`、`eslint.config.mjs`、`server/database/cache.ts`、`server/database/shipping.ts`、`server/shipping-store.ts`、现有 Shipping mutation API、`shared/shipping.ts` |
| 新增文件 | `.nvmrc`、`server/database/runtime.ts`、`server/database/migrations/**`、`server/api/shipping/health.get.ts`、`server/providers/contracts.ts`、`server/services/provider-registry.ts`、`server/secrets/file-secret-store.ts`、`scripts/p0-native-sqlite-smoke.ts` |
| 数据库 | 引入 `app_metadata`/schema version；拆 watchlist；移除 OR REPLACE 和单表空判断；side-by-side V3 DB；业务表只保留原文，不复制 `title_zh/summary_zh`；后续 `translation_cache`/`provider_runtime`/`provider_usage`/`sync_runs` 只作为已批准的 schema/contract placeholder，不启用 Provider 业务 |
| API | 所有 Shipping mutation 在事务失败时返回 503；`GET /api/shipping/health` 和 Shipping snapshot 返回 `database` persistence health；未新增 Provider/AI API |
| 测试 | native SQLite integration、进程 A 写入→异常退出→进程 B 使用同一 DB 读取并校验完整状态、无 vessel 时不 reseed、settings/calendar/watch 不被 Provider upsert 覆盖、DB unavailable UI/API；不得用 FakeRepository 代替 |
| 验收 | Node 24 下 `better-sqlite3` 真实加载；真实进程 A 写入后异常退出，进程 B 重启并完整读回通过；watchlist 不被 Provider upsert 覆盖；不存在成功但未落库的 Shipping mutation |
| 风险 | native build/toolchain；V2 JSON 迁移不一致；生产 Nitro subroute 的已知 `#nitro/index` 问题 |
| 回滚 | 切回 V2 DB 备份和旧 runtime；不删除 V3 DB，保留诊断 |

### P1A — Real Port Directory Foundation

| 项目 | 内容 |
| --- | --- |
| 状态 | implemented / locally verified；P1B Mock Isolation complete，AIS Tracking Runtime/P2 deferred |
| 目标 | 建立 migration-backed `port_directory` 基础目录：UN/LOCODE identity、真实坐标、timezone、中文/英文 aliases 和 source provenance；让 Open-Meteo/AIS Area 的生产几何输入脱离 `shared/shipping-fixtures.ts` |
| 修改文件 | `server/database/runtime.ts`、`server/database/port-directory.ts`、`server/providers/shipping.ts`、`server/providers/aisstream-area.ts`、`shared/ais-area.ts`、`scripts/p0-native-sqlite-smoke.ts` |
| 新增文件 | `shared/port-directory.ts`、`server/database/migrations/003-p1a-port-directory.ts`、`server/database/port-directory.test.ts` |
| 数据库 | `port_directory` 表及 migration v3；首批 8 港口 source=`unlocode`，`verified_at` 保持 unknown/undefined 直到独立校验；`port_directory_status=ready`；Real Mode 不读取 `source=mock` |
| Repository | `searchPorts()`、`getPortByUNLocode()`、`getPortCoordinate()`、`getPortAliases()`；Mock rows 仅在 mock data mode 可读 |
| API/UI | 本阶段不新增 Port Search API/UI；P2 再接入搜索/关注流程 |
| 测试 | `Shekou`/`CNSHK`/`蛇口` identity/alias resolution、source filter、坐标 lookup、migration baseline、天气/AIS Area 注入路径、native persistence smoke |
| 验收 | 八个重点港口拥有 directory identity/坐标/aliases；Open-Meteo/AIS Area 生产 Provider 通过 SQLite PortDirectory lookup，不从 `shipping-fixtures.ts` 读取坐标 |
| 风险 | 当前 baseline 的 `verified_at` 仍为 unknown；后续 UN/LOCODE snapshot/importer 需补充官方校验，不将 manual/mock 数据伪装成 official |
| 回滚 | 停用目录 enrichment，保留 V3 DB；Real Mode 不回退 Mock Port |

### P1B — Mock Isolation（本轮批准范围）

| 项目 | 内容 |
| --- | --- |
| 目标 | 依赖 P1A 且要求 `port_directory_status=ready` 后，Real Mode 只允许 `source_type=real/imported/derived`；Mock 只保留给显式 Test/Mock Mode |
| 修改文件 | `server/database/migrations/004-p1b-mock-isolation.ts`、`server/database/shipping.ts`、`server/providers/shipping.ts`、`server/providers/feed.ts`、`server/providers/calendar.ts`、`server/shipping-store.ts`、`shared/shipping.ts`、相关测试 |
| 数据库 | 为 `vessels`、`ports`、`voyages`、`feed_items`、`events`、`calendar_events`、`ais_port_metrics` 增加 `source_type` lineage；旧 Mock/来源不明记录不进入 Real Mode 当前读取 |
| Provider | Real Mode 缺少真实 Provider 时返回 unavailable/misconfigured；不构造 Mock Provider，不使用 `MockScheduleProvider`，不把 Mock last-known 作为运营数据 |
| Event/HOT | Event 必须通过 Real Evidence Gate；任何 Mock provenance/evidence 不进入 Real Mode 当前 Event/HOT |
| 测试 | Repository 全实体查询隔离、混合 Mock evidence 拒绝、Real Mode Provider/Schedule unavailable、Mock Mode 保留、migration lineage、native SQLite restart persistence smoke |
| 验收 | Real Mode 读取结果只有 `real/imported/derived`；即使 Provider 缺失也只返回真实 last-known 或空；`mock-schedule=0`；本阶段不创建 AIS 长连接或其他新业务功能 |
| 后续 | AIS Tracking Runtime 仍未开始；P2 Search & Watch 及后续 Provider 功能保持 deferred |

### P2A — Search Foundation

| 项目 | 内容 |
| --- | --- |
| 状态 | implemented / locally verified；AIS Tracking Runtime、Watchlist workflow 与其余 P2 deferred |
| 目标 | 建立 Vessel name/IMO/MMSI/callsign 搜索 Domain、服务端 `VesselSearchProvider` contract、VesselAPI discovery/static adapter、本地 SQLite metadata/search cache，以及基于 `port_directory` 的中文/英文/UNLOCODE/alias Port Search |
| 修改文件 | `server/database/runtime.ts`、`server/database/vessel-search.ts`、`server/providers/vessel-search.ts`、`server/search/vessel.ts`、`server/search/port.ts`、`server/api/shipping/search/**`、`shared/vessel-search.ts` |
| 新增文件 | `server/database/migrations/005-p2a-search-foundation.ts`、`server/database/vessel-search.test.ts`、`server/providers/vessel-search.test.ts`、`shared/vessel-search.test.ts` |
| 数据库 | `vessel_metadata` 保存 name/IMO/MMSI/callsign/type/flag/source/fetched_at；`vessel_search_cache` 保存 normalized query、result identities、Provider 和 24 小时 TTL；两者均携带 `source_type`，Real Mode 不读 Mock |
| Provider | `VesselSearchProvider` 隔离页面与 VesselAPI；VesselAPI 只返回 discovery/static metadata，不返回实时位置、不创建 AIS、不替代 AISStream；缺失 Provider/key 明确失败，Mock provider 仅保留 Test/Mock Mode |
| Port Search | `PortSearchService` 复用 SQLite `PortDirectoryRepository`，支持中文名、英文名、UN/LOCODE 和 aliases；不依赖 VesselAPI Port entitlement |
| API | `/api/shipping/search/vessels?q=...` 与 `/api/shipping/search/ports?q=...`；本轮不新增 UI 搜索流程或 Watchlist workflow |
| 测试 | Domain normalization、IMO/MMSI/name query、VesselAPI static-only payload、cache hit/expiry、Real Mode Mock isolation、Port Directory search/alias 和 migration-aware native restart smoke |
| 验收 | identity/P2A/P2B targeted 18/18、full 259/259、typecheck、production build、full lint（仅既有 4 个无关错误）、Node 24 service-backed native SQLite process-A provisional-name watch → close → process-B same-name provider/IMO/MMSI promotion smoke；不进入 P2C/AIS Tracking Runtime 或后续 Provider |

### P2B — Identity Seal（complete）与 P2C Background Runtime Foundation（complete）

| 项目 | 内容 |
| --- | --- |
| 依赖 | P2A 已完成；P1A、P1B 与 `port_directory_status=ready` 继续作为基础约束；不允许绕过真实目录或重新引入 Real Mode Mock |
| P2B 目标 | 搜索结果进入现有 user-owned `vessel_watchlist`，通过 canonical identity resolver 去重并安全 promotion，支持 add/remove/list，保留 P2A `vessel_metadata` 静态字段；VesselAPI 不作为实时船位 Provider |
| P2B 修改文件 | `server/search/vessel-watchlist.ts`、`server/database/vessel-search.ts`、搜索 Watchlist API、Vessels 页面、shared search types、native smoke |
| P2B 数据库 | 复用现有 `vessel_watchlist(vessel_id, watched_at, ais_enabled)` 与 `vessel_metadata`；本轮不新增 migration，不把 `isWatched` 写回 Provider-owned 表 |
| P2B API | `GET /api/shipping/search/vessels/watchlist`、`POST/DELETE /api/shipping/search/vessels/watch` |
| P2B 测试 | `DONG FANG FU` 一致身份（IMO `9162423` / MMSI `413393620` / Callsign `BPCL3` / flag `China`）搜索关注/取消、IMO/MMSI/name 去重、provider identity promotion 与 MMSI 更新、同名不同 strong identity 隔离、真正 provisional name promotion、identity conflict rollback、name/callsign/source 保留、无 MMSI 降级标记、重启 persistence |
| P2B 验收 | 关注后重启仍在；同一 Vessel 通过 IMO/MMSI/name 再搜索不产生重复 entry；同名不同 strong identity 不 merge/不 cross-remove；仅真正 provisional entity 允许 name promotion；无 MMSI 不伪造值 |
| AIS Tracking Runtime | `AisTrackingService`、AIS WebSocket、后台长连接、watchlist 变化订阅更新仍 pending，不在本轮实现 |
| 风险 | Provider 数据库找不到目标船；免费额度；MMSI 重用/IMO 缺失；中文 alias 质量 |
| 回滚 | 禁用 search Provider；保留已持久化 watchlist 和 last-known，不回退 Mock |

### P2C — Background Runtime Foundation（complete / sealed）

| 项目 | 内容 |
| --- | --- |
| 目标 | 建立单 Node 进程内的 Background Runtime singleton，为后续 Provider Workstream 提供统一 Job、调度、失败隔离、运行历史和 Provider health 边界 |
| 修改文件 | `server/database/migrations/006-p2c-runtime-foundation.ts`、`server/database/runtime.ts`、`server/runtime/background-runtime.ts`、`server/runtime/bootstrap.ts`、`server/runtime/registry.ts`、`server/plugins/background-runtime.ts`、`server/database/runtime-jobs.ts`、`server/api/shipping/runtime.get.ts`、`server/providers/contracts.ts` |
| Runtime Contract | `RuntimeJob { id, providerId, capability, intervalMs, enabled, run }`；`SyncResult` 只包含 status、recordsRead、recordsWritten、sourceUpdatedAt、errorCode、errorMessage |
| 调度 | Node timer；同一 Job in-flight 时下一次触发 skip；`runNow()` 取消旧 timer 并从本次完成时间重启 cadence；Job 返回 `skipped` 也持久化新的 `next_sync_at`；失败只影响当前 Job；`stop()` 清理 timer 并阻止新执行；启动从 SQLite `next_sync_at`/health cursor 恢复 |
| 数据库 | migration v6 安全 rebuild `provider_runtime` 为 `PRIMARY KEY(provider_id, capability)` 并保留现有列/数据；`RuntimeRepository` 集中 SQL 且所有读写使用复合 identity。运行状态为 `healthy/degraded/failed/disabled/never_succeeded`，失败按下一次正常 schedule 继续，不实现复杂 retry queue |
| Bootstrap | Nitro server plugin 初始化 DB/migrations、创建单例、注册当前 Registry、启动 Runtime；仅成功启动后发布 singleton/安装 signal handlers；失败时清理 timer、running state、singleton、bootstrap promise 和 signal handlers；SIGTERM/SIGINT/Nitro close 都调用 stop；`SHIPPING_RUNTIME_ENABLED=false` 可关闭 |
| Registry | P2C 默认为空；测试 FakeJob 只存在于自动测试，不注册任何真实 AIS/Feed/Calendar/Voyage/Translation Job |
| API 边界 | `GET /api/shipping/runtime` 只返回本地非敏感状态；现有 `GET /api/shipping` 请求触发 Provider path 标记为 legacy/deferred，后续按 Workstream 逐个迁移，P2C 不重写 `shipping-store` |
| 测试 | singleton、same-provider multi-capability independence/restart、disabled capability isolation、no-overlap、failure isolation、success/failure/skipped sync_runs、runNow fake-timer cadence、provider_runtime 状态恢复、stop、start/bootstrap failure recovery、native SQLite reopen persistence |
| 验收 | P2C targeted 20/20、full tests 270/270、typecheck、build、full lint（仅既有 4 个无关错误）、native SQLite restart smoke、git diff --check 与 Neat Freak Closeout；AIS Tracking Runtime、Feed Auto Sync、Calendar Auto Sync、Voyage、Translation 继续 pending |

### P3 — Feed Freshness

| 项目 | 内容 |
| --- | --- |
| 目标 | 当前 Feed/HOT 不再出现过时新闻，历史可查，来源独立刷新 |
| 修改文件 | `server/providers/feed.ts`、Repository、Event/HOT engine、Feed/HOT 页面 |
| 新增文件 | feed freshness policy、history API、source registry metadata、定时 job tests |
| 数据库 | feed current_until/effective/expires/visibility/translation fields；必要索引 |
| API | current feed 与 history search 分离 |
| 测试 | 7/14 天边界、future/unknown/malformed dates、旧 cache 再抓、source disappearance、Event expiry、时区 |
| 验收 | 验收 C；当前流/首页没有数年前数据；history 能查到；失败只留同源 stale |
| 风险 | RSS 错误日期、官方公告无 expiry、站点结构/版权变化 |
| 回滚 | 关闭单一 source；保留 current-window policy，不恢复无限旧新闻 |

### P4 — Calendar Auto Sync

| 项目 | 内容 |
| --- | --- |
| 目标 | 启动即读缓存并自动维护当前年 + 下一年，无需手工同步 |
| 修改文件 | Calendar provider/store/API/UI、runtime coordinator、settings |
| 新增文件 | calendar scheduler job、year-rollover/restart tests |
| 数据库 | coverage/last_success/next_due 持久化；不再把 coverage 只嵌 settings 作为唯一真相 |
| API | 手工 refresh 走 scheduler；GET 只读库 |
| 测试 | 冷/热启动、约 7 天 TTL、年份变化强制检查、部分国家失败、500 calls/月预算、last-known |
| 验收 | 验收 D；进程启动后页面立即有缓存，后台自动更新 2 年 |
| 风险 | Calendarific Free upcoming 限制；季度更新；系统时间错误 |
| 回滚 | 停自动 job，保留已缓存真实 Calendar 和手工 refresh；不启用 Mock |

### P5 — Real Voyage / Schedule

| 项目 | 内容 |
| --- | --- |
| 目标 | 清除 mock-schedule；先上线有 evidence 的 Current Voyage，再按已确认 entitlement 接 Commercial Schedule，不提前锁死具体商业 Provider |
| 修改文件 | shared Voyage types、Repository、Event engine、Voyage 页面、provider config |
| 新增文件 | CurrentVoyage/Schedule interfaces、AIS/port-call Current Voyage service、可选且 entitlement 验证后的 VesselAPI enrichment adapter、port_calls/voyage_legs API/tests；获批后 carrier adapter |
| 数据库 | voyages、voyage_legs、port_calls 拆表；planned/observed/derived 字段 |
| API | current voyage、schedule search/detail、port calls |
| 测试 | AIS ETA 不等于 schedule ETA、baseline freeze、actual ATA/ATD、provider failure、DCSA normalization contract |
| 验收 | 验收 E；没有真实 Carrier 时 Commercial Schedule 明确为空；Current Voyage 每字段有 evidence |
| 风险 | Carrier onboarding/费用/条款；voyage number 不在 AIS；不同 Carrier DCSA 版本差异；VesselAPI ETA/port-event entitlement 未确认 |
| 回滚 | 禁用单一 carrier adapter；保留已验证的 AIS/port-call Current Voyage；VesselAPI enrichment 可单独关闭；页面显示 schedule unavailable |

### P6 — Translation

| 项目 | 内容 |
| --- | --- |
| 目标 | 外部文本自动中文化并缓存，原文永远可查，标识不翻译；TranslationProvider 可切换且有预算/usage/secret 合同 |
| 修改文件 | shared DTO、Feed/Calendar/Event UI、Provider Runtime/settings |
| 新增文件 | TranslationProvider、DeepSeek/Qwen-MT/Gemini/OpenAI/Claude/Google/DeepL/Azure/Custom adapters（按批准范围选其一或多项）、translation service/cache、字段 allowlist、i18n labels |
| 数据库 | P0 预留的 `translation_cache`/`provider_usage`；各内容表只保留 original，中文与状态由通用缓存查询 |
| API | 默认返回 zh + original；可选 `locale`/原文展开，不在页面请求时翻译 |
| 测试 | identifier denylist、cache key/version、批量、失败原文 fallback、费用上限、HTML/术语保护 |
| 验收 | 验收 H/I；所有固定 UI 中文；英文资讯自动有中文且保留原文 |
| 风险 | 术语误译、供应商区域/额度、标题语义漂移 |
| 回滚 | 关闭 translation job；继续显示已缓存 zh 或原文，采集不受影响 |

### P7 — Final Real-data Seal

| 项目 | 内容 |
| --- | --- |
| 目标 | 全链路自动同步、Provider Health、Event/HOT Real Evidence Gate 和最终中文 UI 验收 |
| 修改文件 | shipping query service、Event/HOT engine、Provider status UI、docs/status/architecture/ADR/env |
| 新增文件 | end-to-end acceptance、provenance trace API/组件、Real Mode bundle guard |
| 数据库 | evidence/health/sync retention 最终索引和清理任务 |
| API | HOT detail trace、provider runtime、sync runs |
| 测试 | 全 Provider failure matrix、Mock contamination scan、重启、A–J E2E、rate-limit/backoff |
| 验收 | 验收 G/J；每条 HOT 能追到 Event→Evidence→Provider→URL/API→timestamps；production bundle 无 Mock |
| 风险 | 旧 orphan Event、部分 Provider coverage、长周期 rate-limit 测试 |
| 回滚 | 逐 Provider disable + same-source last-known；Real Evidence Gate 不回滚 |

## 21. Provider / API 选型比较

> 价格和公开能力按 2026-08-20 可访问的官方页面/官方文档核验；供应商可以随时变更。任何正式接入前都要在用户自己的账号/地区重新确认 entitlement、用途许可、VAT、调用计费单位、中国网络可达性和个人申请资格。未被公开页面确认的内容写作 `unknown/pending`。

### 21.1 船舶 / 港口搜索

| Provider | 船名 | IMO/MMSI | Callsign | 港口搜索 | 公开价格/试用 | 注册/稳定性 | 与 AISStream 重复 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VesselAPI | 是，partial name | 是 | 是 | Port data/UNLOCODE/coords：公开文档可见；具体 endpoint entitlement 仍需账号确认 | quota per account；billing-date monthly window；Free 150 calls；Basic $14.99/月、1,500 calls、Port data；成功 2xx 计入，错误/404/429 不计；可读 `X-RateLimit-Remaining` | 自助注册和公开文档已见；接入时只对具体 endpoint entitlement 做 contract test | 不承担实时 Position；Discovery/static/已验证事件可补充 AISStream | **Discovery/static 候选**；先 Free PoC，不默认承诺具体 Port/ETA/实时 endpoint entitlement |
| Datalastic | 是 | 是 | 是 | 是，name/country/UNLOCODE/coords | 14 天优惠试用后 Starter €199/月、20k credits | 自助但个人成本高；功能完整 | 大量重复，包括 AIS/历史/天气 | 能力强但不适合本个人项目预算 |
| MyShipTracking | 是 | 状态端点支持；search 页面主打 name | 未从公开 search 摘要确认 | 是，name/UNLOCODE | Trial 10 天/2,000 coins；Basic €90/月 | 自助试用；纯 terrestrial AIS，官方提示覆盖有限 | 高 | 次选，成本高于 VesselAPI |
| VesselFinder | API 页面提供 position、voyage、port calls、particulars | 是 | 未公开确认 | Port calls 有；目录搜索未公开确认 | Subscription/按需求询价，无公开价 | 需要提交需求，个人接入摩擦高 | 高 | 不作为 P2 默认 |
| MarineTraffic / Kpler | Ships DB、AIS、events、predictive ETA | 企业级能力 | 企业级能力 | 事件/港口能力强 | Request demo/询价，无公开自助低价 | 成熟但企业销售流程 | 很高 | 作为稳定付费/企业备选，不适合最低成本 |

**选择理由**：VesselAPI 的公开搜索文档和低频套餐适合作为 Discovery/static 候选；它不再被描述为实时船位或必然 Current Voyage Provider。Basic 套餐列出 Port data，但具体 endpoint entitlement 仍需账号 contract test；Port Search 仍默认由本地 UN/LOCODE 目录承担。AISStream 负责长期 watched MMSI，只有账号 contract test 通过后才启用 VesselAPI enrichment。

### 21.2 航次 / 船期

| 来源 | Current Voyage | Commercial Schedule | 接入/价格 | 适合度 |
| --- | --- | --- | --- | --- |
| VesselAPI | 公开资料存在 ETA/port-event 相关页面；具体 endpoint entitlement 需账号验证 | 否；不是官方 carrier rotation | quota 口径明确；Free/Basic 价格公开；仅 endpoint entitlement pending | 可选 enrichment，不是实时默认 |
| MarineTraffic/Kpler | AIS、real/predictive events、ETA/voyage forecast | 不等同 Carrier official schedule | 企业询价 | 更稳定付费备选 |
| Datalastic | Pro query 含 ETA/ATD/LOCODE，历史/port info | 不等同 Carrier official schedule | €199/月起 | 成本不适合个人默认 |
| DCSA Commercial Schedules | 不是数据源 | Point-to-Point、Port Schedule、Vessel Schedule 的标准/API schema | 标准公开；数据仍要向 Carrier 取 | **内部 normalization 标准** |
| Maersk | 可结合 Track & Trace | Integration Hub 明确列 Commercial Schedules | 需要 partner onboarding，公开价未核验 | 首个 Carrier candidate |
| Hapag-Lloyd / CMA CGM | 各自 tracking 能力 | 有 API portal/数字集成可能，具体 entitlement 需账号验证 | 登录/onboarding/价格待确认 | 获准后逐个 adapter |
| MSC / COSCO / ONE / Evergreen / PIL | 公开网页/Track & Trace 各异 | 未核验到适合本个人项目的稳定公开自助 Schedule API | 待商务/技术确认 | 不先写 adapter |
| INTTRA/e2open / project44 | 聚合可见性强 | 企业聚合 Schedule/visibility | 企业合同/询价 | 稳定付费方案，不是个人最低成本 |

### 21.3 翻译

| Provider | 免费/最低价 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| DeepSeek | 价格快照见 21.4；无官方 API Free Tier 声明 | 中文上下文和成本控制候选 | 区域、余额和模型可用性随账号变化 | 可切换 LLM adapter，非默认锁定 |
| Qwen-MT | 面向 Qwen-MT 的免费额度按实际地区/账号确认，保持 `unknown/pending`；不套用 generic Qwen 试用额度 | 中文术语和本地生态候选 | endpoint、数据区域和计费版本需确认 | 可切换 LLM adapter |
| Gemini | 免费层 + 付费层价格快照见 21.4 | 多语言和结构化输出 | Google AI Studio/Cloud 账户与地区确认 | 可切换 LLM adapter |
| OpenAI API | 价格快照见 21.4；按模型、input/cached/output token 计费 | 上下文、术语保护和结构化输出强 | 非专用 NMT；需要 prompt/version/cost 管理与 API key | 可选高质量模式 |
| Claude API | 价格快照见 21.4；官方文档写新用户有少量免费 credits | 长文本和术语一致性候选 | 价格、区域和账号账单政策需确认 | 可切换 LLM adapter |
| Google Cloud Translation | Basic/Advanced 字符价格和免费赠金见 21.4 | 专用 NMT、语言多 | 需 Cloud project/billing，账号和地区确认 | 专用 NMT 候选 |
| DeepL API | Developer 1M 一次性试用、Growth 计划见 21.4 | 质量/术语表强 | 地区币种、账号和订阅需确认 | 质量优先备选 |
| Azure Translator | F0 2M 字符/月、S1 $10/M 文本见 21.4 | 专用 NMT、REST 简单 | 需 Azure resource/key；地区可达性要实测 | 专用 NMT 候选，不锁死 |
| Custom OpenAI-compatible | 由用户自托管或第三方计划决定，公开价格 unknown | 可接入已有网关/本地服务 | endpoint、模型、数据处理、可靠性全部由用户负责 | 支持但必须显式配置 |
| 本地模型 | API 成本 0；模型下载/运行成本不计入 Provider 账单 | 数据不出本机 | CPU/RAM、质量和升级成本高 | V3 可留接口，默认非目标 |

翻译用量基线：单用户每月约 100,000–300,000 字符（或由 LLM 产生的等价 input/output tokens），只对新内容调用，cache hit 不调用；以下 Provider 的具体免费额度、重置日、超额单价、卡要求和区域资格均需在最终选型时再次打开官方价格页确认。LLM Provider 记录 token，NMT Provider 记录字符；不能把两者直接相加成一个“官方余额”。

| TranslationProvider | 预计月用量 | 预计月成本口径 | 当前状态 |
| --- | --- | --- | --- |
| DeepSeek / Qwen-MT / Gemini / OpenAI / Claude | 100k–300k 字符等价 tokens | 按实际模型 input/output/cached token 价格估算；Qwen-MT 免费额度按地区/账号 pending，不使用 generic Qwen 免费额度 | 可切换 LLM adapter |
| Google Cloud Translation / DeepL / Azure Translator | 100k–300k 字符 | 按字符计费；free credit/plan、超额单价和 reset pending | 可切换专用 NMT |
| Custom OpenAI-compatible | 同上 | 由用户网关/自托管计划决定；本地成本另算 | 显式配置后可用 |
| 本地模型 | 100k–300k 字符 | 外部 API $0；CPU/RAM/模型下载成本不计入 Provider ledger | 零外部费用候选 |

### 21.4 Pricing Snapshot — 2026-08-20

以下是 2026-08-20 读取官方价格/文档页面后的决策快照，只用于当前成本估算，不属于长期架构合同。模型、地区、税费、免费资格和计费方式可能变化；正式接入前仍需用用户自己的账号做 contract test。`unknown/pending` 仅保留在官方页面没有给出或本快照无法确认的字段。

| Provider | Free tier / 免费额度 | 输入价格 | 输出价格 | 字符价格 | 最低套餐 / 账号要求 | Shipping-HOT 月成本估算（100k–300k 新内容） |
| --- | --- | --- | --- | --- | --- | --- |
| DeepSeek | 官方价格页未说明 API Free Tier；费用从余额或 granted balance 扣除 | `deepseek-v4-flash` cache hit $0.007–0.014/M、miss $0.22–0.44/M；`v4-pro` hit $0.022–0.044/M、miss $0.66–1.32/M | Flash $0.66–1.32/M；Pro $1.98–3.96/M（均按 peak/off-peak） | N/A | 需充值余额或 granted balance；价格可能变化 | 约 $0.1–$1.5，取决于模型、cache 和输出量；无免费额度承诺 |
| `qwen-mt-lite` / Alibaba Cloud Model Studio | Qwen-MT 免费额度按实际地区/账号确认，`unknown/pending`；不把 generic Qwen 免费额度套用到 Qwen-MT | $0.086 / 1M tokens | $0.229 / 1M tokens | N/A | RPM 60；TPM 100,000；需 Alibaba Cloud/Model Studio 账号 | 按实际账号和地区确认；不预设免费额度 | 100k–300k tokens 约 $0.03–$0.10，免费额度未确认 |
| `qwen-mt-flash` / Alibaba Cloud Model Studio | Qwen-MT 免费额度按实际地区/账号确认，`unknown/pending`；不把 generic Qwen 免费额度套用到 Qwen-MT | $0.101 / 1M tokens | $0.28 / 1M tokens | N/A | RPM/TPM 按实际账号和地区确认 | 不预设免费额度；需 Alibaba Cloud/Model Studio 账号 | 100k–300k tokens 约 $0.04–$0.11，免费额度未确认 |
| Gemini Developer API | 免费层：特定模型有限访问、免费 input/output tokens、AI Studio；内容可能用于改进 Google 产品 | `Gemini 3.6 Flash` 付费层 $1.50/M；免费层免费 | $7.50/M（含思考 token）；免费层免费 | N/A | AI Studio 可免费开始；生产付费层需升级/绑定结算 | 免费层内 $0；付费层约 $0.2–$3，按 input/output 比例 |
| OpenAI API | 页面未声明通用 API Free Tier | `gpt-5.6-luna` $0.20/M、`terra` $2/M、`sol` $5/M；cached input 分别 $0.02/$0.20/$0.50/M | Luna $1.20/M、Terra $12/M、Sol $30/M | N/A | 需 API key 与余额/账单；按模型和 input/cache/output 计费 | Luna 约 $0.1–$0.5；Terra 约 $1–$5；Sol 约 $3–$15 |
| Claude API | 官方文档写新用户有少量 API 免费 credits；长期 Free Tier 额度未承诺 | `Claude Sonnet 5` $2/M；Sonnet 4.6 $3/M；Haiku 4.5 $1/M；Opus 5 $5/M | Sonnet 5 $10/M；Sonnet 4.6 $15/M；Haiku 4.5 $5/M；Opus 5 $25/M | N/A | API 按 token 后付费；AWS/Google Cloud 代运营账单另有规则 | Haiku 约 $0.1–$1；Sonnet 5 约 $0.3–$3；Opus 约 $1–$8 |
| Google Cloud Translation Basic NMT | 每月前 500,000 字符免费（$10/月赠金支付；赠金不顺延） | 超过 500k 后 $20/M 字符 | N/A（NMT 按输入字符） | $20/M 字符；Advanced text LLM $10/M input + $10/M output | 需 Google Cloud project、billing account 和 API credentials | 100k–300k 字符通常 $0（在 500k 内）；超出后按字符计费 |
| DeepL API | Developer 一次性 1,000,000 字符试用额度 | Growth：JP¥3,025/月（年度付费）含 12M 字符/年，超出 JP¥2,750/M 字符；Enterprise 自定义 | N/A | 按字符；Developer 1M 一次性，Growth 50M/月用量上限 | 需 DeepL API 账号；地区/币种以官方结算页为准 | Developer 试用期目标 $0；超出后按 Growth/地区价格，不能写成永久免费 |
| Azure Translator | F0：每月 2,000,000 字符（标准翻译与自定义训练合计）免费 | S1 文本翻译 $10/M 字符；文档 $15/M | N/A | $10/M 文本，$15/M 文档 | 需 Azure resource/key；Azure Free Account 另有 $200/30 天试用，不等于永久 F0 资格 | 100k–300k 字符在 F0 内目标 $0；超出按 $10/M |
| Open-Meteo Marine | Free/Open-Access：600 calls/min、5,000/hour、10,000/day、300,000/month；含 Marine API | N/A | N/A | N/A | 非商业使用、无 uptime guarantee、CC BY 4.0 attribution；商业 Standard €29/月起 | 8 港按小时约 5,760 calls/月，个人非商业预计 ¥0/月 |
| AISStream | 当前公开免费；Beta；无 uptime guarantee/SLA | N/A | N/A | N/A | 服务端 API key；单订阅最多 50 MMSI；政策可能变化 | 目标 $0/月；以 Beta/no SLA 记录，不承诺商业可用性 |

Qwen-MT 的输入/输出价格与 Lite 的 RPM/TPM 是该日期快照；免费额度继续按实际地区/账号保持 `unknown/pending`，不能把 generic Qwen 的免费试用或套餐额度套用到 Qwen-MT。DeepSeek/OpenAI 的 token 数字、Gemini 的免费/付费层、Claude 模型价格、Google Cloud/DeepL/Azure 字符价格都只是该日期快照；它们不会把对应 Provider 变成 V3 的必选依赖。Open-Meteo 的非商业免费额度与 AISStream 的当前免费 Beta 也不构成永久服务承诺。

### 21.5 运营 Provider Cost Matrix

下表把“数据能力、免费/价格、额度单位与重置、超额、计费方式、卡/资格、限流、Shipping-HOT 月用量和月成本”放在同一审查面。`unknown/pending` 是有意保留的状态，不代表已获得供应商 entitlement。用量按单用户、8 个关注港口、少量关注船、30 天估算；条件请求/缓存会显著降低实际传输量。

| Provider | 提供数据 | 免费/最低价与额度 | 重置/超额/计费 | 卡/资格 | Rate limit | 月用量估算 | 月成本目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AISStream | watched MMSI 实时 AIS PositionReport + Static/Voyage messages | 当前公开免费、Beta；无 uptime guarantee/SLA；`FiltersShipMMSI` 单订阅最多 50 MMSI | 非商业 SLA/未来政策可能变化；消息/连接计费未声明 | 服务端 API key；正式接入前复核条款与覆盖 | 初始连接 3 秒内订阅；订阅更新约 1 次/秒；50 MMSI | 1 个长期单例 session；消息数取决于船舶活动，不按 HTTP call 轮询 | $0 目标；Beta/no SLA |
| Open-Meteo Marine/Forecast | 港口天气模型 | Free/Open-Access：600 calls/min、5,000/hour、10,000/day、300,000/month；含 Marine API；通常无需 key | 非商业使用；无 uptime guarantee；超过变量/范围可能按 fractional calls；需 CC BY 4.0 attribution | 个人非商业；商业需 Standard €29/月起（1M calls/月）等计划 | 官方限额如左 | 8 港按小时刷新约 5,760 calls/月，远低于 300,000/月；可按 cache/批量更低 | 个人非商业预计 ¥0/月；商业另评估 |
| Portcast public page | 已覆盖港口拥堵/derived 页面 | 页面无公开 API 套餐承诺 | 不是稳定 API 额度；超额/计费/重置 unknown | 公开页面可达不等于个人抓取许可；robots/条款待审 | 页面/IP 限制 unknown | 8 港 × 30 ≈ 240 次条件请求 | $0 目标但不可保证；无覆盖即 unavailable |
| Calendarific | 国家节假日 | Free 500 calls/月（官方页面快照） | 约 7 天 TTL；约 40–50 calls/月；月度重置日、超额/Starter 需账号确认 | Free 资格/attribution 按计划确认 | 计划限额 unknown | 5 国 × 2 年 × 每 7 天检查约 43 calls/月 | $0 在 quota 内 |
| The Loadstar / Public RSS | 行业资讯 | 公共 RSS/页面，无固定 API 费用 | 按 robots/站点条款；无月度 quota 承诺 | 无 key；抓取许可需逐源审查 | 站点/IP 限制 unknown | 约 5 源 × 15–30 分钟条件检查；ETag 后传输更低 | $0 目标 |
| Official weather sources | JMA/TMD/BMKG 等预警 | 公共源，固定价/额度多为 unknown | 按站点/机构条款；无统一 reset | 通常无需 key；live enablement/资格逐源确认 | source-specific unknown | 3 源 × 10–30 分钟检查 | $0 目标 |
| VesselAPI | Discovery/static metadata，可选已验证 enrichment | quota per account；billing-date monthly window；Free 150 calls；Basic $14.99/月、1,500 calls、Port data | 成功 2xx 计入；错误/404/429 不计；可读 `X-RateLimit-Remaining` 作为官方剩余额度；仅具体 endpoint entitlement pending | Free 公开快照显示无信用卡；接入时只对具体 endpoint entitlement 做 contract test | 约 500/5m/IP、3,000/5m/key、location 300/5m、并发 20（快照，接入时复核） | 低频搜索/metadata 约 20–80 calls/月；不做实时轮询 | $0 Free PoC；Basic 公开基线 $14.99/月 |
| Datalastic | Vessel/port/AIS/ETA 等聚合 | 前次公开快照：14 天试用后 Starter 约 €199/月、20k credits；需复核 | credits 制；重置/超额按计划 unknown | 自助试用；个人生产资格/卡要求 pending | plan-specific unknown | 0（仅商业增强候选） | €0 当前；正式接入约 €199/月起线索 |
| MyShipTracking | 船舶/港口搜索与 terrestrial AIS | 前次公开快照：试用 10 天/2,000 coins；Basic €90/月；需复核 | coins/plan 制；reset/超额 unknown | 自助试用；覆盖和资格 pending | plan-specific unknown | 0（不作为默认） | €0 当前；Basic 约 €90/月线索 |
| VesselFinder | AIS/voyage/port calls/particulars | 公开页面以 subscription/询价为主，无个人低价确认 | 订阅/用量、reset/超额 unknown | 需提交需求，个人资格 pending | unknown | 0（不作为默认） | 询价 |
| MarineTraffic/Kpler | 企业 AIS、事件、预测 ETA/port intelligence | Request demo/询价，无公开个人 quota | 合同/订阅/用量，reset/超额 unknown | 企业客户/销售资格 pending | 合同级 unknown | 0（商业增强候选） | 询价 |
| Carrier Schedule adapters | 官方 Commercial Schedule/rotation | Maersk、Hapag-Lloyd、CMA CGM、MSC、COSCO、ONE、Evergreen、PIL 等公开 portal 不等于可申请 | onboarding/合同/用量/reset/超额 unknown | 可能要求现有客户/企业账号；逐家确认 | contract-specific | 0，直到 entitlement 批准 | $0 当前；批准后逐项报价 |

以上数字不是账单承诺。Provider Usage 页面同时显示 `本地统计/估算`；只有 Provider 返回官方 Remaining/余额时才另列为 `官方返回`。

## 22. 成本评估

### 22.1 三档成本方案

| 档位 | 组合 | 适用边界 | 成本口径 |
| --- | --- | --- | --- |
| 零成本 | AISStream（按现有账号条款）、Open-Meteo、Public RSS/official pages、UN/LOCODE 本地目录；VesselAPI Free 仅低频 Discovery PoC；翻译 disabled 或本地模型 | 个人单用户、少量 watch、允许部分能力 unavailable；不做实时轮询和商业 Schedule | Provider 固定费用目标为 $0；AISStream/来源条款和本地运行成本仍需用户确认；翻译不产生外部账单 |
| 推荐低成本 | 默认继续本地 UN/LOCODE + VesselAPI Free 低频 Discovery（每 account 150 calls 的公开快照），翻译使用用户已有的 DeepSeek/Qwen-MT/Google/DeepL/Azure/OpenAI 等 Provider 的小批量缓存，并设置预算上限；Free quota 不够时再把 Basic（$14.99/月、1,500 calls、Port data）作为可选 add-on | 个人长期使用、少量搜索和关注；仍不承诺实时船位或商业班期；本地目录不因没有付费 Port endpoint entitlement 而失效 | 固定 Provider 目标 $0；翻译按小批量实际 token/字符估算，通常为低个位数美元或更低；可选 VesselAPI Basic 另加公开基线 $14.99/月 |
| 商业增强 | 更高 VesselAPI 套餐、Calendar/翻译付费档、企业 AIS/ETA/port intelligence、已获授权的 Carrier Schedule Provider | 多船、多用户、较高刷新频率或企业 SLA | 所有 Provider 需逐项报价/合同/entitlement；不能在本个人项目中预设总价 |

零成本档的关键限制：Port Search 依赖本地目录，VesselAPI Port/ETA enrichment 可能不可用；Commercial Schedule 始终可以为空；没有官方余额接口时 UI 只显示本地调用/估算。

### 22.2 用量预算与估算规则

- Calendarific Free 500 calls/月的公开额度和五国 × 两年 × 约 7 天 TTL 的 40–50 calls/月只是 2026-08-20 的方案估算；失败重试、手工刷新和官方 coverage 限制必须留余量。
- 翻译预算按 `provider_usage` 记录的字符/token 估算，cache hit 不计外部请求；预算超限时暂停后台翻译，不阻塞 ingestion。
- VesselAPI 的 quota 口径按 account、billing-date monthly window 和成功 2xx 计数；错误/404/429 不计，官方 `X-RateLimit-Remaining` 优先。只有具体 endpoint entitlement 仍需账号 contract test，不能把可搜索能力直接等同于 Port/ETA/事件可用。

## 23. 最终验收标准

### A. Vessel 搜索和关注

P2B 搜索 `DONG FANG FU`，从所选 Discovery Provider 找到真实候选并显示 official name、IMO/MMSI/Callsign/flag/type/year/length/source；添加关注后 SQLite 有 user-owned watchlist；重启后仍存在；同一 Vessel 通过 IMO/MMSI/name 再搜索不产生重复 entry。无 MMSI 时仍可关注但明确不可进行 AIS Tracking。长期 AISStream session 自动包含该 MMSI 属于后续 AIS Tracking Runtime，不是本轮验收。

### B. Port 搜索和关注

`Shekou`、`CNSHK`、`蛇口` 解析到同一真实 Port；保存 UN/LOCODE、zh/en name、country、lat/lon/source identity；重启仍在；Weather/AIS Area 按 capability 自动启用，拥堵无覆盖时明确 unavailable。

### C. Feed

默认当前资讯没有数年前旧新闻；7/14 天、official validity、unknown/future date 规则有自动测试；旧数据只在 history 查询。

### D. Calendar

新进程启动立即显示 SQLite 缓存，不需点击同步；后台自动维护当前年 + 下一年；失败保留 last-known。

### E. Voyage

`mock-schedule` 在 Real Mode/production 为零；Current Voyage 与 Commercial Schedule 页面/字段明确分离；没有 carrier access 时显示暂无真实班期。

### F. Restart Persistence

在进程 A 写入 settings、user-owned vessel/port watch 和其他 P0 持久化状态后，故意异常退出进程 A；进程 B 使用同一 SQLite DB 启动，逐项校验数据完整且无重复 seed。测试直接使用 native SQLite，不使用 FakeRepository。正常关闭重启可以作为补充，但不能替代异常退出场景。

### G. Real Mode Failure

断开每一个 Provider 后分别验证：只显示该 Provider 的 real last-known stale/degraded；无历史则空；任何页面/HOT/Events 都没有 Mock。

### H. 中文 UI

所有固定 UI/状态/字段标签默认中文；技术品牌和标准标识按规则保留。

### I. 翻译

这是 P6 或单独批准的 Translation Provider 阶段验收，不属于 P0：英文 Feed/公告自动生成中文标题和摘要并持久化；原文可展开；重启/刷新不重复计费；翻译失败显示原文且采集成功；Settings 可切换 Provider；usage panel 标明本地统计/估算，不伪造官方余额；标识保护测试通过。

### J. HOT 追溯

每条 HOT detail 能展示：HOT → Event → Evidence → Provider → source URL/API → sourceUpdatedAt/fetchedAt；任何 Mock/test evidence 导致 Real Evidence Gate 拒绝。

### K. Provider Usage / Secret

这是后续 Provider Usage 与业务 Job 阶段验收，不属于 P2C。P2C 只记录通用 Job execution 与 Provider health；Provider 请求数、成功/失败、cache hit、字符/token、估算成本和最近调用的完整 usage ledger 仍需后续 Provider Workstream 在 SQLite/Settings 中实现。SQLite settings 只能保存非敏感 `ProviderConfig`（provider/model/base URL/enabled/budget 等），API key/`ProviderSecret` 只能由 server-only `SecretStore` 读取，Local 模式存放在 `.data/provider-secrets.json`，绝不进入 SQLite settings。

## 24. 配置与密钥管理

建议新增/统一：

```env
NODE_ENV=development
SHIPPING_DATA_MODE=real
SHIPPING_DATABASE_PATH=.data/shipping-hot-v3.sqlite3
SHIPPING_RUNTIME_ENABLED=true

SHIPPING_VESSEL_SEARCH_PROVIDER=vesselapi
VESSELAPI_API_KEY=

SHIPPING_VESSEL_PROVIDER=aisstream
AISSTREAM_API_KEY=

SHIPPING_PORT_DIRECTORY_PROVIDER=unlocode-local
SHIPPING_PORT_ENRICHMENT_PROVIDER=disabled
SHIPPING_WEATHER_PROVIDER=open-meteo
SHIPPING_WEATHER_ALERT_PROVIDER=public
SHIPPING_FEED_PROVIDER=public

SHIPPING_CALENDAR_PROVIDER=calendarific
CALENDARIFIC_API_KEY=

SHIPPING_TRANSLATION_PROVIDER=disabled
SHIPPING_TRANSLATION_MODEL=
SHIPPING_TRANSLATION_BASE_URL=
DEEPSEEK_API_KEY=
QWEN_MT_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_TRANSLATE_API_KEY=
DEEPL_API_KEY=
AZURE_TRANSLATOR_KEY=
AZURE_TRANSLATOR_REGION=
```

- 个人模式由服务端 `SecretStore` 统一读取；环境变量优先于本地文件，且 `.env.local`/`.env.server` 中的值不能被 UI 覆盖。SQLite settings 只保存非敏感 `ProviderConfig`，禁止保存 API key/`ProviderSecret`；key 绝不进入 LocalStorage、前端、Git、docs、fixture 或任何普通 SQLite 列。
- `example.env.server` 只留空 key 和注释，不放真实值。
- API/日志/provider_runtime 只显示 configured boolean，不输出 key。
- real/production 缺少必需 key 时该 Provider 为 `misconfigured`，不改 mode、不回退 Mock。
- 新 Provider key 命名使用实际品牌，避免含糊的 `VESSEL_SEARCH_API_KEY` 无法支持未来并存/迁移；Custom OpenAI-compatible 还必须单独配置 base URL/model。

### 24.1 SecretStore 合同与运行时生效

V3 正式定义 Secret 与普通 Provider 配置的边界：

```ts
interface SecretStore {
  get: (providerId: string) => Promise<string | undefined>
  set: (providerId: string, secret: string) => Promise<void>
  delete: (providerId: string) => Promise<void>
  has: (providerId: string) => Promise<boolean>
  source: (providerId: string) => Promise<"environment" | "file" | "missing">
}
```

- 本地个人模式实现 `FileSecretStore`，文件固定为 `.data/provider-secrets.json`；`.data/` 已在 `.gitignore`，文件只由 server runtime 读写，不能被前端直接读取。
- `EnvironmentVariableSecretStore`（或平台 Secret Manager）先查实际 Provider 环境变量，例如 `DEEPSEEK_API_KEY`、`VESSELAPI_API_KEY`；环境变量命中后，其优先级高于本地文件，且 `set/delete` 对该 provider 返回 `managed_by_environment`，UI 显示“当前密钥由环境变量管理，设置页不可覆盖”。
- 没有环境变量时才读写 `.data/provider-secrets.json`。Settings 的新增、修改、删除、测试连接都经过 server API；写入成功后立即刷新 Provider Registry/Config Service，下一次 Translation/Vessel 请求直接使用新 secret，不要求重启。
- FileSecretStore 只保存 secret，不保存 Provider model/baseUrl/budget/enabled；这些非敏感 `ProviderConfig` 字段进入 SQLite settings。`ProviderSecret` 只能通过 `SecretStore` 访问，不能塞进 settings JSON、`provider_runtime` 或任何 SQLite settings 列。
- API 只返回 `configured`、`source` 和掩码末四位（例如 `****AB12`）；日志、错误、缓存、测试响应和 provider_runtime 不得包含完整值或 Authorization header。

```text
Settings mutation
  → SecretStore.set/delete (server-only)
  → Provider Registry refresh
  → next job/request reads current secret
```

### 24.2 个人模式 Secret 方案比较

| 方案 | 适合度 | 结论 |
| --- | --- | --- |
| A. 环境变量/平台 Secret Manager | 简单、可审计；优先级最高且 UI 不可覆盖 | **Cloud/受管部署默认** |
| B. `FileSecretStore` `.data/provider-secrets.json` | 适合本地个人模式；需限制文件权限并加入 ignore | **Local/个人模式默认 fallback**；Settings 修改可立即生效 |
| C. encrypted SQLite secrets | 需要密钥管理、迁移和启动解密链路，容易把恢复问题变成新单点 | V3 不默认；只有后续明确需要多环境加密存储时再做 ADR |
| D. OS Credential Store | 安全性更高但跨平台、无头服务器和备份行为复杂 | V3 不默认；可作为未来本地增强，不阻塞个人模式 |

Cloud Mode 只使用部署平台环境变量/Secret Manager；不为个人项目引入 Vault 等企业级系统。设置页若允许输入 key，保存后只能显示 `sk-****xxxx` 这类掩码，服务端测试连接也不得把业务内容或完整 secret 发送到浏览器。

## 25. 待用户确认的选型

实施前需要确认：

1. 是否接受 VesselAPI 仅作为 P2 Vessel Discovery/静态 metadata 候选；先 Free PoC，Port/ETA/事件能力只有具体 endpoint entitlement contract test 通过后再启用，Basic $14.99/月、1,500 calls、Port data 作为公开套餐基线。
2. 是否接受 UNECE UN/LOCODE 本地同步目录作为 Port 搜索默认基础，VesselAPI 只做可选 enrichment。
3. 是否接受固定 Node 24 LTS 单一工具链，并创建 side-by-side V3 SQLite，而不是继续兼容 Node 20/22/24。
4. V2 Mock watchlist 是否按 IMO/MMSI/UNLOCODE 重新解析后迁移；推荐 exact match 才迁移，未解析项不进入 Real Mode。
5. P5 是否按“Current Voyage 先行，Commercial Schedule 需 Carrier entitlement 后再做”；首批需要哪几家 Carrier，是否已有 portal/API 账号。
6. 是否选择哪一个 TranslationProvider（DeepSeek/Qwen-MT/Gemini/OpenAI/Claude/Google/DeepL/Azure/Custom）；默认推荐可切换且未配置时 disabled，不提前把 Azure 或任何单一 Provider 写死。
7. 对新增港口无 Portcast/official notice coverage 时，是否接受显示“未覆盖”，而不是要求每港都有拥堵和公告。

## 26. 用户未点名但会阻塞 V3 的架构问题

1. **请求副作用过重**：`GET /api/shipping` 同时是 query、sync、event detection 和 persistence command。P0/P4 前必须拆分，否则搜索/翻译后每次页面请求会放大 API 成本和失败半径。
2. **Watched AIS 生命周期错误**：当前每个 GET 创建短时 WebSocket；多页面/多浏览器会重复连接。必须改为服务器单例 session。
3. **Fixture 是正式几何配置源**：天气坐标和 AIS bbox 从 `shipping-fixtures.ts` 导入，破坏 Real Mode 的 lineage。
4. **用户状态与 Provider 状态共同行**：`isWatched` 在 Vessel/Port Provider row 中，未来任何 upsert 都有覆盖风险。
5. **seed 判据错误**：只检查 vessels 是否为空；AIS 暂无观测会导致其他表反复 seed/覆盖。
6. **Event 没有统一 expiry**：普通 Feed 消失后 active Event 可长期保留；HOT 会继续消费。
7. **Provider Runtime 不是真相**：当前 freshness 取第一条数据的时间，不能代表多港口/多源整体状态，也不能跨重启。
8. **全球关注后的 Provider capability 不对称**：Open-Meteo 可通用坐标化，但 Portcast/official notices 不是全球覆盖；UI/Domain 必须支持 per-port capability，而不是假设“关注即全能力”。
9. **翻译与账单边界缺失**：没有可切换 TranslationProvider、usage ledger、预算上限和 server-only secret contract；P0 必须先留接口/表，P6 才填 adapter。
10. **生产 Nitro subroute 已知故障**：`docs/status.md` 记录 production subroutes 存在 `#nitro/index` package-import error；V3 P0 的 restart/production smoke 必须先把它纳入 gate，否则本地 dev 成功不能代表可交付运行。
11. **没有 migration runner**：当前 startup 只有一次 ad-hoc nullable rebuild，不足以安全承载 V3 拆表和回滚。

## 27. 实施门槛与文档后续

`docs/adr/ADR-005-v3-real-data-boundaries.md` 已于 2026-08-20 更新为 `Accepted`，P0、P1A、P1B Mock Isolation、P2A Search Foundation、P2B Identity Seal 与 P2C Background Runtime Foundation 已获授权、实施并完成本地验证；AIS Tracking Runtime、剩余 P2 watch/tracking 及后续 Provider 功能仍 deferred。该 ADR 至少覆盖：

- V3 real-only runtime、SQLite fail-closed/read-only 行为和已验证的单一 Node LTS。
- VesselAPI 仅 Discovery/static metadata、AISStream 长期 tracking、UN/LOCODE 默认 Port Search，以及 provider-owned/user-owned/directory-owned/translation-owned 字段边界。
- P1A → P1B → P2A → P2B → AIS Tracking Runtime 依赖、AISStream 50 MMSI/Beta/no SLA、长期单例连接和 Position/Static/Voyage facts。
- `ProviderConfig`/`ProviderSecret` 分离、`SecretStore`（环境变量优先 + `FileSecretStore`）、Settings 立即刷新 Provider Registry。
- TranslationProvider 可切换合同、Settings AI 翻译中心、单一 `translation_cache` source of truth、server-only secret、`provider_usage` 和“本地统计/估算”标签。
- Current Voyage 与 DCSA Commercial Schedule 的事实分层。

后续每个获批阶段都严格执行项目 Closeout：Implementation → Verification → typecheck → lint → test → build → Neat Freak Closeout → Status Update → Completion Report。P0/P1A/P1B、P2A Search Foundation、P2B Identity Seal 与 P2C Background Runtime Foundation 已完成；AIS Tracking Runtime、剩余 P2 watch 或 P5 Schedule 不在本轮；后续 Provider/AI adapter 仍按单独批准范围实施。

## 28. 外部资料

- VesselAPI：[Pricing](https://vesselapi.com/pricing)、[Vessel Tracking / Search](https://vesselapi.com/docs/vessels)、[Ports](https://vesselapi.com/docs/ports)、[Port Events](https://vesselapi.com/docs/port-events)
- Datalastic：[Pricing and feature comparison](https://datalastic.com/pricing/)
- MyShipTracking：[API overview](https://api.myshiptracking.com/)、[API pricing](https://api.myshiptracking.com/api-pricing)
- VesselFinder：[Real-Time AIS Data API](https://www.vesselfinder.com/realtime-ais-data)
- MarineTraffic/Kpler：[Maritime Data Services](https://www.kpler.com/product/maritime/data-services)
- DCSA：[Commercial Schedules standard](https://dcsa.org/standards/commercial-schedules)
- Maersk：[Integration Hub](https://integration.maersk.com/)
- Calendarific：[Pricing](https://calendarific.com/pricing)
- UNECE：[UN/LOCODE](https://unece.org/trade/cefact/unlocode-code-list-country-and-territory)
- Open-Meteo：[Pricing](https://open-meteo.com/en/pricing)
- AISStream：[Home](https://aisstream.io/)、[Documentation](https://aisstream.io/documentation)
- DeepSeek：[API pricing](https://api-docs.deepseek.com/quick_start/pricing)
- Qwen-MT/Alibaba Cloud：[Model Studio pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- Gemini：[Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Claude：[API model pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
- Azure：[Translator pricing](https://azure.microsoft.com/en-us/pricing/details/translator/)
- Google Cloud：[Translation pricing](https://cloud.google.com/translate/pricing)
- DeepL：[API pricing](https://www.deepl.com/en/pro-api)
- OpenAI：[API pricing](https://developers.openai.com/api/docs/pricing)
