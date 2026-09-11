# V3 Real Data Provider Matrix

> Current final-seal date: 2026-09-04
> Scope: current branch code/configuration, accepted isolated evidence, final controlled Real Mode Runtime/SQLite/API/UI acceptance and Neat Freak closeout. Retained SQLite and committed environment were not changed; no new Provider, paid entitlement, schema migration or Secret was introduced.
> Status vocabulary for current rows: `SEALED`, `IMPLEMENTED`, `VERIFIED_LIVE`, `COVERAGE_PENDING`, `LIVE_PENDING`, `CREDENTIAL_MISSING`, `OUT_OF_SCOPE`, `NOT_STARTED`, `PARTIAL`, `BLOCKED`.

## Reading this matrix

These columns are intentionally separate:

- **配置** describes what the local environment requests. It is not proof that Real Mode is active.
- **Secret** reports only whether a credential is present and where the server-side loader can obtain it; secret values are never recorded here.
- **真实请求** requires an actual request against the named provider. Fixtures, parser tests and Mock responses do not count.
- **状态** is the current conservative status. Provider live verification and product focus-port coverage are separate dimensions; a Provider may be `verified_live` while operational coverage remains `coverage_pending`.

The application defaults to `mock` unless a caller explicitly sets `SHIPPING_DATA_MODE=real`. Real Mode remains process-scoped and fail-closed; the safe default and local files were not changed. `SHIPPING_VESSEL_PROVIDER=aisstream` is accepted as the existing AIS tracking provider setting, with explicit `SHIPPING_AIS_PROVIDER` taking precedence when present. The final acceptance used `SHIPPING_VOYAGE_PROVIDER=vesselapi` only for the process; no Schedule endpoint was called.

## V3 — FINAL SEALED — P7 Final Real-data Seal

P7-A through P7-G are complete. The final controlled activation used the existing `pnpm smoke:v3-real-activation` path against temporary `.data/p7-final-seal-20260904.sqlite3`: 10 Jobs were registered with no disabled Mock Job; `voyage-sync` was enabled with `vesselapi` and safely skipped without watched targets, while AIS Area was explicit and skipped without eligible current targets. Loadstar, Shekou, Calendarific, Portcast, Open-Meteo, TMD and BMKG persisted bounded real/derived records. `pnpm smoke:v3-readiness` returned `REAL_OPERATIONAL ready=true / overall=degraded` with every hard check passing; degraded status is limited to approved coverage-pending capabilities.

The schema-discovered Real Operational scan reported `actualMockRows.total=0` before shutdown, after process restart and after provider-free API/UI reads. The 13 scanned business tables were `ais_latest_positions`, `ais_port_metrics`, `ais_positions`, `calendar_events`, `events`, `feed_item_history`, `feed_items`, `ports`, `vessel_metadata`, `vessel_search_cache`, `vessels`, `voyage_eta_history` and `voyages`; every table returned zero Mock rows. Read APIs did not run Provider sync, and the temporary database remained separate from retained `.data/shipping-hot-v3.sqlite3`.

Final accepted gaps are explicit: Voyage focus-port coverage is partial outside the approved eight-port directory (`CNYPG` remains unmapped); Calendar official/manual completeness is partial; JMA is disabled/live-pending; Commercial Schedule is unavailable without approved carrier entitlement; and public Port/Weather/Feed coverage remains source-bounded. These boundaries never use Mock fallback or fabricate operational facts. Translation is `VERIFIED_LIVE` optional FeedItem title/summary enrichment outside the Real Operational hard gate; Event/HOT Translation is `OUT_OF_SCOPE`.

## Capability matrix

