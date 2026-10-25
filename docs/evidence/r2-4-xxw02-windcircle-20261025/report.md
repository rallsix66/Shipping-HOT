# R2-4 XX-W02 wind-circle gapfill (dots 1792920528)

Baseline `ffc633a2bf0d2a40348d36c217cd2727d5be47ff`. Branch `codex/shipping-hot-r2-4-gapfill-20261025`.
**Zero new network.** Occupied existing gapfill worktree only. Counts kept **29/39** and **25/34**; XX-W02 not raised by executor.

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
- Units: retain both km and nm; do not invent preference.
- Identity: title typhoonNumber/name/issueUTC cross-checked against forecast for both TCs (**match**).

## 4. Tests / offline replay

- Vitest positive/negative fixtures under `server/fixtures/jma/TC263{6,7}-specifications.min.json`.
- Offline replay both preserved originals: `offline-replay.public.json` (`ok: true`).

## 5. PPA offline TLS audit (read-only)

See `ppa-tls-offline-audit.public.json`. Whitelist: Node 24.15.0 recorded; `rejectUnauthorized:true`; diag SNI=`www.ppa.com.ph`; no request-level CA; env `NODE_EXTRA_CA_CERTS`/`NODE_OPTIONS`/`SSL_CERT_FILE` **未记录**. No CA/protocol/transport change.

## 6. TLS wording

Opening “Same Node default trust store” replaced with **「两次均报告严格验证，但有效信任来源及等价性未核实」** in `docs/evidence/r2-4-jma-ppa-20261025/{report.md,tls-implementation-note.md}`.

## Still blocked / for dots

1. PH-P01 both product entries BLOCKED (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`); no SourceCa.
2. XX-W02 whole-row OK **not** raised here — submit wind-circle+identity evidence for ruling; keep 29/39 & 25/34 until dots decides.
3. Provider sync still does not fetch specifications (intentional; no new framework this round).

## Gate EXIT

- targeted Vitest: EXIT 0 (11 passed)
- full Vitest: EXIT 0 (2021 passed | 5 skipped; 159 files)
- build: EXIT 0
- typecheck: EXIT 0
- lint: EXIT 0
- diff: reviewed; no private originals; routeTree.gen.ts noise restored
- counts held: 29/39 and 25/34; XX-W02 not raised
