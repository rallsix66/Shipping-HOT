# Shipping HOT V3 — Real Data Migration

> 文档状态：`proposal / awaiting architecture approval`
>
> 审查日期：2026-08-20（Asia/Shanghai）
>
> 代码基线：`main` @ `c292be4`
>
> 实施状态：**未开始**。本文只记录现状审查、外部选型和实施方案，不授权修改业务代码、数据库或外部账号。
>
> 实施门槛：只有用户明确确认 `架构确认，开始执行 Phase 1` 后，才可以从本文的 P0 开始；P0 中的 schema、Node 版本和新 Provider 仍需按本文“待确认决策”落实为 ADR。

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
7. Schedule 在所有运行模式中都固定为 `MockScheduleProvider`，并被 Real Mode operational source context 明确允许。
8. Feed 没有 7/14 天年龄闸门；失效的 Feed Event 在缺少当前 source trust 时会继续保持 active，可能长期进入 Events/HOT。
9. Calendarific 只有手工同步 API，没有启动自动维护当前年 + 下一年的后台调度。
10. Provider Runtime 只是当前响应中的临时摘要，无法回答最后请求、最后成功、最后源更新时间、缓存年龄和连续失败次数。

## 2. 当前系统真实状态审查

### 2.1 模块状态矩阵

| 模块 | 当前 Provider / 代码 | 当前真实度 | 是否持久化 | 当前问题 | V3 目标 |
| --- | --- | --- | --- | --- | --- |
| 船舶身份/搜索 | 无全球搜索；Real Mode 仅 `AISStreamVesselProvider`，初始 Watch Target 来自已存数据或 Mock fixture | 混合；AIS PositionReport 可真实，但默认身份种子是 Mock，当前实测无 PositionReport | 设计上写 `vessels`；当前 Node 24 实际为内存 | 无搜索；无观测时 `vessels=[]`；请求内短连接；重启可能重新 seed | VesselAPI 搜索真实身份，SQLite watchlist 永久保存，AISStream 仅长期跟踪已关注 MMSI |
| 港口身份 | 八个 `mockPorts` 身份；Portcast 只覆盖硬编码的八个 public page URL | 混合；名称/UNLOCODE/坐标来自 fixture，部分拥堵字段真实 | 设计上写 `ports`；当前实际为内存 | provenance 被整体标为 Portcast，无法表达身份字段的 fixture 来源；全球搜索不存在 | 真实港口目录 + UN/LOCODE 身份 + 中文别名 + 坐标，能力按 Provider 覆盖显示 |
| 港口拥堵 | `PortcastPublicPageProvider` | 八港部分真实 derived；7 fresh / 1 stale 是历史探测证据 | 同上 | 仅硬编码八港；公开页面脆弱；不能承诺新增港口均有拥堵数据 | 独立 Port Intelligence 能力；没有覆盖就显示“暂无真实拥堵数据” |
| Watched AIS | AISStream | Provider 真实；连接已验证、观测仍 pending | Vessel 当前状态计划写库；当前实际为内存 | 每个 GET 打开最长 5 秒的全世界 bbox + MMSI WebSocket；多客户端会重复连接 | 单例长连接订阅服务；watchlist 变化增量重订阅；观测立即持久化 |
| AIS Area | AISStream Area PositionReport + derived engine | 原始消息可真实，指标为 derived；当前外部观测 0 | `ais_port_metrics` 当前/last-known 设计，当前实际为内存 | bbox 从 fixture 坐标生成；只覆盖八港；不是官方拥堵 | 从真实 Port 坐标/配置生成并保留边界证据；只展示为 AIS 估算信号 |
| 天气模型 | Open-Meteo Marine + Forecast | 响应真实 forecast；目标坐标来自 Mock fixture | 作为 `feed_items`；当前实际为内存 | `portWeatherConfig` 只含八港；无通用坐标路径 | 直接使用真实 Port 经纬度；30–60 分钟自动刷新；失败保留同 Provider last-known |
| 官方气象预警 | JMA/TMD/BMKG adapters | Provider 边界存在，但 `public` 模式没有任何 `verified_live` active source | 作为 `feed_items` | 适配器存在不等于启用；当前 UI 只显示模式值 | 每源独立 live gate、生命周期、覆盖和 health；未启用明确显示“不可用/未验证” |
| 行业资讯 | The Loadstar active；Maritime Executive disabled；其他 registry 项未启用 | Loadstar 真实；Maritime Executive failed；无 Mock fallback 时边界正确 | `feed_items` 设计持久化；当前实际为内存 | 无发布时间年龄闸门、future/异常日期校验和 current/history 分层 | 默认 7 天，重大资讯 14 天；历史单独查询；严格时间校验 |
| 港口公告 | Shekou `/ywgg/` active；其他港口 registry 多为 pending/deferred | Shekou 页面真实；多数条目 publication time unknown | 同 Feed | 发布时间未知仍出现在 Feed；是否仍有效不可判断 | 官方公告与行业新闻分层；基于有效期/撤回状态，未知时间默认不进当前流 |
| 国家日历 | Calendarific + 空的 Official/Manual composition | Calendarific transport/parser 真实且 partial；Official/Manual 当前没有实数据 | `calendar_events` + `settings.calendarSync` 设计；当前实际为内存 | 启动不自动同步；seed 可重置 coverage；只手工维护单年 | 启动先读库，后台维护当前年 + 下一年，24 小时 TTL，失败保留 last-known |
| 当前航程 | AIS 目的地/ETA 字段和 Mock Voyage 分散存在 | 混合，未形成真实 Current Voyage | `voyages` 当前只保存 Mock schedule | AIS ETA 与官方班期没有分层；无 port-call 事实 | VesselAPI ETA + port events 形成明确标记为 observed/derived 的 Current Voyage |
| 商业班期 | `MockScheduleProvider` | 全 Mock | `voyages` | Real Mode 也始终 operational；无真实 ScheduleProvider adapter | DCSA 规范化合同；按获准船公司逐个接入；无 Provider 时为空 |
| Events | `detectShippingEvents()` | derived；显式 sourceId 过滤能排除多数 Mock，但 `mock-schedule` 被允许 | `events` 设计持久化；当前实际为内存 | orphan active Event 无当前 source trust 时不会 resolve/expire；混合 fixture lineage 未被识别 | 所有 evidence 必须是 real/user/derived-from-real；有明确有效期、source identity 和可追溯链 |
| HOT | `rankHotItems()` | derived；可含 Mock schedule Event 和长期 active 的旧 Event | 查询结果，不单独持久化 | 没有强制 `all evidence real`；stale active Event 仍可出现 | 只消费通过 Real Evidence Gate 的 Event/Feed，逐条可追溯 |
| 关注/设置 | `POST /watch` toggle、`POST /settings` | 用户真实操作 | Repository 可用时写库；当前 Node 24 实际内存 | API 返回成功并不代表可跨重启保存；watch 与 Provider 行同表 | 独立 watchlist/settings 表，事务提交成功后才返回成功，DB 不可用时 503 |
| 中文 UI | 大部分固定 UI 已中文 | UI chrome 多数中文；外部内容、船型、国家、标签和 Provider mode 仍英文 | 无翻译缓存 | 无 Translation Layer；原文/译文未分离 | zh-CN 默认；外部可翻译字段异步翻译并缓存；标准标识永不翻译 |
| Provider Runtime | `providerFreshness` 临时对象 + sidebar mode | 请求级状态 | 不持久化 | sidebar 颜色主要看 mode，不看真实 health；无 last success/request/source update | `provider_runtime` + `sync_runs`，展示正常/降级/不可用、时间、缓存和原因 |