| Capability | Current Provider / effective mode | Real Provider | Adapter | API key required | Secret configured | Real request verified | Fee / quota | Current status | Evidence / gate |
|---|---|---|---|---|---|---|---|---|---|
| Vessel Search | `mock` by default; explicit `SHIPPING_VESSEL_SEARCH_PROVIDER` selects `gfw` or `vesselapi` in Real Mode | GFW (verified live), VesselAPI (optional) | Yes: server-side `createGfwVesselSearchProvider()` and existing `createVesselApiSearchProvider()` | GFW: `GFW_API_TOKEN`; VesselAPI: `VESSELAPI_API_KEY` | GFW yes, server-side `.env.local`; VesselAPI not verified | GFW yes; VesselAPI no | GFW public API terms/limits not reassessed here; VesselAPI account plan and quota not verified | GFW `VERIFIED_LIVE`; VesselAPI `CREDENTIAL_MISSING` | GFW isolated probe returned HTTP 200, fresh/then cached HANSA results and provider-aware cache behavior. Mock Mode remains isolated and no live fallback is used. |
| Vessel Identity | Mock search identity when default mode is used; GFW canonical identity in explicit Real Mode | GFW identity dataset + existing canonical resolver | Same-IMO grouping, latest identity selection and `identityHistory` persistence | Inherited from selected Vessel Search provider | GFW yes, server-side only | GFW yes | GFW identity history is retained in existing metadata JSON; no separate identity table or migration | `VERIFIED_LIVE` | HANSA reduced from 3 raw identities to one `imo:9155391` candidate; current MMSI was selected by transmission dates and all three historical MMSIs were retained. |
| AIS Position | `mock` by default; explicit Real Mode selects AISStream | AISStream | Yes: bounded PositionReport adapter and continuous tracking Job/Tracker | Yes: `AISSTREAM_API_KEY` | Yes, server-side only | Accepted multi-target continuous evidence received and persisted a trusted PositionReport, passed Repository/API readback and SQLite restart with `actualMockRows.total=0` | Account limits not verified in this audit | `VERIFIED_LIVE` | Continuous PositionReport evidence is separate from the bounded fallback path; target coverage remains watchlist-dependent. |
| AIS Area / Port Traffic | `aisstream` only in explicit Real Mode | AISStream area subscription | Yes: area session, Port Directory lookup and bounded aggregation | Yes: `AISSTREAM_API_KEY` | Yes, server-side only | Accepted Area evidence persisted the independent metric set, passed provider-free reads, shutdown/restart readback and `actualMockRows.total=0` | Account limits not verified | `VERIFIED_LIVE` | Dedicated Area live gate is separate from Vessel Tracking; coverage remains bounded to configured Port Directory focus ports. |
| Port Intelligence | `portcast` requested in `.env.local` | Portcast public pages | Yes: public-page parser for the eight Port Directory ports | No provider key for the public-page path | Not applicable | Controlled Runtime smoke persisted 8 Port Directory-aligned rows; built `/api/shipping` read them | Public-page availability and robots/legal basis remain operational caveats; no quota claim | `VERIFIED_LIVE` (limited coverage) | Live page evidence and persisted/API rows are recorded; no Mock enrichment was used. Uncovered ports remain unavailable. |
| Weather | `open-meteo` requested in `.env.local` | Open-Meteo Marine + Forecast | Yes: server-side marine/forecast adapter | No | Not applicable | Accepted activation evidence includes 7 real weather-risk Feed rows; final P7 activation persisted 5 bounded weather records and `/api/shipping/feed` exposed wind/gust/window fields | Public endpoint limits not verified | `VERIFIED_LIVE` (bounded coverage) | Model forecast data is real and persisted; official alert status is tracked separately in the Weather Alerts row. |
| Weather Alerts | `public` runs enabled/verified TMD and BMKG source Jobs; JMA remains disabled/live-pending | Country-specific official sources | Source-level TMD RSS/XML and BMKG RSS/XML adapters plus independent `weather-alert-sync:<sourceId>` Jobs | No | Not applicable | TMD HTTP 200 / 12 normalized items and BMKG HTTP 200 / 3 normalized items persisted through Runtime → SQLite → Repository → Feed API and restart | Source-specific public availability; no quota claim | `PARTIAL / VERIFIED_LIVE for enabled TMD/BMKG` | JMA remains `LIVE_PENDING`; current live alert payloads had no safely provable focus-port association, so no port relation was fabricated. Geographic/source coverage remains explicit. |
| Voyage / ETA | `mock` by default; explicit `SHIPPING_VOYAGE_PROVIDER=vesselapi` selects the real adapter only in Real Mode; Mock Mode force-selects Mock despite a wrong provider env | VesselAPI ETA and optional Port Events | Yes: server-side `createVesselApiVoyageProvider()` through `VoyageProvider`/Runtime/Repository; direct Mock-mode selection fails closed | Yes: `VESSELAPI_API_KEY` | Available for the accepted server-side live run; value is not recorded | HANSA ETA HTTP `200` and Port Event HTTP `200`; identity validation passed | Account plan/quota and broader vessel/focus coverage remain bounded follow-up concerns | Provider `VERIFIED_LIVE`; operational `COVERAGE_PENDING / PARTIAL` | Engineering `SEALED`; accepted HANSA evidence persisted one real ETA and one history row, survived provider-free API/Repository reads and SQLite restart, and passed Zero-Mock. Official `destination_port=CNYPG` is valid Provider observation but outside the current 8-port directory, so `canonical destinationPortId=undefined` and reason is `vesselapi_focus_port_coverage_pending`. Port Event `THLCH` supplied `originPortId=THLCH`; unknown voyage number/ETD/status remain absent/`unknown`. No Mock fallback in Real Mode. |
| Feed / Shipping News | Public Feed adapter; active sources are Loadstar and Shekou official; Maritime Executive is disabled after recorded connectivity failure | The Loadstar, Maritime Executive, official port notices | Yes: RSS/HTML parser, freshness boundary and source-level Runtime jobs | No for listed public sources | Not applicable | Controlled Runtime smoke fetched Loadstar (10) and Shekou (5); built current/history API read real persisted rows | Public source limits/cadence pending | `SEALED / VERIFIED_LIVE` source Runtime | Each source runs independently; source failure preserves only same-source last-known data and never triggers Mock fallback. |
| Calendar / Holidays | `calendarific` in explicit Real Mode; app default remains Mock | Calendarific v2 plus separately tracked official/manual sources | Yes: Calendarific v2 adapter, country/year normalization and `calendar-sync` Job | Yes: `CALENDARIFIC_API_KEY` | Yes, server-side only | Controlled Runtime smoke persisted Calendarific events across CN and five overseas countries; provider-free Calendar API and restart reads returned them | Free/paid account quota and official/manual completeness remain unconfirmed | `COVERAGE_PENDING` | Transport/parser/cache/persistence is accepted; official/manual and full current+next-year completeness remain explicitly partial. |
| Translation | Optional `translation-sync` in Mock and Real data modes; fixed server-side DeepSeek provider/model | DeepSeek `deepseek-v4-flash` | Yes: fixed adapter, settings/Secret gates, durable cache and provider-free Feed display | Yes: `DEEPSEEK_API_KEY` | Accepted server-side credential/connectivity evidence; values are never recorded | Accepted evidence covers connectivity/model/credentials, automatic Runtime success, usage/cache growth, placeholder repair, controlled circuit recovery and cached Chinese Feed UI with original disclosure | Local USD estimate and account quota remain bounded follow-up concerns | `VERIFIED_LIVE` (optional enrichment) | Scope is FeedItem `title`/`summary`; Home HOT enriches only `kind="feed"`; Event/HOT Translation is `OUT_OF_SCOPE`; Translation is excluded from REAL_OPERATIONAL hard readiness. |

