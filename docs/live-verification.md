# V3 Real Data Live Verification

> Verification date: 2026-08-30 (review-gap closure; original activation evidence is dated 2026-08-29)
> Scope: controlled local Real Mode process only. No deployment, provider account change or secret creation was performed; the GFW Provider implementation and live probe are recorded separately below.

## Method

`pnpm smoke:v3-real-activation` loaded the existing server environment and set `SHIPPING_DATA_MODE=real` for that process only. For this review it used a fresh process-scoped SQLite path so pre-existing Mock/Off local data could not contaminate the observation; it ran the registered Runtime Jobs, then a built Nitro process was smoke-tested separately with process-scoped Mock/Off configuration across the HTTP surfaces. Secret values are not recorded here.

## GFW Vessel Search + Canonical Identity — 2026-08-31

| Check | Result |
| --- | --- |
| Capability / Provider | Vessel Search / GFW (`providerId=gfw`) |
| Credential | `configured: true`; loaded server-side from `.env.local`; only the redacted suffix was observed during the probe |
| Isolated database | Fresh temporary SQLite only; deleted after the probe; retained `.data/shipping-hot-v3.sqlite3` was not opened for this verification |
| HANSA first search | HTTP `200`, `cacheHit=false`, `resultsCount=1`; canonical `imo:9155391`, current MMSI `538090733`, Call Sign `V7B3029`, Flag `MHL` |
| HANSA repeat | HTTP `200`, `cacheHit=true`; zero additional GFW fetches |
| IMO search | HTTP `200`, `cacheHit=false`, one result pointing to the same `imo:9155391` canonical vessel |
| HANSA identity history | Raw 3 identities → canonical 1; historical MMSIs retained: `636090756`, `770308484`, `538090733` |
| DONG FANG FU | HTTP `200`, `cacheHit=false`, 16 canonical candidates; separate IMO examples `9162423` and `4837047` remained distinct |
| Watchlist / AIS target smoke | Watchlist used `imo:9155391` and current MMSI `538090733`; AIS target selection emitted only that MMSI; no PositionReport was requested |
| Status | `verified_live` for GFW authentication/search/normalization; this does not verify AIS PositionReport, Voyage/ETA or official weather-alert coverage |

The probe used `loadServerEnv()` and the existing `FileSecretStore` mapping (`gfw` → `GFW_API_TOKEN`), with no token value in code, SQLite, logs or this document. The GFW adapter is separate from VesselAPI and provider-aware cache keys prevent an empty cache from one provider blocking another.

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

## AIS Zero-Observation Runtime Semantics Repair — 2026-08-31

| Check | Result |
| --- | --- |
| Isolated database | Fresh temporary Real SQLite only; retained `.data/shipping-hot-v3.sqlite3` was not opened and the temporary database was cleaned after the probe |
| Watched vessel / MMSI | HANSA BREITENBURG / IMO `9155391` / current MMSI `538090733` |
| Production-default observation | AISStream socket opened and subscription sent; default window `2500ms`; PositionReport count `0` |
| Runtime result | `skipped`, `errorCode=no_ais_position_observed`, `recordsRead=0`, `recordsWritten=0` |
| Provider runtime | `status=never_succeeded`; `lastSuccessAt` and `lastSourceUpdatedAt` absent |
| Provider usage | `request_count=1`, `success_count=0`, `failure_count=0`, `records_count=0` |
| Sync run | `status=skipped`, `errorCode=no_ais_position_observed` |
| SQLite positions | `ais_positions=0`; `ais_latest_positions=0` |
| Extended probe | Not repeated; the prior 120-second probe already observed `0` PositionReports |
| Gate | `coverage_pending`; no verified live PositionReport was obtained |

This repair changes only the Runtime interpretation of a normal empty AIS observation. AISStream timeout, GFW, Watchlist, UI, schema and other V3 workstreams were not changed.

## AISStream Binary Frame Diagnostic + Parser Repair — 2026-08-31