### 2.2 已存在的 API

当前 Shipping API 只有：

- `GET /api/shipping`：读取、触发所有 Provider、写入快照、计算 Event/HOT。
- `POST /api/shipping/watch`：对既有 Vessel/Port 做 toggle。
- `POST /api/shipping/settings`：更新刷新/阈值/retention。
- `GET /api/shipping/calendar`：读取已缓存日历。
- `POST /api/shipping/calendar/sync`：手工同步指定年/国家。

不存在 Vessel/Port 搜索、资源式 watchlist CRUD、Current Voyage/Port Call、Provider Health、历史 Feed 搜索、翻译状态和同步运行记录 API。

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
| Provider Runtime 已显示 | UI 显示 requested mode 和一次请求的 freshness；不持久化 last success/request、错误次数或 next sync | P0/P7 建立真实 Runtime Health |
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
SQLite Repository (original facts + localized fields + last-known)
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
- Real Mode 不运行 Mock seed。
- Demo/Test seed 只在独立测试数据库执行，且只用 `INSERT ... ON CONFLICT DO NOTHING`。
- Provider upsert 使用 `INSERT ... ON CONFLICT DO UPDATE SET provider_owned_columns...`，禁止 `INSERT OR REPLACE`。
- Watchlist/settings/manual calendar 是 user-owned 表，Provider 无权更新。
- 每个 migration 在事务内执行；升级前复制数据库文件并记录 checksum。

### 7.4 重启合同

重启后首先从 SQLite 恢复：watchlists、settings、日历、Voyage/Port Call、Feed current/history、Events、AIS aggregate、Provider Runtime、translation cache 和 sync schedule。恢复完成后 UI 可立即读取；后台同步随后运行。

## 8. Vessel Search / Watch 方案

### 8.1 推荐 Provider

