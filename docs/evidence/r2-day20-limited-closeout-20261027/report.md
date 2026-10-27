# R2 day20 limited-scope closeout — 2026-10-27

- **dots ts**: `1793071443.735819`
- **prior offline reconcile**: `1793071080.923599`
- **written**: 2026-10-27 11:35 Asia/Shanghai
- **isolation**: branch `codex/shipping-hot-r2-4-gapfill-20261025` · worktree `.tmp/worktrees/r2-4-gapfill-20261025`
- **mode**: docs + desensitized evidence seal only; **no** product code change; **no** new 24h; **no** merge/deploy/force; **no** re-verify manual9; **no** S7 re-run
- **overallR2Pass**: **false** (unchanged; never disguised as true)

## 本次限定范围结论（≠ overallR2Pass）

**限定交付 accepted for independent review:**

1. **19-source day20 observe** (`day20-20261026a`, profile `24h-19`) natural end **ENDED_CLEAN** (ops)
2. **9 manual** limited capability already accepted (CN-P02 / VN-P01 / MY-P03 / MY-L01 / PH-P01 / PH-W01 / PH-W02 / XX-F01 / MY-P02) — not re-verified this closeout

**Not claimed:** full R2-8 / full P1 continuous-24h / overall R2 PASS.

### day20 ops facts (reuse; not re-run)

| Field | Value |
| --- | --- |
| start | 2026-10-26 10:58:16 Asia/Shanghai |
| end | 2026-10-27 10:58:21 Asia/Shanghai |
| finished event | seq **4830**, reason=`deadline`, at `2026-10-27T02:58:21.391Z` |
| lock | released |
| PIDs | gone |
| exitCode | **unknown** (not fabricated) |
| HTTP | requests **488** / completed **481** / failed **7** / reservations **488** |
| sources final | **19/19 ok** |
| continuous24hAcceptance | string retained: **`NOT_GRANTED; clock/sleep/network gaps require independent review`** |

### Ledger 572 = 571 + 1

- job_result Σ recordsWritten = **572**
- source_run Σ itemsNew = **571**, itemsRevised = **1**
- RO DB: intel_item=571 / intel_item_version=572 / intel_item_current_change=572
- Revision: seq **2318** `intel:id-w01` item `f6218730-eedd-49c1-bb88-b74bc279528f` (BMKG nowcast, 2 versions)
- Conclusion: **yes** — the 1-diff is itemsRevised=1

### Failures (all recovered)

7 fails all recovered: **VN-D01×6** + **CN-P01×1**. See `failure-recovery-table.json`.

### codeIdentity dirty (no exec impact)

- manifest head: `e41d3145b4276a0c02aab9f00d795476aefa1608`
- worktreeDirty: **true** (boolean only; path list not preserved at start)
- All 19 observe `codeFiles` git hash-object == HEAD blob → dirty does **not** indicate divergent observe execution code
- Secondary porcelain at reconcile: `M src/routeTree.gen.ts` (not in observe codeFiles)

## 原完整 R2 — 11 continuous acceptances deferred

Defer **ONLY** continuous-run acceptance. Keep auto direction + already-accepted single/offline evidence. Do **NOT** convert to manual. Do **NOT** mark full R2-8 pass. Numbers stay on existing ops chain.

| # | ID | Deferred item |
| ---: | --- | --- |
| 1 | CN-W01 | continuous-run acceptance |
| 2 | CN-W02 | continuous-run acceptance |
| 3 | CN-T01 | continuous-run acceptance |
| 4 | VN-W01 | continuous-run acceptance |
| 5 | MY-W01 | continuous-run acceptance |
| 6 | XX-M01 | continuous-run acceptance |
| 7 | ID-W02 | continuous-run acceptance |
| 8 | XX-W01 | continuous-run acceptance |
| 9 | XX-W02 | continuous-run acceptance |
| 10 | XX-A01 | continuous-run acceptance |
| 11 | XX-A02 | continuous-run acceptance |

## Journey counters (unchanged)

- R2-4 **32/39**
- R2-5 **26/34**
- numericFieldsSeparate **3/5** (historical limited; ProductionIntegrationRate=NOT_CLAIMED)
- **overallR2Pass=false**

## Sealed evidence (this directory)

Relative: `docs/evidence/r2-day20-limited-closeout-20261027/`

| File | Role |
| --- | --- |
| `result.desensitized.json` | observe result (desensitized) |
| `manifest.desensitized.json` | observe manifest (desensitized) |
| `finished-event-seq4830.json` / `.jsonl` | natural-end finished event |
| `19-source-final-summary.json` | per-source ok/fail/items |
| `failure-recovery-table.json` | 7 fails + recovery |
| `failed-fetch-runs.json` | failed fetch runs |
| `revision-source-run.json` | itemsRevised=1 proof |
| `reconcile-summary.json` | machine summary |
| `RECONCILE.md` | human reconcile |
| `SOURCE.md` | absolute local pack provenance |
| `limited-scope-conclusion.json` | structured split conclusion |

Local absolute pack (PC only; may not exist elsewhere):

`D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/`

## Constraints held

- No new sources / prod enable / merge / deploy / force
- No new 24h / restart day20 / delete locks / touch day19
- No re-verify accepted manual9 / no S7 re-run
- No flip of overallR2Pass
