# R3-8 policy auto RC4（dots REQUEST CHANGES round 4）— 2026-11-02

Parent REQUEST CHANGES on tip: `c81789eca8ff36834bb61493babdcb3eea64f391`.

## Scope
Offline policy-library auto create/update. **Not** full R3. No live crawl, no Shopee/Lazada auto, no R4 product slice, no merge/deploy.

## RC4 fixes (only two)
1. **Exact analysis bind without trim/fallback** — pick target run from the untrimmed analysis set, then require *every* member of that run to match itemId/versionId/contentHash; any mismatch refuses (no other-run fallback). Covers mixed-hash same-run and newest-bad/old-good without runId.
2. **P1 connection txn isolation** — AsyncLocalStorage distinguishes same-call-chain nesting (SAVEPOINT) from independent requests (wait on write queue). Barrier-controlled cross-repository regression; nested outer+inner rollback retained.

## Gates
See `gates.txt`. Label e2e: `label-browser-e2e.txt`. Full vitest: `vitest-full.txt`.

## Explicit non-claims
- Real 200 human label set / real accuracy&cost: **not run**
- R3-5: **BLOCKED**; S7: **NOT_RUN**
- Unmerged / undeployed; Slack **not sent** by agent
