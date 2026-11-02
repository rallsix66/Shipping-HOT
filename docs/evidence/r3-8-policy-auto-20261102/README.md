# R3-8 policy auto (offline only) — 2026-11-02

Parent tip: `483a8646fec9635c9f534a18cca2142ab4b78bc6` (dots accept ts 1793595541.081439).

## Scope
Offline policy-library auto create/update per plan §4.11. **Not** full R3. No live crawl, no Shopee/Lazada auto, no R4, no merge/deploy.

## Delivered
- schema **v37** `policy_auto_pending` / `policy_auto_audit`
- `PolicyAutoService.apply` outcomes: created|updated|unchanged|needs_human_confirm|rejected
- Exact identity: country + publisher + documentNumber; missing/ambiguous → human pending (idempotent)
- Source≠status: media→rumor; platform≠government; dates need evidence; clock injected in tests
- TikTok Shop offline dated-paragraph fixtures (add/modify/idempotent); Shopee/Lazada out of auto scope
- Defenses: `aiPrelabelHasSelectableRun` rejects mixed/NULL run_id; leave-confirm preserves search+hash (`mergeLeaveFromHref` because TanStack useBlocker strips hash)

## Gates
See `gates.txt`. Label browser e2e log: `label-browser-e2e.txt`. Full vitest: `vitest-full.txt`.

## Explicit non-claims
- Real 200 human label set / real accuracy&cost: **not run**
- R3-5: **BLOCKED**; S7: **NOT_RUN**
- Unmerged / undeployed; Slack **not sent** by agent
