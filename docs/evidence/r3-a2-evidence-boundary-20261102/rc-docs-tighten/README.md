# RC docs tighten — A2 证据边界（相对 3e420536）

- 日期：2026-11-02（Asia/Shanghai）
- Parent tip：`3e42053630d098d76e07dd36e415fedc665e39a8`
- dots REQUEST CHANGES：ts `1793609745.224419`
- 范围：**仅文档收紧**；草案保持 **Draft**；盘点「现有证据不足」**保留接受**
- **未**实施 A2 产品代码；**未**写入授权记录；**未**开 HTTP；**未** merge/deploy

## 三处收紧如何落地

### 1. §2 硬拒 vs「更高证据」措辞冲突 → 删除绕过预留

- **旧**：未核验声明「且无更高核验证据」才拒——暗示未来可用更高证据绕过现有硬拒。
- **新**：明确**保留当前** `admitModelPayload` 对 private / unverified 的硬拒；本片**不**预先设计更高证据绕过。
- 未认证 operator 勾选「有权+同意」写进 §1.4 禁止捷径：**仍是声明**，不得列成可信核验等价选项。

### 2. 用途清单覆盖真实链

- 写入真实 `IntelAnalysisStep`：`prefilter` / `extract` / `severity` / `severity_tiebreak`。
- 仅前两步的授权**不能**覆盖 severity / tiebreak；范围不足 → 拒对应步骤。
- embeddings / 训练 / 二次分享 **不**自动包含。

### 3. 取消 A–G 七组一次推问 → 推荐设计 + 单项下一步

- 默认拒绝、精确绑定、范围收窄、撤销检查等整理为 **§4 推荐设计**。
- 真实素材依据、指定服务、传输同意留给后续实际授权。
- 预算 / 密钥 / S7 继续既定边界，本包不展开问卷。
- **用户下一步压缩为一项**（写入文档供交审，执行器不问用户）：是否继续做零付费、无授权记录写入、无 HTTP 的 fail-closed **证据核验接口与夹具测试**（只验证提供的可信证据；不创造证据；不实际授权；不宣称生产颁发器接通）。**决定前不编码。**

## 变更文件

- `docs/design/r3-a2-exactversion-evidence-boundary-draft.md`
- `docs/evidence/r3-a2-evidence-boundary-20261102/evidence-boundary-proposal.md`
- `docs/evidence/r3-a2-evidence-boundary-20261102/README.md`
- `docs/evidence/r3-a2-evidence-boundary-20261102/r3-capability-and-blockers.md`
- `docs/evidence/r3-a2-evidence-boundary-20261102/gates.txt`
- `docs/evidence/r3-a2-evidence-boundary-20261102/neat-closeout.md`
- `docs/evidence/r3-a2-evidence-boundary-20261102/rc-docs-tighten/`（本说明）
- `docs/status.md`（A2 段）
- `docs/evidence/r3-acceptance-closeout-20261102/wiring-gaps.md`（A2 行措辞）