首选 VesselAPI：公开文档的 `GET /v1/search/vessels` 同时支持 name、callsign、MMSI、IMO、flag、type 和 year-built；静态 Vessel 结果含 official name、call sign、type、flag、year、dimensions。Free 为 150 calls/月；Basic 为 $14.99/月、1,500 calls/月，并增加 Port data。

AISStream 继续只承担已关注 MMSI 的实时 PositionReport，不承担全球搜索数据库。

### 8.2 搜索流程

1. 服务端规范化 `q`，识别 IMO/MMSI/Callsign/Name。
2. 调用 `VesselSearchProvider.search()`；结果缓存 24 小时，保留 provider record key。
3. 返回 normalized `VesselSearchResult`，不把结果自动加入业务表。
4. 用户点击“添加关注”后，在一个 SQLite 事务内：upsert vessel identity、insert watchlist、写审计时间。
5. Watchlist 变更事件通知长期 AISStream session 重订阅。
6. AIS 尚未观测时，仍保留真实搜索身份并显示“暂无 AIS 观测”，不能消失或变成 Mock。

### 8.3 身份规则

- 内部 `vessel_id` 稳定，不直接等于可变 MMSI。
- 优先 IMO；没有 IMO 时使用 provider + provider record id；MMSI 是可变查找键。
- official registered name 永远保留，不翻译。
- Callsign、IMO、MMSI 的唯一冲突必须进入人工确认，不自动合并两艘船。

## 9. Port Search / Watch 方案

### 9.1 推荐来源

- 基础真实目录：定期同步 UNECE UN/LOCODE 官方快照到本地，只保存 Function 含港口/码头的记录。
- API enrichment：VesselAPI Basic 的 Port API，支持 name search、UN/LOCODE detail 和坐标；Free 计划是否包含 Port data 以账号实际 entitlement 为准，不写死为免费能力。
- 中文别名：本地 `port_aliases`，由明确来源/人工确认维护。`蛇口`、`Shekou`、`CNSHK` 都归一到同一 `port_id`。

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

### 10.3 来源分层

- 行业新闻：The Loadstar、Splash247、gCaptain、Seatrade Maritime、Maritime Executive（连接恢复后重新 probe）。可信度是 third-party reported。
- 官方运营公告：港口、船公司、海事局、气象机构。可信度是 official reported，但 parser、发布时间和有效期仍需验证。

每个来源必须有 registry：format、legal/robots review、parser version、refresh cadence、publication timezone、current-window policy、live status 和 failure isolation。

## 11. Calendar 自动同步方案

### 11.1 启动流程

1. SQLite ready 后立即读取日历和 coverage，页面无需等待外部 API。
2. Scheduler 检查当前年和下一年 × TH/ID/MY/PH/VN。
3. coverage 缺失、超过 24 小时、年份变化或 provider version 变化时入队同步。
4. 每个 country/year 独立成功或失败；成功事务更新 events + coverage，失败保留同源 last-known。
5. UI 通过 React Query invalidation/SSE 可选通知刷新；手工“立即刷新”保留但有 rate limit。

Calendarific Free 官方公开额度为 500 calls/月。五国 × 两年 × 每 24 小时一次约 300 calls/月，仍留约 200 次给首次启动、失败重试和手工刷新，适合个人项目。注意 Free 的 upcoming/historical coverage 有限制且数据集按季度更新，所以 coverage 必须继续标 partial/unknown，不能宣称完整。

### 11.2 年份滚动

- 2026 年维护 2026 + 2027。
- 进入 2027 年后维护 2027 + 2028；2026 保留为 history，不再日常刷新。
- 下一年若 Free entitlement 暂无数据，记录 `partial/unknown`，不删除当前 last-known，也不创建 Mock。

## 12. Voyage / Schedule 真实数据方案

### 12.1 两类事实

**Current Voyage** 是 observed/derived：上一港、当前位置、AIS 目的地、AIS ETA、下一港候选、当前状态。推荐使用 VesselAPI 的 vessel ETA、last port event、port-call history，与 AISStream position 分别保存 evidence。

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

- P5-A Current Voyage：VesselAPI。它公开提供 vessel ETA、port events、last port event 和 port history；低成本且与 P2 搜索共享一把 key。
- P5-B Commercial Schedule：使用 DCSA Commercial Schedules 作为 normalization 标准，不把 DCSA 当作数据供应商。
- 首个 Carrier candidate：Maersk Integration Hub 已公开列出 Commercial Schedules，但需要合作/onboarding；拿到 sandbox/production entitlement 后再建 `MaerskScheduleProvider`。
- Hapag-Lloyd、CMA CGM、MSC、COSCO、ONE、Evergreen、PIL：只有在官方 portal、认证、用途许可、价格和样例覆盖验证后才逐个批准适配器。
- INTTRA/e2open、project44、Kpler/MarineTraffic：更适合企业聚合/预测，公开资料通常要求 demo/询价，不作为个人项目 P5 默认依赖。

