# R1-1 ripgrep exception (PR #5)

**Status:** **APPROVED** (2026-10-09). User confirmed the five-line minimal allowlist at commit **`8d6cba2`** — **three files only**, fixed line numbers and **full line bodies**. **No** whole-file exemption and **no** automatic expansion beyond this table.

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

## Approved allowlist — exact path + full line (no `includes`, no whole-file)

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

## R1-1 acceptance record (not “original zero-hit”)

- **Original criterion** (zero hits in `src/` + `server/` without carve-out): **not claimed** — `server/` has five approved lines only.
- **Approved criterion:** baseline scan + **`src/` strict rule** + every other hit must match **exactly one** approved row; Vitest **9/9** on `test/r1-retired-surface.contract.test.ts` at **`8d6cba2`** (re-run on closeout: **9/9**, 2026-10-09).
