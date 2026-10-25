# 洁癖收尾

| 事实面 | 状态 | 依据 |
| --- | --- | --- |
| 代码 | changed-and-verified | 只增加 JMA 列表 404 与显式 issue 偏移的回归。本轮隔离门禁：定向 `pnpm exec vitest run -c vitest.config.ts server/providers/jma-tropical-cyclone.test.ts server/services/jma-target-tc-strict.test.ts` EXIT 0（10 passed / 2 files）；全量 `pnpm exec vitest run -c vitest.config.ts` EXIT 0（2017 passed / 5 skipped / 159 files）；`pnpm build` EXIT 0 → `pnpm typecheck` EXIT 0；`pnpm lint` EXIT 0；`git diff --check HEAD` EXIT 0。日志：`.tmp/r2-4-gapfill-20261025/gates/`。解析行为未改，生产允许名单未扩。 |
| 运行态 | verified-current | 本轮对五源六入口共 6 次传输尝试（上限 12；跳转跟随 0；重试 0；详情/PDF 0）。其中 MY-P02/MY-P03/XX-W01/MY-L01 各取得 HTTP 正文；PH-P01 两个入口均止于 TLS `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，无 HTTP 状态与正文。不暗示六次全部取得正文。24 小时观察工作树、进程和数据库未切换。 |
| 文档 | changed-and-verified | 矩阵分子仍 28/39、资讯 25/34。XX-W01 为 PARTIAL，PH-P01 为 BLOCKED。closeout/mapping/文案按本轮门禁与真实时间修正。 |
| 规则 | verified-current | 未改 AGENTS.md。28/39 与 25/34 仍然成立。 |
| 记忆 | not-applicable | 本轮没有获准改写的代理记忆。 |
| 工作区 | pending | 原件和捕获脚本留在新工作树 `.tmp`。不删除，不并入正在运行的 r2-compat。 |

发布：分支待推送。未合并，未部署，未改 `codex/shipping-hot-r2`。