若没有任何 Carrier entitlement，V3 可以完成 Current Voyage，但 Commercial Schedule 页面必须显示“未配置真实班期 Provider”，不能保留 `mock-schedule`。

## 13. Translation 中文化方案

### 13.1 推荐

首选 Azure Translator F0：官方公开额度为每月 200 万字符免费，S1 标准文本翻译为 $10/百万字符。它是简单 REST、专业机器翻译、成本可预测，适合个人项目的新闻标题/摘要/公告/预警缓存翻译。

备选：

- Google Cloud Translation NMT：每月前 50 万字符由 $10 monthly credit 覆盖，之后 $20/百万字符；云账号和 billing 配置更复杂。
- DeepL API：当前公开页面是一次性 100 万字符 Developer 额度，Growth 之后按订阅/用量计费；质量好，但不再把它当持续免费方案。
- OpenAI API：可用低成本文本模型做上下文翻译/结构化摘要；官方价格按 token 计费。它更适合作为可选“高质量模式”，不作为稳定 NMT 默认依赖。
- 本地 NLLB/Argos：无 API 费用，但模型下载、CPU/内存、质量和升级成本高，V3 非目标。

### 13.2 字段策略

允许翻译：新闻 title/summary、公告、天气预警、日历名称、国家名、船型、航行状态、港口状态、Event/HOT 解释。

禁止翻译：registered vessel name、IMO、MMSI、Callsign、Voyage number、SCAC、UN/LOCODE、Container number、Carrier/service codes。

实体允许显示人工/可靠中文别名，例如：`东方福 / DONG FANG FU`，但 official registered name 永远保留。

### 13.3 两阶段持久化

1. Normalizer 先保存原文事实，确保抓取成功不依赖翻译。
2. Translation job 根据 allowlist 批量翻译。
3. `translation_cache` key = provider + model/version + source language + target language + content hash。
4. 成功写 `title_original/title_zh`、`summary_original/summary_zh`；失败记录 health，UI 显示原文。
5. 打开页面不调用翻译 API；只读缓存。

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
| `vessels` | 真实船舶身份/静态元数据 | IMO/MMSI/Callsign 索引；registered name 原样保存 |
| `vessel_watchlist` | 用户关注 | 与 Provider upsert 隔离；watch 时间和 AIS enabled |
| `ports` | 真实港口身份 | UN/LOCODE unique、zh/en name、country、lat/lon |
| `port_aliases` | 中文/英文/历史别名 | normalized alias 索引；支持蛇口/Shekou/CNSHK |
| `port_watchlist` | 用户关注 | 独立 user-owned |
| `voyages` | Current/Commercial Voyage 头 | `kind`、vessel、voyage number、source/confidence |
| `voyage_legs` | 商业 rotation legs | scheduled/estimated/actual 分列 |
| `port_calls` | observed arrival/departure | Provider event identity + time |
| `feed_items` | 原文资讯、当前/历史状态 | original/zh 字段、effective/expiry/current_until |
| `calendar_events` | 当前/历史日历 | 保留 scope/coverage/source；增加翻译字段 |
| `events` | derived lifecycle | evidence JSON schema、expires_at、real_evidence flag |
| `provider_runtime` | health + scheduler cursor | UI 和失败恢复真相 |
| `settings` | 用户设置 | 保持单用户 JSON 可接受；增加 schemaVersion |
| `ais_port_metrics` | bounded aggregate | 继续 current/last-known，不存 raw AIS |
| `translation_cache` | 内容哈希翻译缓存 | 不单独建 `feed_translations`，避免重复结构 |
| `sync_runs` | 最近同步执行/错误 | 有界保留，例如 90 天/每源最近 N 次 |

`feed_translations` 不单独建表：个人项目用 `feed_items` 的 original/zh 列 + 通用 `translation_cache` 已足够。若未来一个 Feed 需要多目标语言，再通过新 ADR 拆表。

## 16. 自动刷新策略

| 数据 | 建议频率 | 缓存/失败策略 |
| --- | --- | --- |
| AIS watched vessels | 长期 WebSocket | 断线指数退避；PositionReport 立即落库；无消息不伪造 fresh |
| AIS Area | 长期独立 WebSocket，会话按 watched ports 更新 | 保留 15 分钟 bounded observation memory；只持久化 aggregate |
| Vessel static/search cache | 3–7 天；搜索结果 24 小时 | 手工关注时强校验；静态数据慢更新 |
| Current Voyage / port calls | 2–6 小时；关注后立即一次 | 同 Provider last-known；AIS ETA 与 port events 分字段 |
| Commercial Schedule | 4–6 小时或 Provider webhook | 遵守 carrier rate limit；baseline 不被自动覆盖 |
| Port congestion | 15–30 分钟仅对 API 型 Provider；Portcast public page 维持 24 小时 | per-port isolation；无覆盖即 unavailable |
| Weather model | 30–60 分钟 | ETag/TTL；按 port 隔离 |
| Official weather alerts | 10–30 分钟 | source-specific lifecycle/expiry |
| Industry news | 15–30 分钟 | ETag/Last-Modified；7/14 天 current gate |
| Official notices | 10–30 分钟 | 有效状态优先；未知时间不进 current |
| Calendar | 启动检查 + 24 小时 | 10 country-year calls/day；同源 last-known |
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
- `GET /api/shipping/health`：数据库、scheduler、Provider 摘要，不泄露密钥。

