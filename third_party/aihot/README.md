# AIHOT (third-party, MIT)

Source: https://github.com/KKKKhazix/AIHOT at the pinned commit `44578fa` (2026-09-29). Only the files listed in
`docs/plans/shipping-hot-risk-intelligence-2026-09-29.md` §5.3 are adapted, each with an `Adapted from AIHOT@44578fa` header.
The name "AIHOT" and its logo are not licensed under MIT (upstream NOTICE).

Adapted so far:
- `packages/backend/src/providers/receipts.ts` → `server/intel/llm/receipts.ts` (R2-3, offline only)
- `tests/receipts.test.ts` → behaviours re-expressed in `server/intel/llm/receipts.test.ts` with a fake caller
