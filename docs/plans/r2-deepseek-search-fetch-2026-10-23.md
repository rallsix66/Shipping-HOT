# R2 DeepSeek Search/Fetch 增强自动情报采集（方案，待审）

- 日期：2026-10-23（Asia/Shanghai）
- 状态：**Proposed / 待审** — **仅方案与文档**；审核通过后才进入「默认关闭实现 + 离线测试」；再往后才是获预算后的小规模实测与单独启用决策
- 授权依据：dots 线程 `1791602463.207089`，指令 ts `1792724533.820219`（用户同意方向：**先改方案交审**）
- 分支：`codex/shipping-hot-r2`；基线 `36b5b7e3ce9254aad0609a7c0e72b53174f0914c`
- 决策草案：[`docs/adr/ADR-011-deepseek-search-fetch-intel-assist.md`](../adr/ADR-011-deepseek-search-fetch-intel-assist.md)（Proposed）
- 相关已接受：ADR-007（LLM/付费边界）、ADR-008（外部信源）、`docs/plans/shipping-hot-risk-intelligence-2026-09-29.md`、`docs/intel-source-catalog.md`
- 官方只读依据（**本轮未调用付费 API、未配置真实密钥**）：
  - [网页搜索与抓取指南](https://api-docs.deepseek.com/zh-cn/guides/search/)
  - [Search API](https://api-docs.deepseek.com/zh-cn/api/search/)
  - [Fetch API](https://api-docs.deepseek.com/zh-cn/api/fetch/)

## 0. 中文可读摘要

用户同意用 DeepSeek 的 **Search / Fetch** 增强 Shipping HOT 的**自动情报采集辅助**，但必须先改方案交审。本方案把二者定位为：

1. **Search**：优先补**来源发现**、**官方栏目迁移/失效后的替代入口**、**临时公告/突发公开通知**的候选线索；结果只进入**候选审核**，不自动注册、不自动启用、不抬升 R2 分子、不生成确认事件。
2. **Fetch**：可选的**第三方内容获取适配器**，返回 title + Markdown；**绝不**冒充本机 `secureFetchArticle` 完成的 HTML/`rawBody`、DNS/公网 IP 绑定与跳转检查。

稳定 RSS/天气预警链路**不绕经** DeepSeek；不做聊天助手；**不替代**现有 `intel` 采集器与 Feed/天气 Provider。计费是**按次**（各 5 元 / 1000 次「HTTP 200 且有结果」），与现有翻译的 **token 估算费用**不同；不得把「Harness/Claude Code/Codex 里工具调用 2026-11-01 起收费」误当作本产品自行集成的免费授权。

**本轮交付只有文档。** 审核通过前：不写产品代码、不启源、不调付费 API、不碰真实密钥、不合并不部署。

## 1. 目标与非目标（对应复审 7 点）

| # | 必须做到 | 明确不做 |
| --- | --- | --- |
| 1 | Search 服务发现/栏目迁移/临时公告候选；稳定 RSS/天气不经 DeepSeek；无聊天；不替代原采集器；候选审核闸门 | 自动 `registeredIntelSources` 写入、自动 allow-select、自动 R2-4/5 计数、自动确认事件 |
| 2 | Fetch 标明第三方 Markdown 溯源；与本机 transport 证据分离；不能用远程 Fetch 绕开既有安全拒绝 | 把 Markdown 当 HTML/`rawBody`；伪造本机 DNS/IP/跳转已通过 |
| 3 | 保留许可与日期角色；分数≠事实置信度；搜索日期≠已核实 `publishedAt`；`disallowed` 不因 Markdown 自动全文入库或送模型；页面内指令不可信不执行 | 用 `rerank_score`/`authority` 当确认依据；静默扩大 persistence |
| 4 | 复用 Provider/SecretStore/`provider_usage`/预算决策骨架/缓存思路/唯一 `BackgroundRuntime`；**先承认仓库尚无 Search/Fetch 预算与 capability**，再定义独立按次计数与硬预算 | 假称已有 Search/Fetch 预算；第二套调度；把搜索记成模型 token |
| 5 | 只发允许的公开 query/URL；无登录态、签名私链、内网、用户隐私；不发非必要 `localization` IP；Key 仅服务端 | 方案/日志/测试夹具含真实密钥或密钥值 |
| 6 | 最小文件与数据结构清单；是否迁移/ADR；离线合 → 预算后小规模实测 → 单独启用 | 初次实测重复已有历史回放；无预算硬开 live |
| 7 | R2-4 **28/39**、R2-5 **25/34** 不变；生产允许选择 19 项已实现 ≠ 实际启用；CN-T01/XX-M01 阶段门槛保持 | 本授权内做 R3、24h、合并、部署、扩 allow-select |

## 2. 官方能力与计费（只读摘录，实现以官方文档为准）

### 2.1 端点与鉴权

- Base：`https://api.deepseek.com`
- Search：`POST /v1/tools/search`；Fetch：`POST /v1/tools/fetch`
- 与现有 Chat 相同 Bearer（`Authorization: Bearer <API Key>`）+ `Content-Type: application/json`
- 仓库现状：`FileSecretStore` 已将 `deepseek` 映射 `DEEPSEEK_API_KEY`（翻译用）；**本方案复用同一 Secret 身份，但 capability / 预算 / usage 窗口必须与 `translation` 分离**

### 2.2 Search 请求/响应（实现约束）

- 必填 `query`（1–128 Unicode，非全空白）；可选 `count`（1–50，默认 10）、`ori_question`、`localization`、`need_content`
- **本产品默认**：`need_content=false`（候选审核用 title/url/snippet/summary/date 足够）；**不发送 `localization`**（避免无必要上传本机/出口 IP）
- 结果字段含 `rerank_score`（0–3）、`authority`（-1–4）、`date`（UTC RFC3339 或 null）等 —— 一律当**第三方排序/标签**，见 §7
- 空 `results` = 搜索结束无匹配（官方：不计费）

### 2.3 Fetch 请求/响应

- 必填 `url`（≤8192，含 host 的 HTTP/HTTPS，**不得带用户名密码**）
- 成功仅公开：`title` + Markdown `content`
- 错误中 403 = 安全策略拒绝；404 = 无可用内容；429 = QPS；402 = 余额不足 —— 映射到现有 `ProviderError` 族时保持 fail-closed，**不得**回退到「当成本机抓取成功」

### 2.4 计费与限速（产品预算必须对齐）

| API | 计费 | 账号 QPS（官方） |
| --- | --- | --- |
| Search | 5 元 / 1000 次「HTTP 200 **且** `results` 非空」 | 100 |
| Fetch | 5 元 / 1000 次「HTTP 200 **且** 有正文」 | 25（另有目标域名 QPS） |

- **按请求次数**，不按 token、不按返回条数；`count` 不影响单价
- 失败 / 无结果 / 超时：**不计费**（官方说明）—— 产品侧仍应计入 `request_count`/`failure_count` 以便审计，但**硬预算只扣「可计费成功」**
- **不得**把 DeepSeek Harness 等产品内工具调用「11/1 起收费」解释为本仓库自行集成的免费额度

## 3. 仓库现况核对（诚实边界）

| 能力 | 现状 | 本方案结论 |
| --- | --- | --- |
| DeepSeek Chat 翻译 | `server/providers/translation/deepseek-provider.ts`；capability=`translation`；token 定价与 `estimatedCost` | **保留不动**；Search/Fetch **不**走 chat/completions |
| SecretStore | `deepseek` → `DEEPSEEK_API_KEY` | 复用同一 providerId；不新增第二套密钥文件格式（除非后续另批） |
| `provider_usage` | 按 `providerId+capability+window` 聚合；含 `request_count` / tokens / `estimatedCost` | **可复用表**；Search/Fetch 用**新 capability 字符串**与**按次成本字段语义**（见 §6），**不能**把一次 Search 记成模型 token |
| `decidePaidBudget` / `paid_receipt` | 面向 **estimatedCost（货币）** 的 LLM 闸门 | **骨架可复用**（未配置/0/耗尽 → 不发请求）；**必须新增按次预算输入**（元/月或次数/月），**假称「已有 Search/Fetch 预算支持」不成立** |
| 本机安全抓取 | `secureFetchArticle`：每跳 DNS/公网 IP、禁私网、禁降级、限重定向与字节 | Fetch **不能**声称完成了这些检查 |
| 情报采集 | `server/intel/collect.ts` + registry seeds + `BackgroundRuntime` intel-collect | Search/Fetch **旁路辅助**；默认不挂入 collect 主路径 |
| 生产允许选择 | 19 catalogId 已实现，总开关默认关；阶段排除 CN-T01/XX-M01 | **不变**；Search 候选 ≠ allow-select |

## 4. 架构接点与最小变更清单（审核通过后的实现预告）

> 下列为**拟议最小集**，供审；**本轮不实施**。

### 4.1 拟议文件（新增为主，少改现有）

| 路径 | 作用 |
| --- | --- |
| `server/providers/deepseek/search-fetch.ts`（名可微调） | 纯 HTTP 客户端：Search/Fetch 请求构造、响应校验、错误映射；注入 `fetcher`；**零**业务入库 |
| `server/services/deepseek-search-fetch-budget.ts` | 按次硬预算决策（未配置/0/耗尽）；与 `paid-budget.ts` 并列或薄封装，**不**把次数换成假 token |
| `server/intel/discovery/*.ts` | 候选规范化、去重键、审核状态机（discovered → reviewed → rejected/accepted_for_catalog_review） |
| `server/runtime/intel-discovery-job.ts`（可选） | **仅当**显式启用时挂到现有 `BackgroundRuntime`；默认不注册或 `enabled:false` |
| `server/database/migrations/0xx-intel-discovery-search-fetch.ts` | **若**持久化候选/Fetch 溯源需要新表（见 §5）；无表则本项取消 |
| 定向测试 `*.test.ts` | 离线夹具；见 §8 |

**刻意不改（首实装）**：`secureFetchArticle` 核心安全语义、现有 RSS/web_list/json_list 解析器、天气 Provider、翻译 Job、生产 allow-select 19 项清单、CN-T01/XX-M01 排除。

### 4.2 复用理由 vs 新增理由

- **复用**：唯一 Runtime、SecretStore、`provider_usage` 行模型、`PaidGateError` 风格的「未配置则不发请求」、现有 fail-closed ProviderError 映射习惯、中文 Settings「密钥已配置」红acted 元数据模式。
- **新增**：Search/Fetch 端点与 schema 校验、**按次**计费窗口、候选审核实体、Fetch **第三方 Markdown 溯源**字段、与本机 `rawBody` hash 并列的 `convertedContentHash`。
- **不新增**：第二 PostgreSQL、第二调度框架、聊天 UI、自动注册管道、无头浏览器。

## 5. 数据结构（逻辑；迁移与否）

### 5.1 候选审核（Search）

逻辑字段（表名待实现时定，例如 `intel_discovery_candidate`）：

- `id`、`query`、`searchedAt`
- `url`、`title`、`snippet`、`summary`（可选存）
- `providerDate`（官方 `date`，可 null）— **角色：搜索侧标注时间，非已核实发布时间**
- `rerankScore`、`authority` — **角色：排序标签，非事实置信度**
- `status`: `pending_review` | `rejected` | `promoted_to_catalog_review`（后者仍只是人工目录流程入口，**不是**自动注册）
- `dedupeKey`: 规范化 URL（或 URL+title）哈希
- `usageReceiptId` / `providerUsageWindow` 指针（审计）

**禁止**：候选写入 `intel_source` / 修改 `PRODUCTION_ALLOW_SELECT_CATALOG_IDS` / 修改 R2 分子分母。

### 5.2 Fetch 溯源（第三方适配器）

每次成功 Fetch 必须可区分：

| 字段 | 含义 |
| --- | --- |
| `originalUrl` | 请求的目标 URL（规范化后） |
| `requestedAt` / `receivedAt` | 本服务发出/收到 DeepSeek 响应的时间 |
| `converter` | 固定如 `deepseek_tools_fetch` |
| `convertedTitle` / `convertedMarkdown` | 第三方转换结果 |
| `convertedContentHash` | Markdown（或规范化字节）哈希 |
| `originResponseHash` | **未知**（DeepSeek 不返回原 HTTP 正文）— **如实记 null/unknown，不得伪造** |
| `localFetchEvidence` | **无** — 明确：本次**没有**本机 DNS/IP/跳转证据 |

存储形态：优先独立 `intel_fetch_third_party`（或 version 上的 `contentScope=third_party_markdown` + 元数据），**禁止**写入现有「本机 raw 成功」路径的 `rawBody` 列语义。

### 5.3 是否需要迁移 / ADR

- **ADR**：本片提出 **ADR-011（Proposed）**；接受前不得实装。
- **迁移**：若候选/Fetch 溯源要进 SQLite → **需要**后续独立批准的加法迁移（预计 schema 在现有 intel 迁移之后）。若首切片仅进程内/临时 `.tmp` 夹具 → 可无迁移，但**不得**声称生产可审计。
- **不**为 Search/Fetch 新建第二套 `budgets` 表；预算配置可先落在 Settings JSON 扩展字段（与 translation.monthlyBudget 并列的 `searchFetch` 段），具体键名实装时再定且 fail-closed 默认 0/未配置。

## 6. 预算、计数、缓存、并发与失败关闭

### 6.1 Capability 与计数（拟议）

- `providerId`: `deepseek`
- `capability`: `deepseek_search` 与 `deepseek_fetch`（**两个**独立窗口，对齐官方分别 QPS/计费）
- 每次尝试：`request_count += 1`
- HTTP 200 且（Search `results.length>0` / Fetch content 非空）：`success_count += 1`，并按 **0.005 元/次** 累加到该 capability 的月度 `estimatedCost`（或并行 `billableSuccessCount` 字段——实装二选一，**文档层要求：审计能还原「可计费成功次数」**）
- 空结果成功响应：可记调用完成但 **billable=0**（与官方不计费对齐）；测试必须覆盖

### 6.2 硬预算（默认不发请求）

- `monthlyBudgetCny`（或等价次数上限）**未配置 / ≤0** → 与现网翻译闸门一致：**零外部请求**
- 耗尽 → 失败关闭，返回明确 gate code（如 `paid_budget_exhausted` / `search_fetch_budget_exhausted`），**不**静默改走本机抓取冒充
- 翻译 token 预算与 Search/Fetch 按次预算 **分开计数**；禁止互相「借额度」

### 6.3 重试 / 超时 / 大小 / 去重 / 缓存 / 并发 / 取消

| 项 | 拟议默认（实装可调，但需测） |
| --- | --- |
| 超时 | 与翻译同量级或更严（建议 ≤20s）；可取消 `AbortSignal` |
| 重试 | 仅 408/429/5xx 有限次（≤2）+ 抖动；**402/401/403/400/404 不重试**（对齐官方） |
| 响应大小 | 客户端硬上限（建议 Markdown ≤ 512KiB–1MiB 可读截断并记 `truncated`，超限 fail-closed） |
| 去重 | Search：同一 `dedupeKey` 在 TTL 内不重复付费拉取；Fetch：同 URL+内容策略 TTL 缓存，命中记 `cacheHitCount` **且不发请求** |
| 并发 | 进程内小信号量（Search/Fetch 分开）；远低于官方 QPS |
| 默认开关 | 环境/Settings **默认关**；关则 Job 不注册或 enabled=false，代码路径单测证明零 HTTP |

## 7. 安全、许可与日期角色

1. **出口内容**：仅允许公开 query 模板与已在审核名单内的公开 URL；拒绝 `localhost`/私网/metadata、带 userinfo 的 URL、明显签名私链与登录态 Cookie/Authorization（本客户端不附加这些头）。
2. **不发送** `localization`（除非未来单独授权且说明隐私影响）。
3. **页面/Markdown 内指令**：一律当数据；禁止执行、禁止改变工具/预算/密钥。
4. **许可**：`persistence=disallowed` 来源即使 Fetch 成功 → 最多 metadata/第三方 Markdown 审计存证（若该切片允许），**不得**自动升为 `full`/`excerpt_only`，**不得**自动送翻译/LLM 步骤。
5. **日期**：`providerDate` ≠ `publishedAt`；入库 `publishedAt` 仍须走现有解析/证据规则；未知保持 null。
6. **分数**：`rerank_score`/`authority` 可展示为「搜索侧标签」，UI/API 不得渲染成「已确认/高置信事实」而无 provenance。
7. **绕过禁止**：本机 `secureFetchArticle` 已拒绝的目标，**不得**改道 DeepSeek Fetch 当作「已安全获取」；若产品允许「仅第三方 Markdown 预览」，必须单独开关且证据类型为 `third_party_markdown`。

## 8. 离线测试清单（审核通过后的实现门禁预告）

全部注入假 HTTP，**零**实网、**零**真实密钥：

1. 开关默认关 → 零请求、零 usage 增量
2. 预算未配置/0 → PaidGate，零请求
3. Search 契约：合法 query；超长/空白拒绝；`need_content` 默认 false；不出现 `localization` 字段
4. Search 空 results → billable=0；非空 → billable 次数 +1，成本按次累加（非 token）
5. Fetch 仅 title+content；禁止写入 `rawBody` 本机语义；`originResponseHash` 为 unknown
6. 私网/userinfo URL 在**客户端**拒绝（不发到 DeepSeek）
7. 403/404/402 映射与不重试；429/5xx 有限重试
8. 缓存命中不二次付费；取消信号中止
9. 候选状态机：不能直接变成 registry seed / allow-select
10. `disallowed` + Fetch 成功仍不自动全文许可/不送模型
11. 源码卫语句：collect 主路径与天气 Job 不默认 import Search/Fetch 客户端
12. 回归：现有翻译 DeepSeek 与 intel-production 全量相关测试仍绿

## 9. 分阶段验收

| 阶段 | 内容 | 所需额外授权 |
| --- | --- | --- |
| A. 本轮 | 方案 + Proposed ADR + status | 无（文档） |
| B. 默认关闭实装 + 离线测 | §4–§8 | dots/用户审过本方案 |
| C. 小规模实测 | 对准**现有真实缺口**（例如栏目 404/迁址后的公开入口发现、临时港务公告检索），**不**重复已有历史回放语料 | 明确预算（建议先极小：如 Search ≤20 可计费次、Fetch ≤10）、允许使用现有 DeepSeek 密钥、允许出网、记录证据目录 |
| D. 启用 | Settings/环境正式打开 Job | **单独**决定；与 R3/24h/合并部署无关 |

R2 进度口径：**28/39、25/34 不因本方案或后续实装自动改变**。

## 10. 明确不在此次授权内

启源、付费 API 调用、真实密钥读写/输出、产品代码实装（本轮）、合并、部署、force-push、动主工作区/`wt-*`/Junction、扩生产允许选择、放宽 CN-T01/XX-M01、R3 事件合并、24h 连续跑、无头浏览器。
