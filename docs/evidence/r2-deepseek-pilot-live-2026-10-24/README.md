# DeepSeek Search/Fetch 受控试点 live 收尾（2026-10-24）

> **范围**：`pilotId = ds-pilot-2026-10-23-r1` 的 ledger / paid 双库 live 结果核对与代码离线收口。**不**启源、**不**合并部署、**不**释放 8 条 `unknown`、**不**扩大预算、**不**在本收尾轮追加真实 Search/Fetch。
>
> **本机现场**：`.tmp/deepseek-pilot-2026-10-23/`（ledger + paid + 辅助 PS1/TS + 局部 evidence JSON）**未**入库；本目录为项目内脱敏摘要与交叉引用。
>
> **官方错误语义**：[DeepSeek Search/Fetch errors](https://api-docs.deepseek.com/guides/search/#errors) — Fetch **HTTP 404** 表示上游无法从目标 URL 提取可计费 Markdown（站点策略、不支持的内容类型、空 markdown 等），**不是**缺少 `/v1/tools/fetch` 路由；非 200 / 空结果 **`billable: false`**。

## 基线与工作区

| 项 | 值 |
|---|---|
| 代码核对 HEAD（r2-compat worktree） | `68e133be008f822a979aea70ee56c52c15dbe74d`（收口提交前） |
| 目标分支 | `codex/shipping-hot-r2`（PR #8） |
| 产品 Search/Fetch | 仍 **默认关闭**；未写入生产 intel 启源 |
| 主仓未提交改动 | 主路径 `D:/try one/Shipping HOT` 上其它 R2 改动 **未** 纳入本提交 |

## Ledger 核对（只读，2026-10-24 收口时）

`pilot_attempt` 共 **12** 行（`pilot_id = ds-pilot-2026-10-23-r1`）：

| # | capability | operation_key | status | receipt_id（摘要） | 与 JSON 证据 |
|---|------------|---------------|--------|-------------------|--------------|
| 1–8 | deepseek_search | 首轮 8 条 PH/TH query 键 | **unknown** | null | 未改写；`error_code=DeepSeekToolsOutcomeUnknownError` |
| 9 | deepseek_search | `search:3fc560fdf5c1c88bbfbad2a9a826e646` | **succeeded** | `676978c3-52f4-4055-9e7d-a70f216bdba0` | ↔ `ninth-run-evidence.json` |
| 10 | deepseek_fetch | `fetch:d646eba2d9be14dbe7a090f790f90fe7` | **failed** | `7818f89d-f24d-4083-a101-048abd6f90d6` | ↔ `first-fetch-attempt-evidence.json`；paid `deepseek_tools_http_404` |
| 11 | deepseek_search | `search:623d1734d7db398bef928df98243d5f3` | **succeeded** | `94bb33fe-515c-4d0f-97bd-1b335830d742` | ↔ `mpa-followup-closeout.json`（**legacy** query-only ledger 键；HTTP 带 `need_content: true`） |
| 12 | deepseek_fetch | `fetch:eb9fa871aba2dcdf0069d91d3c67b602` | **failed** | `f5ce6d40-f6da-407f-a3fe-c76390f9ad0c` | ↔ `mpa-followup-closeout.json`；paid `deepseek_tools_http_404` |

**额度（per capability，非共享）**

| capability | attempts | reserved milli-CNY | cap |
|------------|----------|------------------|-----|
| deepseek_search | **10 / 10** | **50 / 50** | 满额；不得再 reserve |
| deepseek_fetch | **2 / 10** | **10 / 50** | 未用尽；**仍禁止**未授权重试同一 `operation_key` |

## 费用口径

- 单位：**5 milli-CNY（¥0.005）/ 次 attempt reserve**（与 `DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY` 对齐）。
- **Billable**：以 paid 层回执为准；Search 成功 9、11 为 billable；两次 Fetch 404 为 **non-billable**（仍占 attempt reserve）。
- 首轮 8× unknown：ledger 各 reserve 5 milli；paid 窗口 `paid_result_unknown` / `request_failed`（见 `ninth-run-evidence.json` 的 `providerUsageWindows`）；**不得**自动释放或重跑同一 operation_key。
- `actualCostCny` 在试点输出中多为 null / `costBasis=estimated`；不宣称发票级对账。

## Live 结果摘要（非正文存证）

### 第 9 次 Search

- Query：`MPA Singapore port marine circular advisory 2026`
- 上游 `upstreamResultCount=10`，latency ~381 ms，10 条候选（ledger `result_summary_json` 仅存 **trim 后** url/title/providerDate/titleUrlHash，无 snippet/content）。
- 候选 **titleUrlHash** 列表见本机 `ninth-run-evidence.json`（10 个 hash，无 URL 正文）。

### 第 10 次 Search（`need_content: true`）

- Query：`site:mpa.gov.sg port marine circular 2026`
- HTTP 请求体含 `need_content: true`（`createLiveOutbound({ searchNeedContent: true })`）。
- **不得**将 `need_content=true` 或 Search 返回的 snippet/content 字段写成「已取得可入库正文」或「站点许可」；仅证明 **发现层** 在官方 API 上返回了候选（含可能的 content 字段，未在本仓库持久化全文）。
- 收口后代码：`searchOperationKey(query, { needContent: true })` 与 query-only 键 **不同**；live 第 11 行仍落在 **legacy** 键 `623d1734…`（执行当时 ledger 键未含 need_content 后缀）。**禁止**在未授权下用新键重跑以为「复用」第 11 行。

### 两次 Fetch（`excerpt_only`）

| URL 目标 | operation_key | 结果 |
|---------|---------------|------|
| PMC 10/2026 detail | `fetch:d646eba2…` | failed，`ProviderRejectedError`，~6.7 s |
| PMC 03/2026 detail | `fetch:eb9fa871…` | failed，同上，~9.6 s |

- `persistence=excerpt_only` 仅为 **本地审核标签**，**不是** MPA 站点授权或官方通告效力证明。
- 两次失败符合官方 **404 = 无法提取 markdown** 语义；**未验证** MPA 是否对其它 URL 形态、PDF 附件或不同网络路径可抓。

## 候选去重与来源（离线，基于 ledger 摘要）

- 第 9 次与第 11 次 query 不同，operation_key 不同；**未**做跨次 URL 集合 diff（本目录不复制 URL 列表）。
- 同次 Search 候选以 `titleUrlHash` 存证；若上游重复 URL，hash 应相同（本轮 JSON 证据未报告 dup）。
- 第 11 次 query 含 `site:mpa.gov.sg`，预期候选 host 以 `mpa.gov.sg` 为主；**未**逐条人工核实是否全部为官方详情页。

## 缓存键 / operation_key / 幂等（代码合同）

| 层 | 键 material |
|----|-------------|
| **paid / `searchIdentity`** | `policyVersion` + 规范化 `query` + `count` + **`need_content`**（`search-fetch-service.ts`） |
| **pilot ledger** | `search:` / `fetch:` + SHA256 前缀；Search 在收口后含 **`need_content=1` 后缀**（当 `runPilot({ searchNeedContent: true })`） |
| **幂等** | `UNIQUE (pilot_id, capability, operation_key)`；同键 `duplicate_restored` **不再 HTTP** |

**禁止**通过改 `need_content` 或 query 大小写绕过 attempt 上限：不同键 = 新 reserve；Search 已满 10/10。

## 未验证 / 未授权

- 8 条 `unknown` 根因（首轮 burst vs 密钥/网络）**未**在本轮定论；见 `first-round-vs-oneshot-offline.json` hypotheses。
- Fetch 对 MPA **未**证明永久不可用；仅记录两次 detail URL 在 DeepSeek Tools 上 404。
- 生产 intel 启源、24h、R2 资格计数、合并 `main`、部署：**均未授权**。
- 用户侧独立复核：本 README 与 `docs/status.md` 同步块；本机 `.tmp/deepseek-pilot-2026-10-23/*.json` 为交叉核对源。

## 关联文件（仓库内）

- 方案 / ADR：`docs/plans/r2-deepseek-search-fetch-2026-10-23.md`，`docs/adr/ADR-011-deepseek-search-fetch-intel-assist.md`
- 脚本：`scripts/deepseek-search-fetch-pilot-lib.ts`，`scripts/deepseek-oneshot-*.ts` + 离线 Vitest
