final_tip: 334ce8ec24c2a6cfb3fbb2469a9c1c18d738c262

# Neat closeout — R3-A2 rc-material-bind (2026-11-02 18:02:15 Asia/Shanghai)

## 影响
关闭「裸 persistence 枚举可把 excerpt_only 素材伪造成 full_text 核验成功」假阳性；门禁原始日志改为可核验 UTF-8 非空输出。

## 事实面
| 面 | 状态 |
|---|---|
| 代码 | changed-and-verified — TrustedMaterialSource 注入 + 身份交集；±14:01 拒绝；小数秒≤3 |
| 运行态 | not-applicable — 未 deploy；无 HTTP/生产证据源 |
| 文档 | changed-and-verified — design draft + evidence README 同步 |
| 规则 | out-of-scope — 未改 CLAUDE/AGENTS |
| 记忆 | out-of-scope — 本执行器不写用户记忆 |
| 工作区 | pending — 保留主脏树/R2/旧观察/wt-*；本片仅 worktree 提交 |

## 改动
- `server/intel/llm/exact-version-evidence-verifier.ts` — material source bind
- `server/intel/llm/exact-version-evidence-verifier.test.ts` — 26 夹具
- `docs/design/r3-a2-exactversion-evidence-boundary-draft.md`
- `docs/evidence/r3-a2-failclosed-verifier-20261102/` + `rc-material-bind/`

## 待你确认
- 清场候选：无（未删除 worktree/分支）
- merge/deploy：未批准，未做

## 遗留
- 可信生产证据接入/颁发仍未完成
- S7 NOT_RUN；R3-5 BLOCKED
- 复核现场保留；等待用户确认后才清场