### 17.2 Mutation

- `POST /api/shipping/watchlist/vessels`：body 使用 selected provider identity，不接受客户端伪造完整 Vessel。
- `DELETE /api/shipping/watchlist/vessels/:id`：只取消关注，不级联删除历史事实。
- `POST /api/shipping/watchlist/ports`。
- `DELETE /api/shipping/watchlist/ports/:id`。
- `PATCH /api/shipping/settings`：替代当前全局 POST 语义。
- `POST /api/shipping/sync/:provider`：手工立即刷新；有权限白名单、cooldown 和 202/运行记录。
- `POST /api/shipping/calendar/refresh`：当前年 + 下一年或显式 year，仍走同一 scheduler job。

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

### 19.2 回滚

- V3 migration 不修改 V2 原文件。
- 回滚时停止 V3、恢复配置指向 V2 文件并回退代码；V3 新写数据不会反向写入 V2。
- 用户确认 V3 验收和备份后，才讨论旧 DB/Mock 残留清理；本文不授权删除。

## 20. P0–P7 实施阶段

### P0 — Persistence

| 项目 | 内容 |
| --- | --- |
| 目标 | 固定 Node 24 LTS；SQLite 成为唯一持久化真相；数据库失败显式只读/不可用；重启恢复全部用户状态 |
| 修改文件 | `package.json`、`README.md`、`nitro.config.ts`、`example.env.server`、`server/database/shipping.ts`、`server/shipping-store.ts`、现有 mutation API、`shared/shipping.ts`、`src/components/shipping/app.tsx`、`src/components/shipping/data.ts` |
| 新增文件 | `.nvmrc`/`.node-version`、`server/database/runtime.ts`、`server/database/migrations/**`、`server/api/shipping/health.get.ts`、restart smoke fixture/script |
| 数据库 | 引入 schema version；拆 watchlist；新增 provider_runtime/sync_runs；移除 OR REPLACE 和单表空判断；side-by-side V3 DB |
| API | 所有 mutation 在事务失败时返回 503；GET 返回 `persistence` health |
| 测试 | native SQLite integration、进程 A 写入→关闭→进程 B 读取、无 vessel 时不 reseed、settings/calendar/watch 不被 Provider upsert 覆盖、DB unavailable UI/API |
| 验收 | Node 24 下 `better-sqlite3` 真实加载；A–F 中的重启保存前置条件全部通过；不存在成功但未落库的 mutation |
| 风险 | native build/toolchain；V2 JSON 迁移不一致；生产 Nitro subroute 的已知 `#nitro/index` 问题 |
| 回滚 | 切回 V2 DB 备份和旧 runtime；不删除 V3 DB，保留诊断 |

### P1 — Mock Isolation

| 项目 | 内容 |
| --- | --- |
| 目标 | Mock 只存在于 test/demo；real/production code path 无 fixture import、Mock seed、Mock Schedule |
| 修改文件 | `server/providers/shipping.ts`、`server/providers/feed.ts`、`server/providers/calendar.ts`、`server/shipping-store.ts`、`shared/ais-area.ts`、全部相关测试、`example.env.server` |
| 新增文件 | `server/config/shipping.ts`、`server/providers/unavailable.ts`、`test/fixtures/shipping.ts`、Real Evidence Gate tests |
| 数据库 | migration 时隔离/不导入 Mock operational rows；增加 origin/environment 约束 |
| API | response 明确 `unavailable/misconfigured`；Real Mode 不返回 Mock payload |
| 测试 | production bundle 无 fixture import；每个 Provider 缺 key/失败/无历史矩阵；Event/HOT mixed evidence rejection |
| 验收 | Real Mode 即使全部 Provider 失败，页面只有真实 last-known 或空；`mock-schedule=0`；正式 UI 无 Mock 计数/卡片 |
| 风险 | 现有八港身份/坐标全部来自 fixture，移除前必须先有真实目录 |
| 回滚 | 仅在 development demo 显式切 `SHIPPING_DATA_MODE=mock`；production 不提供回滚到 Mock 的开关 |

### P2 — Search & Watch

