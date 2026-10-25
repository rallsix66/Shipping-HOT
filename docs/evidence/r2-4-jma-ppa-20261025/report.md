# R2-4 JMA forecast + PPA TLS evidence packaging (dots 1792919016)

## Scope

Read-only packaging of existing `.tmp/r2-4-jma-ppa-20261025/` round evidence onto the isolated gapfill branch. **Zero new HTTP/TLS.** Zero product code changes. No full Vitest/typecheck/lint/build re-run. Counts stay **R2-4 29/39** and **R2-5 25/34**. Does not raise XX-W02 or unblock PH-P01 product entries.

Baseline: `978a7e4ff7df4e8e57cfa4fdabdca5b8bf02c2a2`
Branch: `codex/shipping-hot-r2-4-gapfill-20261025`

## Public files (this directory)

| File | Contents |
| --- | --- |
| `round-summary.public.json` | Desensitized round summary |
| `budget.public.json` | HTTP 7/12 + TLS diag 1/1 budget |
| `request-ledger.public.json` | Seven official JMA URLs (map.html body_too_large) |
| `tls-diag-ledger.public.json` | PPA www:443 STRICT_TLS_OK metadata |
| `forecast-fields-reconciliation.public.json` | TC2637 / TC2636 public forecast field reconciliation |
| `tls-implementation-note.md` | Library / runtime / trust vs `article-fetch-security` |

Private raw bodies and absolute machine paths stay under gitignored `.tmp/` only.

## Forecast field reconciliation (public)

| TC | nameEn / nameJp | issuedAt (UTC) | current lat,lon@at | track / fcst | wireSha256 prefix |
| --- | --- | --- | --- | --- | --- |
| TC2637 | In-fa / インファ | 2026-10-25T07:05:00Z | 12.2,165.2@06:00Z | 13 / 5 | `9e4f3a25…2012a02` |
| TC2636 | Champi / チャンパー | 2026-10-25T06:45:00Z | 30,125.4@06:00Z | 109 / 2 | `d2c87132…cf60ce` |

Both identities match prior XX-W01 list sha `73f95b53…4b4c31`. Parser: `parseJmaForecastJson` ok. Forecast alone ≠ XX-W02 whole-row OK.

## TLS contrast (one line)

两次均报告严格验证，但有效信任来源及等价性未核实；两端均 `rejectUnauthorized=true` 且复用同一 DNS 门控；API 不同（diag `node:tls.connect` 无 HTTP vs 产品 `https.request` / `secureFetchArticle`）。详见 `tls-implementation-note.md`。

## Still blocked

1. XX-W02 specifications exact URL unverified (do not invent `TC{id}/specifications.json`).
2. `bosai/map.html` burned at secureFetch `maxBytes` 524288 (`body_too_large`); no raise / no retry this turn.
3. PH-P01 product entries remain BLOCKED; www:443 STRICT_TLS_OK is host-identity only — not product recovery, not CA import authorization.