## S2 Offline Inventory and Eight-Port Coverage — 2026-09-11

> This section updates the matrix in place for the S2 round. Rows above remain the historical `V3 — FINAL SEALED` evidence and are not rewritten. No new real Provider request was made while producing this section; it records code/config inventory, accepted historical evidence, and explicit gaps.

### Credential presence (existence and loader only; no values recorded)

| Credential | Present | Loader location | Note |
|---|---|---|---|
| `GFW_API_TOKEN` | Yes | `.env.local` → `FileSecretStore` (`gfw`) | Vessel Search / canonical identity |
| `VESSELAPI_API_KEY` | Yes | `.env.local` → `FileSecretStore` (`vesselapi`) | Voyage/ETA + optional VesselAPI search |
| `AISSTREAM_API_KEY` | Yes | `.env.local` → `FileSecretStore` (`aisstream`) | AIS tracking, AIS Area |
| `CALENDARIFIC_API_KEY` | Yes | `.env.local` → `FileSecretStore` (`calendarific`) | Operational Calendar transport |
| `deepseek` | Yes | `.data/provider-secrets.json` → `FileSecretStore` | Optional Feed title/summary translation |

Presence of a configured credential does **not** mean this round has new authorization for paid calls or higher quota. Local `.env.local` requests `SHIPPING_VESSEL_PROVIDER=aisstream`, `SHIPPING_PORT_PROVIDER=portcast`, `SHIPPING_WEATHER_PROVIDER=open-meteo`, `SHIPPING_FEED_PROVIDER=public`, `SHIPPING_CALENDAR_PROVIDER=calendarific`, `SHIPPING_AIS_AREA_PROVIDER=aisstream`, `SHIPPING_WEATHER_ALERT_PROVIDER=public`; the default data mode remains `mock`.

