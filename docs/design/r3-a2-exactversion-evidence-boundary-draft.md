# Draft: R3-A2 ExactVersion 送模证据边界

- Status: **Draft for review**（非 Accepted ADR；推荐设计已落地只读核验接口；**可信生产证据接入/颁发仍未完成**）
- Date: 2026-11-02
- Evidence: `docs/evidence/r3-a2-evidence-boundary-20261102/`（方案）+ `docs/evidence/r3-a2-failclosed-verifier-20261102/`（核验接口实现；含 `rc-tighten/`）
- Relates: ADR-007（付费 LLM 边界）、ADR-010（本地 manual clip）、`model-payload-gate.ts`、`exact-version-evidence-verifier.ts`

## Intent

定义「何时可以核验 ExactVersion 送模证据」的边界，使核验层默认拒绝，且**不**把现有 ClipAudit / persistence / 空 `evidenceId` 升级为 `permitted: true`，也**不**由核验接口构造/返回可直接送入既有 `admitModelPayload` 的 license。

## Implemented (read-only verifier)

- `tryVerifyExactVersionEvidence` + `createFixtureTrustedEvidenceSource` in `server/intel/llm/exact-version-evidence-verifier.ts`
- Fail-closed；无可信证据源/记录 → BLOCKED
- 复用 `admitModelPayload` **仅**做 clip 硬拒（private / unknown / unverified **不放宽**）；**成功路径不构造/不返回** `ExactVersionModelLicense`
- 精确 item/version/hash、证据身份、严格日历+时区有效期/撤销、指定模型服务、步骤（`prefilter`/`extract`/`severity`/`severity_tiebreak`）
- 内容范围：`requested` ≤ `evidence.allowedContentScope ∩ stored persistence`；缺 persistence → `material_scope_unverified`；`disallowed` / `excerpt_only` 只能收窄，永不因 full-text evidence 整体放行；存储永不产生许可
- **不**写授权记录；**不**开 HTTP/UI/cron；**不**接 Provider；夹具成功 ≠ 生产有权；核验结果 ≠ 新创建授权 / 可消费 license
- 文档声明：**只读核验接口已实现；可信生产证据接入/颁发仍未完成**

## RC tighten (dots 1793611831.715999)

1. 成功仅返回 `evidenceRef` + `productionAuthorized:false` + `licenseIssued:false`；正向测试断言结果不可用于既有送模 gate。
2. `validFrom` / `validUntil` / `revokedAt` 走 `parseStrictInstant`（真实日历 + 显式时区）；非法/溢出/无时区/非法时区/now 异常 → BLOCKED；显式 `null` 开放期限语义保留。
3. 只读绑定当前素材 `persistence`；缺失不可读 → BLOCKED；与证据范围取窄。

## Normative distinctions

1. Storage/read persistence ≠ model-send permission（存储只可收窄）。
2. Unverified user declaration ≠ verified rights.
3. User consent to transmit ≠ legal right to permit use of the material.
4. Public readability / catalog inclusion ≠ license.
5. Fixture verify success / evidenceRef ≠ production grant / consumable ExactVersionModelLicense.
6. Purpose covering only prefilter/extract ≠ permission for severity / severity_tiebreak.

## Default deny（本片保留现有 clip 硬拒）

Issuer/verifier and `admitModelPayload` must deny: private_material; rights unknown; unverified declaration-only（**硬拒，不预留「更高证据」绕过**）; storage-only evidence; version/hash mismatch; revoked or out-of-scope purpose/provider/step; missing evidence record; purpose scope that fails to cover the requested chain step; material persistence missing/unreadable; disallowed/excerpt_only when request exceeds narrowed ceiling; malformed/overflow/unknown-zone time fields.

Real chain purposes: `prefilter` / `extract` / `severity` / `severity_tiebreak`. Embeddings, training, and secondary sharing are **not** auto-included.

## Non-goals

No parallel ACL product; no HTTP open grant; no auto-grant; no merge/deploy in this slice; no R4; no inventing bypass of current clip hard deny; no production issuer wiring yet; no returning a gate-consumable license from verify; no loosening old gate to keep a license return.
