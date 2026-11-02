# Neat Freak closeout — R3-8 (2026-11-02)

## 洁癖收尾完成

**影响**：政策自动入库与 label 离线防御的现役说法集中到 status/AGENTS/evidence，避免下游把「schema v37 + offline auto」误读成 R3 全量通过或已部署。

**事实面**
- 代码：changed-and-verified（v37 policy_auto_* + PolicyAutoService + TikTok fixture page-diff + leave hash merge + mixed-run gate）
- 运行态：not-applicable（未合并未部署；仅本地 production build + CDP e2e）
- 文档：changed-and-verified（docs/status.md 置顶 R3-8；evidence README/gates）
- 规则：changed-and-verified（AGENTS.md 注明 R3-8 / schema v37）
- 记忆：out-of-scope（未写用户记忆）
- 工作区：pending 清场（保留 .tmp/r3-8-label-browser 与主脏树/R2/wt-s*/diag；不删）

**改动 / 新建**
- server/database/migrations/037-policy-auto.ts
- server/intel/policy-auto.ts + policy-page-diff.ts + fixtures + tests
- shared/label-leave-target.ts（含 mergeLeaveFromHref，补 TanStack blocker 丢 hash）
- label-service aiPrelabelHasSelectableRun 混合/NULL 拒绝
- docs/status.md / AGENTS.md / docs/evidence/r3-8-policy-auto-20261102/

**待你确认**
- 删除候选：无（未清 .tmp 浏览器目录；工作树外主脏树不动）

**遗留**
- R3-5 BLOCKED；S7 NOT_RUN；真实 200 集与费用未跑；禁止 R4；未发 Slack
