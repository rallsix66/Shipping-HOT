# V3 Real Data Live Verification

> Verification date: 2026-09-04 (P7 Final Real-data Seal)
> Scope: controlled local Real Mode activation, persisted/restart evidence, provider-free Repository/API reads, Readiness, browser routes and regression verification. The retained SQLite, Secret values and committed env were not changed.

## Method

`pnpm smoke:v3-real-activation` ran with process-scoped `SHIPPING_DATA_MODE=real`, `SHIPPING_VOYAGE_PROVIDER=vesselapi` and a fresh temporary SQLite path, so retained local data could not contaminate the observation. It exercised the existing registered Runtime Jobs and approved adapters only. `pnpm smoke:v3-readiness` and the provider-free Repository/API paths were verified against the same temporary database; browser routes were checked through a local Nitro dev server. No DeepSeek, JMA, Maritime Executive or Commercial Schedule request was made, and secret values are not recorded here.

## P7 Final Real-data Seal — 2026-09-04

| Check | Result |
| --- | --- |
| Activation | 10 approved Jobs registered; Loadstar `10/10`, Shekou `5/5`, Calendar `259/259`, Port `8/8`, Weather `5/5`, TMD `8/8`, BMKG `3/3`; Voyage and AIS Area safely skipped for no eligible targets; Translation skipped because disabled; exit `0` |
| Readiness | `ready=true`, `overall=degraded`, no failed hard checks; Node `24.15.0`, ABI `137`, pnpm `10.30.3`, better-sqlite3 `12.6.2`, schema `v12`, exact approved core Job set |
| API / Event / HOT | Provider-free API read returned 14 derived Events / 5 active Events and 2 HOT; active evidence was real third-party/derived, with no Mock or mixed operational lineage |
| Restart persistence | New process read Port `8`, Feed `31`, Feed history `62`, Events `13`, Calendar `259`; GET/API/UI reads did not add sync runs or call Providers |
| Zero-Mock | Schema-discovered scan before/after activation, after restart and after UI/API reads reported `actualMockRows.total=0` across all 13 `source_type` business tables |
| UI | `/`, `/vessels`, `/ports`, `/voyages`, `/feed`, `/calendar`, `/settings` and `/events` rendered without loading/error state; Feed showed 33 `查看原文` disclosures and simulated count `0`; Schedule was unavailable; Settings showed fixed DeepSeek metadata and redacted Secret |
| Browser hygiene | Console errors/warnings `0`; React Query Devtools `0`; TanStack Devtools `0` |
| Translation boundary | Temporary settings were disabled with monthly budget `0`; DeepSeek usage was `0`; Translation remains optional Feed title/summary enrichment and Event/HOT Translation is out of scope |
| Full regression | Targeted suite `20 files / 207 tests passed`; full Vitest `63/64 files`, `726/727 tests`; only failure is the pre-existing isolated dated Shekou assertion at `server/providers/feed.test.ts:156` |
| Scope | Retained `.data/shipping-hot-v3.sqlite3` untouched; no new Provider, entitlement, migration, Secret or committed env change |

## Current Accepted Live Evidence Summary — 2026-09-04

This section is a current-state index over evidence already accepted in the dated sections below. It adds no request, response, counter, timestamp or probe result.

