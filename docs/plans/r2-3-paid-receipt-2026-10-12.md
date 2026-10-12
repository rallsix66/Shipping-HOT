# R2-3 paid_receipt 离线切片（2026-10-12）

依据：dots 2026-10-12 16:58（ts 1791795482.294249）。分支 codex/shipping-hot-r2（PR #8）。这一轮只做离线实现和测试：没有真实凭据，不发付费请求，不接 R3 自动抽取，也不改生产绑定和开关。

## 1. 来源与移植范围
- 上游：AIHOT@`44578fa` 的 `packages/backend/src/providers/receipts.ts`（216 行），以及 `tests/receipts.test.ts`、迁移 0001 `receipts` / 0022 `receipt_attempts` / 0033。这些都在计划 §5.3 A 表内。
- 放在 `server/intel/llm/receipts.ts`，文件头写明 `Adapted from AIHOT@44578fa`。MIT 许可证放在 `third_party/aihot/LICENSE`（加 README 说明）。
- 上游 `lib/ids.ts` 只取 `sha256` / `stableJson` 两个函数，内联进 receipts.ts，没有引入 cuid2。

## 2. SQLite 适配（与上游的差异）

| 上游 | 本项目 |
| --- | --- |
| Postgres，`pg_advisory_xact_lock` + `FOR UPDATE` | 用 `BEGIN IMMEDIATE` 事务做同一幂等键的原子认领；同一进程内的 db0 单连接再用一个串行队列，避免嵌套事务 |
| `budgets` 表（每分钟、小时、天的请求数） | **不建预算表**。复用现有预算判定：从 translation-settings 里抽出 `server/services/paid-budget.ts` 的 `decidePaidBudget`，翻译也改为调用它，行为不变。月度支出 = provider_usage.estimated_cost + 仍处于 pending 的尝试的预估费用 |
| 环境变量 API key | 现有 `SecretStore.get(providerId)`；没配就不调用（paid_secret_missing） |
| 只有一个 `cost` 字段加 `cost_basis` | 拆成 `estimated_cost` 和 `actual_cost` 两列。只有 provider 回执给出 basis=actual 且是有限数值时，才写 actual_cost。DB 的 CHECK 约束保证 actual_cost 非空当且仅当 cost_basis IS 'actual' |
| admin/runs.ts 在 30 分钟后自动释放 unknown | **没有移植**。unknown 永不自动重发，需要人工处理（见 §5） |

## 3. 状态机
- pending → received → completed；pending → failed（ProviderRejectedError：服务商明确不受理、不计费，可以重试，记为新的尝试）；pending → unknown（发出后超时、连接中断、进程崩溃）。
- received / completed 状态的回执直接复用，不再检查预算，也不读取凭据。
- 遇到 pending：10 分钟内返回 busy；超过 10 分钟标为 unknown。unknown 一律抛出 ReceiptUnknownError，不再调用。
- 重启时：显式独占启动步骤 `markPendingReceiptsUnknownAtExclusiveStartup` 把所有 pending 标为 unknown；不调用这一步时，`markStalePendingReceipts` 或认领时的 10 分钟判定也一样不会重发。
- provider_usage：成功按估算计费并记录 token；ProviderRejected 记 failed、费用 0；unknown 记 failed，并保守地按估算计费（可能已经被收费）。

## 4. 迁移 024
`paid_receipt`（logical_key UNIQUE）和 `paid_receipt_attempt`（UNIQUE(receipt_id, attempt)），只追加，schema 版本 24。

## 5. 未覆盖项
- 真实 provider 接入：没有实现 llm.ts / chatJson，也没有接入任何调用方；R3 自动抽取未接入。
- 生产绑定和开关没有变化；registry 接线和 GET 端点仍未完成。
- 没有 unknown 回执的人工释放接口或 UI（上游的 admin 自动释放也没有移植）。
- 预算按估算判定：provider_usage 只有 estimated_cost 一列，实际费用只保存在回执上，没有和预算对账。
- 上游按每分钟、小时、天限流请求数，这里没有移植（按 dots 要求不另建预算体系）；只做月度金额判定。
- 跨进程只验证了“同一数据库文件上的两条连接”。在单进程内，测试由进程内串行队列加 BEGIN IMMEDIATE 共同保证；真正多进程并发下的 SQLITE_BUSY 重试策略没有验证。
- 计划 §5.3 里的 embeddings.ts、llm.ts、prompts.ts 等不在本切片内。
- 之前的缺口照旧：历史回放 1/10 属未完成验证（用户已推迟），PAGASA、促销缺口。
