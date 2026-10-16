# Existing calendar demo-source adaptation — 2026-10-14

Code `2b988bca8574247c277b1ed7aabc14525d973515` (initialc6604cc plus loading/error layer-count disclosure). One frontend slice, no parallel calendar business implementation.

## Source reuse and retained scope

The existing annual calendar already had left filters / centre month / right day detail and the accepted reference/promotion/policy queries. Kept that component and business services; did not replace it with static demo arrays. Actual demo `.tmp/demo/shipping-hot-demo.html` hash remains `23d6efbb343182eba93caa74a4b1ca1657bab25f414fb873d9c448efe98b51b7`.

Demo calendar() line807 and markup855–890 define the same left/month/day layout. Direct CSS copy/adaptation: annual-ref-layout243 -> calendar-demo.css3 (175/min420/255 columns); annual-ref-day261 -> CSS21; detail-head279 -> CSS39; panel/filter/toolbar/control/grid/event/notice rules242–287 all scoped onto existing classes. Heading now日历; added demo Today action within existing2026–2027 navigation limits, still using actual device day rather than demo NOW. Existing multi-country checkboxes retained instead of demo single-country buttons; five-country reference scope unchanged, CN independent policy switch retained and no demo China holiday dates copied. Controls/selectors adapted to actual aria labels. Viewport<=1500 stacks panels to account for sidebar; this is unverified responsive CSS, not pixel acceptance.

Existing GET /calendar/reference?year, /calendar/promotions?year and /policies?effectiveFrom/effectiveTo reused with existing query keys/gates. No backend/DTO/schema/provider/threshold/date dataset or business rules changed. No generation/confirmation POST called. No new real date, source, procurement, paid/LLM call or production switch. Vitest-only ~ alias matches the app alias so the actual page can be SSR-tested; no runtime alias/framework change.

Retain holiday/workday/region/incomplete-source evidence, multi-day promo display, rule-generated pending status, E-R04/E-R06 anchor/window-pending semantics, original evidence links, confirmation notes, fixture-labelled policies and local timezone/localToday. Added timezone/confirmation-note disclosure; confirmation is stored state, no external evidence re-verification. Risk event/stock-preparation overlap disabled/unopened; no fake demo risk shading or invented preparation dates. Browser country/checkbox/month interaction is not claimed.

Error reads no longer show cached records as successful results or failed counts as zero. Existing arrays retained in query cache/repository; frontend hides them on query error. Loaded empty, no-country, missing-year, pending and error states stay distinct. Day headline count now explicitly refers to holiday/reference records; other-layer counts disclosed separately. No date-derived policy state or timezone conversion added.

## Verification

Exact clean code fresh local clone `.tmp/calendar-demo-final-build`, full frozen install with scripts enabled, build/typecheck/lint,79targeted, full118files/1115pass/3existing Windows skips and3isolated native/Runtime/Feed smokes all raw exit0. Full SHA/commands/cwd/timestamps/separate stdout/stderr/raw exits adjacent; normalized tracked diff0 after build. Initialc6604cc full gate also passed, retained separately; final count disclosure triggered a new exact-SHA full rerun, not a docs-only test claim. Primary repo dist untouched.

Eight synthetic SSR cases run the actual page with mocked state/query transport, verifying structure/unopened risk, country filtering, workday filter, query-disabled layers, missing-year/loading/empty/error, 2026/2027 boundary controls and UTC Monday/leap arithmetic, pending multi-day anchor, error-cache isolation, independent CN policy switch and fixture/timezone labels. They **do not verify live React event transitions, keyboard, viewport geometry or real source correctness**. Existing promotion/policy tests reused; no second generator/date normalizer/confirmation system.

28loopback HTTP/API/static-resource checks on `http://127.0.0.1:4486/calendar`, PID64764, cwd`.tmp/calendar-preview-2b988bc`. Original4482isolated DB copied,3policy fixtures retained; bundled annual reference data kept distinct from synthetic policy/cache sample data. Reference2026/2027, promotion2026/2027 and policy-year responses exactly equal old4485; GET read counts do not write calendar/ops/policy/version/usage/receipt/runs. Runtime/providers/translation off, minimal OS env, no project env/credentials/secret file. Old4477/4482/4483/4484/4485 unchanged. Counters alone are not egress proof; no egress capture or full-country/date accuracy claim. No new source requests or confirmation/generation.

Browser/pixel/keyboard/widths/S7 **NOT_RUN / pending**. Official browser unavailable; prior rejected custom CDP path not bypassed. No fake GUI/PASS or R1.5/R2/R5 aggregate completion claim. Parent review pending; normal draftPR8 only, no merge/deploy/force-push.

## Actual Neat Freak closeout

Real installed skill v3.0.0 and verification reference previously loaded; actual Bash inventory rerun at final2b988bc, raw exit0 (`neat-inventory.log`). Enumeration, not security audit. React review: existing hooks/query keys/gates retained, no new external client API/SQLite/Provider access, native controls, pure filtering; fake-query SSR separated from browser evidence. Source code/plan/status/architecture and fixture/coverage limitations reconciled. Rules unchanged; memory generated-read-only/out-of-scope. New evidence pattern scan only, no historical key inspection or account-leak claim.

Fact states: code changed-and-verified (non-browser); runtime pending full UI; docs changed-and-verified; rules verified-current; memory out-of-scope; workspace preserved/pending cleanup. Existing warnings (chunk size,Browserslist,duplicate import,Windows skips,CRLF/ignore permission) retained. Old preview/DBs and both test clones/drivers/logs preserved; deletion needs explicit post-report authorization.
