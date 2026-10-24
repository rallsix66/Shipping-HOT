# DeepSeek Search/Fetch 受控试点 live 收尾（2026-10-24）

> **范围**：`pilotId = ds-pilot-2026-10-23-r1` 的 ledger / paid 双库 live 结果核对与文档收口。**不**启源、**不**合并部署、**不**释放 8 条 `unknown`、**不**扩大预算、**不**追加真实 Search/Fetch。
>
> **本机现场**：`.tmp/deepseek-pilot-2026-10-23/`（ledger + paid + 辅助 PS1/TS + 局部 evidence JSON）**未**入库；本目录为项目内脱敏摘要与交叉引用。
>
> **试点状态**：默认关闭下的受控试点 **已收尾**；**不等于**生产 Search/Fetch 启用，也 **不等于** R2 整体验收通过。
>
> **官方错误参考**：[DeepSeek Search/Fetch errors](https://api-docs.deepseek.com/guides/search/#errors) — Fetch **HTTP 404** 在官方文档中归类为 **未取得可用页面内容** 的一类响应；本次两条目标 URL 的 paid 层记录为 `deepseek_tools_http_404`、**non-billable**。**本次记录未独立确定**具体失败原因（站点策略、内容类型、空 markdown、其它上游因素等）；**不得**推广为「整个 Fetch 接口不可用」或「路由缺失」等绝对结论。非 200 / 空结果在合同上 **`billable: false`**。

## 基线与工作区

| 项 | 值 |
|---|---|
| 文档收口预期基线 | `045467e79b448469719ab2583bab649fc8990079`（口径修正提交在其后时以该提交 SHA 为准） |
| 目标分支 | `codex/shipping-hot-r2`（PR #8） |
| 产品 Search/Fetch | 仍 **默认关闭**；未写入生产 intel 启源 |
| 主仓未提交改动 | 主路径 `D:/try one/Shipping HOT` 上其它 R2 改动 **未** 纳入试点文档提交 |

## Ledger 核对（只读，2026-10-24 收口时）

`pilot_attempt` 共 **12** 行（`pilot_id = ds-pilot-2026-10-23-r1`）。**账本行号 ≠ Search 调用次数**（中间穿插 Fetch 行）。

| 账本行 | capability | 对应试点事件 | operation_key | status | receipt_id（摘要） |
|--------|------------|--------------|---------------|--------|-------------------|
| 1–8 | deepseek_search | 首轮 8 次 Search | 8 个 PH/TH query 键 | **unknown** | null |
| 9 | deepseek_search | **Search 第 9 次** | `search:3fc560fdf5c1c88bbfbad2a9a826e646` | **succeeded** | `676978c3-52f4-4055-9e7d-a70f216bdba0` |
| 10 | deepseek_fetch | Fetch（PMC 10/2026 detail） | `fetch:d646eba2d9be14dbe7a090f790f90fe7` | **failed** | `7818f89d-f24d-4083-a101-048abd6f90d6` |
| 11 | deepseek_search | **Search 第 10 次**（HTTP `need_content: true`） | `search:623d1734d7db398bef928df98243d5f3` | **succeeded** | `94bb33fe-515c-4d0f-97bd-1b335830d742` |
| 12 | deepseek_fetch | Fetch（PMC 03/2026 detail） | `fetch:eb9fa871aba2dcdf0069d91d3c67b602` | **failed** | `f5ce6d40-f6da-407f-a3fe-c76390f9ad0c` |

JSON 交叉引用：`ninth-run-evidence.json`（Search 9）、`first-fetch-attempt-evidence.json`（Fetch PMC10）、`mpa-followup-closeout.json`（Search 10 + Fetch PMC03）。Search 第 10 次 ledger 行为 **legacy** query-only 键（执行当时未含 need_content 后缀）；见下文幂等说明。

**额度（per capability，非共享）**

| capability | attempts | reserved milli-CNY | cap |
|------------|----------|------------------|-----|
| deepseek_search | **10 / 10** | **50 / 50** | 已满；**不再**发起 Search |
| deepseek_fetch | **2 / 10** | **10 / 50** | 剩余额度 **不自动使用**；**仍禁止**未授权重试同一 `operation_key` |

## 费用口径

- 单位：**5 milli-CNY（¥0.005）/ 次 attempt reserve**（与 `DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY` 对齐）。
- **Billable**：以 paid 层回执为准；**Search 第 9、10 次**成功为 billable；两次 Fetch 404 为 **non-billable**（仍占 attempt reserve）。
- 首轮 8× **unknown**：ledger 各 reserve 5 milli（合计 **40 milli ≈ ¥0.04** 保守预留）；paid 窗口见 `ninth-run-evidence.json` 的 `providerUsageWindows`。**不**称为已确认扣费；**不得**自动释放或重跑同一 operation_key。
- `actualCostCny` 在试点输出中多为 null / `costBasis=estimated`；不宣称发票级对账。

## Live 结果摘要（非正文存证）

### Search 第 9 次

- Query：`MPA Singapore port marine circular advisory 2026`
- 上游 `upstreamResultCount=10`，latency ~381 ms；ledger 仅存 trim 后 url/title/providerDate/titleUrlHash，无 snippet/content 入库。
- 本机 `ninth-run-evidence.json` 存 10 个 **titleUrlHash**（非 URL 列表）。

### Search 第 10 次（`need_content: true`）

- Query：`site:mpa.gov.sg port marine circular 2026`；HTTP 请求体含 `need_content: true`。
- **`need_content=true` ≠** 已取得可入库正文；**≠** 站点许可。仅表示 API 请求形态；候选正文未在本仓库持久化。
- 两次 Search 各返回 **10 条上游结果计数**；**未核验**跨两次 Search 的去重 URL 数、有效独立情报条数或逐条来源；**不得**将 10+10 条返回结果直接写成 20 条独立情报。
- 收口后代码：`searchOperationKey(query, { needContent: true })` 与 query-only 键不同；live **账本第 11 行**（Search 第 10 次）仍落在 legacy 键 `623d1734…`。**禁止**在未授权下用新键重跑以为「复用」该行。

### 两次 Fetch（`excerpt_only`）

| 目标 | operation_key | 结果 |
|------|---------------|------|
| PMC 10/2026 detail | `fetch:d646eba2…` | failed，`ProviderRejectedError`，~6.7 s，paid `deepseek_tools_http_404` |
| PMC 03/2026 detail | `fetch:eb9fa871…` | failed，同上，~9.6 s |

- `persistence=excerpt_only` 仅为 **本地审核标签**，**不是** MPA 站点授权或官方通告效力证明。
- 仅记录 **这两个** URL 在本轮 DeepSeek Tools Fetch 上失败；其它 URL、形态或网络路径 **未验证**。

## 候选去重与来源

- **未核验**：跨 Search 第 9 次与第 10 次的 URL 去重数量、有效候选条数、逐条官方来源确认（本目录不复制 URL 列表，未做集合 diff）。
- **`titleUrlHash`** 同时依赖 **URL 与标题**（trim 后候选视图）；**不能**单凭 hash 相等推断 URL 重复，也不能代替 URL 级去重。
- 同次 Search 内 URL 级去重、host 分布、是否均为官方详情页：**未核验**。

## 缓存键 / operation_key / 幂等（代码合同，历史提交描述）

| 层 | 键 material |
|----|-------------|
| **paid / `searchIdentity`** | `policyVersion` + 规范化 `query` + `count` + **`need_content`**（`search-fetch-service.ts`） |
| **pilot ledger** | `search:` / `fetch:` + SHA256 前缀；Search 在 `searchNeedContent:true` 时可含 **`need_content=1` 后缀** |
| **幂等** | `UNIQUE (pilot_id, capability, operation_key)`；同键 `duplicate_restored` **不再 HTTP** |

**禁止**通过改 `need_content` 或 query 绕过 attempt 上限：不同键 = 新 reserve；Search 本轮已满 10/10。

## 未验证 / 未授权

- 8 条 `unknown` 根因 **未**定论；见 `first-round-vs-oneshot-offline.json` hypotheses。
- Fetch：**两条目标失败**；不推广为接口级不可用。
- 生产 intel 启源、24h、R2 资格计数、合并 `main`、部署：**均未授权**。
- 独立复核：本 README 与 `docs/status.md` 同步块；本机 `.tmp/deepseek-pilot-2026-10-23/*.json` 为交叉核对源。

## 关联文件（仓库内）

- 方案 / ADR：[`docs/plans/r2-deepseek-search-fetch-2026-10-23.md`](../../plans/r2-deepseek-search-fetch-2026-10-23.md)，[`docs/adr/ADR-011-deepseek-search-fetch-intel-assist.md`](../../adr/ADR-011-deepseek-search-fetch-intel-assist.md)
- 脚本（上一提交已入库）：`scripts/deepseek-search-fetch-pilot-lib.ts`，`scripts/deepseek-oneshot-*.ts`；全量 Vitest **1970 passed / 4 skipped** 为提交 `045467e…` 时历史结果，**非**本文档-only 修改后重跑。
