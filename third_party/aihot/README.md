# AIHOT (third-party, MIT)

Source: https://github.com/KKKKhazix/AIHOT at the pinned commit `44578fa` (2026-09-29). Only the files listed in
`docs/plans/shipping-hot-risk-intelligence-2026-09-29.md` §5.3 are adapted, each with an `Adapted from AIHOT@44578fa` header.
The name "AIHOT" and its logo are not licensed under MIT (upstream NOTICE).

Adapted so far:
- `packages/backend/src/sources/json-list.ts` -> `server/intel/sources/json-list.ts`: retained path/string/template/item mapping, restricted to pure JSON via the existing collector. Own-property bounded paths and encoded path/query templates replace raw interpolation; no embedded scripts, GitHub credentials, custom headers/POST, filters, recursive key discovery or pagination. Existing strict date evidence replaces upstream Date.parse/epoch/date-only-midnight conversion. JSON parser and integration tests are locally authored boundary regressions, not a claim that the whole upstream JSON test suite was ported. MIT attribution retained.
- `packages/backend/src/providers/receipts.ts` → `server/intel/llm/receipts.ts` (R2-3, offline only)
- `tests/receipts.test.ts` → behaviours re-expressed in `server/intel/llm/receipts.test.ts` with a fake caller
- `packages/backend/src/sources/web-list.ts` → `server/intel/sources/web-list.ts`: HTML selector/seen/allowed flow retained; existing secure fetch, decoding and URL canonicalization reused. Jina/MiMo, Markdown/Docusaurus and detail-fetch branches are not enabled in this HTML-only slice. Unsupported config is rejected, not silently ignored.
- `packages/backend/src/sources/config-keys.ts` → `server/intel/sources/config-keys.ts`: whitelist restricted to the implemented HTML subset, with selector/type/offset/prefix validation.
- `tests/web-list-date.test.ts` and HTML/config cases from `tests/sources.test.ts` → `server/intel/sources/web-list.test.ts`. Explicit-offset and numeric/Chinese date behaviours retained; implicit +08:00, date-only midnight and permissive English/host-local Date.parse fallbacks intentionally replaced by explicit precision/timezone evidence and strict unknown-date results. Jina/MiMo/paid-detail tests are not ported because those branches are rejected.

Pinned full upstream revision: `44578fa11da55f2e863900752653e0c221f6cf70`. HTML fixture coverage distinguishes a newly authored synthetic date-format page from the existing NCHMF 2026-10-10 HTML archive; neither is a new live-source check. See `docs/plans/r2-web-list-2026-10-12.md` for the current integration boundary.
