# Port notice disclosure P2 repair — 2026-10-14

Code `180f919ebdcbf350a23a75d28bd2efbcf5765f67`. One limited review repair, no calendar/next module.

## Fixed

`ports-demo.tsx` announcement cards previously showed title/summary/provenance only and omitted old Feed/detail time semantics and status context. They now render `FeedNoticeMetadata`: existing publicationTimeKnown/publishedAt, received_at, stale/sourceStatus, stored alertState, unknown validity/lifecycle and stored expiry. Known publication is labelled; unknown publication is not replaced by an arbitrary placeholder. received_at is displayed separately as first receipt (not publication) even when publicationTimeKnown=false. Cache expiry/source failure and stored notice expiry are distinct. No status is derived from dates/current clock; no new DTO, backend, source, migration, unit/rule, forecast/reference or data change.

Four synthetic SSR regressions cover historical date + stale without deriving alert expiry; source failure + persisted expired/unknown state; unknown timestamp placeholder hidden; received_at/unknown publication with separate receipt label. They test rendering only, not browser interaction or source accuracy.

## Verification

Exact-SHA fresh clone `.tmp/port-notice-fix-build`, full frozen install with scripts enabled; install/build/typecheck/lint,59targeted, full117files/1107pass/3existing Windows skips and3isolated native/Runtime/Feed smokes all raw exit0. Full SHA/commands/cwd/timestamps/separate stdout/stderr/raw exits adjacent. Normalized tracked diff0; primary repo dist never rebuilt.

54loopback HTTP/API/resource checks pass on independent `http://127.0.0.1:4485/ports`, PID11600, cwd`.tmp/notice-preview-180f919`. Original4482isolated fixture DB copied; original policy samples retained, no credentials/project env/secret file, Runtime/providers/translation off. Old4477/4482/4483/4484 retained. Eight approved weather reads have **empty forecasts**: these checks prove reads/empty states and existing DTO/status preservation only, not weather coverage, browser switching or real provider correctness. No write-count deltas; counters alone are not egress proof and no egress capture claimed.

Browser/visual/keyboard/widths/S7 **NOT_RUN / pending**. Official browser unavailable; rejected CDP path not bypassed. No source/real/paid/LLM requests, no merge/deploy/force-push.

## Actual Neat Freak closeout

Real skill v3.0.0/verification reference already loaded; actual Bash inventory ran exit0 at code180f919, copied here. Enumeration is not security audit. Code/parent review matched the lost metadata and limited repair. status updated; architecture/plan/rules unchanged because existing read/DTO/business boundaries unchanged. React review: pure escaped presentation, no new hook/query/fetch/write and reused source-status priority.

Fact states: code changed-and-verified (non-browser); runtime pending full UI acceptance; docs changed-and-verified; rules verified-current; memory generated-read-only/out-of-scope; workspace preserved/pending cleanup. Known chunk/Browserslist/duplicate imports/Windows skips/CRLF/ignore permission warnings retained. Only new evidence secret-pattern scan; no historical key inspection or account-leak claim. Original previews/DBs/drivers/clones preserved; cleanup needs explicit post-report authorization. Parent review pending; no R1.5/R2/R5 aggregate PASS.