| Capability | Current state | Accepted evidence summary | Evidence location |
| --- | --- | --- | --- |
| GFW Vessel Search / canonical identity | `VERIFIED_LIVE` | Credential loading, live search, canonical IMO/MMSI normalization, identity history persistence and provider-free cache/read behavior were accepted. | `GFW Vessel Search + Canonical Identity — 2026-08-31` |
| AIS continuous PositionReport | `VERIFIED_LIVE` | Accepted multi-target continuous evidence persisted a real PositionReport, passed Repository/API reads and SQLite restart, and passed the isolated zero-Mock gate. | `V3 AIS Multi-Target Continuous Live Acceptance — 2026-08-31` |
| AIS Area | `VERIFIED_LIVE` | Independent Area evidence persisted the bounded metric set, passed provider-free reads, clean shutdown and restart readback, and passed the isolated zero-Mock gate. | `V3 AIS Area Background Runtime + Live Acceptance — 2026-08-31` |
| Port Intelligence / Portcast public-page | `VERIFIED_LIVE` | Existing controlled activation evidence persisted Port Directory-aligned public-page enrichment and exposed it through the Repository/API path; uncovered ports remain unavailable rather than inferred. | Historical controlled activation evidence in this document and `docs/status.md` |
| Open-Meteo Weather | `VERIFIED_LIVE` | Existing controlled activation evidence persisted real weather-risk Feed rows with provider-owned weather fields and preserved provider-free reads. | Historical controlled activation evidence in this document and `docs/status.md` |
| TMD official Weather Alerts | `VERIFIED_LIVE` | TMD contract and source-level Runtime evidence were accepted with persisted normalized Feed records, Runtime/sync state and restart readback. | `Official Weather Alerts — Contract Gate and Runtime Acceptance — 2026-09-01` |
| BMKG official Weather Alerts | `VERIFIED_LIVE` | BMKG contract and source-level Runtime evidence were accepted with persisted normalized Feed records, Runtime/sync state and restart readback. | `Official Weather Alerts — Contract Gate and Runtime Acceptance — 2026-09-01` |
| VesselAPI Voyage/ETA Provider path | `VERIFIED_LIVE` | Accepted HANSA evidence verified ETA/Port Event identity, Runtime → SQLite persistence, ETA history, provider-free reads, restart readback and zero-Mock evidence. Operational focus-port coverage remains `COVERAGE_PENDING` because `CNYPG` is outside the formal directory. | `V3 VesselAPI Voyage / ETA — Accepted Live Verification Seal — 2026-09-01` |
| DeepSeek Translation Provider / Runtime | `VERIFIED_LIVE` (optional enrichment) | Translation Provider connectivity/model/credentials were proven live. Automatic Translation Runtime subsequently produced successful real DeepSeek calls and durable successful cache rows. After placeholder reliability repair and controlled circuit recovery, automatic translation resumed and success/cache counters increased without increasing failure count in the observed recovery cycle. Feed UI displayed cached Chinese translations with original disclosure. | Accepted Translation runtime/provider/browser evidence referenced by the 2026-09-03 Translation sections in `docs/status.md` and `docs/architecture.md` |

Translation evidence above describes the live Production Translation Runtime and cached Feed display. It does not claim that the separate T3D server/browser final acceptance has completed beyond the evidence actually accepted by its own finalizer. Translation remains optional, FeedItem `title`/`summary`-only enrichment and outside the REAL_OPERATIONAL hard gate.

## Official Weather Alerts — Contract Gate and Runtime Acceptance — 2026-09-01

