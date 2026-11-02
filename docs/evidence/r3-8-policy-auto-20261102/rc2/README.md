# R3-8 policy auto RC2（dots REQUEST CHANGES round 2）— 2026-11-02

Parent REQUEST CHANGES on tip: `e3409e45b2c49f1af14d571e89745f519fb9e2c2`.

## Scope
Offline policy-library auto create/update. **Not** full R3. No live crawl, no Shopee/Lazada auto, no R4, no merge/deploy.

## RC2 fixes (all four + GET honesty)
1. **Extract contract** — `EXTRACT_PROMPT` extract-v2; `parseExtractOutput` accepts publisher/documentNumber/status/platform; authority entry uses parser; trust-based sourceType; no expired→repealed; unknown platform→human.
2. **Persist rights** — whole object sanitized including `pageParagraphs[].text` (date+hash only when rights disallow body).
3. **Safe v37→v38/v39** — 038 backfills `candidate_fp` before unique index; 039 repairs already-v38 IFNULL index without dropping tasks/audits.
4. **Source-op idempotency** — same intelVersionId+contentHash replay returns prior result/version; does not overwrite current B; new hash/version content-regression A may create v3.
5. **GET honesty** — `policies-read-http.test.ts` drives real list/detail handlers; asserts paid_receipt/provider_usage flat + policy-auto invoke 0.

## Gates
See `gates.txt`. Label e2e: `label-browser-e2e.txt`. Full vitest: `vitest-full.txt`.

## Explicit non-claims
- Real 200 human label set / real accuracy&cost: **not run**
- R3-5: **BLOCKED**; S7: **NOT_RUN**
- Unmerged / undeployed; Slack **not sent** by agent