### Classification of each capability (S2)

- **Implemented with historical real evidence (not re-verified this round):** Vessel Search / canonical identity (GFW); AIS continuous PositionReport; AIS Area; Port Intelligence (Portcast public page); Open-Meteo weather; official Weather Alerts (TMD/BMKG); VesselAPI Voyage/ETA provider path; Feed Loadstar + Shekou official; Calendarific transport/parser/persistence; DeepSeek translation (optional).
- **Configured but not re-verified:** all of the above; no new real request or activation was run in S2.
- **Genuinely missing credentials:** none among the currently selected providers. JMA needs no key but is intentionally disabled; no missing credential blocks the current focus scope.
- **No credential but access conditions must be checked:** Portcast public pages (robots/legal basis), Open-Meteo hosted free tier (non-commercial terms), TMD/BMKG public feeds, public Feed sources.
- **Requires fee/quota confirmation:** Calendarific account plan/free quota; VesselAPI account plan/quota; AISStream connection limits; GFW public API terms; DeepSeek budget.
- **Out of S2 scope:** Commercial Schedule (S6), broader Translation (S5), Event/HOT translation, Port Directory expansion, new Providers.

### Eight-port coverage matrix (actual source / implementation / evidence / gap / next)

Ports: `CNSHK` Shekou, `CNYTN` Yantian, `CNNSA` Nansha, `THLCH` Laem Chabang, `MYPKG` Port Klang, `PHMNL` Manila, `IDJKT` Jakarta (Tanjung Priok), `VNSGN` Ho Chi Minh City.

| Capability | Source / mode | Implementation | Historical evidence | Current gap (all 8 ports) | Next step |
|---|---|---|---|---|---|
| Directory identity | UN/LOCODE baseline (`source=unlocode`), SQLite `port_directory` | `shared/port-directory.ts`, `server/database/port-directory.ts`, migration v3 | `port-directory.test.ts` resolves UN/LOCODE/name/alias for the baseline; Real Mode excludes `source=mock` | Not re-verified live; no port added or renamed. Granularity caveat: Manila is city/port-level (not a specific terminal), Jakarta uses the `Tanjung Priok` alias, HCMC may cover multiple terminals. `CNYPG` has no directory identity and is kept raw | Keep raw for unresolved identifiers; any new port/alias is a scope change requiring approval |
| Congestion | Portcast public pages | `server/providers/shipping.ts` (`createPortcastPublicPageProvider`) | Historical controlled activation persisted 8/8 Port Directory-aligned rows; stale/`no_public_data`/failure semantics tested | Source-bounded public-page coverage; no per-terminal congestion; not re-verified | Re-verify reads under a controlled Real run (Portcast public availability/terms) |
| AIS observation / estimate | AISStream bounded + continuous tracking; AIS Area aggregation | `server/providers/ais/*`, `server/providers/aisstream-area.ts`, runtime jobs | Continuous PositionReport acceptance (watchlist-dependent); Area acceptance persisted 8 metrics incl. Shekou `usable` | Tracking requires a watched vessel with valid MMSI; Area depends on live signal; current targets may be empty. No estimate for all 8 ports at all times | Re-verify with a controlled target/area run; keep `no_eligible_*`/`no_ais_position_observed` as non-success |
| Weather forecast | Open-Meteo Marine + Forecast | `server/providers/shipping.ts` (`createOpenMeteoWeatherProvider`), `PortDirectoryRepository` coordinates | Historical controlled activation persisted bounded weather records with wind/gust/window fields | Hosted free tier is non-commercial; coverage is forecast-model based, not official; not re-verified | Re-verify bounded reads and confirm Open-Meteo terms for this use |
| Official warnings | TMD (TH), BMKG (ID) official; JMA disabled | `server/providers/weather-alerts.ts`, per-source jobs | TMD/BMKG contract/runtime/restart acceptance | No official warning source mapped for CN/MY/PH/VN; JP/`JMA` not in scope; focus-port association is evidence-only (often empty) | Keep JMA disabled; any new official source needs approval and an isolated probe |
| Official notices / port announcements | Shekou official `/ywgg/`; The Loadstar (general shipping) | `server/providers/feed.ts` sources; feed source jobs | Shekou official 5/5 and Loadstar 10/10 persisted historically | No dedicated official notice source for Yantian/Nansha/Laem Chabang/Port Klang/Manila/Jakarta/HCMC; Laem Chabang/Port Klang parsers pending | Add/replace only with approved sources; uncovered ports stay explicitly unavailable |
| Voyage association | VesselAPI ETA (+ optional Port Events) for watched vessels | `server/providers/voyage/vesselapi-provider.ts`, `VoyageRepository`, voyage-sync job | Accepted HANSA evidence; provider `verified_live` | Focus-port coverage `PARTIAL`: `CNYPG` (Yantian-area official key) is outside the directory; association only for watched vessels with trusted ETA | Keep `CNYPG` raw; expanding the directory requires approval |