| Check | Result |
| --- | --- |
| Contract gate | Three official index requests: JMA HTTP `200` with the official sea-warning container but no safely classified alert/explicit-empty result (`not_verified`); TMD HTTP `200` with recognized RSS/XML structure (`contract_verified_alerts`); BMKG HTTP `200` with recognized RSS/XML structure plus one linked official CAP detail HTTP `200` with CAP `alert`/`info` fields (`contract_verified_alerts`) |
| Public source registry | `tmd` and `bmkg`: `enabled=true`, `liveStatus=verified_live`; `jma`: `enabled=false`, `liveStatus=live_pending` |
| Isolated database | Fresh temporary Real SQLite only; 8 active Port Directory focus ports established through `ShippingRepository`; retained `.data/shipping-hot-v3.sqlite3` was not opened |
| Runtime scope | Only `weather-alert-sync:tmd` and `weather-alert-sync:bmkg`; `capability=weather_alerts`; interval `900000` ms; no AIS, Voyage, Feed, Calendar, Port or model Weather Job executed |
| TMD Job | HTTP `200` through the official registered RSS endpoint; `success`, `recordsRead=12`, `recordsWritten=12`, Runtime `healthy`, trusted `lastSourceUpdatedAt=2026-09-01T02:47:52.000Z` |
| BMKG Job | HTTP `200` through the official registered RSS endpoint; `success`, `recordsRead=3`, `recordsWritten=3`, Runtime `healthy`, trusted `lastSourceUpdatedAt=2026-09-01T02:45:18.000Z` |
| Normalized Feed | `15` total official items; TMD `12`, BMKG `3`; provenance/source IDs and source timestamps were retained; current payloads produced no safely provable focus-port association, so no `relatedPortIds` were fabricated |
| Feed API before restart | HTTP handler read `15` persisted items from sources `tmd`/`bmkg`; no Provider call occurred during the API read |
| SQLite restart | Repository read `15` Feed items; both `provider_runtime` rows were `healthy`; both `sync_runs` remained persisted; a separate post-restart Feed API read returned `15` items from `tmd`/`bmkg` |
| Zero-Mock gate | `actualMockRows.total=0` across all schema-discovered Shipping HOT business tables carrying `source_type` |
| Weather Alert Readiness | `provider=public`, `configured=true`, `credential=not_required`, `runtime=healthy`, `freshness=fresh`, `liveVerification=verified_live`, `status=configured` when both source histories are present |
| Coverage boundary | TMD/BMKG contract/runtime is verified; JMA remains pending; current live items had no safe focus-port alias evidence, and geographic gaps remain explicit rather than inferred |

The initial contract gate did not print response bodies or secrets. It recorded only bounded response metadata and parser-recognizable structure; the formal acceptance stored normalized records in the fresh temporary database, then verified repository/API/restart reads without another Provider call. The temporary database was isolated from the retained database.

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

## V3 AIS Continuous Live Tracker — 2026-08-31

This acceptance run validates the new long-lived AISStream lifecycle. It used only a fresh temporary Real SQLite database and the minimum GFW identity, Watchlist and `AisLiveTracker` dependencies; it did not open the retained database or start other external Runtime Jobs. Discovery frames were never injected into the formal tracker.

| Check | Result |
| --- | --- |
| Runtime configuration | `SHIPPING_DATA_MODE=real`, `SHIPPING_AIS_PROVIDER=aisstream`, `SHIPPING_VESSEL_SEARCH_PROVIDER=gfw`, `SHIPPING_AIS_STREAMING_ENABLED=true`; connection timeout `5000` ms and legacy observation setting `30000` ms remained defaults; `SHIPPING_AIS_INTERVAL_MINUTES` remained `15` for fallback only |
| Singapore discovery | Final 30-second run: raw frames `10`, `SubscriptionConfirmation=1`, `PositionReport=9`, unique valid MMSIs `9`; all observed decoded message types were `SubscriptionConfirmation` or `PositionReport` |
| Selected active candidate | GFW identity `FU CHI`, canonical `imo:9611644`, IMO `9611644`, current MMSI `414720000`, call sign `BPGE`, flag `CHN`, type `OTHER`; discovery observed this MMSI once |
| GFW identity history | One returned identity observation for MMSI `414720000`, transmission range `2012-07-30T02:50:08Z` to `2026-08-29T23:59:44Z`; no alternate MMSI was returned for this candidate |
| Formal Watchlist | One canonical Watchlist target, `ais_enabled=true`, current MMSI `414720000` |
| Formal continuous stream | One fresh socket opened, `SubscriptionConfirmation=1`; at the 120-second deadline Tracker remained `running=true`, `targetCount=1`, `socketCount=1`, `confirmedSocketCount=1` |
| Formal PositionReport | `0`; no valid PositionReport for the selected target was re-observed in the formal 120-second stream |
| SQLite / Runtime | `ais_positions=0`, `ais_latest_positions=0`; `provider_runtime.status=never_succeeded`, no `lastSuccessAt` or `lastSourceUpdatedAt`; `lastMessageAt` and `lastPersistedAt` absent |
| Shutdown | Tracker stopped with `running=false`, target/socket/confirmed counts `0`; tracked socket handle reported closed and timers were cleared |
| Restart / API read | Not run because no formal position existed to validate; existing provider-free API/repository read isolation remains covered by targeted tests |
| Zero-Mock Gate | Schema-discovered `actualMockRows.total=0` across all lineage-bearing business tables |
| Acceptance Gate | `coverage_pending`; canonical reason `active_candidate_not_reobserved_on_continuous_stream` |

