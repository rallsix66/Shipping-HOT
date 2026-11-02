# Draft: R3-A2 ExactVersion 送模证据边界

- Status: **Draft for review**（非 Accepted ADR；方案通过前不实现产品；相对 `3e420536` RC 文档收紧）
- Date: 2026-11-02
- Evidence: `docs/evidence/r3-a2-evidence-boundary-20261102/`（含 `rc-docs-tighten/`）
- Relates: ADR-007（付费/LLM 边界）、ADR-010（本地 manual clip）、`model-payload-gate.ts`

## Intent

定义「何时可以构造 `ExactVersionModelLicense`」的证据边界，使未来核验层在获批后仍默认拒绝，且**不**把现有 ClipAudit / persistence / 空 `evidenceId` 升级为 `permitted: true`。

## Normative distinctions

1. Storage/read persistence ≠ model-send permission.
2. Unverified user declaration ≠ verified rights.（未认证「有权+同意」勾选仍是声明，非可信核验等价项。）
3. User consent to transmit ≠ legal right to permit use of the material.
4. Public readability / catalog inclusion ≠ license.
5. Test-constructed license ≠ production grant.
6. Purpose covering only prefilter/extract ≠ permission for severity / severity_tiebreak.

## Default deny（本片保留现有 clip 硬拒）

Issuer/verifier and `admitModelPayload` must deny: private_material; rights unknown; unverified declaration-only（**硬拒，不预留「更高证据」绕过**）; storage-only evidence; version/hash mismatch; revoked or out-of-scope purpose/provider/step; missing evidence record; purpose scope that fails to cover the requested chain step.

Real chain purposes that must be covered when authorizing send: `prefilter` / `extract` / `severity` / `severity_tiebreak`. Embeddings, training, and secondary sharing are **not** auto-included.

## Recommended design（摘要；不推 A–G 问卷）

Default deny + exact item/version/hash binding + content scope ≤ persistence + step-scoped purpose + revoke checks on query/admit. Real material basis, named service, and transmit consent belong to later actual authorization. Budget / keys / S7 stay established blockers.

## Single next user decision（文档记载；执行器不问用户）

Whether to proceed with a **zero-pay, no-auth-record-write, no-HTTP** fail-closed evidence **verification** interface + fixture tests that only validate provided trusted evidence — do not create evidence, do not actually authorize, do not claim production issuer wired. **No A2 coding until that decision.**

## Non-goals

No parallel ACL product; no HTTP open grant; no auto-grant; no merge/deploy in this draft; no R4; no inventing bypass of current clip hard deny.
