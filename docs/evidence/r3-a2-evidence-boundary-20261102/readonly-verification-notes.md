# 只读核查笔记 — A2 证据边界（2026-11-02 Asia/Shanghai）

基线 tip：`b507306fcae81828cc9446ac0b65b96a179fe0da`
方法：源码阅读 + `.tmp/r3-a2-readonly-inventory.mjs` 机械盘点（产物 `readonly-inventory.json`）。**无** DB 写入、**无** HTTP、**无** 产品代码改动。

## 核查结论摘要

1. ClipAudit verification **仅有**未核验二态；无核验通过态。
2. `source.persistence` / `permittedContentScope` 只管存读范围。
3. `ExactVersionModelLicense.evidenceId` 无存储实现、无颁发函数（`issuerFunctionHits: []`）。
4. 送模最终闸 `admitModelPayload` 对 private / unknown / unverified / bare-true / mismatch **已默认拒绝**。
5. 因此：**没有可直接颁发送模许可的可信持久证据**；保持 BLOCKED；**不可**升级为 `permitted:true`。

## 关键代码锚点

| 锚点 | 观察 |
|---|---|
| `shared/manual-clip.ts` | `LegacyClipAudit.verification = user_declaration_unverified`；`PrivateClipAudit = manual_capture_unverified` + `private_material` + `rightsStatus: unknown` |
| `server/intel/manual-clip.ts` | 写入审计时固定上述 verification；新剪藏默认私有未核验 |
| `server/intel/manual-license.ts` | persistence 派生自未核验声明或 seed 精确 URL；`privateClipScopeFor` 声明「storage access, never a source license」 |
| `server/intel/content-license.ts` | persistence → contentScope；只收窄不放宽 |
| `server/intel/material-read.ts` | 「not an HTTP/model payload」；用 persistence 裁 blocks |
| `server/intel/llm/model-payload-gate.ts` | ExactVersion 接口 + deny codes；evidenceId 标注 future；无 issuer |
| `server/intel/llm/analyze-pipeline.ts` | 调用前强制 `modelUseLicense` + `admitModelPayload` |
| `server/intel/llm/*test.ts` | `licenseFor` 测试夹具构造 `permitted: true` |
| `docs/adr/ADR-010-local-manual-clip.md` | 产品授权 ≠ 版权许可；未核验标签；公开/自动采集不授予模型输入 |

## 机械盘点

见 [`readonly-inventory.json`](./readonly-inventory.json)：

- `issuerFunctionHits: []`
- `mayUpgradeToPermittedTrue: false`
- `a2IssuerWired: false`
- `withoutTrustedEvidenceKeep: "BLOCKED"`

## 与 dots 前置核查对齐

| 前置陈述 | 本包核实 |
|---|---|
| manual clip 审计均为未核验声明 | **确认**（仅两字面量） |
| source.persistence 仅授予存储范围 | **确认** |
| ExactVersion.evidenceId 仍是未来接口 | **确认**（可选字段 + 无 store/issuer） |
| 不要升级成 permitted:true | **本方案遵守** |
