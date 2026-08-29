# V3 Real Data Live Verification

> Verification date: 2026-08-29
> Scope: controlled local Real Mode process only. No deployment, provider account change, secret creation or new Provider was performed.

## Method

`pnpm smoke:v3-real-activation` loaded the existing server environment and set `SHIPPING_DATA_MODE=real` for that process only. For this review it used a fresh process-scoped SQLite path so pre-existing Mock/Off local data could not contaminate the observation; it ran the registered Runtime Jobs, then a built Nitro process was smoke-tested separately with process-scoped Mock/Off configuration across the HTTP surfaces. Secret values are not recorded here.

## Provider and persistence evidence

| Capability | Provider | Observation | SQLite / API evidence | Status |
| --- | --- | --- | --- | --- |
| AIS tracking | AISStream | Runtime Job completed successfully with `recordsRead=0`; no eligible watched MMSI/PositionReport was available | Runtime health was healthy; no fabricated position row was written | `connection_verified / coverage_pending` |
| Voyage / ETA | None in Real Mode | Job was disabled because only the Mock Voyage adapter is available and no real key/adapter was configured | Readiness correctly blocks on the disabled Voyage Job; VesselAPI ETA entitlement is **not verified** and no ETA claim is made | `credential_missing` |
| Feed — The Loadstar | Public RSS | 10 normalized items fetched | Real Feed rows persisted; current/history API available | `verified_live` |
| Feed — Shekou official | Public HTML | 5 normalized items fetched | Real Feed rows persisted; publication/freshness policy controls current vs history visibility | `verified_live` |
| Calendar | Calendarific | 259 events fetched for CN, ID, MY, PH, TH and VN | Real Calendar rows persisted and Calendar API returned them; official/manual completeness remains separate | `coverage_pending` |
| Port Intelligence | Portcast public pages | 8 Port Directory-aligned port rows fetched | Real Port rows persisted; legacy Shipping API returned 8 ports | `verified_live` |
| Weather model | Open-Meteo Marine | 7 weather-risk Feed rows fetched with wind/gust/window fields | Real Feed rows persisted; `/api/shipping/feed` returned model fields | `verified_live` |
| Weather alerts | JMA/TMD/BMKG | No live alert source was enabled or claimed | No alert coverage claim | `coverage_pending` |

The activation result reported `actualMockRows` from a direct native SQLite scan of `vessels`, `ports`, `voyages`, `feed_items`, `events`, `calendar_events`, `ais_positions` and `ais_latest_positions`: `vessels=0`, `ports=0`, `voyages=0`, `feedItems=0`, `events=0`, `calendarEvents=0`, `aisPositions=0`, `aisLatestPositions=0`, `total=0`. The smoke asserts this total and exits non-zero if it is not zero; `mockRows` is retained only as a compatibility alias for the observed object. The real database read path accepts only `real/imported/derived` lineage. No Mock data was promoted into the Real operational read.

## Built Nitro HTTP smoke

The built Nitro HTTP smoke returned HTTP 200 for `/`, `/api/shipping/health`, `/api/shipping`, `/api/shipping/feed`, `/api/shipping/feed/history`, `/api/shipping/calendar`, `/api/shipping/runtime`, `/api/shipping/readiness`, `/api/shipping/search/ports` and `/api/shipping/search/vessels` under process-scoped Mock/Off configuration. Real Operational Readiness was checked separately through the API and remained blocked; an unconfigured real Vessel Search endpoint is not counted as a successful HTTP surface.

- `/api/shipping` returned 8 persisted ports, 17 persisted Feed items and 259 persisted Calendar events, with no Mock rows; it did not trigger a Provider request.
- `/api/shipping/runtime` showed the AISStream Job healthy, two Feed source Jobs healthy, Calendarific healthy, Portcast healthy and Open-Meteo healthy; Voyage was disabled.
- `/api/shipping/readiness` returned `profile=REAL_OPERATIONAL`, `overall=blocked`, `ready=false`. The blocking Runtime scope is the disabled Mock Voyage Job. Any unavailable HTTP pnpm observation is represented as `skipped`/unverified and cannot make Readiness ready. Feed retains source-level details and aggregates them rather than letting the last Feed Job overwrite the first.
- `/` returned the built HTML shell. This is an HTTP surface check; no browser interaction or deployment verification is claimed.

## Boundary

This document records observed requests and persisted/API evidence only. VesselAPI ETA entitlement is **not verified**: no credentialed ETA probe was made, so `entitlement_missing` is not asserted. The evidence also does not establish AIS PositionReport coverage, official weather-alert coverage, commercial Voyage/Schedule availability or permission to begin a later V3 phase.
