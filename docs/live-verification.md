# V3 Real Data Live Verification

> Verification date: 2026-08-30 (review-gap closure; original activation evidence is dated 2026-08-29)
> Scope: controlled local Real Mode process only. No deployment, provider account change, secret creation or new Provider was performed.

## Method

`pnpm smoke:v3-real-activation` loaded the existing server environment and set `SHIPPING_DATA_MODE=real` for that process only. For this review it used a fresh process-scoped SQLite path so pre-existing Mock/Off local data could not contaminate the observation; it ran the registered Runtime Jobs, then a built Nitro process was smoke-tested separately with process-scoped Mock/Off configuration across the HTTP surfaces. Secret values are not recorded here.

## V3 AIS Live PositionReport Verification — 2026-08-29

| Check | Result |
| --- | --- |
| Capability / Provider | AIS Tracking / AISStream |
| Credential | `configured: true`; `source: environment`; `maskedLast4: ****dbcf` |
| Watched vessel / MMSI | None. The current SQLite `vessel_watchlist` has no eligible canonical real watched vessel with a valid MMSI. |
| Connection | Not attempted; the no-target stop condition was met before opening a WebSocket. |
| PositionReport | Not observed; valid count `0`. |
| SQLite | `ais_positions` row count `0`; `ais_latest_positions` result `none`; no live write occurred. |
| Restart persistence | Not run because no real PositionReport was written. |
| Repository / API | Existing latest-position surface remains Repository → SQLite-only; no Provider call is made during API reads. No target row was available to return. |
| UI | Existing Vessel detail AIS surface is wired to the latest-position API and can display source timestamp/source/stale state; no real position was available to display in this run. |
| Last-known failure | Not simulated because this run produced no real last-known observation; no Mock fallback was used. |
| Zero-Mock Gate | Isolated fresh Real activation smoke passed with `actualMockRows.total=0`, including `ais_positions=0` and `ais_latest_positions=0`. The same gate against the retained mixed local database failed with `total=16` from pre-existing Mock/Test rows outside the AIS tables; no cleanup was performed. |
| Status | `coverage_pending`; Live Gate blocked until the user selects/provides a real watched MMSI. |

The AISStream adapter hardening verified in this batch rejects non-9-digit MMSI values, ignores PositionReports outside the watched target set, and never promotes a local `fetchedAt` into a trusted source timestamp. These checks do not constitute live-provider evidence.

## AIS Live Verification Review Gap Closure — 2026-08-30

| Check | Result |
| --- | --- |
| No-target Runtime | Empty/invalid watchlist returns `skipped`, `errorCode=no_eligible_ais_targets`, and message `No eligible watched vessel with valid MMSI`; the Provider function was called `0` times. |
| No-target runtime state | First-run `provider_runtime` remains `never_succeeded`, `lastSuccessAt` remains absent, `errorCode=no_eligible_ais_targets`; `sync_runs` is `skipped`. A prior success retains its `lastSuccessAt` and is not replaced by a no-target skip. |
| Provider usage | No-target execution increments only capability sync `request_count`; `success_count` and `failure_count` remain unchanged. `request_count` is not an HTTP/WebSocket request count. |
| Last-known failure | A persisted Real position remains available after `ProviderError(provider_timeout)`; the read service joins the current AIS runtime health without calling the Provider. |
| Fresh at +1 minute | `stale=false`, `sourceStatus=degraded`, `errorCode=provider_timeout`. |
| Freshness boundary at +16 minutes | `stale=true`, `sourceStatus=degraded`, `errorCode=provider_timeout`. Position freshness and Provider health remain separate dimensions. |
| Healthy success | Valid target + PositionReport returns `sourceStatus=healthy` with no error code and preserves the Provider timestamp. |
| UI | Vessel detail now uses `latestPosition.sourceStatus`; degraded/failed last-known data is labeled as the previous real position, with the AISStream source label retained. |
| Live status | Still `coverage_pending`: the real watchlist has no eligible MMSI, so no live socket or fabricated PositionReport was introduced. |

The retained development database remains unchanged with its 16 historical Mock/Test rows; the isolated fresh Real zero-Mock result remains the valid activation evidence. No later V3 workstream was started.

Validation for this closure: AIS-targeted tests passed `18/18`, typecheck, lint and build passed, and P0/P2C/P3A smoke checks passed. The full suite reported `358/359` with one unrelated date-sensitive Feed test failure in `server/providers/feed.test.ts`; no Feed code or test was changed in this AIS-only scope.