### S2 offline verification added this round (no real request)

- `server/providers/calendar.test.ts`: Calendarific HTTP failure taxonomy (401/403/entitlement/429/503/504) + malformed/network-timeout mapping.
- `server/providers/feed.test.ts`: public-feed HTTP failure taxonomy (401/403/429/503/504).
- `server/providers/shipping.test.ts`: Portcast and Open-Meteo HTTP failure taxonomy.
- `server/database/port-directory.test.ts`: exact identity resolution, unmapped `CNYPG` kept unresolved, and ambiguous alias kept unresolved (no first-match guessing).
- `server/providers/ais/index.test.ts`: AIS factory never constructs a real adapter in Mock Mode; Mock AIS fails closed in Real Mode.
- Code repair: `server/database/port-directory.ts` `resolvePortIdentity()` now returns `undefined` when an exact value matches more than one distinct UN/LOCODE (previously first match); `server/providers/ais/index.ts` `createAisTrackingProvider()` now force-selects the Mock AIS provider in non-Real modes (previously, with `SHIPPING_VESSEL_PROVIDER=aisstream`, default Mock Mode could register an enabled real AISStream job).

Offline tests prove logic only. They do not count as real-data or zero-Mock live acceptance.

### Real part — pending / conditions

This round listed but did not execute real requests. Before any controlled Real run, enumerate and restrict the registered Jobs so no unauthorized translation, full-calendar sync, commercial schedule or unbounded AIS subscription starts. Only sources with confirmed authorization/terms/quota should be probed; each real check must record request, source/time, local persistence, API/page read-back, restart read-back and the zero-Mock scan. Missing real evidence stays unverified/`BLOCKED`.

## Non-provider foundations

- Port identity is owned by the SQLite-backed UNECE UN/LOCODE Port Directory. Providers must resolve `Shekou`, `SHEKOU`, `CNSHK` and aliases to `CNSHK`; they must not create a second port identity.
- Real Mode accepts only `real`, `imported` and `derived` lineage. `mock` records cannot be promoted into Real operational current data.
- Secrets remain server-only through `FileSecretStore`, with environment precedence over `.data/provider-secrets.json`. This document contains no secret value or masked suffix.
- The controlled Real Mode registry contains `ais-tracking`, an enabled `voyage-sync` selected by the configured Voyage provider, one Feed Job per active public source, `calendar-sync`, `port-sync`, `weather-sync` and one official Weather Alert Job per enabled/verified source. Mock/Test Mode retains the exact Mock/Off Job set; Readiness validates the set for the selected profile.

## Post-V3 boundaries

1. Keep `SHIPPING_DATA_MODE=real` process-scoped for controlled operation; do not change the safe default or commit local secrets.
2. VesselAPI search and ETA/Port Events remain separate capabilities. The accepted HANSA ETA/Port Event evidence proves the Provider path is live for that target; it does not imply focus-port coverage for every vessel or destination.
3. Keep Maritime Executive and JMA disabled until their real contract/coverage evidence is available; TMD/BMKG remain enabled only through their verified source Jobs.
4. Keep the accepted AIS Position and AIS Area live states separate from their target/focus-port coverage boundaries; do not downgrade either accepted gate to the old no-observation checkpoint.
5. P7-A through P7-G are complete; the accepted final state is `V3 — FINAL SEALED` with the coverage gaps listed above.
6. Any future live gate or post-V3 enhancement requires separate approval and must record request, result, SQLite row and API surface in `docs/live-verification.md`; do not use `VERIFIED_LIVE` for connection-only or fixture-only evidence.
