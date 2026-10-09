# R1-1 ripgrep exception proposal (PR #5)

**Status:** **PROPOSED — not confirmed.** Maintainer acceptance is required before recording **R1-1 PASS**. Technical review passing the mechanical check is **not** user authorization.

## Baseline command (unchanged)

```text
rg -i "aisstream|vesselapi|gfw|voyage|watchlist" src server --glob "!server/database/migrations/**"
```

Vitest enforcement adds `-n` (line numbers) so allowlist rows are **exact path + line + full body**; pattern and globs are unchanged.

## Always excluded (glob / docs)

| Location | Reason |
| --- | --- |
| `server/database/migrations/**` | Glob exclude; historical schema |
| `docs/archive/vessel-capability-recovery.md` | Recovery doc (outside `src`/`server` scan) |

## Proposed allowlist — exact path + full line (no `includes`, no whole-file)

Mechanical enforcement: `test/r1-retired-surface.contract.test.ts` → `R1_1_PROPOSED_ALLOWED_HITS`.

| Relative path | Line | Full line body (must match exactly after trimEnd) |
| --- | ---: | --- |
| `server/middleware/retired-spa-routes.ts` | 7 | `    \|\| pathname === "/voyages"` |
| `server/middleware/retired-spa-routes.ts` | 8 | `    \|\| pathname.startsWith("/voyages/")` |
| `server/middleware/retired-spa-routes.test.ts` | 25 | `    "/voyages",` |
| `server/middleware/retired-spa-routes.test.ts` | 26 | `    "/voyages/example-id",` |
| `server/shipping-store.read-only.test.ts` | 126 | `    expect(result).not.toHaveProperty("voyages")` |

**Not allowlisted:** `/vessels` literals (no `voyage` keyword match), Provider env keys, Runtime job names, scripts/e2e, migration strings, or any extra text on the same line (e.g. `// aisstream`).

## `src/` strict rule (no allowlist)

- **Pass:** `rg … src` → **exit code 1** and **stdout empty** (stderr may contain diagnostics).
- **Fail:** exit **0** (matches found), **2+** (rg error), **127** (missing binary), or exit 1 with non-empty stdout.

## Current mechanical result (2026-10-09, branch `codex/shipping-hot-r1-retire-vessel`)

- **`src/`:** strict rule **PASS** in Vitest.
- **`src` + `server`:** all rg hits match the five rows above; counterexamples in tests reject same-file Provider keywords and partial-line matches.

## Decision requested

Confirm, narrow, or reject the five-line allowlist. Until then:

- **R1-1 (original zero-hit):** **BLOCKED** on `server/` keyword hits.
- **R1-1 (proposed carve-out):** mechanical check only; **not PASS**.
