# CN-T01 limited R2-5 PASS product ruling (2026-10-26)

- Isolation branch: `codex/shipping-hot-r2-4-gapfill-20261025`
- Product / gate bind SHA (review-fix impl, not this docs tip): `f87a2626239baf049e3e0e6a9da7bd7ef4aa8c9c`
- Baseline tip before this docs write: `f961c050c8ca70b58358739c2b2fcddfb74e980b`
- Ruling time (Slack ts to ISO): `2026-10-26T03:58:28.133129Z` (rulingMessageTs=1792987108.133129)
- Asia/Shanghai: `2026-10-26 11:58:28.133 Asia/Shanghai`
- Zero new network; day20-20261026a left alone (PID 82336); no merge/deploy/force-push

## Ruling (accepted by dots)

CN-T01 (**MOFCOM policy list**) is counted as **limited** R2-5 **PASS**:

- r2_5=PASS, countedPass=true; R2-5 numerator **25/34 -> 26/34**
- Scope **ONLY**:
  1. specified **20318B** real original list (sha256=ab5e3780d9988fe7032458a05ad00adf4f6e66bb891aaaed385f8e2f515d340f, byte-for-byte unmodified)
  2. the **one** verified HTTP/HTTPS identity alias (mofcom_art_http_https_twin; HTTP list identity remains canonicalUrl; HTTPS twin is alias only)
  3. original **8** items fields / ingest / dedupe + **true readonly** reopen verification (openReadonly + query_only)
- **NOT**: relaxing HTTP transport, production enablement, continuous-run endorsement, blanket HTTP->HTTPS under the same allowUrlPrefixes, or overall R2 PASS

## Counts after this ruling

| Bucket | Value |
| --- | --- |
| R2-4 | **32/39** unchanged |
| R2-5 | **26/34** (was 25/34; CN-T01 limited PASS) |
| numeric | **3/5** unchanged |
| overallR2Pass | **false** |

## History retained (not erased)

- Prior **7/8 PARTIAL** parent acceptance (HTTP identity excluded) remains a historical snapshot.
- Prior **HTML-copy href-mutation 8/8** remains **experimental / NON_QUALIFYING**.
- Prior RW-reopen (non-readonly open() / NativeDatabase) remains annotated as-was — not true readonly proof; superseded for qualification by true readonly reopen evidence under review-fix `f87a2626239baf049e3e0e6a9da7bd7ef4aa8c9c`.

## Evidence pointers

- Alias / offline 8/8 + review fixes: this directory report.md / summary.json / closeout.md
- Part B twin HTTPS equivalence (identity fields): docs/evidence/r2-cn-t01-item8-https-20261026
- Prior 7/8 qualification: docs/evidence/r2-maersk-mofcom-qualification-2026-10-20/acceptance.json
- Product code SHA: `f87a2626239baf049e3e0e6a9da7bd7ef4aa8c9c`

## Non-claims

- No HTTP body fetch / crawl-whitelist widen / TLS/SSRF change
- No production ingest enable / continuous availability / 24h pass
- day20 observe untouched; no second start / lock delete / day19 touch
- R2-4 stays 32/39; other sources unchanged; overallR2Pass=false
