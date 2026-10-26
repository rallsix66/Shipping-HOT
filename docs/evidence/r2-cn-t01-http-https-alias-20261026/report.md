# CN-T01 exact HTTP↔HTTPS metadata alias (dots 1792984344.944339)

Asia/Shanghai local work on gapfill branch. **Zero new network.** day20 observe untouched (RO inspect only).

## Ruling applied (this twin only)

- Accept identity-field equivalence for **this one** official HTTPS detail ↔ existing HTTP list item (Part B evidence).
- **Do NOT** accept blanket HTTP→HTTPS upgrade under the same `allowUrlPrefixes`.
- Prior **HTML-copy href-mutation 8/8** (see `docs/evidence/r2-cn-t01-item8-https-20261026/offline-8of8.json`) is **experimental only / non-qualifying** — not a qualification basis.

## Design

Modeled on existing source-scoped `metadataLinkRule` (`sitc_show`):

| Constraint | Behavior |
| --- | --- |
| Rule | `mofcom_art_http_https_twin` (new enum value only) |
| Scope | `intel:cn-t01` + `persistence=disallowed` + candidate `enabled:false` |
| Default | **off** until the candidate is explicitly selected/enabled |
| Canonical identity | original HTTP list href |
| Alias | verified HTTPS twin (must still pass existing HTTPS host/prefix/deny) |
| Order | alias applied on exact inputs **before** generic URL normalization |
| Persist | collector stores `canonicalUrl` only → HTTP identity preserved in DB |
| Widen | **no** crawl whitelist / HTTP transport allow / global canonicalizer / TLS / SSRF / schema |

Same exact HTTPS twin later in a list maps to the **same** HTTP identity (no second row). Title/date conflicts after alias merge still **reject**. Other HTTP, `/zcjd/` interpretation links, wrong source/mode, unselected rule, query/hash/port/credentials/encoding variants get **no** privilege.

## Unmodified 20318B list proof

- Path: `.tmp/cn-t01-item8-https-20261026/private/list-response-after-save-20261020.bin`
- Bytes: **20318**; sha256: `ab5e3780d9988fe7032458a05ad00adf4f6e66bb891aaaed385f8e2f515d340f` (**byte-for-byte unmodified**)
- Real path: `fromHtml` → collector → independent SQLite → repeat → RO reopen
- Result: **8/8** items; repeat `itemsNew=0` / `itemsRevised=0`; original 7 HTTPS rows unchanged; item 8 keeps HTTP `canonicalUrl` with auditable HTTPS alias in `entry.url` (non-persisted field; provenance in rule + tests + this evidence)
- Source-day role kept (`2026-10-16`); detail header 10-26 **not** used as publish time; no new time gates

Fixture: `server/intel/sources/cn-t01-http-https-twin.test.ts` (pos/neg + strict original replay).

## Counts frozen

| Bucket | Value |
| --- | --- |
| R2-4 | **32/39** |
| R2-5 | **25/34** (pending review; not silently bumped) |
| numeric | **3/5** |
| overallR2Pass | **false** |

## Non-changes

No merge/deploy/force; main dirty preserved; day20 not restarted / locks not deleted; day19 untouched; no Guyang / no Slack send from this executor.
