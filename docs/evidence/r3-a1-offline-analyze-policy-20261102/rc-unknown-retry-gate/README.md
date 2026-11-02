# A1 RC — UNKNOWN 完整成功链可零付费 retry（2026-11-02）

相对 tip `901c7fc2c3882a4aecf1f8ce21c1d52dc9160a47`（A1 RC retry 完整成功终态；dots REQUEST CHANGES：合法 UNKNOWN 成功路径被误拒）。

## 修复

- `verifyPersistedExactRunAnalyzeSuccess`：按真实管线语义认可 **PASS 或 UNKNOWN** 后完整成功的链
  - 既有管线仅在 BLOCK 时停止；UNKNOWN 继续 extract / dual severity（必要时 tiebreak）
  - 仍硬拒：BLOCK、失败、缺步、必要第三轮未成功、非政策
- **只修** 这条语义差异；不重开已关闭的失败/空 runId 绕过等项

## 对照测试（真实流水线）

1. `UNKNOWN → 政策写故障 → retry 成功`：主入口 analyze.ok + prefilter UNKNOWN；policy 写失败；同 runId retry → created；**Provider hits 不增**
2. 空 / 错 runId：retry → rejected（`invalid_exact_identity` / `run_not_found`）；不 apply；hits 不变
3. 重复 retry：首次补落库后再次 retry → 版本数不增（versions.length=1）、policyId/versionId 不变；hits 不变
4. （保留）BLOCK / severity 失败 / 非政策：仍拒绝

## 如何本地复验

```bash
pnpm exec vitest run server/intel/llm/offline-analyze-policy.test.ts
```

关注用例名含 `contrast: UNKNOWN`、`empty/wrong runId`、`duplicate retry`。

## 门禁

见同目录 `gates.txt` 等。

## 非结论

- 未 merge / 未 deploy；未打扰用户；未发 Slack；未 resume shipping-hot-dots
- A2 未扩；R3-5 BLOCKED；S7 NOT_RUN
- 生产仍未启用
