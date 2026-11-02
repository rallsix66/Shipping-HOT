# A1 RC — retry 精确 run 完整成功终态校验（2026-11-02）

相对 tip `90de4afc7fe728671a3039dcf2f5bc55d781b688`（A1 初交付；dots REQUEST CHANGES：仅重试入口成功状态校验未闭环）。

## 修复

- `verifyPersistedExactRunAnalyzeSuccess`：从可信 `intel_analysis` 持久行验证精确 run 的完整成功终态
  - prefilter PASS（completed|reused）
  - extract completed|reused 且政策 eventType
  - dual severity（attempt 1+2）成功；分差 >1 时还须 `severity_tiebreak` 成功
  - 失败 / 未完成 / BLOCK / 非政策 → `ok:false`
- `retryPolicyApplyFromExactRun`：先跑上述校验；未通过则 `outcome:"rejected"` + `analyze_success_unverified:…`，**不**调用 `applyFromExactIntel`，零新 Provider
- **不**接受 caller 自报成功；**不**仅凭 extract 存在放行

## 对照测试（真实流水线）

1. `failOnHit=3`（severity-1 失败）：主入口 `analyze.ok=false`、不入库；同 runId retry → rejected；库仍无政策
2. `failOnHit=4`（severity-2 失败 / dual 未完成）：同上拒绝
3. BLOCK run：retry → `prefilter_blocked`
4. 非政策完整成功：retry → `event_type_not_policy`
5. （保留）政策写故障后 retry：仍可补落库且 chatHits 不变

## 如何本地复验对照测

```bash
pnpm exec vitest run server/intel/llm/offline-analyze-policy.test.ts
```

关注用例名含 `contrast:` 与既有 `policy write fault leaves analyze; retryPolicyApplyFromExactRun`。

## 门禁

见同目录 `gates.txt` 等。

## 非结论

- 未 merge / 未 deploy；未打扰用户；未发 Slack；未 resume shipping-hot-dots
- A2 未扩；R3-5 BLOCKED；S7 NOT_RUN
- 生产仍未启用