| Check | Result |
| --- | --- |
| Raw diagnostic | Direct Node 24 WebSocket probe received `4` binary `Blob` frames: `SubscriptionConfirmation=1`, `PositionReport=3` |
| Parser evidence | `binary_frame_verified=true`; all observed `event.data` values were `Blob` with UTF-8 JSON payloads |
| Production repair | Parser now supports string, `ArrayBuffer`, `ArrayBufferView`/Node `Buffer` and `Blob`; malformed/unsupported frames fail closed |
| Post-repair discovery | One Singapore run observed `11` binary frames (`SubscriptionConfirmation=1`, `PositionReport=10`); the integrated run observed `9` (`1`, `8`) |
| GFW / Watchlist | Selected real candidate `PSA SHURI CS08`, `imo:9951604`, IMO `9951604`, current MMSI `563185100`, callsign `9V8666`, flag `SGP`; one eligible AIS target was created in the isolated temporary database |
| Production-default AIS runs | Three runs opened the socket and sent the subscription but each returned `skipped/no_ais_position_observed`, with `recordsRead=0` and `recordsWritten=0` |
| Extended same-target probe | A separate 30-second probe received one real PositionReport for MMSI `563185100`; this is evidence of coverage, not a successful production-default job run |
| Gate | `changes_required/runtime_sampling_window_too_short`; no timeout/default was changed and no `verified_live` claim was made |
| Persistence | Retained `.data/shipping-hot-v3.sqlite3` was not opened; the fresh temporary SQLite was cleaned after the probe and no formal AIS position persistence/restart/API proof was produced |
| Verification | Provider tests `14/14`, AIS Runtime/Watchlist targets `33/33`, typecheck, lint and build passed; full suite `383/384` with only the existing date-sensitive Feed failure |

The diagnostic and re-probe used server-side credentials only and did not log an API key or raw AIS payload. No GFW, Watchlist, timeout, schema, migration, Feed, Voyage, Weather or Translation implementation was changed; the only implementation change was binary-frame parsing plus SubscriptionConfirmation handling.

## V3 AIS Runtime Sampling Window Repair + Live Acceptance — 2026-08-31

This was a formal isolated Real acceptance run after the binary-frame repair. It kept the normal Runtime cadence and did not widen the observation window.

| Check | Result |
| --- | --- |
| Runtime configuration | `SHIPPING_DATA_MODE=real`, `SHIPPING_AIS_PROVIDER=aisstream`, `SHIPPING_VESSEL_SEARCH_PROVIDER=gfw`; connection timeout `5000` ms, observation window `30000` ms; cadence remained `15` minutes (`900000` ms) |
| GFW identity | `PSA SHURI CS08`, GFW vessel `imo:9951604`, IMO `9951604`, current MMSI `563185100`, callsign `9V8666`, flag `SGP`; historical MMSIs `563185100`, `565282252`, `376000000` |
| Watchlist | One canonical target added with `ais_enabled=true`, eligible MMSI `563185100` |
| Runtime run 1 | `skipped/no_ais_position_observed`; `recordsRead=0`, `recordsWritten=0` |
| Runtime run 2 | `skipped/no_ais_position_observed`; `recordsRead=0`, `recordsWritten=0` |
| Provider Runtime / sync | `never_succeeded`; no success/source timestamps; sync status `skipped`; `provider_usage`: `request_count=2`, `success_count=0`, `failure_count=0`, `records_count=0` |
| Persistence | Fresh temporary SQLite only; `ais_positions=0`, `ais_latest_positions=0`; retained `.data/shipping-hot-v3.sqlite3` was not opened or written |
| Repository/API read | No position returned; service/API read caused `0` Provider calls; no source, stale or Runtime source-status position evidence existed because no position was persisted |
| Restart | Metadata and watchlist were present; position/latest-position absent; GFW/AIS calls during read `0` |
| Zero-Mock gate | Schema-discovered `actualMockRows.total=0` |
| Acceptance gate | `coverage_pending`; canonical reason `active_target_not_observed_in_runtime_window` |

The earlier independent 30-second diagnostic PositionReport was not used as formal acceptance evidence. The normal window was not enlarged, no manual position was inserted, and the temporary database was removed after the probe. No GFW, Watchlist, schema, migration, AIS interval, Voyage, AIS Area, Feed, Weather, Translation or UI implementation was changed beyond the approved sampling-window repair.

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
