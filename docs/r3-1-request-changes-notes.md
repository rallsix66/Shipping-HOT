# R3-1 REQUEST CHANGES notes (2026-10-27)

## Billing classification + translation test entrance (post 7920f1dd)

- **P1 billing**: unpaid reject only `auth_failed` / `entitlement_missing` / `provider_forbidden` / `rate_limited` → ProviderRejected / 0-cost. HTTP success + usage + wrapper/empty/protected validation fail → book usage/cost then `rejectReceivedResponse` (no free release). No usage on business fail → unknown (keep reservation). Reuses exported `hasExplicitTranslationWrapper` (full wrapper list).
- **P1 leak**: `POST /shipping/translation/test` → `runTranslationTest` → `executeTranslationViaPaidRequest` (paidRequest + sharedBudget). Diagnostic return shape kept; no dedicated Settings shared-pool field.
- **Tests**: fake HTTP200+tokens+bad output; registry-full → diagnostic zero-call; `Promise.all` start-barrier race for last unit; unknown exclusive-startup assert (three recovery shapes still owned by `receipts.test.ts`).
- Evidence: `.tmp/r3-1-llm-registry-20261027/request-changes-billing-test-validation/`.

## Shared LLM budget + translation path (prior tip 7920f1dd / 46a79db)

- **Wiring**: `translation-sync` calls `executeTranslationViaPaidRequest` -> `paidRequest` with `sharedBudget` from `resolveSharedLlmBudgetFromTranslation(translation.monthlyBudget, USD)`.
- **Gate**: when `PaidRequestContext.sharedBudget` is set, `checkBudget` runs `assertSharedLlmBudgetInTransaction` inside BEGIN IMMEDIATE (same receipt claim). Search/Fetch omit `sharedBudget` (ADR-011).
- **Ownership**: scope=`SHARED_LLM_BUDGET_CAPABILITIES`; currency=explicit ISO on gate+call (no FX); reservation=`paid_receipt` pending only; `aggregatePaidMonthSpend` stays a helper inside the claim.
- **Usage**: paidRequest books cost once; finalize uses characters-only patch (`request:false`, `estimatedCost:0`, `records:1`) -- no parallel ledger / no migration.
- **Proof**: `shared-budget-translation.test.ts` injects fake transports + isolated SQLite (contention / mixed currency / pending / once-bill / cache-reuse / GET zero-call).
- Evidence: `.tmp/r3-1-llm-registry-20261027/shared-budget-translation/`.

## Pending (honest, not claimed done)

1. **model-payload-gate pipeline**: `admitModelPayload` is skeleton only; **NOT WIRED** into prefilter/extract/runtime pipeline yet (unit tests cover the pure gate).
2. Real dual-vendor live models, R3-2~5 slices, production enablement -- out of scope.
3. Dedicated Settings field for shared LLM pool (currently reuses `translation.monthlyBudget` + USD); fake amounts only in isolation -- not user spend authorization.
4. Price-precision persistence round-trip assert still not separate (deferred until that test is next touched); 79 browser checks stay attributed to prior tip.

## Aggregate vs ADR-011

- `paidRequest` / `monthSpend` default remains **per provider_id x capability** (Search/Fetch independent).
- `aggregatePaidMonthSpend(db, { currency, capabilities?, providerIds? })` is an **optional scoped helper**; requires ISO currency; mixed/unknown currency in an explicit capability/provider domain fail-closed; does **not** replace capability gates. Shared pool attaches only when callers pass `sharedBudget`.

## Limited closeout (ts 1793086505.439649)
- Provider POST/PATCH secret writes go through `createProviderWithSecret` / `patchProviderWithSecret` (injectable SecretStore): env preflight before mutation; create snapshots prior secret state and restores it on failure (never unconditional delete of a pre-existing key) or `provider_secret_inconsistent`; patch writes secret before DB; never silent success on compensate failure.
- Binding upserts use in-process serialiser + in-txn snapshot returned after COMMIT; busy/nested-txn -> `binding_conflict` (409).

## Closeout3 save-boundary (ts 1793087899.608889)
- `compensateCreateFailure` no longer assumes originally both-absent: prior key presence/value is snapshotted before create; on secret-write failure the DB row is removed and a pre-existing orphan key is left/restored unchanged.
- Fake regression: `createProviderWithSecret: pre-existing orphan key survives write-before create failure`.
