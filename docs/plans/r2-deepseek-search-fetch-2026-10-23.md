# R2 DeepSeek Search/Fetch 增强自动情报采集（方案）

- 日期：2026-10-23（Asia/Shanghai）
- 状态：**Accepted-for-slice-1（合同已按 dots `1792725183.066059` 修正）** — 本阶段仅接受 **默认关闭 + 离线可测** 的最小接入；真实付费/凭证配置/启源/R3/24h/合并部署仍未授权
- 授权依据：dots 线程 `1791602463.207089`；方向认可基线 `a9ae16d`；本指令 ts `1792725183.066059`（方案三点修正后同一授权内实施第一片，不另等用户批准；不联系 Guyang）
- 分支：`codex/shipping-hot-r2`；基线 `a9ae16dfc1603e0670397de8234b47445157c720`
- 决策：[`docs/adr/ADR-011-deepseek-search-fetch-intel-assist.md`](../adr/ADR-011-deepseek-search-fetch-intel-assist.md)
- 既有边界：ADR-007（LLM/付费）、ADR-008（外部信源）、`docs/plans/shipping-hot-risk-intelligence-2026-09-29.md`、`docs/intel-source-catalog.md`
- 官方只读入口（**实现与测试不得调用付费 API、不得配置真实密钥**）：
  - [网页搜索与抓取指南](https://api-docs.deepseek.com/zh-cn/guides/search/)
  - [Search API](https://api-docs.deepseek.com/zh-cn/api/search/)
  - [Fetch API](https://api-docs.deepseek.com/zh-cn/api/fetch/)

## 0. 一页可读摘要

用 DeepSeek **Search / Fetch** 增强 Shipping HOT 的**自动情报采集辅助**：

1. **Search**：辅助发现**信源候选**、**官方栏目迁移/失效替代**、**临时公告/突发事件通知**的候选链接；产出只到**候选列表**；不自动注册、不自动启用、不抬高 R2 计数、不代替人工确认入库。
2. **Fetch**：对候选做**第三方网页内容获取与转换**（返回 title + Markdown），**不得**冒充本机 `secureFetchArticle` 完成的 HTML/`rawBody`、DNS/公网 IP 校验与跳转审计。

相对 RSS/目录预审主路**不替代** DeepSeek；计费与翻译**分离**（按次 5 元/1000 次·HTTP 200 且有有效非空结果；**与 token 结算分离**）。不把 Cursor/Harness/Claude Code/Codex 等工具调用、不把 2026-11-01 后计费、不把其它产品中间件的条款当本授权。

**本阶段已授权**：默认关闭、预算零、离线合成测试的最小接入（注入 HTTP client + 复用 `paid_receipt`/`provider_usage` 按次服务 + 候选裁剪 + 离线测试）。**仍未授权**：启源、真实 Secret 配置、付费外呼、R3/24h、合并部署、Settings UI、第二套调度、通用审核框架、持久候选表、改 version `contentScope`。

## 1. 目标与非目标（对应原授权 7 点）

| # | 目标摘要 | 明确不做 |
| --- | --- | --- |
| 1 | Search 辅助发现/栏目迁移/临时公告候选；相对 RSS/目录不替代 DeepSeek；不抬高原采集门槛；候选闸门 | 自动 `registeredIntelSources` 写入、自动 allow-select、自动 R2-4/5、自动确认入库 |
| 2 | Fetch 第三方 Markdown 为 provenance；与本机 transport 证据分离；不得用远程 Fetch 绕过本机安全拒绝 | 用 Markdown 当 HTML/`rawBody`；伪造本机 DNS/IP/跳转通过 |
| 3 | 不把第三方排序当主角色；不把第三方日期当已核实 `publishedAt`；**不**把 `third_party_markdown` 写成 `contentScope`；页面内指令不当作可执行 | 用 `rerank_score`/`authority` 做确认入库；默认抬 persistence |
| 4 | 复用 Provider/SecretStore/`provider_usage`/回执骨架/唯一 `BackgroundRuntime`；**先** Search/Fetch 独立 CNY 预留与 capability，再谈启用 | 挪用翻译 Search/Fetch 预算；第二套调度；与模型 token 混账 |
| 5 | 只发送必要的公开 query/URL；无登录态；标签隐私默认；无必要不传 `localization` IP；Key 不进仓 | 仓库/日志/测试夹具含真实密钥或密钥值 |
| 6 | 最小文件与数据结构清单；是否迁移/ADR；离线测 →（另授权）预算后小规模实测 → 单独启用 | 重复实现历史回执；未预算硬上 live |
| 7 | R2-4 **28/39**、R2-5 **25/34** 不变；允许选择 19 ≠ 实际启用；CN-T01/XX-M01 阶段门槛保持 | 本授权内 R3、24h、合并部署、抬高 allow-select |

## 2. 官方契约与计费（摘录；实现以官方文档为准）

### 2.1 端点与鉴权

- Base：`https://api.deepseek.com`
- Search：`POST /v1/tools/search`；Fetch：`POST /v1/tools/fetch`
- 与 Chat 相同 Bearer；`FileSecretStore` 已将 `deepseek` 映射 `DEEPSEEK_API_KEY`（若配置）
- **同一 Secret 条目，capability / 预算 / usage 必须与 `translation` 分开**

### 2.2 Search

- `query` 1–128 Unicode；可选 `count` 1–50（默认 10）；可选 `ori_question` / `localization` / `need_content`
- **产品默认** `need_content=false`；**默认不传 `localization`**
- `rerank_score` / `authority` / `date` 仅为第三方标签，非核实字段
- 空 `results` = 官方不计费

### 2.3 Fetch

- `url` ≤8192；host 须 HTTP/HTTPS；**不得带用户信息**
- 成功：`title` + Markdown `content`
- 403/404/429/402 等映射既有 `ProviderRejectedError` / fail-closed；**不得**因远端成功宣称本机抓取成功

### 2.4 计费（产品预留口径）

| API | 计费 | 账号 QPS（官方） |
| --- | --- | --- |
| Search | 5 元 / 1000 次 · HTTP 200 **且** `results` 非空 | 100 |
| Fetch | 5 元 / 1000 次 · HTTP 200 **且** `content` 非空 | 100 |

单位成本常量：`0.005` CNY / 可计费成功。空结果必须 `cost.amount = 0`（`basis: estimated`）写入回执用量。

## 3. 合同三点修正（相对 a9ae16d 方案，强制）

### 3.1 硬预算 = `paidRequest` 内原子预留（不能只靠 `decidePaidBudget`）

- **必须**复用 `server/intel/llm/receipts.ts` 已有骨架：`BEGIN IMMEDIATE` 占位、`pending` / `unknown`、`usage_recorded` 幂等、`monthSpend = usage + 未入账 pending/unknown`。
- `decidePaidBudget` **单独不足以**控制并发；并发争用最后一个额度时，只有拿到 IMMEDIATE 预留的一方可外呼。
- **发送后**的本机超时 / 取消 / 断线只能记 **`unknown`**：保留额度占用，**不当作**官方免费，**不自动重试**。
- **仅**明确未发送、或明确非计费结果（如 `ProviderRejectedError` 记账 0、空结果 cost=0）才释放/不占用。
- **每次重试**另受预算约束（新 attempt / 新预留），不得在 unknown 上静默重购。
- 已知成功非空按次结算，**与 token 分离**（capability `deepseek_search` / `deepseek_fetch`，currency `CNY`）。

### 3.2 `third_party_markdown` 是 provenance，不是 `contentScope`

- 保留现有 `full` / `excerpt_only` / `disallowed` **权限语义**，不把第三方 Markdown 塞进 version `contentScope`。
- **删除**「`disallowed` 仍可 Markdown 审计存证」例外。
- **缓存、`paid_receipt.response`、日志**均不得旁路存正文（无 snippet/summary/content/markdown 字段落库）。
- Search 候选（含首片）仅保留经裁剪的 **URL / title / 第三方日期标签 / 必要 hash**；snippet/summary/content **不默认持久化**。
- Fetch：**无正文持久化许可时不得写正文到任何存储**；首片回执只存 meta（长度与 hash）；进程内新鲜返回的 content 不得写入 receipt/cache/logs。

### 3.3 删除安全拒绝后的「单独开关预览」路径

- 已安全拒绝的目标：首片**直接排除**，无远程绕行、无预览开关。
- 目标审核与 persistence **分离**：`reviewFetchTarget` / `FetchTargetReview` 为句法闸（复用 `isBlockedAddress`，规范化括号与尾点）；**不**宣称能验证第三方实际 DNS/IP/跳转。persistence 许可不能代替目标安全审核；调用方已 `locally_rejected` 时即使 persistence=full 亦拒绝。
- **计费**：按上游有效非空结果次数结算（Search 以 `results.length` 为准），不以裁剪后 `candidates.length`；HTTP200 无效 JSON / 错误 schema → `unknown` 保留额度；仅明确有效空结果释放。query/count 等入参校验在 `paidRequest` 之前。
- **错误**：回执/日志只存固定错误码（如 `deepseek_tools_http_401`），禁止附响应正文或凭据。
- **时限**：默认 AbortSignal（约 25s）**主要约束 outbound HTTP** + 调用方取消下传；响应体流式字节上限；发送后超时/取消/超限且无法确认计费 → `unknown`。Secret/DB claim 仍按既有 `paidRequest`（先读密钥再原子预留），**不宣称**端到端总期限。未发送取消 → 固定非计费。
- **预算**：`deepseek_search` 与 `deepseek_fetch` **各自**月预算，不是共享总池。

- Search **请求缓存键** = 规范化 query ＋ 有效参数 ＋ 策略版本；**不能**用请求前还没有的结果 `dedupeKey`。候选 URL 去重是**另一层**（结果侧）。
- Fetch 按**审核 URL ＋ 许可/转换策略**隔离缓存（identity 含 `persistence` + `converter`）。

## 4. 仓库对照与第一片落地

| 既有 | 复用方式 |
| --- | --- |
| `paidRequest` / `paid_receipt` | 先读 Secret 再原子预留（既有语义）；logical_key = identity 哈希兼请求缓存 |
| `provider_usage` | capability 分列；CNY；空结果 0 成本 |
| `decidePaidBudget` | 仅闸门辅助；并发以 IMMEDIATE 为准 |
| `FileSecretStore` / `deepseek` | **默认关闭或预算≤0 时连 SecretStore 都不读** |
| `IntelPersistence` | Fetch 入口 fail-closed：`disallowed` 直接拒绝 |
| 本机 `secureFetchArticle` | **不**被 Fetch 替代或绕过 |

### 4.1 第一片文件（默认关闭、离线可测）

| 路径 | 职责 |
| --- | --- |
| `server/providers/deepseek/search-fetch-client.ts` | 注入 HTTP 的 Search/Fetch client；URL 语法闸；无 localization |
| `server/intel/discovery/deepseek-search-fetch-policy.ts` | capability / CNY / 单位成本 / 策略版本常量 |
| `server/intel/discovery/candidate-trim.ts` | 候选规范化与许可裁剪；泄漏探测辅助 |
| `server/intel/discovery/search-fetch-service.ts` | 按次调用服务；enabled/预算闸在 SecretStore 之前；复用 `paidRequest` |
| `*.test.ts`（client + service） | 离线合成覆盖见 §8 |

**不做（本片）**：Settings UI、第二套调度、通用审核框架、持久候选表、改 version scope、schema 迁移（本片确认可零迁移：回执存裁剪 DTO）。

## 5. 数据结构（首片）

### 5.1 Search 候选 DTO（内存 / 回执）

`{ url, title, providerDate, titleUrlHash }` — 无 snippet/summary/content。

### 5.2 Fetch meta DTO（回执）

`{ url, titleLength, contentByteLength, titleHash, convertedContentHash, provenance:"third_party_markdown", originResponseHash:null, localFetchEvidence:"none", empty }` — 无 title/content 正文；不冒充本机 raw/版本 hash。

### 5.3 迁移 / schema

- **本片不扩大 schema / Runtime 合同**：不新表、不加列。
- 若后续复用骨架确需新字段，先报最小加法 diff，不自选多套路径。

## 6. 预算、缓存、失败关闭

### 6.1 Capability

- `deepseek_search` / `deepseek_fetch`；provider `deepseek`；currency `CNY`；默认 `enabled=false`；预算默认未配置/0。

### 6.2 缓存

- Search：identity = `{ policyVersion, query, count, need_content }`（query 已规范化空白）。
- Fetch：identity = `{ policyVersion, url, persistence, converter }`。
- 命中 `received`/`completed` → 零外呼、零重复计费。

### 6.3 失败关闭

- 默认关闭 / 预算 0 / 缺密钥（仅在已启用且预算>0 之后才会读 Secret）→ 零外呼。
- URL 私网/userinfo、`persistence=disallowed`、本机已安全拒绝 → 零外呼。
- 发送后未知 → 占额度；不自动重试。

## 7. 安全与角色（摘要）

1. 第三方排序/日期非核实主证据。
2. Fetch 不冒充本机 transport 证据。
3. 页面/Markdown 内指令不可执行。
4. `disallowed`：**无** Markdown 存证例外；直接拒绝 Fetch。
5. 已安全拒绝目标：无远程预览绕行。
6. Key / Bearer / 正文不进回执与日志。

## 8. 离线测试必须覆盖

1. 最后一个额度并发争用（仅一方外呼）
2. 发送后未知不释放；重启不重购
3. 空结果零计费
4. 缓存命中零外呼
5. 回执/日志无正文或密钥
6. 默认关闭零外呼（且不读 SecretStore）
7. 许可/安全拒绝 fail-closed 零外呼
8. 取消/超时/超限路径不把 unknown 当免费
9. Fetch 最后额度并发；临时文件 SQLite 关闭再打开不重购
10. 两 capability 预算分离；错误正文/假 Bearer 不落库

全部用合成 HTTP；不读真实密钥、不调 API。

## 9. 分阶段

| 阶段 | 内容 | 授权 |
| --- | --- | --- |
| A. 合同修正（文档/ADR） | §3 三点 | 本指令 |
| B. 默认关闭实装 + 离线测 | §4–§8 | 本指令（同一授权） |
| C. 预算后小规模实测 | live | **另授权** |
| D. 启用决策 | Settings/启源 | **另授权** |

## 10. 明确不在此次授权内

启源、真实密钥写入、付费外呼、合并/部署/force、R3、24h、联系 Guyang、抬 R2 计数、改 CN-T01/XX-M01 门槛、主工作区 64 条修改、wt-s*/wt-diag/Junction、新依赖、启服务、碰现用 DB。

## 合同缺口修补 v1.2（2026-10-23）

1. Client transport 异常不透传：统一 `request_failed` / `response_read_failed` 等固定码，保持 unknown。
2. Fetch `targetReview.canonicalUrl` 必须与 `input.url` 规范化结果一致；不一致或伪造 approved 私网 → 零密钥/零回执/零 HTTP。
3. 预先取消：入口拒绝已取消；dispatch 前再检；未发送非计费，已发送才 unknown。
4. 合成 `Response`/`ReadableStream` 覆盖默认适配器流式字节上限（不只 `staticReadText`）。
5. 措辞：25s controller 主要约束 HTTP；不宣称端到端总期限或「先预留再读密钥」。
