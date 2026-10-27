# R3-1 REQUEST CHANGES notes (2026-10-27)

## Pending (honest, not claimed done)

1. **Translation shared total budget**: translation executor still uses its own budget/executor path and is **not** wired through `aggregatePaidMonthSpend`. Do not claim "all LLM share one total budget" until connected without double-billing.
2. **model-payload-gate pipeline**: `admitModelPayload` is skeleton only; **NOT WIRED** into prefilter/extract/runtime pipeline yet (unit tests cover the pure gate).
3. Real dual-vendor live models, R3-2~5 slices, production enablement — out of scope.
4. Settings UI edit/delete/secret rotation: create + bind + mock test-connection are in-page; full edit/delete/secret management remains API-only (declared in UI copy).

## Aggregate vs ADR-011

- `paidRequest` / `monthSpend` restored to **per provider_id × capability** (Search/Fetch independent).
- `aggregatePaidMonthSpend(db, { currency, capabilities?, providerIds? })` is an **optional scoped helper**; requires ISO currency; mixed/unknown currency in an explicit capability/provider domain fail-closed; does **not** replace capability gates.
