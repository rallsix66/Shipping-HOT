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
| R2-5 | **26/34** (limited PASS after dots 1792987108.133129; was 25/34) |
| numeric | **3/5** |
| overallR2Pass | **false** |

## Non-changes

No merge/deploy/force; main dirty preserved; day20 not restarted / locks not deleted; day19 untouched; no Guyang / no Slack send from this executor.

## Review fixes (dots 1792985451.804939) - Asia/Shanghai 2026-10-26 11:44:39

**Zero new network.** day20-20261026a worker PID 82336 left alone (RO peek only). Prior review-fix freeze held until dots ruling; now CN-T01 limited PASS — R2-4 **32/39**, R2-5 **26/34**, overallR2Pass=false.

### 1) Exact raw href privilege
- `resolveMetadataUrlAlias(originalHrefLiteral)` matches **only** the two approved absolute original strings (HTTP identity / HTTPS alias). No `new URL(...).href` / exactHrefKey path before eligibility.
- Twin privilege removed from `allowed()`; unmatched HTTP cannot regain exception later in canonicalize/allowed.
- `fromHtml` end-to-end negatives: `:80`, `%2e`/dot-segments, empty `?`/`#`, port/credentials/encoding variants -> `web_list_no_allowed_items` (HTTP) or no HTTP-identity mapping (HTTPS ordinary allow only).

### 2) Gitignored private fixture gate (PAGASA pattern)
- Ordinary run, private raw missing -> explicit **skip** (not false PASS).
- `CN_T01_STRICT_PRIVATE_REPLAY=1` missing original or hash mismatch -> **fail**.
- Local full-chain replay keeps unmodified 20318B (`ab5e3780...515d340f`).

### 3) True readonly reopen
- `isolated-db::openReadonly(path)`: `{ readonly: true, fileMustExist: true }` + `PRAGMA query_only=ON`; returns `readonly` / `fileMustExist` / `queryOnly` facts.
- **Prior RW-reopen evidence (as-was, not rewritten):** earlier offline 8/8 path used `open()` / `new NativeDatabase(path)` without readonly - that reopen+query was **not** a true readonly open. Annotated here; do not treat prior wording as readonly proof.

### 4) dateRuleBasis + upgrade-db
- Restored / kept existing `dateRuleBasis` string (alias rationale in comments + this evidence only) so contentHash for original 7 does not revise.
- Proof: isolated DB pre-fix **7** rows (HTTP twin + `/zcjd/` replaced with `https://example.invalid/...`), upgrade with rule on -> only item **8** added; original 7 keys/content/versions unchanged; second run `itemsNew=0` / `itemsRevised=0`; close + **true readonly** reopen consistent.

### Gates (this round)
- build / typecheck / lint: exit 0
- vitest: **2056 passed | 8 skipped (2064)** / 161 files (`CN_T01_STRICT_PRIVATE_REPLAY=1`)
- SHAs filled in `summary.json` after commit (tip = product/code SHA for this one-batch fix).

## Limited R2-5 PASS ruling (dots 1792987108.133129) - 2026-10-26T03:58:28.133129Z / 2026-10-26 11:58:28.133 Asia/Shanghai

Accepted by dots. **CN-T01 limited R2-5 PASS** → count **25/34 → 26/34**.

Scope ONLY: specified 20318B real original; the one verified HTTP/HTTPS identity alias; original 8 items fields/ingest/dedupe + true readonly reopen verification.

NOT: relaxing HTTP transport, production enablement, or continuous-run endorsement.

| Bucket | Value |
| --- | --- |
| R2-4 | **32/39** unchanged |
| R2-5 | **26/34** |
| numeric | **3/5** unchanged |
| overallR2Pass | **false** |

History retained: old 7/8 PARTIAL; href-mutation experimental NON_QUALIFYING; prior RW-reopen annotated as-was.

Gate bind product code SHA f87a2626239baf049e3e0e6a9da7bd7ef4aa8c9c. Baseline tip before this docs write f961c050c8ca70b58358739c2b2fcddfb74e980b. day20 PID 82336 untouched; zero new network. See [product-ruling.md](./product-ruling.md).
