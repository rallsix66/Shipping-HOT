# Neat closeout — R3-6 RC (2026-11-02)

| 事实面 | 状态 | 说明 |
|---|---|---|
| 代码 | changed-and-verified | `e2e-r3-6-browse-zero-pay.mjs` + 新 `e2e-r3-6-provider-spy.mjs`（测试拦截器） |
| 运行态 | verified-current | RC 48/48；spy 负向自检；浏览后 spy/账表全零；无外呼 |
| 文档 | changed-and-verified | inventory 本次已核验证据范围；README/gates/status；历史 strengthen/空库保留 |
| 规则 | verified-current | 未扩 S7；未执行 A1；未改产品语义 |
| 记忆 | out-of-scope | |
| 工作区 | verified-current | 保留主脏树/R2/wt-s*/diag/Junction；无破坏性清场；RUN_DIR 独立 |

清场：不删除已有证据或工作树。新 `.tmp/.../runs/*` 可留。
