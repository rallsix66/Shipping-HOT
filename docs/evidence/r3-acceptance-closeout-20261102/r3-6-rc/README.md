# R3-6 RC — provider-spy + per-page query waits

相对 `r3-6-strengthen/`（历史 50/50）的**补证**；不把 50/50 写成已满足本 RC 更强条件。

- `r3-6-browse-rc-e2e.txt` — 48/48 摘要
- `r3-6-browse-rc-evidence.json` — 负向 probe、spy 与账表分列、逐页 queryHits/ledger/spy 快照
- `r3-6-browse-rc-last-page.png` — 末页截图

要点：
1. `scripts/e2e-r3-6-provider-spy.mjs` 经 `--import` 仅在隔离子进程加载；独立记录/阻断非本地 `fetch`；`/probe` 负向自检后 `/reset`；账表 `provider_usage`/`paid_receipt` 另列。
2. CDP Network 逐页等待对应数据 API 完成（超时/4xx/失败即 FAIL），再断言内容或明确空态；不用 shell 当查询结果。
3. Chrome profile 位于本次 `RUN_DIR/chrome-profile`。