The run confirms the continuous lifecycle and subscription acceptance, but it does not establish `verified_live`: discovery coverage was not re-observed by the selected-MMSI formal stream. No AIS position was manually inserted, no Mock fallback was used, no database schema or retained SQLite was touched, and the temporary database was removed after the run.

## V3 AIS Multi-Target Continuous Live Acceptance — 2026-08-31

This is the current formal AIS evidence. It used a fresh filesystem temporary Real SQLite database, closed discovery before formal tracking, and did not open or write the retained database.

| Check | Result |
| --- | --- |
| Credentials | `AISSTREAM_API_KEY` and `GFW_API_TOKEN` configured from the server environment; secret values were not recorded |
| Singapore discovery | 45.1 seconds; raw frames `7`; `SubscriptionConfirmation=1`; `PositionReport=6`; unique valid MMSIs `6` |
| Discovery Top 10 | `572549220(1)`, `563080160(1)`, `269047000(1)`, `525121064(1)`, `564298000(1)`, `538012811(1)` |
| GFW resolution | `6/6` discovery candidates resolved to current/latest MMSI matches |
| Formal candidates | `6`: VALLIANZ PRESTIGE / IMO `9978846` / MMSI `572549220`; MPA GUARDIAN / no IMO / `563080160`; ST-CERGUE / IMO `9775373` / `269047000`; JENGGALA BANGO / IMO `9394208` / `525121064`; JET FLYTE II / IMO `9149615` / `564298000`; GRAND NEPTUNE / IMO `9303209` / `538012811` |
| Canonical identities | `imo:9978846`, `mmsi:563080160`, `imo:9775373`, `imo:9394208`, `imo:9149615`, `imo:9303209` |
| Formal subscription | One socket, `SubscriptionConfirmation=1`; `FiltersShipMMSI` contained exactly the six current candidate MMSIs |
| First formal observation | VALLIANZ PRESTIGE / IMO `9978846` / MMSI `572549220`; PositionReport provider timestamp `2026-08-31T11:32:15.242Z`; latitude `1.2172833333`; longitude `103.7730733333` |
| Persistence | `ais_positions=1`; winner `ais_latest_positions=1`; `source=aisstream`; `sourceType=real` |
| Runtime / Tracker | `provider_runtime=healthy`, `lastSuccessAt=2026-08-31T11:32:16.568Z`, `lastSourceUpdatedAt=2026-08-31T11:32:15.242Z`, `consecutiveFailures=0`; Tracker `running=true`, `targetCount=6`, `socketCount=1`, `confirmedSocketCount=1` before clean shutdown |
| Repository / API | Read-back succeeded with `sourceStatus=healthy`, `stale=false`; API/service read made zero AIS/GFW calls |
| Restart | All six metadata records and Watchlist records persisted; winner position/latest-position persisted; restart Repository/API reads made zero Provider calls |
| Zero-Mock Gate | Schema-discovered `actualMockRows.total=0` |
| Readiness | With the real continuous Tracker evidence: `runtime=healthy`, `freshness=fresh`, `liveVerification=verified_live`, `status=configured` |
| Acceptance Gate | `verified_live`; canonical reason `multi_target_continuous_ais_position_persisted_and_restarted` |

Readiness now derives AIS `verified_live` from the real continuous runtime evidence; it does not infer it from credential presence alone. Historical success remains visible when the current runtime is degraded/failed or the source timestamp is stale, while streaming-disabled, Mock, missing-credential and no-observation states remain unverified/coverage-pending as appropriate. This acceptance does not verify Voyage/ETA, AIS Area or official weather-alert coverage.

