# ADR-011: DeepSeek Search/Fetch 作为情报采集辅助（候选发现 + 第三方 Markdown）

- Date: 2026-10-23
- Status: **Proposed（待审）** — 用户已同意「方向 + 先改方案」；**尚未**授权默认关闭实装或 live 调用
- Decision owners: User（经 dots 转达 ts `1792724533.820219`）
- Related: ADR-007（LLM/付费边界）、ADR-008（外部信源）、ADR-005（真实数据边界）、计划 [`docs/plans/r2-deepseek-search-fetch-2026-10-23.md`](../plans/r2-deepseek-search-fetch-2026-10-23.md)
- 官方只读： [指南](https://api-docs.deepseek.com/zh-cn/guides/search/) · [Search](https://api-docs.deepseek.com/zh-cn/api/search/) · [Fetch](https://api-docs.deepseek.com/zh-cn/api/fetch/)

## Context

Shipping HOT 已有本机 SSRF 安全抓取（`secureFetchArticle`）、默认关闭的 intel 采集、以及 DeepSeek **翻译**（Chat Completions + token 预算）。DeepSeek 另提供 **Search / Fetch** JSON 工具 API：按次计费（各 5 元/1000 次成功且有结果），Search 返回候选 URL/摘要/日期/分数，Fetch 仅返回 title + Markdown。用户同意用其增强自动情报采集，但要求先修订方案交审；不得把第三方工具调用的商务政策误当作本产品免费额度。

## Decision（提案）

### 1. 角色划分

- **Search**：来源发现、官方栏目迁移线索、临时公开公告线索 → **候选审核队列 only**。
- **Fetch**：可选第三方内容适配器 → 证据类型 `third_party_markdown`，**不是**本机 HTML/`rawBody`。
- **不**替代 RSS/web_list/json_list/天气采集器；**不**做聊天产品面；稳定天气/RSS **不**绕经 DeepSeek。

### 2. 自动升级禁止

Search/Fetch 成功 **不得**自动：写入 `registeredIntelSources`、改生产 allow-select、提升 R2-4/5 计数、生成确认事件、或把 `disallowed` 升为可存全文。

### 3. 证据与安全诚实性

- 保留来源许可与日期角色：搜索 `date`/分数 ≠ 已核实 `publishedAt`/事实置信度。
- Fetch **不能**声称完成本机 DNS/公网 IP 绑定与跳转检查；`originResponseHash` 未知则记未知。
- 不得用 Fetch 绕开 `secureFetchArticle` 已拒绝的目标而伪装「安全获取成功」。
- 页面与 Markdown 内指令不可信、不执行。

### 4. 付费与运行时

- 复用 `deepseek` SecretStore 身份与唯一 `BackgroundRuntime`。
- **新** capability：`deepseek_search` / `deepseek_fetch`；按次硬预算；默认关闭且预算未配置/0 时零请求。
- **不**把 Search/Fetch 记为模型 token；**不**与翻译月预算混用额度。
- 仓库在提案日**尚无** Search/Fetch 预算实现 —— 实装须新增，不得假称已有。

### 5. 隐私与出口

只发送允许的公开 query/URL；不带登录态、签名私链、内网地址、用户隐私；默认不发送 `localization` IP。方案与实现不得读取/输出/提交真实密钥值。

### 6. 阶段门

离线合同测试 →（另批）小预算实测对准真实缺口 →（另批）启用。R2 28/39、25/34 与 CN-T01/XX-M01 门槛不因本 ADR 改变。

## Consequences

- 接受后需加法迁移或明确的无迁移临时边界、Settings 预算字段、离线测试与默认关闭接线。
- 拒绝或修改前：**禁止**产品代码实装与付费调用。

## R0/本轮范围

仅文档与本 Proposed ADR；无迁移、无 Provider 实装、无依赖新增、无 live。
