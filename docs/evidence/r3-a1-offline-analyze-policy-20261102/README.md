# A1 — 离线显式分析→政策编排（2026-11-02）

相对基线 tip `da2ea5a40658056c74a234e882b005bf1be3f206`（R3-6 隔离浏览专项限定接受）。

## 交付

- 新入口：`server/intel/llm/offline-analyze-policy.ts`
  - `runOfflineAnalyzeThenPolicy`（`enablePolicyAuto` **默认 false**）
  - `retryPolicyApplyFromExactRun`（政策写失败后不重付费分析）
  - `decidePolicyApplyAfterAnalyze`
  - 文档化 env `SHIPPING_OFFLINE_POLICY_AUTO_AFTER_ANALYZE`：** alone 不启用**
- 导出：`isPolicyAutoEventType`（`policy-auto.ts`）
- 单测：`offline-analyze-policy.test.ts`（假 Provider + 内存隔离 DB）
- **无** HTTP / cron / BackgroundRuntime / GET 触发
- **未**接通 ExactVersion 颁发器（**A2 未接通**）；仍仅注入可验证 ExactVersion license
- **生产仍未启用**

## 覆盖用例（11）

1. decide：默认关 / BLOCK / 非政策 / 精确成功可 apply
2. 默认关闭：分析可成功，policy 不调用、库无政策
3. 显式开启 + 政策 extract → created；重复运行 reuse 分析、不重打 Provider、不重复政策记录
4. 非政策 extract → 跳过落库
5. prefilter BLOCK → skipped_block，不落库
6. Provider 失败 → analyze 失败如实返回，不伪造整链完成，不落库
7. 缺文号 → needs_human_confirm，不静默发明
8. 政策写故障保留分析；`retryPolicyApplyFromExactRun` 零新 Provider hits 补落库
9. 错误 contentHash license → Provider 前拒绝
10. 无预算 → Provider 前拒绝
11. itemId 不匹配 ExactVersion → Provider 前拒绝（不宣称颁发器完成）

## 门禁

见 `gates.txt` / `typecheck.txt` / `lint.txt` / `build.txt` / `vitest-full.txt` / `vitest-a1.txt`。

## 非结论

- 未 merge / 未 deploy；未打扰用户；未发 Slack
- R3-5 **BLOCKED**；S7 **NOT_RUN**
- R3-6 口径不变：隔离浏览 global-fetch 外呼尝试为零（不推广任意 transport）
- 矩阵口径：**离线编排已接线，生产仍未启用**；A2 生产授权未接通

## RC（dots REQUEST CHANGES）

见子目录 [`rc-retry-success-gate/`](./rc-retry-success-gate/)：`retryPolicyApplyFromExactRun` 改为从持久分析行校验**完整成功终态**后才允许补落库；对照测覆盖 severity 失败/未完成 vs 成功分析+政策写失败重试。

见子目录 [`rc-unknown-retry-gate/`](./rc-unknown-retry-gate/)：`verifyPersistedExactRunAnalyzeSuccess` 按管线契约认可 **PASS|UNKNOWN** 完整成功链的零付费 retry（仍硬拒 BLOCK/失败/缺步）；对照含 UNKNOWN 写故障重试、空/错 runId、重复 retry 不增版本。
