# day20-20261026a offline evidence reconcile

- dots ts: `1793071080.923599`
- generated: 2026-10-27 11:26:22 Asia/Shanghai
- mode: **READ-ONLY** (no new 24h / no restart / no lock delete / overallR2Pass unchanged)
- exitCode: **unknown** (not fabricated)
- failed http retained: **7**

## 1. Desensitized evidence pack paths

- `D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/19-source-final-summary.json`
- `D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/_build_pack.py`
- `D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/failed-fetch-runs.json`
- `D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/failure-recovery-table.json`
- `D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/finished-event-seq4830.json`
- `D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/finished-event-seq4830.jsonl`
- `D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/manifest.desensitized.json`
- `D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/reconcile-summary.json`
- `D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/result.desensitized.json`
- `D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day20-20261026a/.tmp/offline-reconcile-1793071080/revision-source-run.json`

### Finished event (seq 4830)
```json
{"sequence": 4830, "at": "2026-10-27T02:58:21.391Z", "type": "finished", "reason": "deadline"}
```

### 19-source final summary

| source | status | failRuns | itemsNew | itemsRevised | lastOkAt (Asia/Shanghai) |
|---|---|---:|---:|---:|---|
| intel:cn-p01 | ok | 1 | 8 | 0 | 2026-10-27 10:40:20 Asia/Shanghai |
| intel:cn-t02 | ok | 0 | 10 | 0 | 2026-10-27 10:25:03 Asia/Shanghai |
| intel:id-t01 | ok | 0 | 8 | 0 | 2026-10-27 10:25:12 Asia/Shanghai |
| intel:id-t02 | ok | 0 | 10 | 0 | 2026-10-27 10:25:14 Asia/Shanghai |
| intel:id-w01 | ok | 0 | 153 | 1 | 2026-10-27 10:55:20 Asia/Shanghai |
| intel:my-c01 | ok | 0 | 10 | 0 | 2026-10-27 10:25:16 Asia/Shanghai |
| intel:my-t01 | ok | 0 | 6 | 0 | 2026-10-27 10:25:17 Asia/Shanghai |
| intel:ph-c01 | ok | 0 | 13 | 0 | 2026-10-27 10:25:05 Asia/Shanghai |
| intel:ph-m01 | ok | 0 | 18 | 0 | 2026-10-27 10:25:18 Asia/Shanghai |
| intel:th-c01 | ok | 0 | 102 | 0 | 2026-10-27 10:25:03 Asia/Shanghai |
| intel:th-c02 | ok | 0 | 100 | 0 | 2026-10-27 10:25:06 Asia/Shanghai |
| intel:th-w01 | ok | 0 | 15 | 0 | 2026-10-27 10:25:02 Asia/Shanghai |
| intel:vn-d01 | ok | 6 | 7 | 0 | 2026-10-27 10:09:59 Asia/Shanghai |
| intel:vn-p03 | ok | 0 | 14 | 0 | 2026-10-27 10:25:07 Asia/Shanghai |
| intel:vn-t01 | ok | 0 | 7 | 0 | 2026-10-27 10:25:09 Asia/Shanghai |
| intel:xx-k01 | ok | 0 | 27 | 0 | 2026-10-27 10:25:16 Asia/Shanghai |
| intel:xx-k02 | ok | 0 | 10 | 0 | 2026-10-27 10:25:15 Asia/Shanghai |
| intel:xx-k03 | ok | 0 | 22 | 0 | 2026-10-27 10:25:13 Asia/Shanghai |
| intel:xx-m03 | ok | 0 | 31 | 0 | 2026-10-27 10:25:18 Asia/Shanghai |

**Totals from source_run:** itemsNew=571, itemsRevised=1, itemsSeen=8948; job_result recordsWritten=572

### Failure + recovery table (all 7)

| # | source | errorCode | failedAt (Asia/Shanghai) | recovered lastOkAt (Asia/Shanghai) | url host |
|---:|---|---|---|---|---|
| 54 | intel:vn-d01 | fetch_timeout | 2026-10-26 13:14:45 Asia/Shanghai | 2026-10-26 13:29:50 Asia/Shanghai | phongchongthientai.mard.gov.vn |
| 101 | intel:vn-d01 | fetch_timeout | 2026-10-26 15:30:49 Asia/Shanghai | 2026-10-26 15:45:49 Asia/Shanghai | phongchongthientai.mard.gov.vn |
| 222 | intel:vn-d01 | fetch_timeout | 2026-10-26 21:49:14 Asia/Shanghai | 2026-10-26 22:04:14 Asia/Shanghai | phongchongthientai.mard.gov.vn |
| 229 | intel:cn-p01 | fetch_timeout | 2026-10-26 22:19:31 Asia/Shanghai | 2026-10-26 22:34:51 Asia/Shanghai | www.gd.msa.gov.cn |
| 244 | intel:vn-d01 | fetch_failed | 2026-10-26 23:04:56 Asia/Shanghai | 2026-10-26 23:20:12 Asia/Shanghai | phongchongthientai.mard.gov.vn |
| 277 | intel:vn-d01 | fetch_timeout | 2026-10-27 00:20:48 Asia/Shanghai | 2026-10-27 01:06:04 Asia/Shanghai | phongchongthientai.mard.gov.vn |
| 285 | intel:vn-d01 | fetch_timeout | 2026-10-27 00:36:04 Asia/Shanghai | 2026-10-27 01:06:04 Asia/Shanghai | phongchongthientai.mard.gov.vn |

## 2. 572 vs 571

- job_result Σ recordsWritten = **572**
- source_run Σ itemsNew = **571**
- source_run Σ itemsRevised = **1**
- DB intel_item=571, intel_item_version=572, intel_item_current_change=572
- **Conclusion: yes — the 1-diff is the single itemsRevised=1 revision.**
- Proven by source_run seq 2318 on intel:id-w01 (itemsNew=9, itemsRevised=1) and DB item with 2 versions.
- Revision item: `f6218730-eedd-49c1-bb88-b74bc279528f` source `intel:id-w01` title `Thunderstorm Tonight in Aceh` versions=2

## 3. True RO DB

- Opened `mode=ro` + `PRAGMA query_only=ON`
- counts: {"intel_item": 571, "intel_item_version": 572, "intel_item_current_change": 572, "intel_fetch_run": 464}
- duplicate (source_id, canonical_url) groups: **0**
- items with >1 version: **1** (matches itemsRevised=1)
- vs write ledger: item=571=itemsNew; version=572=itemsNew+itemsRevised=recordsWritten; current_change=572. **No mismatch.**

## 4. codeIdentity dirty

- head: `e41d3145b4276a0c02aab9f00d795476aefa1608`
- worktreeDirty: **True**
- mechanism: `Boolean(git status --porcelain) in scripts/r2-intel-observe-worker.ts`
- concrete dirty path list at observe start: **not preserved** in manifest (boolean only).
- All 19 observe `codeIdentity.files` are content-equivalent to HEAD (git hash-object == HEAD blob); manifest sha256 differs only by on-disk CRLF under autocrlf.
- Therefore dirty does **not** indicate divergent observe **execution code** vs e41d3145.
- Current (secondary) porcelain: `M src/routeTree.gen.ts` — generated route tree, **not** in observe codeFiles; no logical content diff vs HEAD.

## Flags

- exit=unknown
- overallR2Pass unchanged
- no new 24h
- continuous24hAcceptance string retained as in result.json (NOT_GRANTED; independent review)
- commit/push: **skipped** (local .tmp pack only; isolation-branch commit deferred as optional/risky)