## V3 AIS Area Background Runtime + Live Acceptance — 2026-08-31

This is the isolated Area acceptance. It used a fresh temporary Real SQLite, the eight formal Port Directory ports and one persistent Area AISStream session; the retained database was not opened.

| Check | Result |
| --- | --- |
| Runtime configuration | `SHIPPING_DATA_MODE=real`, `SHIPPING_AIS_AREA_PROVIDER=aisstream`, default interval `60000` ms; eight watched ports produced eight subscription bounding boxes and no `FiltersShipMMSI` |
| Credential | Server-side `FileSecretStore` resolved the configured `AISSTREAM_API_KEY`; the value was not recorded |
| Raw/decoded frames | `socketOpened=1`, `subscriptionsSent=1`, `subscriptionConfirmations=1`, `positionReportsReceived=9`, `validPositionReports=9`, `assignedPortSamples=9`, `ambiguousSamples=0`, `sourceTimestampPresent=9`, `distinctMmsi=8` |
| Runtime Job | `ais-area-sync` / `aisstream-area` / `ais_area`; latest successful sync had `recordsRead=7`, `recordsWritten=8`; runtime `healthy`, `consecutiveFailures=0` |
| Shekou metric | `port-shekou` / `CNSHK`; `sampleSize=6`, `activeVesselCount=6`, `anchoredCount=0`, `mooredCount=1`, `lowSpeedCount=3`, `stationaryRatio=0.1666666667`, `ambiguousSampleCount=0`, `coverage=usable`, `trend=unknown` |
| Timestamp policy | Shekou trusted `sourceUpdatedAt=2026-08-31T14:32:12.983Z`; local `fetchedAt=2026-08-31T14:32:21.319Z` remained separate |
| Persistence | Eight derived `ais_port_metrics` rows were persisted; Repository/snapshot reads had zero Provider stats delta |
| Lifecycle / restart | Shutdown closed the socket; restart preserved all eight watched ports and eight metrics, including Shekou; post-close stats remained unchanged |
| Zero-Mock gate | Fresh isolated database reported `actualMockRows.total=0`, including `ais_port_metrics`, ports and events; retained `.data/shipping-hot-v3.sqlite3` was unchanged |
| Acceptance Gate | `verified_live`; canonical reason `real_ais_area_metric_persisted_and_restarted` |
| Readiness | `provider=aisstream`, `credential=available`, `runtime=healthy`, `freshness=fresh`, `liveVerification=verified_live`, `status=configured`; Readiness consumes the persisted qualifying `ais_port_metrics` row read-only |

The Area path reuses the hardened AISStream binary/trust parser, treats `SubscriptionConfirmation` as connection evidence only, validates MMSI/metadata/coordinates/provider timestamps, and guards asynchronous Blob decoding against stale socket generations and configuration snapshots. The separate Readiness alignment reads existing Real `ais_port_metrics` evidence without opening a Provider or writing SQLite: a qualifying `aisstream-area` metric with positive sample/minimum thresholds and a parseable `sourceUpdatedAt` remains historical evidence when coverage is usable or stale; insufficient or malformed evidence stays pending. No schema, migration, raw observation table, retained SQLite, UI, Vessel Tracking, Voyage, Weather or Feed behavior was changed.

## V3 VesselAPI Voyage / ETA — Accepted Live Verification Seal — 2026-09-01

This section records previously accepted live evidence. This documentation seal performs no new Provider request and does not claim a new live run.