| 项目 | 内容 |
| --- | --- |
| 目标 | 全球 Vessel/Port 搜索、真实身份、事务式关注和 AIS/Weather/Area 自动接入 |
| 修改文件 | `shared/shipping.ts`、Repository、shipping service、Vessels/Ports 页面、settings/config |
| 新增文件 | `server/providers/vessel-search.ts`、`server/providers/vesselapi.ts`、`server/providers/port-catalog.ts`、search/watchlist API、search UI components |
| 数据库 | vessels/ports identity、watchlist、port_aliases、search cache |
| API | 本文 17 节 search/watchlist CRUD |
| 测试 | DONG FANG FU 多字段查询 fixture/contract、Shekou/CNSHK/蛇口 identity resolution、duplicate/conflict、重启、AIS subscription update |
| 验收 | 验收 A/B；关注后重启仍在；无 MMSI/坐标能力明确降级，不制造值 |
| 风险 | Provider 数据库找不到目标船；免费额度；MMSI 重用/IMO 缺失；中文 alias 质量 |
| 回滚 | 禁用 search Provider；保留已持久化 watchlist 和 last-known，不回退 Mock |

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
| 测试 | 冷/热启动、24h TTL、跨年、部分国家失败、500 calls/月预算、last-known |
| 验收 | 验收 D；进程启动后页面立即有缓存，后台自动更新 2 年 |
| 风险 | Calendarific Free upcoming 限制；季度更新；系统时间错误 |
| 回滚 | 停自动 job，保留已缓存真实 Calendar 和手工 refresh；不启用 Mock |

### P5 — Real Voyage / Schedule

| 项目 | 内容 |
| --- | --- |
| 目标 | 清除 mock-schedule；先上线真实 Current Voyage，再接有授权的 Commercial Schedule |
| 修改文件 | shared Voyage types、Repository、Event engine、Voyage 页面、provider config |
| 新增文件 | CurrentVoyage/Schedule interfaces、VesselAPI current-voyage adapter、port_calls/voyage_legs API/tests；获批后 carrier adapter |
| 数据库 | voyages、voyage_legs、port_calls 拆表；planned/observed/derived 字段 |
| API | current voyage、schedule search/detail、port calls |
| 测试 | AIS ETA 不等于 schedule ETA、baseline freeze、actual ATA/ATD、provider failure、DCSA normalization contract |
| 验收 | 验收 E；没有真实 Carrier 时 Commercial Schedule 明确为空；Current Voyage 每字段有 evidence |
| 风险 | Carrier onboarding/费用/条款；voyage number 不在 AIS；不同 Carrier DCSA 版本差异 |
| 回滚 | 禁用单一 carrier adapter；保留 VesselAPI Current Voyage；页面显示 schedule unavailable |

### P6 — Translation

| 项目 | 内容 |
| --- | --- |
| 目标 | 外部文本自动中文化并缓存，原文永远可查，标识不翻译 |
| 修改文件 | shared DTO、Feed/Calendar/Event UI、Provider Runtime/settings |
| 新增文件 | TranslationProvider、Azure adapter、translation service/cache、字段 allowlist、i18n labels |
| 数据库 | translation_cache；各内容表 original/zh/translation status |
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

> 价格和公开能力按 2026-08-20 官方页面核验；供应商可以随时变更。任何正式接入前都要在用户自己的账号/地区重新确认 entitlement、用途许可、VAT 和中国网络可达性。

### 21.1 船舶 / 港口搜索

| Provider | 船名 | IMO/MMSI | Callsign | 港口搜索 | 公开价格/试用 | 注册/稳定性 | 与 AISStream 重复 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VesselAPI | 是，partial name | 是 | 是 | 是，name + UN/LOCODE detail + coords | Free 150 calls/月；Basic $14.99/月 1,500；Starter $59.99/月 15,000 | 自助注册，Free 无信用卡；公开文档/限流清楚 | Position 有重复；搜索/static/port events 是补充 | **首选**；先 Free PoC，正式 Port + Current Voyage 推荐 Basic |
| Datalastic | 是 | 是 | 是 | 是，name/country/UNLOCODE/coords | 14 天优惠试用后 Starter €199/月、20k credits | 自助但个人成本高；功能完整 | 大量重复，包括 AIS/历史/天气 | 能力强但不适合本个人项目预算 |
| MyShipTracking | 是 | 状态端点支持；search 页面主打 name | 未从公开 search 摘要确认 | 是，name/UNLOCODE | Trial 10 天/2,000 coins；Basic €90/月 | 自助试用；纯 terrestrial AIS，官方提示覆盖有限 | 高 | 次选，成本高于 VesselAPI |
| VesselFinder | API 页面提供 position、voyage、port calls、particulars | 是 | 未公开确认 | Port calls 有；目录搜索未公开确认 | Subscription/按需求询价，无公开价 | 需要提交需求，个人接入摩擦高 | 高 | 不作为 P2 默认 |
| MarineTraffic / Kpler | Ships DB、AIS、events、predictive ETA | 企业级能力 | 企业级能力 | 事件/港口能力强 | Request demo/询价，无公开自助低价 | 成熟但企业销售流程 | 很高 | 作为稳定付费/企业备选，不适合最低成本 |

