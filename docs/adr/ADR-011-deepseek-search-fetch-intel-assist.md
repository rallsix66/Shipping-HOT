# ADR-011: DeepSeek Search/Fetch 作为情报采集辅助（候选发现 + 第三方 Markdown provenance）

- Date: 2026-10-23
- Status: **Accepted-for-slice-1** — 合同三点已按 dots `1792725183.066059` 修正；本阶段仅接受默认关闭、离线可测最小接入。真实付费/凭证配置/启源/R3/24h/合并部署仍未授权。
- Decision owners: User（经 dots 转达；方向认可 `a9ae16d`；实施授权 ts `1792725183.066059`）
- Related: ADR-007；ADR-008；ADR-005；计划 [`docs/plans/r2-deepseek-search-fetch-2026-10-23.md`](../plans/r2-deepseek-search-fetch-2026-10-23.md)
- 官方只读：[指南](https://api-docs.deepseek.com/zh-cn/guides/search/) · [Search](https://api-docs.deepseek.com/zh-cn/api/search/) · [Fetch](https://api-docs.deepseek.com/zh-cn/api/fetch/)

## Context

Shipping HOT 已有本机 SSRF 安全抓取（`secureFetchArticle`）、默认关闭的 intel 采集，以及 DeepSeek **翻译**（Chat Completions + token 预算）。DeepSeek 另提供 **Search / Fetch** JSON 工具 API（按次计费，约 5 元/1000 次成功非空结果）。用户同意用其增强自动情报采集辅助，并要求先修正方案合同三点，再在同一授权内落地默认关闭离线第一片。

## Decision

### 1. 角色边界

- **Search**：信源发现 / 官方栏目迁移替代 / 临时公告 → **候选列表 only**。
- **Fetch**：候选第三方内容获取 → 证据类型为 **provenance `third_party_markdown`**，**不是** `contentScope`；**不得**替代 HTML/`rawBody`。
- **不**替代 RSS/web_list/json_list/目录采集主路；稳定目录/RSS **不**依赖 DeepSeek。

### 2. 自动化禁止

Search/Fetch 成功 **不得**自动写入 `registeredIntelSources`、抬高 allow-select、改写 R2-4/5 计数或确认入库；不得把 `disallowed` 抬成可抓全文。

### 3. 证据与安全（含合同修正）

- 不把第三方排序当主角色；`date`/摘要 ≠ 已核实 `publishedAt`/置信度。
- Fetch **不得**宣称完成本机 DNS/公网 IP 校验与跳转审计；`originResponseHash` 未知即未知。
- **删除**安全拒绝后的「单独开关预览」路径：已安全拒绝目标直接排除，无远程绕行。
- **删除**「`disallowed` 仍可 Markdown 审计存证」：无正文持久化许可则不得写入任何存储（含 cache / receipt / 日志）。
- 页面内 Markdown 与指令不可执行。

### 4. 付费与并发（含合同修正）

- 复用 `deepseek` SecretStore 条目与唯一 `BackgroundRuntime`。
- 独立 capability：`deepseek_search` / `deepseek_fetch`；独立 CNY 硬预算；默认关闭；预算未配置/0 时**不读 SecretStore、不外呼**。
- **硬预算发送前原子预留**：复用 `receipts.ts` 的 `BEGIN IMMEDIATE`、pending/unknown、`usage_recorded`；`decidePaidBudget`  alone 不足以控并发。
- 发送后超时/取消/断线 → `unknown`，保留占用，不当免费、不自动重试；仅明确未发送/明确非计费才释放；每次重试另受预算约束。
- 已知成功非空按次结算，与 token 分离。
- Search 缓存键 = 规范化 query + 有效参数 + 策略版本（不用结果 dedupeKey）；Fetch 缓存按审核 URL + 许可/转换策略隔离。

### 5. 隐私与密钥

只发送必要公开 query/URL；默认不传 `localization` IP；仓库/测试/日志不得出现真实密钥值。

### 6. 阶段门

合同修正 → 默认关闭离线实装与测试（本 ADR 本阶段接受）→（另授权）预算后实测 → 单独启用。R2 28/39、25/34 与 CN-T01/XX-M01 门槛不变。

## Consequences

- 首片可落地注入 client + 按次服务 + 裁剪模块 + 离线测试，零 schema 迁移（回执存裁剪 DTO）。
- 若未来确需扩大 schema/Runtime，先报最小加法 diff，不自选多套路径。
- 仍禁止：未授权 live 付费、启源、合并部署。

## R0 / 本阶段范围

文档合同修正 + 默认关闭离线实现与测试；无 live、无合并部署。