## Provider and persistence evidence

| Capability | Provider | Observation | SQLite / API evidence | Status |
| --- | --- | --- | --- | --- |
| AIS tracking | AISStream | No eligible watched MMSI was available; the batch stopped before opening a live socket | No AIS position row was written; the existing API/UI surface remains available for a future persisted observation | `coverage_pending` |
| Voyage / ETA | None in Real Mode | Job was disabled because only the Mock Voyage adapter is available and no real key/adapter was configured | Readiness correctly blocks on the disabled Voyage Job; VesselAPI ETA entitlement is **not verified** and no ETA claim is made | `credential_missing` |
| Feed — The Loadstar | Public RSS | 10 normalized items fetched | Real Feed rows persisted; current/history API available | `verified_live` |
| Feed — Shekou official | Public HTML | 5 normalized items fetched | Real Feed rows persisted; publication/freshness policy controls current vs history visibility | `verified_live` |
| Calendar | Calendarific | 259 events fetched for CN, ID, MY, PH, TH and VN | Real Calendar rows persisted and Calendar API returned them; official/manual completeness remains separate | `coverage_pending` |
| Port Intelligence | Portcast public pages | 8 Port Directory-aligned port rows fetched | Real Port rows persisted; legacy Shipping API returned 8 ports | `verified_live` |
| Weather model | Open-Meteo Marine | 7 weather-risk Feed rows fetched with wind/gust/window fields | Real Feed rows persisted; `/api/shipping/feed` returned model fields | `verified_live` |
| Weather alerts | JMA/TMD/BMKG | No live alert source was enabled or claimed | No alert coverage claim | `coverage_pending` |

The activation result reported `actualMockRows` from a direct native SQLite schema-discovered scan of every business table carrying `source_type`: `ais_latest_positions=0`, `ais_port_metrics=0`, `ais_positions=0`, `calendar_events=0`, `events=0`, `feed_item_history=0`, `feed_items=0`, `ports=0`, `vessel_metadata=0`, `vessel_search_cache=0`, `vessels=0`, `voyage_eta_history=0`, `voyages=0`, `total=0`. System/metadata tables are explicitly excluded. The smoke asserts this total and exits non-zero if it is not zero; `mockRows` is retained only as a compatibility alias for the observed object. The real database read path accepts only `real/imported/derived` lineage. No Mock data was promoted into the Real operational read.

This seals zero-Mock gate coverage for the review only; it does not claim `Real Operational Ready` because AIS PositionReport, real Voyage/ETA, VesselAPI credentials and official weather-alert coverage remain pending.

## Built Nitro HTTP smoke

The built Nitro HTTP smoke returned HTTP 200 for `/`, `/api/shipping/health`, `/api/shipping`, `/api/shipping/feed`, `/api/shipping/feed/history`, `/api/shipping/calendar`, `/api/shipping/runtime`, `/api/shipping/readiness`, `/api/shipping/search/ports` and `/api/shipping/search/vessels` under process-scoped Mock/Off configuration. Real Operational Readiness was checked separately through the API and remained blocked; an unconfigured real Vessel Search endpoint is not counted as a successful HTTP surface.

- `/api/shipping` returned 8 persisted ports, 17 persisted Feed items and 259 persisted Calendar events, with no Mock rows; it did not trigger a Provider request.
- `/api/shipping/runtime` showed the historical 2026-08-29 activation state (AISStream Job healthy, two Feed source Jobs healthy, Calendarific healthy, Portcast healthy and Open-Meteo healthy; Voyage disabled). The 2026-08-30 review-gap closure changes the no-target AIS state to skipped/never_succeeded and is covered by the Runtime regression tests above.
- `/api/shipping/readiness` returned `profile=REAL_OPERATIONAL`, `overall=blocked`, `ready=false`. The blocking Runtime scope is the disabled Mock Voyage Job. Any unavailable HTTP pnpm observation is represented as `skipped`/unverified and cannot make Readiness ready. Feed retains source-level details and aggregates them rather than letting the last Feed Job overwrite the first.
- `/` returned the built HTML shell. This is an HTTP surface check; no browser interaction or deployment verification is claimed.

## Boundary

This document records observed requests and persisted/API evidence only. VesselAPI ETA entitlement is **not verified**: no credentialed ETA probe was made, so `entitlement_missing` is not asserted. The evidence also does not establish AIS PositionReport coverage, official weather-alert coverage, commercial Voyage/Schedule availability or permission to begin a later V3 phase.
