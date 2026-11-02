# R3-8 policy auto RC3（dots REQUEST CHANGES round 3）— 2026-11-02

Parent REQUEST CHANGES on tip: `e180dfcf0e8fe37b8643ec4f048e8e8f1349c32d`.

## Scope
Offline policy-library auto create/update. **Not** full R3. No live crawl, no Shopee/Lazada auto, no R4, no merge/deploy.

## RC3 fixes (all three + evidence honesty)
1. **Exact analysis bind** — select run only from rows matching itemId/versionId/contentHash; refuse mismatch; no policy/pending from bad bind; happy-path exact bind still works.
2. **Rejected ≠ completed** — `findPriorSourceOpResult` reuses only created/updated/unchanged/needs_human_confirm; rejected kept for forensics but retryable after txn rollback; do not attach current B record when returning prior A versionId.
3. **Connection locks** — shared-db writeChain + PolicyRepository txDepth/BEGIN mutex via WeakMap; two service/repository instances converge under Promise.all.
4. **Evidence honesty** — real 038 mid-fault inject + legacy IFNULL index fixture for 039; offline eval report retained (INCOMPLETE / missing samples).

## Gates
See `gates.txt`. Label e2e: `label-browser-e2e.txt`. Full vitest: `vitest-full.txt`.

## Explicit non-claims
- Real 200 human label set / real accuracy&cost: **not run**
- R3-5: **BLOCKED**; S7: **NOT_RUN**
- Unmerged / undeployed; Slack **not sent** by agent
