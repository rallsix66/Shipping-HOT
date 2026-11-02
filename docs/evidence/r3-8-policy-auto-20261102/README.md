# R3-8 policy auto RC（dots REQUEST CHANGES）— 2026-11-02

Parent accepted tip then REQUEST CHANGES on: `3fbac06a18741d7c31f3ba8a326ccf589ff4c728`.

## Scope
Offline policy-library auto create/update. **Not** full R3. No live crawl, no Shopee/Lazada auto, no R4, no merge/deploy.

## RC fixes (all five + same-slice cleanup)
1. **Authoritative entry** — `applyFromExactIntel` / `buildCandidateFromExactIntel` from exact item/version/contentHash + consistent analysis run + rights; missing publisher/doc#/status → human. GET zero-model via invoke counters.
2. **Rights on all writes** — `sanitizeCandidateForPersist` before pending/audit/create/revise; platform excerpt+link only.
3. **Atomicity** — policy version + auto audit (or pending + audit) in nestable IMMEDIATE/SAVEPOINT tx; pending `candidate_fp` unique (v38); write-chain mutex; mid-flight audit fault rollback + retry + Promise.all covered.
4. **Current-version idempotency** — fingerprint vs current content only (A→B→A bumps); includes `applicableTimezone` + current pageFp.
5. **Page diff** — split paragraphs before normalize; plain multi-date HTML + attr-order fixtures.
6. **Cleanup** — removed prod Shell hidden `shell-nav-policies-query-hash`; e2e harness stamps real Shell Link; leave-no clears `intendedHrefRef`.

## Gates
See `gates.txt` / `gates-rc.txt`. Label e2e: `label-browser-e2e-rc.txt`. Full vitest: `vitest-full-rc.txt`.

## Explicit non-claims
- Real 200 human label set / real accuracy&cost: **not run**
- R3-5: **BLOCKED**; S7: **NOT_RUN**
- Unmerged / undeployed; Slack **not sent** by agent

## RC2
See subdirectory rc2/ for REQUEST CHANGES round-2 on tip e3409e45 (schema v39, extract contract, persist rights, source-op idempotency, real GET).

## RC3
See subdirectory rc3/ for REQUEST CHANGES round-3 on tip e180dfcf (exact analysis hash bind; completed-only prior reuse + rejected retry; connection-scoped locks; real 038 mid-fault + IFNULL fixture honesty).

## RC4
See subdirectory rc4/ for REQUEST CHANGES round-4 on tip c81789ec (untrimmed run select + full-member hash bind; ALS nesting vs independent repo write queue + barrier regression).
