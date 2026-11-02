# Draft: R3-A2 ExactVersion 送模证据边界

- Status: **Draft for review**（非 Accepted ADR；方案通过前不实现产品）
- Date: 2026-11-02
- Evidence: `docs/evidence/r3-a2-evidence-boundary-20261102/`
- Relates: ADR-007（付费/LLM 边界）、ADR-010（本地 manual clip）、`model-payload-gate.ts`

## Intent

定义「何时可以构造 `ExactVersionModelLicense`」的证据边界，使 A2 窄颁发器在获批后仍默认拒绝，且**不**把现有 ClipAudit / persistence / 空 `evidenceId` 升级为 `permitted: true`。

## Normative distinctions

1. Storage/read persistence ≠ model-send permission.
2. Unverified user declaration ≠ verified rights.
3. User consent to transmit ≠ legal right to permit use of the material.
4. Public readability / catalog inclusion ≠ license.
5. Test-constructed license ≠ production grant.

## Default deny

Issuer and `admitModelPayload` must deny: private_material; rights unknown; unverified declaration-only; storage-only evidence; version/hash mismatch; revoked or out-of-scope purpose/provider; missing evidence record.

## Minimal future evidence record

Material identity (item/version/hash/source/url) + allowed model services & purpose + content scope ≤ persistence + rights basis + confirmer identity/time + revocation. `evidenceId` points at that record when implemented.

## Non-goals

No parallel ACL product; no HTTP open grant; no auto-grant; no merge/deploy in this draft; no R4.