**选择理由**：VesselAPI 是当前公开资料中唯一同时覆盖本项目四种 Vessel query、Port 目录、Current ETA/Port Events，并提供持续免费试用和 $14.99/月低价档的候选。用它做低频 discovery/static/current-voyage，AISStream 做实时 watched MMSI，可最小化功能重复和成本。

### 21.2 航次 / 船期

| 来源 | Current Voyage | Commercial Schedule | 接入/价格 | 适合度 |
| --- | --- | --- | --- | --- |
| VesselAPI | ETA、destination、last port event、port history、inbound | 否；不是官方 carrier rotation | Free/Basic 公开 | **P5-A 首选** |
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
| Azure Translator | F0 200 万字符/月；S1 $10/百万字符 | 专用 NMT、REST 简单、额度最适合个人项目 | 需 Azure resource/key；地区可达性要实测 | **首选** |
| Google Cloud Translation | 50 万字符/月 credit；之后 $20/百万字符 | 稳定、语言多、NMT | Billing/项目配置更复杂；免费额度较小 | 次选 |
| DeepL API | Developer 一次性 100 万字符；Growth 订阅 + usage | 质量/术语表强 | 不再是持续月度免费；地区价格差异 | 质量优先备选 |
| OpenAI API | 例如官方价格页所列低价文本模型按 token 计费 | 上下文和结构化输出强 | 非专用 NMT；需要 prompt/version/cost 管理 | 可选高质量/摘要模式 |
| 本地模型 | API 成本 0 | 数据不出本机 | 下载、CPU/RAM、质量和维护成本高 | V3 非目标 |

## 22. 成本评估

### 22.1 免费可行方案

- AISStream：继续现有 watched MMSI 实时流（实际账号限额/条款按用户账号确认）。
- VesselAPI Free：150 calls/月，仅用于搜索 PoC 和极低频 static/current voyage；不要做实时轮询。
- Port：UNECE UN/LOCODE 本地真实目录；VesselAPI Port entitlement 未包含时不做 API enrichment。
- Open-Meteo：天气。
- Public RSS/official pages：资讯，遵守来源规则。
- Calendarific Free：500 calls/月，按本文 300 calls/月策略。
- Azure Translator F0：200 万字符/月。

限制：Port API enrichment 和多 Vessel Current Voyage 自动刷新可能超过免费能力；Commercial Schedule 不保证可用。

### 22.2 最低成本推荐方案

- VesselAPI Basic：$14.99/月，1,500 calls/月，覆盖 Vessel Search、Port data、Current Voyage 所需 endpoint。
- AISStream/Open-Meteo/Public Feed/Calendarific Free/Azure F0：保持免费。

预计固定 Provider 成本约 **$14.99/月**（不含税、汇率、可选 satellite credits 和现有账号费用）。这是本项目首选成本档。

### 22.3 更稳定付费方案

- VesselAPI Starter：$59.99/月，15,000 calls/月，用于更多 watched vessels/notifications。
- Calendarific Starter：$100/年，10,000 calls/月、完整 upcoming/historical、免 attribution。
- Azure S1：超出 F0 后 $10/百万字符。
- 若需要企业级全球 AIS/预测/商业 Schedule，再单独询价 Kpler/MarineTraffic、project44 或 e2open；不在本个人预算中预设金额。

## 23. 最终验收标准

### A. Vessel 搜索和关注

搜索 `DONG FANG FU`，从所选 Provider 找到真实候选并显示 official name、IMO/MMSI/Callsign/flag/type/year/length/source；添加关注后 SQLite 有 watchlist；重启后仍存在；AISStream session 自动包含该 MMSI。若 Provider 数据库确实无此船，验收必须报告“Provider 无匹配”，不能制造结果，随后由用户决定第二搜索 Provider。

### B. Port 搜索和关注

`Shekou`、`CNSHK`、`蛇口` 解析到同一真实 Port；保存 UN/LOCODE、zh/en name、country、lat/lon/source identity；重启仍在；Weather/AIS Area 按 capability 自动启用，拥堵无覆盖时明确 unavailable。

### C. Feed

默认当前资讯没有数年前旧新闻；7/14 天、official validity、unknown/future date 规则有自动测试；旧数据只在 history 查询。

### D. Calendar

新进程启动立即显示 SQLite 缓存，不需点击同步；后台自动维护当前年 + 下一年；失败保留 last-known。

### E. Voyage

`mock-schedule` 在 Real Mode/production 为零；Current Voyage 与 Commercial Schedule 页面/字段明确分离；没有 carrier access 时显示暂无真实班期。

### F. Restart Persistence

