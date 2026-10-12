# R2-3 paid_receipt 离线切片（2026-10-12）

依据：dots 2026-10-12 16:58（ts 1791795482.294249）。分支 codex/shipping-hot-r2（PR #8）。这一轮只做离线实现和测试：没有真实凭据，不发付费请求，不接 R3 自动抽取，也不改生产绑定和开关。

## 1. 来源与移植范围
- 上游：AIHOT@`44578fa` 的 `packages/backend/src/providers/receipts.ts`（216 行，在计划 §5.3 A 表内）和 `tests/receipts.test.ts`。数据表参照上游的状态表（迁移 0001 `receipts` / 0022 `receipt_attempts` / 0033），按已批准的 SQLite 迁移范围适配（这三个上游迁移不是 §5.3 A 表逐项列出的文件）。
- 放在 `server/intel/llm/receipts.ts`，文件头写明 `Adapted from AIHOT@44578fa`。MIT 许可证放在 `third_party/aihot/LICENSE`（加 README 说明）。
- 上游 `lib/ids.ts` 只取 `sha256` / `stableJson` 两个函数，内联进 receipts.ts，没有引入 cuid2。

## 2. SQLite 适配（与上游的差异）

| 上游 | 本项目 |
| --- | --- |
| Postgres，`pg_advisory_xact_lock` + `FOR UPDATE` | 用 `BEGIN IMMEDIATE` 事务做同一幂等键的原子认领；同一进程内的 db0 单连接再用一个串行队列，避免嵌套事务 |
| `budgets` 表（每分钟、小时、天的请求数） | **不建预算表**。复用现有预算判定：从 translation-settings 里抽出 `server/services/paid-budget.ts` 的 `decidePaidBudget`，翻译也改为调用它，行为不变。这是**预估预算门禁**，不是实际收费的硬上限。月度支出 = provider_usage.estimated_cost + 尚未记入用量的尝试的预留（pending，以及迁移 025 之前留下、usage_recorded=0 的 unknown） |
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
- 预算门禁按估算判定（预估预算门禁），不是实际收费的硬上限：provider_usage 只有 estimated_cost 一列，实际费用只保存在回执上，没有和预算对账（按计划留到后续）。
- 上游按每分钟、小时、天限流请求数，这里没有移植（按 dots 要求不另建预算体系）；只做月度金额判定。
- 并发认领只验证了**同进程双连接**（同一数据库文件上的两条连接，加上进程内串行队列和 BEGIN IMMEDIATE）。真正多进程并发下的 SQLITE_BUSY 重试策略没有验证。
- 计划 §5.3 里的 embeddings.ts、llm.ts、prompts.ts 等不在本切片内。
- 之前的缺口照旧：历史回放 1/10 属未完成验证（用户已推迟），PAGASA、促销缺口。

## 6. 复审返修（dots 2026-10-12 17:06，ts 1791796000.929179）

1. **unknown 恢复不再释放预算**：迁移 025 给 paid_receipt_attempt 增加 `usage_recorded`。四条路径都通过同一个 `closeAttempt`：捕获的超时或连接中断、认领时发现过期、批量清理 `markStalePendingReceipts`、独占启动恢复。它在同一个 BEGIN IMMEDIATE 事务里把 pending 改成 unknown，并按估算把这次尝试记入 provider_usage。只有仍处于 pending 且 usage_recorded=0 的尝试才会被处理，所以对每个尝试是幂等的：重复恢复不会重复记账。
   - 迟到的结果：回执改为 received、可以复用，实际费用照常写入；但已经入账的估算不再记第二次，尝试的 estimated_cost 也保持入账时的数值。
   - 迁移 025 的回填是保守的：received/failed 记为 1；遗留的 unknown 保持 0，继续占预留，宁可偏紧也不释放。
2. **费用校验**：请求预估必须是有限且非负的数值，否则在认领和发送之前抛出 PaidCostError（paid_invalid_estimate）。返回的费用必须有限、非负，且币种等于预算币种，才会被采用；否则保留请求预估、不写 actual，并在 error 字段记录 "returned cost rejected"。回执的 currency 一律使用预算币种。零费用是合法的。
3. 测试：receipts.test.ts 共 24 项，新增 8 项：三条恢复路径各一项（含重复恢复、另一个 key 的 0.6 仍被拦住）、迟到结果、超时后再恢复只记一次、非法请求预估、非法返回费用（负数、NaN、Infinity、币种不一致；账本不会减少、预算不会解锁）、零费用正例。