| Check | Result |
| --- | --- |
| Engineering | VesselAPI Voyage/ETA `SEALED`; real adapter runs behind the existing Provider → factory → Runtime → Repository boundary, with no Mock fallback in Real Mode |
| Target identity | HANSA BREITENBURG; local `vesselId=imo:9155391`; IMO `9155391`; MMSI `538090733` |
| VesselAPI ETA | HTTP `200`; identity validation `PASSED`; official `destination_port=CNYPG`; official ETA `2026-08-31T21:00:00Z`; trusted provider timestamp `2026-08-29T16:07:07Z` |
| Port Event | HTTP `200`; `Departure` at `THLCH`; `originPortId=THLCH` |
| Production path | `VesselAPI Provider → factory → Voyage Runtime → VoyageRepository → SQLite`; `recordsRead=1`, `recordsWritten=1`, `voyages=1`, ETA history `1`, `newEpisodes=1` |
| Persisted episode | `vesselapi:imo:9155391:destination:CNYPG:episode:20260829T160707000Z`; `episodeState=current`; `voyageNumber=undefined`; `status=unknown`; `etd=undefined` |
| ETA state | `baselineEta=2026-08-31T21:00:00.000Z`; `latestEta=2026-08-31T21:00:00.000Z`; `delayMinutes=0` |
| Runtime | `provider_runtime=healthy`; `lastSourceUpdatedAt=2026-08-29T16:07:07.000Z`; `sync_run=success` |
| Persistence / reads | Voyage API read and `ShippingRepository` read passed without Provider calls; SQLite restart, restart Repository read, ETA-history read and API read passed; Provider calls during reads/restart `0` |
| Zero-Mock | Isolated evidence reported `actualMockRows.total=0` |
| Focus-port coverage | Official `CNYPG` is outside the current eight-port directory, so `canonical destinationPortId=undefined`; `focusPortCoverageObserved=false`; operational status `coverage_pending`; reason `vesselapi_focus_port_coverage_pending` |
| Provider status | `liveVerification=VERIFIED_LIVE`; focus-port coverage is separate `PARTIAL / COVERAGE_PENDING` and does not invalidate Provider verification |

IRIS MIKO is recorded only as a boundary check: IMO `9327566`, MMSI `548156600`; VesselAPI ETA HTTP `200` with matching identity, but no official `destination_port`. The Provider emitted no Voyage observation and Runtime returned `skipped/no_voyage_eta_observed`. PPA Manila pre-screen evidence is not official VesselAPI destination evidence.

The accepted deterministic repairs are referenced by commit: PortDirectory binding `8fc97c0227c66acf7c7f0aab78edcb48d2e5213a`; Provider live verification/focus-port coverage split `720beff0b3d52892baecd1cfc0151c7b7df2bf9a`; stable Episode anchor validation against the first trusted ETA history `bf7df46b7095d51a37e316fcaddda2260663dfa4`.

The formal focus directory remains `CNSHK`, `CNYTN`, `CNNSA`, `THLCH`, `MYPKG`, `PHMNL`, `IDJKT` and `VNSGN`; no Port Directory change is implied. No secret, Authorization header or raw provider payload is recorded.

## Historical Provider and persistence evidence

| Capability | Provider | Observation | SQLite / API evidence | Status |
| --- | --- | --- | --- | --- |
| AIS tracking | AISStream | Latest multi-target continuous acceptance persisted a real PositionReport and survived SQLite restart; earlier no-target/no-observation runs remain historical | `ais_positions` and `ais_latest_positions` contain the accepted temporary-run evidence; Repository/API reads are provider-free | `verified_live` |
| Voyage / ETA | VesselAPI adapter, accepted live evidence for HANSA | ETA HTTP `200` plus Port Event HTTP `200`; identity passed; official destination `CNYPG`; origin `THLCH` | One real voyage and one ETA-history row persisted; provider-free API/Repository reads and SQLite restart passed; `actualMockRows.total=0` | Provider `verified_live`; focus coverage `partial/coverage_pending` |
| Feed — The Loadstar | Public RSS | 10 normalized items fetched | Real Feed rows persisted; current/history API available | `verified_live` |
| Feed — Shekou official | Public HTML | 5 normalized items fetched | Real Feed rows persisted; publication/freshness policy controls current vs history visibility | `verified_live` |
| Calendar | Calendarific | 259 events fetched for CN, ID, MY, PH, TH and VN | Real Calendar rows persisted and Calendar API returned them; official/manual completeness remains separate | `coverage_pending` |
| Port Intelligence | Portcast public pages | 8 Port Directory-aligned port rows fetched | Real Port rows persisted; legacy Shipping API returned 8 ports | `verified_live` |
| Weather model | Open-Meteo Marine | 7 weather-risk Feed rows fetched with wind/gust/window fields | Real Feed rows persisted; `/api/shipping/feed` returned model fields | `verified_live` |
| Weather alerts | TMD/BMKG official source Jobs; JMA disabled | TMD/BMKG contract/runtime/restart evidence is accepted; JMA remains `LIVE_PENDING` and geographic/focus-port association coverage is partial | TMD/BMKG normalized Feed rows, Runtime/sync persistence and restart readback; no fabricated port relation | `PARTIAL / VERIFIED_LIVE for enabled TMD/BMKG` |
| Translation | DeepSeek `deepseek-v4-flash` | Connectivity/model/credentials, automatic Runtime success/cache/usage, placeholder recovery, controlled circuit recovery and cached Chinese Feed UI with original disclosure are accepted | Durable Translation cache/usage evidence and provider-free Feed display; Translation remains optional and FeedItem-only | `VERIFIED_LIVE` |

