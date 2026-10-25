# R2-4 XX-W02 wind-circle gapfill (dots 1792920528)

Baseline `ffc633a2bf0d2a40348d36c217cd2727d5be47ff`. Branch `codex/shipping-hot-r2-4-gapfill-20261025`.
**Zero new network.** Occupied existing gapfill worktree only. Counts kept **29/39** and **25/34** at code-round closeout (historical snapshot); XX-W02 not raised by executor in that round. Later product ruling: see below (dots 1792922911).

### P2 local fixes (dots 1792921846)

Baseline for this delta: `60090e26d48074e8f5e7a02a84b2b7f8f6f2ca7b`.
1. Range usable-radius gate (finite non-negative + ≥1 valid unit) via existing field-level `*_range_invalid`.
2. Identity cross-check: missing/empty → `"unknown"`; true only when both sides have non-empty equal values.
3. Minimal fixture provenance note: `server/fixtures/jma/README.md` (source / extraction scope / not full originals / no new license claim).

## 1. Source chain (z / o / n)

From preserved `map.html` (sha256 `71c57265064a4d54...`, 861490 bytes), inline script only:

| Symbol | Evidence |
| --- | --- |
| `z` | `z="typhoon/data/"` (data-root relative to `/bosai/`) |
| `n` | `makeTcList` = filter targetTc entries with truthy `typhoonNumber`, map to `tropicalCyclone` |
| `o` | full init `var o=z+n+"/"` then `r["specifications_"+n]=o+"specifications.json"` |

Absolute product URL: `https://www.jma.go.jp/bosai/typhoon/data/{TCID}/specifications.json`.
Public assignSnippet now includes z/o/n context (see `source-chain-zon.public.json`). No whole script published.

## 2. Wind-circle parse (XX-W02 path/forecast already covered)

- Path / forecast positions: reuse existing `parseJmaForecastJson` + offline forecast originals (0 refetch).
- New pure function `parseJmaSpecificationsJson` in `server/services/jma-typhoon-parse.ts` (no new provider/scheduler).
- Extracts gale/storm sectors with source `km`+`nm`, area string or bilingual object, `advancedHours` / `validtime`.
- Official UI labels from map.html: gale=`15m/s以上の強風域`; storm analysis=`25m/s以上の暴風域`; storm forecast=`暴風警戒域`.

### Field presence (both TCs)

| TC | Row | galeWarning | stormWarning | notes |
| --- | --- | --- | --- | --- |
| TC2637 In-fa | Analysis (0h) | present SW 220km/120nm + NE 165km/90nm | present All 75km/40nm | |
| TC2637 | +24..+120h | **absent** | present All (growing) | absent ≠ 0 |
| TC2636 Champi | Analysis (0h) | present NE 560km/300nm + SW 330km/180nm | **absent** | |
| TC2636 | +12h / +24h | **absent** | **absent** | still ok parse |

## 3. Default semantics

- Missing key → `status:"absent"` (UI skips render); never coerce to radius 0; not whole-document failure.
- Present null / non-array / bad range → `status:"invalid"` for that field only.
- Usable radius: finite **non-negative** number; **at least one** of km/nm must be valid. Empty `{}`, `{km:null,nm:"120"}`, or negative-only radii use the existing `*_range_invalid` path (do not become present circles). Single-unit present is allowed; no km/nm conversion consistency gate.
- Units: retain both km and nm; do not invent preference.
- Identity: title typhoonNumber/name/issueUTC cross-checked against forecast for both TCs (**match**). Missing/empty on either side is `"unknown"` (not `true` via `undefined===undefined`); only non-empty equal values yield `true`.

## 4. Fixture provenance (minimal)

See `server/fixtures/jma/README.md`. TC2636/TC2637 `.min.json` fixtures are trimmed excerpts from preserved offline originals for Vitest only — **not** complete wire bodies. JMA terms retained; **no new license claimed**.

## 5. Tests / offline replay

- Vitest positive/negative fixtures under `server/fixtures/jma/TC263{6,7}-specifications.min.json`.
- Offline replay both preserved originals: `offline-replay.public.json` (`parserStatus: "ok"`; identity fields `typhoonNumberMatch` / `nameEnMatch` / `nameJpMatch` / `issuedAtMatch` all `true` for both TCs).

## 6. PPA offline TLS audit (read-only)

See `ppa-tls-offline-audit.public.json`. Whitelist: Node 24.15.0 recorded; `rejectUnauthorized:true`; diag SNI=`www.ppa.com.ph`; no request-level CA; env `NODE_EXTRA_CA_CERTS`/`NODE_OPTIONS`/`SSL_CERT_FILE` **未记录**. No CA/protocol/transport change.

## 7. TLS wording

Opening “Same Node default trust store” replaced with **「两次均报告严格验证，但有效信任来源及等价性未核实」** in `docs/evidence/r2-4-jma-ppa-20261025/{report.md,tls-implementation-note.md}`.

## Still blocked / for dots（代码轮快照；裁定前）

1. PH-P01 both product entries BLOCKED (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`); no SourceCa.
2. XX-W02 whole-row OK **not** raised in the code round — wind-circle+identity evidence submitted for ruling; 29/39 & 25/34 held until dots decided.
3. Provider sync still does not fetch specifications (intentional; no new framework this round) — **显著保留** after ruling.

## Product ruling landed (dots 1792922911)

- Ruling at `2026-10-25T10:08:31.869439Z` (`rulingMessageTs=1792922911.869439`): XX-W02 **limited** R2-4 OK (`countedOK=true`, scope=existing two-TC forecast+specifications capture and offline field verification).
- Counts after docs land: **30/39** (shortfall 2); R2-5 **25/34**; numeric production partition **3/5**; `overallR2Pass=false`; PPA still BLOCKED.
- Prior 29/39 / forecast-only / PARTIAL statements above remain **historical snapshots**.
- Docs-only; gates reuse `a2e99a01`; see [product-ruling.md](./product-ruling.md).
- lastUpdatedAt for matrix write: `2026-10-25T10:16:43.402Z`.

## Gate EXIT (dots 1792921846 P2)

- targeted Vitest: EXIT 0 (7 passed; jma-typhoon-parse.test.ts)
- full Vitest: EXIT 0 (2021 passed | 5 skipped; 159 files)
- build: EXIT 0
- typecheck: EXIT 0
- lint: EXIT 0
- diff: reviewed; no private originals; routeTree.gen.ts noise restored
- counts held: 29/39 and 25/34; XX-W02 not raised; numeric prod 3/5 unchanged
- network: zero new; offline originals only
- identity: true / false / unknown per dots 1792922143
