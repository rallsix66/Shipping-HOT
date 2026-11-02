# A2 — ExactVersion 送模授权证据边界方案（交审，未实现产品）

- 日期：2026-11-02（Asia/Shanghai）
- 分支：`codex/shipping-hot-r3-1-llm-registry-20261027`
- 基线 tip（A1 已限定接受，保持）：`b507306fcae81828cc9446ac0b65b96a179fe0da`
- 性质：**文档 + 只读核查**；**不是** A2 产品接通；**不**把现有字段升级为 `permitted:true`
- 相关：ADR-007 / ADR-010；`server/intel/llm/model-payload-gate.ts`；`wiring-gaps.md` A2 行

## 本包文件

| 文件 | 内容 |
|---|---|
| [`evidence-boundary-proposal.md`](./evidence-boundary-proposal.md) | 现有证据为何不足；最小核验默认拒绝面；未来可信记录字段；最小实现方案与用户确认选项 |
| [`readonly-verification-notes.md`](./readonly-verification-notes.md) | 只读核查笔记（类型/字面量/无颁发器） |
| [`readonly-inventory.json`](./readonly-inventory.json) | 机械盘点结果（issuerHits=0） |
| [`r3-capability-and-blockers.md`](./r3-capability-and-blockers.md) | R3 已接受离线能力 + 剩余真实授权/样本/预算阻塞一览 |
| [`neat-closeout.md`](./neat-closeout.md) | Neat 收口 |
| [`gates.txt`](./gates.txt) | 门禁记录（docs-only） |
| 交叉引用草案 | [`docs/design/r3-a2-exactversion-evidence-boundary-draft.md`](../../design/r3-a2-exactversion-evidence-boundary-draft.md) |

## 非结论

- **未**实现 A2 颁发器 / HTTP / 定时 / 自动 grant
- **未** merge / deploy / force
- **未**把 `ClipAudit` / `source.persistence` / `evidenceId` 升级成送模许可
- 测试夹具 `licenseFor(...)` **不能**代表生产许可
- 不重开 R2、不混 continuous 11、不做 R4
