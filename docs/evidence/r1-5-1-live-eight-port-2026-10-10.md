# R1.5-1 — Eight-port live acceptance (Open-Meteo + JMA)

**Status:** **PASS** (2026-10-10, PR #7 branch `codex/shipping-hot-r1-5`) with **VNSGN marine coverage BLOCKED** (documented gap).

## Evidence binding (re-run after merge commits)

| Field | Value |
|--------|--------|
| Harness | `node scripts/r1-5-1-live-acceptance.mjs` |
| Isolated run dir | `.tmp/r1-5-1-live-2026-10-10T02-49-03-058Z` |
| Machine JSON | `<runDir>/r1-5-1-evidence.json` + `r1-5-1-sync-live.json` |
| Live sync window | `2026-10-10T02:49:03.445Z` → `2026-10-10T02:49:10.082Z` |
| Git HEAD at run | record `git rev-parse HEAD` on the commit that contains this doc + harness fixes |

## Seven-day time口径

- **Target window:** `[now − 1h, now + 7d]` (`WEATHER_FORECAST_HORIZON_MS`).
- **Hourly counts:** only `horizon === "hourly"` instants inside that window (`hourlyInSevenDayWindow` / `forecastMeta.actualCoverage.hourlyReturned`).
- **`current` rows:** reported separately as `currentReturned`; **never** added to hourly counts.

## Live network (isolated `.tmp` cwd, retained DB untouched)

| Job | Result |
|-----|--------|
| `weather-sync` (Open-Meteo marine + forecast) | **success** — 8 ports persisted (`1352` `weather_forecast` rows) |
| `tropical-cyclone-sync` (JMA) | **success** — **outcome `ok`**, **2** active cyclones (`TC2634`, `TC2635`) at run time (**not** `ok_empty`; real archive in sync JSON) |

Per-port live matrix (hourly in 7d window ≈ **166**, land fields complete on all 8):

| Port | UN/LOCODE | Hourly in window | Marine wave | Land wind/precip/vis |
|------|-----------|------------------|-------------|----------------------|
| Shekou | CNSHK | 166 | OK | OK |
| Yantian | CNYTN | 166 | OK | OK |
| Nansha | CNNSA | 166 | OK | OK |
| Laem Chabang | THLCH | 166 | OK | OK |
| Port Klang | MYPKG | 166 | OK | OK |
| Manila | PHMNL | 166 | OK | OK |
| Jakarta | IDJKT | 166 | OK | OK |
| Ho Chi Minh | VNSGN | 166 | **BLOCKED** (166/166 hourly wave missing) | OK |

**VNSGN:** `forecastMeta.marineCoverageNote` present in API and port UI; **缺测说明 ≠ 覆盖达标**. Minimal follow-up (not implemented): probe nearest-sea coordinate or alternate approved marine source at L-stage; keep `cell_selection=sea` until architecture approves change.

## Chain verified per port

1. Live sync → SQLite (`weather_forecast` / `weather_impact`)
2. Production server **restart** → `GET /api/shipping/ports/:id/weather` still populated
3. Browser (headless CDP): `/ports/:id` shows the same **hourlyReturned** as API `forecastMeta`

## Fixture network (deterministic — not live JMA scenarios)

Partial / failed / stale / ok_empty tropical UI and retained-path behaviour: **`scripts/e2e-s7-integrated.mjs`** — evidence `.tmp/s7-local/s7-integrated-evidence.json` (**151** checks, `failedChecks: []`). Explicitly **separate** from live JMA above.

## Gate bundle (same day)

Run with the commit under review: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, full Vitest, `pnpm smoke:p0-native`, S7, Git Bash `scripts/audit-inventory.sh`.

**R1.5-4:** remains **BLOCKED (0/10)** — unchanged.
