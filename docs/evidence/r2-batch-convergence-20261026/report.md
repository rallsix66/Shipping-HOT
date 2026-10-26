# R2 batch convergence (dots 1792994131 + 3982 + 4253)

- **main ts**: `1792994131.133459`; R2-8 boundary `1792993982.228989`; continue/no separate inventory round `1792994253.888519`
- **written**: 2026-10-26T06:09:32.745Z / 2026-10-26 14:09:32 Asia/Shanghai
- **baseline tip**: `6a2dafad88f051a85c220e946ce144d24ef9bd87`; **product code SHA**: `f87a2626239baf049e3e0e6a9da7bd7ef4aa8c9c` (no tip self-rebind)
- **network**: zero new HTTP/TLS (`httpRequestsThisBatch=0`)
- **counts unchanged**: R2-4 **32/39**; R2-5 **26/34**; **overallR2Pass=false**
- **day20-20261026a**: PID 82336 **not stopped / not reset / lock not deleted / day19 untouched**

## 1. Fixed / verified this batch

1. **R2-8 coverage-diff wording**: original contract requires P1 continuous 24h + failing backoff; does **not** mandate all-39 concurrent window or full re-run on every source add; day19/day20 windows must **not** be stitched into continuous 24h; prior two-source proposal and 10s zero-HTTP lifecycle tests are **not** 24h pass; whether incremental observe is needed = separate review — this batch does not self-open a new round or invent a full-39 re-run gate.
2. **Remaining 8**: all classified **EXTERNAL_MISSING_MATERIALS**; **0** proven fixable code defects this batch.
3. **PPA**: stored `tls.connect` STRICT_TLS_OK vs product `secureFetchArticle`/`defaultTransport` `UNABLE_TO_VERIFY_LEAF_SIGNATURE` recompared; API / HTTP / minVersion differ; effective trust source **not verified**; cannot fabricate historical trust stack; **no** definite code defect → **no** gapfill code change.
4. **VN-P01**: offline-only check of existing materials — list id `200/TBHH-...` and detail attachment filename text `200.pdf` on same page; **no** PDF download; **no** attachment href captured in audit; date gap remains; verdict **PARTIAL/PARTIAL** unchanged.
5. **day20 RO**: all 19 sources latest status ok; HTTP started/completed/failed = 61/60/1; **VN-D01** `fetch_timeout` at 2026-10-26 13:14:35 Asia/Shanghai then natural recovery `ok_items` at **13:29:50** (itemsSeen=4), failures=0.

## 2. True external blockers

| ID | Blocker |
| --- | --- |
| CN-P02 | root 302 Location self-points; no distinct list payload |
| VN-P01 | title/link present; no own date; 200.pdf is filename text only |
| MY-P03 | duplicate URL title/date conflict; collector fails closed |
| MY-L01 | no title-anchor detail href |
| PH-P01 | product-path leaf verify fail; missing product-path chain evidence |
| PH-W01 | official explicit empty; missing active bulletin field materials |
| PH-W02 | official explicit empty; missing active advisory field materials |
| XX-F01 | no qualifying product request/data; historical oneshot stopped at blocked_address |

## 3. Next minimal URL / request budget

**Necessary this batch: none.** If dots later approves separately, see `batch-report.json` → `nextMinimalUrlBudget.ifLaterApprovedSeparately` (not executed now).

## 4. day20 + VN-D01

- runId `day20-20261026a` / profile `24h-19` / until **2026-10-27 10:58:16 Asia/Shanghai**
- last event ~ **2026-10-26 13:59:57 Asia/Shanghai**
- VN-D01 natural recovery as above; **must not** claim full P1 24h pass

## 5. R2-8 wording landed

See item 1 and `batch-report.json` `sections.A_r28_coverage_diff`; short note: [r2-8-coverage-diff.md](r2-8-coverage-diff.md).

## Gate

- product code unchanged → **did not run** build/typecheck/lint/vitest (`gateRun=NOT_REQUIRED_DOCS_ONLY`)
- no merge / deploy / force; main dirty and `D:/wt-s1~s5` / `D:/wt-diag-3d42100` / Junctions untouched