在进程 A 修改 settings、vessel/port watch、calendar、voyage tracking 后正常退出；进程 B 使用同一 DB 启动，逐项一致；测试直接使用 native SQLite，不使用 FakeRepository。

### G. Real Mode Failure

断开每一个 Provider 后分别验证：只显示该 Provider 的 real last-known stale/degraded；无历史则空；任何页面/HOT/Events 都没有 Mock。

### H. 中文 UI

所有固定 UI/状态/字段标签默认中文；技术品牌和标准标识按规则保留。

### I. 翻译

英文 Feed/公告自动生成中文标题和摘要并持久化；原文可展开；重启/刷新不重复计费；翻译失败显示原文且采集成功。

### J. HOT 追溯

每条 HOT detail 能展示：HOT → Event → Evidence → Provider → source URL/API → sourceUpdatedAt/fetchedAt；任何 Mock/test evidence 导致 Real Evidence Gate 拒绝。

## 24. 配置与密钥管理

建议新增/统一：

```env
NODE_ENV=development
SHIPPING_DATA_MODE=real
SHIPPING_DATABASE_PATH=.data/shipping-hot-v3.sqlite3

SHIPPING_VESSEL_SEARCH_PROVIDER=vesselapi
VESSELAPI_API_KEY=

SHIPPING_VESSEL_PROVIDER=aisstream
AISSTREAM_API_KEY=

SHIPPING_PORT_PROVIDER=portcast
SHIPPING_WEATHER_PROVIDER=open-meteo
SHIPPING_WEATHER_ALERT_PROVIDER=public
SHIPPING_FEED_PROVIDER=public

SHIPPING_CALENDAR_PROVIDER=calendarific
CALENDARIFIC_API_KEY=

SHIPPING_TRANSLATION_PROVIDER=azure
AZURE_TRANSLATOR_KEY=
AZURE_TRANSLATOR_REGION=
```

- `.env.local` 保存本机 secret；`.env.server` 保存非 secret durable config；process env 优先级最高。
- `example.env.server` 只留空 key 和注释，不放真实值。
- API/日志/provider_runtime 只显示 configured boolean，不输出 key。
- real/production 缺少必需 key 时该 Provider 为 `misconfigured`，不改 mode、不回退 Mock。
- 新 Provider key 命名使用实际品牌，避免含糊的 `VESSEL_SEARCH_API_KEY` 无法支持未来并存/迁移。

## 25. 待用户确认的选型

实施前需要确认：

1. 是否接受 VesselAPI 为 P2 Vessel/Port API 和 P5 Current Voyage Provider；先 Free PoC，验证 DONG FANG FU/Shekou 后再决定 Basic $14.99/月。
2. 是否接受 UNECE UN/LOCODE 本地同步目录作为 Port 搜索的免费权威基础，VesselAPI 负责 enrichment。
3. 是否接受固定 Node 24 LTS 单一工具链，并创建 side-by-side V3 SQLite，而不是继续兼容 Node 20/22/24。
4. V2 Mock watchlist 是否按 IMO/MMSI/UNLOCODE 重新解析后迁移；推荐 exact match 才迁移，未解析项不进入 Real Mode。
5. P5 是否按“Current Voyage 先行，Commercial Schedule 需 Carrier entitlement 后再做”；首批需要哪几家 Carrier，是否已有 portal/API 账号。
6. 是否接受 Azure Translator F0 为默认；如果用户已经有 OpenAI/Google/DeepL 账号，是否改用已有 Provider。
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
9. **生产 Nitro subroute 已知故障**：`docs/status.md` 记录 production subroutes 存在 `#nitro/index` package-import error；V3 P0 的 restart/production smoke 必须先把它纳入 gate，否则本地 dev 成功不能代表可交付运行。
10. **没有 migration runner**：当前 startup 只有一次 ad-hoc nullable rebuild，不足以安全承载 V3 拆表和回滚。

## 27. 实施门槛与文档后续

本文批准后，应先新增 ADR，至少覆盖：

- V3 real-only runtime、SQLite fail-closed/read-only 行为和 Node 24 LTS。
- VesselAPI/UNLOCODE/Azure Translator 的 Provider 边界、成本和 key。
- Current Voyage 与 DCSA Commercial Schedule 的事实分层。

之后从 P0 开始，严格执行项目 Closeout：Implementation → Verification → typecheck → lint → test → build → Neat Freak Closeout → Status Update → Completion Report。不得从本文直接跳到 P2 搜索或 P5 Schedule。

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
- Azure：[Translator pricing](https://azure.microsoft.com/en-us/pricing/details/translator/)
- Google Cloud：[Translation pricing](https://cloud.google.com/translate/pricing)
- DeepL：[API pricing](https://www.deepl.com/en/pro-api)
- OpenAI：[API pricing](https://developers.openai.com/api/docs/pricing)