The activation result reported `actualMockRows` from a direct native SQLite schema-discovered scan of every business table carrying `source_type`: `ais_latest_positions=0`, `ais_port_metrics=0`, `ais_positions=0`, `calendar_events=0`, `events=0`, `feed_item_history=0`, `feed_items=0`, `ports=0`, `vessel_metadata=0`, `vessel_search_cache=0`, `vessels=0`, `voyage_eta_history=0`, `voyages=0`, `total=0`. System/metadata tables are explicitly excluded. The smoke asserts this total and exits non-zero if it is not zero; `mockRows` is retained only as a compatibility alias for the observed object. The real database read path accepts only `real/imported/derived` lineage. No Mock data was promoted into the Real operational read.

This historical section seals zero-Mock gate coverage for its activation review and the accepted AIS/Voyage evidence. The current P7 Final Real-data Seal above supersedes its earlier readiness statement: Voyage focus-port coverage remains `coverage_pending` for `CNYPG`, Calendar completeness and selected alert geography remain partial, while the final controlled Readiness result is `ready=true / overall=degraded` with no failed hard checks.

## V3 VesselAPI recurring Voyage episode repair — 2026-09-01 (historical repair checkpoint)

This was a deterministic Repository/Runtime repair checkpoint before the later accepted live run. No `VESSELAPI_API_KEY` was configured or used in that repair, no live request was made in that repair, and no retained SQLite database was opened. The accepted live evidence is recorded in the seal above.

- The stateless VesselAPI adapter now emits a candidate identity containing the normalized official destination and trusted ETA timestamp. The Repository resolves same-destination updates to the current persisted row, creates a new row only for a strictly newer destination transition, rejects stale/equal cross-destination transitions, and persists `episodeState=current|superseded` plus `supersededAt` in existing `voyages.data` JSON.
- Regression coverage proves `PHMNL → SGSIN → PHMNL` yields three historical rows, resets the returning episode baseline, survives native SQLite restart, retains optional Port Event/canonical destination enrichment behavior, and keeps historical rows visible through `ShippingRepository` while excluding superseded VesselAPI episodes from Voyage delay Event/HOT detection.
- No migration, code outside the Voyage episode boundary or retained SQLite data was touched by that repair; this historical note records deterministic hardening only, not the later live acceptance.

## V3 Real Voyage / ETA — VesselAPI adapter contract alignment — 2026-09-01 (pre-acceptance checkpoint)

