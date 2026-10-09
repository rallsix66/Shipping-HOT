# R1-1 ripgrep exception proposal (PR #5)

**Status:** **PROPOSED — not confirmed.** Until a maintainer accepts this list, the adjusted mechanical scan must **not** be recorded as the original **R1-1 PASS** (zero disallowed matches in `src/` + `server/` without carve-outs).

## Baseline command (unchanged)

```text
rg -i "aisstream|vesselapi|gfw|voyage|watchlist" src server --glob "!server/database/migrations/**"
```

## Always allowed (no proposal needed)

| Location | Reason |
| --- | --- |
| `server/database/migrations/**` | Excluded by glob; historical schema only |
| `docs/archive/vessel-capability-recovery.md` | Recovery documentation (not runtime) |

## Proposed minimal allowlist (tight, line-scoped)

Only these **files** and **purposes** — not whole-repo wildcards:

| File | Matching lines (2026-10-09) | Purpose |
| --- | --- | --- |
| `server/middleware/retired-spa-routes.ts` | Path literals `/voyages`, `/voyages/` | R1-4: HTTP **404** for retired SPA URLs (route names only) |
| `server/middleware/retired-spa-routes.test.ts` | `"/voyages"`, `"/voyages/example-id"` | Assert 404 middleware for retired URLs |
| `server/shipping-store.read-only.test.ts` | `not.toHaveProperty("voyages")` | Reverse contract: port-only snapshot has no voyage collection |

**Not allowed under this proposal:** Provider names, Runtime job names, business APIs, scripts/e2e harness copy, migration table renames (`_retired_*`, `voyage_eta_history` in `scripts/r1-migration-copy-test.ts`), or any restored AIS/vessel/voyage **entry points**.

## Current scan result (with proposal applied)

- **`src/`:** zero matches (rg exit 1) — satisfies original R1-1 intent for product UI.
- **`server/`:** only the three rows above — no Provider/Runtime/business code.

Mechanical enforcement: `test/r1-retired-surface.contract.test.ts` (allowlist = this table only).

## Decision requested

Confirm, narrow, or reject the three-file allowlist. Until then:

- **R1-1 (strict original):** **BLOCKED** on `server/` substring matches.
- **R1-1 (proposed carve-out):** implemented in tests/docs only; **not PASS**.