| Check | Result |
| --- | --- |
| Official contract | Base `https://api.vesselapi.com/v1`; ETA `GET /vessel/{id}/eta` with `filter.idType=imo|mmsi`; optional latest Port Event `GET /portevents/vessel/{id}/last`; Bearer authentication |
| Adapter | `providerId=vesselapi`; server-side SecretStore only; IMO preferred and legal MMSI fallback; bounded requests; no Mock fallback |
| Credential gate | Historical pre-acceptance checkpoint: `VESSELAPI_API_KEY configured=false`; no secret value was recorded and no live request was made at that checkpoint |
| Contract repair | ETA and Port Event identities are validated against the requested vessel; Port Event is optional enrichment and fails closed on errors/mismatch; official `destination_port` plus local vessel ID form a stable episode key; Port Directory resolution is fail-closed; `voyage_eta_history` remains append-only |
| Runtime gate | No eligible targets → `skipped/no_eligible_voyage_targets`; eligible targets with no ETA → `skipped/no_voyage_eta_observed`; only a persisted trusted real observation returns `success` |
| Timestamp / identity | ETA `timestamp` alone owns Voyage freshness; Port Event timestamp is enrichment-only; missing ETA timestamp or destination yields no usable observation; requested canonical identity is never overwritten |
| Mock isolation | Mock Mode force-selects `mock-voyage` even when `SHIPPING_VOYAGE_PROVIDER=vesselapi`; direct factory selection fails closed; Real Mode has no Mock fallback |
| Readiness | Current semantics are split: accepted Provider evidence gives `liveVerification=verified_live`; focus-port mapping is separately observed. For HANSA, `CNYPG` has no canonical focus-port mapping, so operational status remains `coverage_pending` with reason `vesselapi_focus_port_coverage_pending` |
| Persistence/API | No retained SQLite was opened or written; API remains Repository/SQLite-only and provider-call delta is zero for reads |
| Live acceptance | The later accepted HANSA live run is recorded in the VesselAPI seal above; this row is retained as a pre-acceptance historical checkpoint |

VesselAPI documents describe ETA as an AIS/crew-reported observation rather than a commercial schedule. No ETA, origin, ETD or commercial voyage number was fabricated from missing fields. No new migration was added; migration 008 already supports nullable Voyage fields.

## Historical Built Nitro HTTP smoke

The built Nitro HTTP smoke returned HTTP 200 for `/`, `/api/shipping/health`, `/api/shipping`, `/api/shipping/feed`, `/api/shipping/feed/history`, `/api/shipping/calendar`, `/api/shipping/runtime`, `/api/shipping/readiness`, `/api/shipping/search/ports` and `/api/shipping/search/vessels` under process-scoped Mock/Off configuration. Real Operational Readiness was checked separately through the API and remained blocked; an unconfigured real Vessel Search endpoint is not counted as a successful HTTP surface.

- `/api/shipping` returned 8 persisted ports, 17 persisted Feed items and 259 persisted Calendar events, with no Mock rows; it did not trigger a Provider request.
- `/api/shipping/runtime` showed the historical 2026-08-29 activation state (AISStream Job healthy, two Feed source Jobs healthy, Calendarific healthy, Portcast healthy and Open-Meteo healthy; Voyage disabled). The 2026-08-30 review-gap closure changes the no-target AIS state to skipped/never_succeeded and is covered by the Runtime regression tests above.
- `/api/shipping/readiness` returned `profile=REAL_OPERATIONAL`, `overall=blocked`, `ready=false`. The blocking Runtime scope is the disabled Mock Voyage Job. Any unavailable HTTP pnpm observation is represented as `skipped`/unverified and cannot make Readiness ready. Feed retains source-level details and aggregates them rather than letting the last Feed Job overwrite the first.
- `/` returned the built HTML shell. This is an HTTP surface check; no browser interaction or deployment verification is claimed.

## Boundary

This document records observed requests and persisted/API evidence only. The accepted HANSA evidence verifies the VesselAPI ETA contract, identity trust, Port Event enrichment, Runtime persistence, provider-free reads and restart behavior. It does not claim full focus-port operational coverage: `CNYPG` remains outside the current directory, so Voyage status is `coverage_pending` with reason `vesselapi_focus_port_coverage_pending`. The current project phase is `V3 — FINAL SEALED`; P7-A through P7-G are complete and post-V3 enhancements require separate approval.
