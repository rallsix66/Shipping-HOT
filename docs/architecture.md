# Architecture — NewsNow Foundation / Shipping HOT Proposal

> Last verified: 2026-08-19
> Architecture status: approved for local Mock implementation, V1 AISStream/Open-Meteo adapters, sealed V2.0 Data Trust Foundation and Mock Isolation boundary, implemented V2.1 Port Intelligence, V2.2/V2.3/V2.4 local verification and V2.5 AIS / Port Derived Intelligence local verification; Portcast/Open-Meteo/Shekou corrected live-path closeout, Final Alert Lifecycle + Feed Timeout closeout and Final Trust Boundary Seal are verified on 2026-08-18; Calendar sync persisted-baseline restart boundary is verified on 2026-08-19; V2.5 external area observation remains live pending
> Source of truth for: the current retained system structure and approved boundaries

## Current AISStream + Calendarific Live Verification — 2026-08-18

AISStream reached the official WebSocket and stayed open for a 120-second filtered subscription covering the two current watched MMSIs, but no PositionReport arrived. Its current live state is connection_verified / pending_observation; the provider must not be labeled verified_live without an observation.

Calendarific returned HTTP 200 and valid JSON for TH/ID/MY/PH/VN. All five countries produced healthy Calendarific events with coverageStatus=partial; the provider is verified_live for transport/parser/data availability, while partial coverage remains explicit. The normalizer maps national/public/federal/bank labels to national `public_holiday`, maps local/regional/state/provincial/subdivision labels to explicit `subdivision` or `unknown` scope, preserves supplied subdivision evidence, and deduplicates by country/date/name/type/scope. Local/unknown Calendar facts remain in Calendar but do not enter national Calendar → Event → HOT.

All-real local API smoke showed no Mock Vessel/Port/Weather/Feed/Calendar source; mock-schedule remained the only Mock source. Native SQLite persistence remains pending because the current Node 24 runtime cannot load the bundled better-sqlite3 ABI.

## Calendarific Final Operational Semantics Seal — 2026-08-18

- `scope=national` is reserved for national/public/federal/bank holiday labels. Local, regional, state, provincial and subdivision-specific labels remain CalendarEvent facts with `scope=subdivision` when the payload supplies region evidence, or `scope=unknown` when it does not.
- Calendarific's actual MY payload supplies `states[].iso` and `locations`; PH also supplies local-labeled records with broad `All` location evidence. The adapter stores actual ISO values, preserves multiple codes and location text, and never fabricates a subdivision mapping.
- `calendarEventKey()` and source merge/reconciliation include date and scope. Existing unscoped/national IDs remain stable; scoped facts receive a deterministic scope component, so same-name same-day facts from different subdivisions do not collapse.
- Local/unknown facts are retained in Calendar persistence and API reads but `isCalendarOperationallyRelevant()` prevents national Calendar Event/HOT creation. Switching provider or scope is not treated as evidence that an old Event resolved.
- Unknown Calendarific type labels normalize to `commercial` with `scope=unknown`, `businessImpact=low` and `recognized=false`; they remain Calendar-visible facts but are not operationally eligible. The targeted 2026 probe reconciled `201` raw → `201` normalized unique → `201` provider/merged facts: `98` national, `44` subdivision, `59` unknown and `25` unsupported-type records; `98` are operationally eligible. The earlier 198/189/48 counts came from pre-seal measurements and are historical, superseded values. Coverage remains partial.
- Legacy unscoped Calendarific local facts are superseded only when an incoming scoped subdivision/unknown fact matches the same source, country, date, normalized name and type. The old normalized CalendarEvent is removed from the current `calendar_events` set via `removedIds`; its linked ShippingEvent remains historical in the Event audit repository, is excluded from current Event/HOT input, and is not falsely resolved. Legacy unscoped national facts and unscoped Official/Manual facts retain compatibility.
- The current Calendarific reminder window has `3` national reminders; the previous aggregate four-reminder sample cannot be reconstructed exactly.

## Calendar Sync Persisted Baseline Seal — 2026-08-19

- Direct Calendar sync begins with `readStoredSnapshot()` after initialization. Repository-backed Calendar facts, coverage, settings, Vessel/Port/Voyage/Feed state and previous ShippingEvents are the authoritative baseline for reconciliation and Event detection.
- `fallbackSnapshot` remains the in-memory fallback only when Repository initialization/read is unavailable. It cannot replace persisted state during a successful Repository-backed sync.
- A restart-style test confirms persisted legacy Calendarific local identity migration: the old normalized row is deleted through `removedIds`, the new scoped row is upserted, the linked ShippingEvent remains historical and is not resolved, and the local fact creates no current Calendar reminder.
- A real-mode persisted-state test confirms direct Calendar sync does not re-inject `mock-vessel`, `mock-port`, `mock-weather`, `mock-port-notice` or `mock-calendar` Events; `mock-schedule` remains allowed. No schema or Provider architecture change was introduced.

## Calendar Sync Operational Source Isolation Seal — 2026-08-19

Calendar sync preserves Repository history but passes only current `OperationalSourceContext`-compatible Vessel, Port, Voyage and Feed inputs to the Event Engine. `sourceAllowedForOperationalContext()` checks both the requested Provider mode and `activeSourceIds`, so disabled or inactive Mock/registry sources cannot become current evidence. Existing operational Event filtering is reused for previous Events; `mock-schedule` remains the explicitly allowed Mock source.

## 1. Project Purpose

The repository retains NewsNow as its foundation and now exposes Shipping HOT as a local single-user product surface. The implemented path uses normalized Mock or approved V1 real Provider adapters and deterministic Domain/Event rules; real provider credentials remain optional.

## 2. Current Scope

### In Scope

- Current NewsNow news Source aggregation, cache, UI cards, local preferences, optional GitHub login/sync, and deployment adapters.
- Preserving the existing modular monolith as the foundation for the local Mock loop and approved V1 Provider adapters.
- V2.0 Data Trust Foundation: provenance, freshness/status separation, last-known fallback semantics, Event evidence and UI attribution within the existing JSON/API boundaries.
- V2.1 Port Intelligence: an optional server-side Portcast public-page adapter normalizes only anonymous public HTML fields into the existing Port entity, applies a 14-day source-age gate and separates source update time from local fetch time; Mock remains the default and no commercial API or hidden endpoint is used.
- V2.2 Country Calendar: a five-country annual path composes Calendarific, Official and Manual sources when explicitly configured, uses source-scoped coverage and date/scope-aware reconciliation, persists facts/coverage and feeds only operationally relevant Calendar facts into Event → HOT; Mock remains the default and official live sync is pending.
- V2.3 Shipping Information Feed: a small opt-in RSS/HTML registry normalizes industry and Shekou `/ywgg/` operational notices into `FeedItem`, preserves unknown publication time without using `fetchedAt`, isolates source failures, applies an independent 10-second fetch/body/parser timeout per active source with `AbortController` cancellation, requires fresh/healthy evidence for the direct Feed → HOT path, classifies Chinese operational terms and converges explicit operational impact through Feed → Event → HOT; Mock remains the default.
- V2.4 Weather Intelligence: one opt-in Open-Meteo request supplies local 24-hour/72-hour/7-day wave/swell/wind windows and directions with TTL/stale fallback; forecast-valid `updatedAt`, optional reliable `sourceUpdatedAt` and local `fetchedAt` remain distinct; JMA/TMD/BMKG are separate source-specific official-warning contracts, missing-index warnings become stale/degraded lifecycle-unknown items that cannot create Event/HOT output, official alert port mapping is alert-evidence-only, known focus-port aliases are normalized, and model risk never receives official provenance.
- V2.5 AIS / Port Derived Intelligence: explicit `SHIPPING_AIS_AREA_PROVIDER=off|aisstream` controls an independent Area session. The area adapter subscribes only to `PositionReport` messages for small configured heuristic boxes around watched current-port identities, never uses `FiltersShipMMSI`, keeps latest-per-MMSI observations and a bounded aggregate ring in memory, persists only `ais_port_metrics`, and exposes derived/estimated fields separately from Portcast. Area Event/HOT requires a fresh usable sample of at least five distinct MMSIs, three consecutive rising windows and a watched current port; the maximum severity is warning. External area observation is not claimed in local verification.

### Explicitly Out of Scope

- Any unapproved Shipping HOT business implementation.
- Unapproved real AIS, port, schedule, weather or typhoon API integration; V1 AISStream and Open-Meteo Marine adapters are approved within this document's boundary.
- Next.js, Prisma, Supabase, microservices, event buses, or a global vessel database.

### Deferred Integrations

| Proposal | State | Reason not in current scope |
|---|---|---|
| Shipping HOT domain and HOT feed | implemented | Mock/fixture data, deterministic Event Engine and HOT query are active |
| Vessel/Port/Voyage/Event storage | implemented / schema migration locally verified; native runtime pending | SQLite tables, Repository seed/read/write/reconcile paths and explicit last-known fallback are present; `vessels.status_changed_at` is nullable, with an idempotent old-schema rebuild that preserves rows and watch state; native better-sqlite3 cannot load in the current Node 24 environment |
| Structured shipping Providers | implemented | Mock adapters remain active; AISStream Vessel and Open-Meteo Marine Weather adapters are optional V1 paths |
| V2.0 Data Trust Foundation | sealed | `sourceType`/`dataNature` provenance, independent freshness timestamps/status, ProviderResult-compatible API data, Event evidence and explicit Mock/UI attribution; final isolation seal adds only the nullable Vessel status compatibility rebuild, not a new domain table |
| V2.1 Port Intelligence | implemented / verified | `PortcastPublicPageProvider`, public HTML parser, 24-hour cache/fingerprint and Port congestion detail; no schema migration or new dependency |
| V2.2 Country Calendar | implemented / locally verified; live pending | TH/ID/MY/PH/VN contracts, Calendarific + Official + Manual composition, source-scoped and date/scope-aware reconciliation, minimal `calendar_events` table, settings-backed coverage and national-scope calendar reminder Events; no ORM migration |
| V2.3 Shipping Information Feed | implemented / locally verified; live pending | RSS/HTML adapters, normalized FeedItem metadata with unknown publication semantics, per-source stale fallback, Chinese classification, canonical/title dedupe and Feed → Event → HOT reasons; no new table or NewsNow cache rewrite |
| V2.4 Weather Intelligence | implemented / locally verified; live pending | Open-Meteo 24-hour/72-hour/7-day wave/swell/wind normalization and directions, 30-minute TTL, per-port failure isolation, source-specific warning contracts and expiry separation; no new table |
| V2.5 AIS / Port Derived Intelligence | implemented / locally verified; live pending | Separate Watched/Area AIS session, `aisstream-area` provenance, heuristic watched-port boxes, bounded observation/aggregate state, `ais_port_metrics`, thresholded warning-only Event/HOT and explicit off rollback; no raw AIS persistence |

## 3. Architecture Summary

The current retained architecture is a single repository modular monolith: React and TanStack Router render the browser UI; React Query and Jotai manage query/local state; Nitro exposes server handlers; `server/sources/**` fetches and normalizes news; db0 provides the local database abstraction; and the cache stores normalized `NewsItem[]` payloads.

This is the smallest existing foundation compatible with the local Shipping HOT product. No framework or ORM migration is approved; persistence changes remain minimal JSON-backed tables accessed through `ShippingRepository`: the nullable Vessel status compatibility rebuild, the approved `calendar_events` table and the V2.5 aggregate-only `ais_port_metrics` table.

## 4. System Context

| Actor / External System | Interaction | Trust boundary |
|---|---|---|
| Local browser | Reads pages and `/api` responses; stores local UI preferences | Browser/local app |
| News Sources | Fetched by server Source getters | Untrusted external web/API |
| GitHub OAuth/API | Optional login and user sync | Untrusted external service |
| Local db0/SQLite | Stores cache and optional user data | Local application boundary |
| Cloudflare/Vercel/Docker | Optional deployment targets already supported by config | Deployment boundary |

## 5. Modules and Responsibilities

| Module | Primary responsibility | Owns data | Depends on | Must not do |
|---|---|---|---|---|
| `src/routes` | Map URLs to UI | Route state | UI, Router | Call APIs directly beyond UI service hooks |
| `src/components` | Render cards, layout and interactions | UI state only | hooks, shared types | Operate SQLite or parse provider responses |
| `src/atoms` / `src/hooks` | Browser preferences and query orchestration | local metadata state | Jotai, React Query | Become server data authority |
| `server/api` | HTTP handlers and error mapping | API response contract | getters, database, middleware | Contain provider-specific parsing |
| `server/sources` | Fetch one news Source and return `NewsItem[]` | Source result | Source helpers, fetcher | Render UI or own database schema |
| `server/database` | db0 SQL access for cache/user | `cache`, `user` tables | db0 | Import React or external provider formats |
| `shared` | Shared types, Source metadata and pure utilities | Shared contracts | no app-specific UI | Become a second database or service layer |
| `scripts` | Generate Source metadata/assets | Generated source files | git/package data | Run as runtime business logic |

## 6. Dependency Rules

- Allowed direction: `UI → hooks/services → API → Source/database utilities → external systems`.
- `shared/types.ts` and Source metadata may be consumed by both client and server, but must not import UI or database code.
- `server/sources/**` may use shared Source contracts and fetch helpers; UI must not import it.
- Shipping HOT now has separate shared Domain rules, Provider interfaces/Mock adapters, server API/storage and UI routes. The Shipping Information Feed adapter is server-only; UI consumes normalized FeedItem DTOs and never parses RSS/HTML.
- New structured shipping code must use the UI → Application/API → Domain → Provider interface → Adapter → External API boundary. V2.2's `calendar_events` table is the explicitly approved minimal exception to the prior no-new-table baseline; it is accessed only through `ShippingRepository`.

## 7. Data Model and Ownership

| Entity / Data | Owning module | Writers | Readers | Source of truth |
|---|---|---|---|---|
| `NewsItem` | `shared` contract, Source server | `server/sources` / cache | API/UI | Source response or cache row |
| Source metadata | `shared` + generation script | `shared/pre-sources.ts`, `scripts/source.ts` | server/UI | `pre-sources.ts` source definition |
| `cache` row | `server/database/cache.ts` | server cache service | `/api/s`, `/api/s/entire` | db0 table |
| `user` row | `server/database/user.ts` | OAuth/sync handlers | authenticated sync | db0 table |
| local focus/order metadata | `src/atoms` | browser Jotai/localStorage; optional sync | UI | browser localStorage, or synced user data when enabled |
| Vessel/Port/Voyage/Event | `shared`, `server` and `src/components/shipping` | Mock Providers through `server/shipping-store.ts`; `ShippingRepository` persists state; local Vessel `statusChangedAt` and Voyage baselines are retained by the service merge | HOT, detail pages and Event Engine | Repository-backed state when SQLite is available; explicit last-known in-memory fallback otherwise |
| FeedItem | `shared/shipping.ts`, `server/providers/feed.ts`, `server/shipping-store.ts` | Mock Feed or opt-in RSS/HTML adapters; `ShippingRepository` persists normalized JSON | `/api/shipping`, `/feed`, Event Engine and HOT | Provider-specific XML/HTML stays inside the adapter; ordinary news remains Feed and stale failures do not create new Events |
| CalendarEvent / CalendarCoverage | `shared/calendar.ts`, `server/providers/calendar.ts`, `server/database/shipping.ts` | Calendar Provider contracts through `server/shipping-store.ts`; `calendar_events` stores event facts and settings `calendarSync` stores coverage | `/api/shipping/calendar`, Calendar page, Event Engine | Cached national, subdivision and unknown-scope facts remain readable offline; supplied subdivision evidence is preserved, local/unknown facts are excluded from national Event/HOT, unknown/partial coverage is explicit and source keys never cross the API boundary |

## 8. Key Data Flows

### Flow A — News Source

1. `shared/pre-sources.ts` defines metadata and `scripts/source.ts` generates Source metadata.
2. `server/getters.ts` collects `server/sources/**` via glob.
3. `/api/s` checks db0 cache, calls a getter when needed, stores the result, and returns `SourceResponse`.
4. React Query and News cards render the response.

Failure and recovery: if a previous cache row exists, the API returns cached items; otherwise it returns an error. The current response does not provide a complete structured freshness/error contract.

### Flow B — Local preference sync

1. Jotai stores focus/order metadata in browser localStorage.
2. With JWT, `useSync` sends metadata to `/api/me/sync`.
3. `UserTable` stores serialized data in the `user` table.

Failure and recovery: invalid auth causes a user-facing login prompt and local logout; this is optional and not required for the proposed local-only Shipping HOT mode.

### Current Shipping HOT flow

Information Feed and Operational Data remain separate and meet at the Event/HOT query layer. The current implementation flows through Mock or approved real Provider adapters, service orchestration, Repository persistence and the existing Event Engine.

### V2.0 Data Trust flow

Provider data is normalized with `sourceType`, `dataNature`, `sourceId`, optional `sourceUrl`/`verified`, and independent `updatedAt`, `sourceUpdatedAt`, `fetchedAt`, `stale` and `sourceStatus` fields. Provider failures preserve last-known `updatedAt`, add the current fetch time, and expose `failed`/`degraded`/other status without presenting the data as fresh. Domain events derive their own provenance while retaining lower-level evidence; stale or failed source data cannot create new facts or resolve an active event, and recovery is required before resolution. Repository JSON, API responses, HOT items and UI cards carry the same trust information. The final seal keeps `status_changed_at` nullable so identity-only AIS observations can persist; startup rebuilds only the existing table when an older NOT NULL schema is found.

The V2.1 Portcast adapter is opt-in through `SHIPPING_PORT_PROVIDER=portcast`; its default remains Mock. It requests only mapped public port pages once per 24-hour interval, parses visible congestion category, median wait, previous wait, week-over-week change, long-tail flag and page date, and stores no raw HTML. The HCM mapping uses the public `/port-congestion/ho-chi-minh` path. A 14-day source-age gate marks old pages `degraded/source_stale`, and a missing or invalid page date is `degraded/source_update_time_unknown`; stale real values may remain visible but cannot create a new Port Event/HOT item. Freshness is re-evaluated on every read, including cache hits; cache TTL controls HTTP fetch frequency only. 404/no-public pages become an explicit degraded `no_public_data` state; parse/network failures retain same-source last-known values and expose failed/stale status. `updatedAt` follows the page date when available, otherwise the unchanged same-source update time; `fetchedAt` is the last real fetch time and is not changed by cache hits. Public-page attribution is carried in Port provenance and the port detail UI.

The V2.2 Calendar path is opt-in for Calendarific through `SHIPPING_CALENDAR_PROVIDER=calendarific` plus `CALENDARIFIC_API_KEY`; otherwise Mock is the default. The configured Calendar provider returns actual provenance `calendarSourceIds`: Mock → `mock-calendar`; Calendarific with a key → `calendarific`, `official-holiday-source`, `manual-holiday`; Calendarific without a key → `calendarific` only; Official → `official-holiday-source`, `manual-holiday`; Manual → `manual-holiday`. The server composes only the selected sources, normalizes them into `CalendarEvent`, strips the key from errors and stored/API data, persists event facts in `calendar_events`, and persists per-country/year/source coverage in `settings.calendarSync`. National/public/federal/bank labels receive `scope=national`; local/regional/state/provincial/subdivision labels receive `scope=subdivision` when actual subdivision evidence exists, otherwise `scope=unknown`, with no fabricated ISO code. `mergeCalendarSources` and Store reconciliation include date and scope, so same-name facts on different dates or subdivisions remain distinct; official facts still receive priority over third-party facts and ManualOverride conflicts remain evidenced. Calendarific attribution is conditional on actual provider/data usage. Only operationally relevant Calendar facts enter the existing Event Engine with 14/7/3-day lead rules; local/unknown facts remain Calendar-visible but produce no national Event/HOT, while future `government_special` retains its immediate `announced` lifecycle. Current Calendar, Event and HOT reads filter by the configured provenance source IDs rather than composition keys.

The V2.3 Shipping Information Feed path is opt-in through `SHIPPING_FEED_PROVIDER=public`; otherwise the Mock Feed remains the default. `server/providers/feed.ts` fetches each enabled and registry-active source independently, supports RSS for The Loadstar and the retained-but-disabled Maritime Executive entry, and source-specific `/ywgg/` HTML parsing for Shekou operational notices (company-news `/gsxw/`, navigation and footer links are excluded). Laem Chabang/Port Klang remain registered parser pending, Yantian/Nansha remain deferred without a stable source, and a `failed_live` source is excluded from the active fetch set so a known TCP/HTTPS failure cannot slow the public Feed. Each active source has a 10-second deadline covering fetch/body/parser; timeout calls `AbortController.abort()` and preserves only that source's stale/failed last-known records. The adapter emits normalized `FeedItem` records with `sourceType`, `dataNature=reported`, source timestamps, related ports, tags and optional `hotReason`. A source-provided publication time is never replaced by `fetchedAt`; unknown publication items remain visible but are not eligible for new Event/HOT creation. Direct FeedItem → HOT additionally requires fresh/healthy evidence. Canonical URLs and normalized titles deduplicate reposts with official-source priority. A failed source preserves only its own last-known records as stale/failed without changing their publication/update time.

The V2.4 Weather Intelligence path extends the existing Open-Meteo adapter without changing the Weather Feed boundary. `SHIPPING_WEATHER_PROVIDER=open-meteo` requests current plus hourly wave height/direction, swell height/direction, swell period, wind and gusts for one 7-day model response; local 24-hour, 72-hour and 7-day windows are calculated without repeating API calls, with a 30-minute in-process TTL. Each port is fetched independently, with its own last-known model FeedItem marked stale/failed when unavailable. Model items use `sourceType=third_party`, `dataNature=forecast`, `weather.riskSource=model` and the UI can switch windows. `updatedAt` is the forecast/current valid time, `sourceUpdatedAt` stays undefined unless the API explicitly supplies a reliable source/model-run timestamp, and `fetchedAt` is the local request completion time; `generationtime_ms` is not a source timestamp. `SHIPPING_WEATHER_ALERT_PROVIDER=public` additionally enables independent source-specific JMA sea-warning HTML, TMD public RSS and BMKG RSS contracts; TMD/BMKG port association is derived only from alert title/summary/area evidence and canonical names/UNLOCODEs, with aliases such as Chonburi/Chon Buri → Laem Chabang and Tanjung Priok/North Jakarta → Jakarta; provider-wide default `relatedPortIds` cannot create an association. Warning items retain issued/expiry metadata when the source provides it; a warning missing from an RSS index without reliable expiry evidence is retained stale/degraded as lifecycle-unknown, with `eventEligibility=false`, `hotReason` removed and `weather.alertState=unknown`, rather than resolved or expired. A known past expiry may downgrade to info. JMA empty-result validation requires the JMA `#seawarning-container`/warning structure or an explicit empty marker; a generic `<main>` or ordinary `#contents table` does not qualify. Public live runtime remains pending because all three alert sources are still `live_pending`; Mock remains the default, and a real model mode never consumes `mock-weather` as first-failure last-known.

The V2.5 AIS / Port Derived Intelligence path is explicitly controlled by `SHIPPING_AIS_AREA_PROVIDER=off|aisstream` and defaults to `off`. `server/providers/aisstream-area.ts` owns a separate process-local Area session from Watched AIS: it reuses one socket, single-flights connection setup, debounces subscription replacement by at least one second, reconnects with finite backoff and closes when idle. It sends only `PositionReport` for small `configured_heuristic` boxes around watched current-port identities and never sends `FiltersShipMMSI`. `shared/ais-area.ts` validates coordinates, assigns overlap to the nearest configured port while counting ambiguity, retains latest-per-MMSI observations with a 15-minute TTL and a 5000-entry hard cap, and computes bounded aggregate metrics. Reliable AIS payload time is the only input to `sourceUpdatedAt`; when absent, `updatedAt` may use local `fetchedAt`-derived observation time while `observationWindow` remains a local aggregation window. Metrics use five-minute bucket boundaries, same-bucket calls do not increment the trend chain, gaps/stale/insufficient/restart state reset it, and rising requires both stationary-count and ratio increase. `ais_port_metrics` persists only one aggregate JSON row per port; raw AIS messages/tracks are not stored. Metrics are `aisstream-area + derived`, trend provenance is `aisstream-area + estimated`, and no metric is copied into Portcast fields. The Event Engine requires a fresh usable watched-port metric with at least five distinct MMSIs and three consecutive rising buckets, emits only warning-level `ais_port_congestion_trend`, retains same-source active Events stale on failure and removes area history from current Event/HOT when area mode is off. The 2026-08-19 60-second Shekou Area probe opened one subscription but received no PositionReport, so Area remains `connection_verified / coverage_pending`.

The final AIS/Event boundary keeps watch configuration separate from observation data: `VesselWatchTarget` carries only identity/control fields, AIS receives only same-source sanitized last-known observations, and successful PositionReports never inherit Mock dynamic fields. AIS `statusChangedAt` is the first continuously observed timestamp of the current navigation state, not a guaranteed real-world transition time. Entity Event identities are source-scoped (`logical key + provenance.sourceId`) so Mock/AIS histories coexist. Current operational Event/HOT reads use an `OperationalSourceContext` that combines requested Provider modes with enabled/verified registry source IDs and the actual configured Calendar `calendarSourceIds`; incompatible historical Events remain in SQLite for audit and are not auto-resolved when a Provider switches. Calendar scope is a second operational boundary: persistence keeps local/unknown facts, while the Event Engine excludes them from the national operational set.

## Mock Isolation Rule

Status: `Mock isolation complete` for the local operational boundary. Native SQLite and live external-provider verification remain separate pending gates.

Only explicit Mock mode may surface Mock data.

Real Provider modes:

- never fall back to Mock on missing configuration;
- never use Mock as last-known;
- preserve only same-provider successful historical data;
- first failure with no same-provider history returns no data / `never_succeeded`;
- unknown fields remain unknown rather than inheriting Mock values.
- Watch configuration is not observation data; AIS receives only `VesselWatchTarget` identity/control fields and same-source AIS last-known observations.
- A successful AIS observation never inherits Mock `destination`, `eta`, `callSign`, `carrier`, `shipType` or `statusChangedAt`; AIS `statusChangedAt` is an observed-state boundary, not an authoritative vessel transition time.
- Area AIS is a separate source: `aisstream-area` subscribes only to configured watched-port boxes and `PositionReport`; it never uses Watched MMSI filters, never writes raw tracks/messages and never overwrites Portcast congestion or waiting fields. Aggregate metrics use `derived` provenance and trend Events use `estimated` provenance.
- Area metrics require fresh usable samples (at least five distinct MMSIs) and three consecutive rising five-minute buckets for a warning-only Event/HOT item. `sourceUpdatedAt` never uses local `fetchedAt`; same-bucket updates do not advance the chain, and bucket gaps, stale/insufficient previous state or restart gaps reset it. `SHIPPING_AIS_AREA_PROVIDER=off` removes historical area metrics/Events from the current operational view without resolving or deleting their history.
- Current Event/HOT input uses explicit `sourceId` → `OperationalSourceContext` compatibility for vessels, ports, weather, feeds, calendars and alerts. Registry-disabled, parser-pending or otherwise inactive sources are excluded even when their broad Provider mode matches. Incompatible Events stay in Repository history and are not auto-resolved. Direct FeedItem → HOT also requires fresh/healthy evidence; existing active Event → HOT behavior is unchanged.
- Calendar activation is source-accurate: composition option keys (`calendarific`, `official`, `manual`) are never treated as Event provenance IDs; only actual configured IDs (`calendarific`, `official-holiday-source`, `manual-holiday`, `mock-calendar`) enter the current Calendar/Event/HOT boundary.

Provider mode is the requested source (`mock`, `aisstream`, `portcast`, `open-meteo`, `calendarific` or `public`); runtime availability is represented independently by `healthy`, `degraded`, `failed`, `disabled` or `never_succeeded`. This keeps a missing AISStream key visible as `aisstream / never_succeeded`, while the data array is empty. Portcast retains static port identity on first failure, and its dynamic fields remain optional/unknown. Calendar, Feed, Event and HOT read boundaries filter retained incompatible rows without deleting them from SQLite.

## 9. Interfaces and External Dependencies

| Dependency / Interface | Purpose | Failure behavior | Replacement / fallback |
|---|---|---|---|
| `SourceGetter` | Fetch one normalized news source | Cache fallback or error | Disable Source / RSS or RSSHub adapter |
| `myFetch` | HTTP requests with timeout/retry | Throws after retry | Source-specific fallback where implemented |
| db0 + local `better-sqlite3` | Local cache/user persistence | Cache can be disabled; auth requires DB | In-memory/no-cache only where current code supports it |
| GitHub OAuth/JWT | Optional identity and sync | Login disabled when env is absent | Local browser preferences |
| Cloudflare D1/Vercel/Bun | Optional runtime adapters | Runtime-specific failure | Local Node runtime |
| Shipping Provider interfaces | Mock plus approved V1 adapters, V2.2 Calendar, V2.3 Feed and V2.4 Weather contracts implemented | Must isolate provider failure | Explicit Mock mode, same-provider last-known or no-data with stale/sourceStatus |

## 10. Authentication, Authorization and Security

- Authentication: optional GitHub OAuth with JWT; disabled when required env vars are absent.
- Roles and permissions: none beyond authenticated sync access in current code.
- Sensitive data: GitHub secrets, JWT secret and future provider keys.
- Validation: `verifyPrimitiveMetadata` validates sync payload shape; Provider adapters validate and normalize external payloads before Domain use.
- Secret handling: environment variables or local untracked configuration; never commit keys.
- Shipping HOT must not make OAuth or AI a core runtime dependency without a new decision.

## 11. Error Handling and Recovery

- Source fetch failures are logged and may fall back to an existing cache row.
- Missing auth configuration disables login-related behavior through middleware.
- Shipping HOT DTOs carry `updatedAt`, `sourceUpdatedAt`, `fetchedAt`, `stale`, `sourceStatus`, provenance and optional `error`; Mock/provider failures are isolated at the API boundary. HOT Event freshness follows the related Vessel/Port/Voyage/FeedItem rather than Event detection time, and disabled/degraded/failed sources are not treated as fresh.
- Real adapters must preserve only same-provider last-known data and the same freshness/error contract; missing configuration is a requested real mode with no-data, never an implicit Mock switch.

## 12. Deployment, Backup and Restore

- Local development: Vite/Nitro Node runtime, intended to use `pnpm dev` after dependencies are installed.
- Optional deployment: Cloudflare Pages/D1, Vercel, Bun, and Docker are configured in existing files.
- Local database path: not explicitly configured in the repository; exact runtime location is pending dependency/runtime verification.
- Docker persists `/usr/app/.data` through the compose volume.
- No general Shipping HOT backup/restore procedure is approved; current persistence changes are the startup-safe nullable `vessels.status_changed_at` compatibility rebuild plus the minimal JSON-backed `calendar_events` and aggregate-only `ais_port_metrics` tables.

## 13. Testing and Verification Boundaries

- Current tests: Vitest covers Shipping HOT Domain, Provider, Repository, Event/HOT and UI trust contracts.
- Current verification state: the 2026-08-19 V2.5 Final Trust Seal closeout is 227/227 tests, with typecheck, targeted lint, build, `git diff --check`, local Mock/AIS-no-key/Calendarific-no-key runtime smoke, forced Provider failure fixtures, `shared/updated-sources.ts` stability and a 60-second Shekou Area probe. The Area socket opened and subscription was sent, but 0 PositionReports/valid reports/assigned samples/distinct MMSIs/source timestamps were received, so Area remains `connection_verified / coverage_pending`; no `verified_live` claim is made. The preceding corrected public Portcast/Open-Meteo/Shekou re-probe and all-real API/page smoke remain documented as prior baseline evidence. Full lint retains four pre-existing errors outside this batch; native better-sqlite3 runtime, Watched AIS observations and official-alert live criteria remain pending. Model weather, official weather alerts and AIS Area are independently configured and freshness-tracked.
- Shipping HOT tests cover delay, baseline preservation, Vessel/Voyage ownership merges, Provider normalization/failure/fallback, Calendar source composition/conflict/reconciliation/announcement behavior, RSS/HTML Feed parsing with unknown publication and Chinese classification, source isolation, repost dedupe, Feed → Event/HOT boundaries, Open-Meteo 24-hour/72-hour/7-day windows/direction/TTL/per-port failure behavior, source-specific official warning parsing/expiry, Real → Event flow, status duration, Event update/resolve/reopen, freshness, Feed/Event dedupe, congestion threshold, settings bounds, HOT ranking and Repository seed/read/write/prune contracts.
- Minimum release checks after implementation: typecheck, lint, relevant tests, build and local smoke verification.

## 14. Architecture Change Rules

Changes that require `/architect change`:

- Database tables/fields/ownership or migration changes.
- New authentication, deployment platform, external provider or secret class.
- Framework/ORM/runtime migration.
- Deleting or renaming current NewsNow Source, cache, OAuth, PWA or deployment capabilities.
- Enabling real external Providers, changing auth/deployment, or changing the accepted local Mock boundaries.

Changes that can remain local implementation decisions:

- Pure UI styling within the current component boundary.
- Pure helper refactors that preserve API/data contracts and pass existing checks.
- Additional tests and documentation corrections grounded in current code.

## 15. Known Risks and Pending Decisions

| Item | State | Impact | Owner / next action |
|---|---|---|---|
| Shipping HOT V1 Provider architecture | accepted | User-approved AISStream Vessel and Open-Meteo Marine Weather adapters preserve existing interfaces and Domain/Event/HOT boundaries | Preserve current module boundaries; no V2 Provider expansion |
| Project Architect/Neat Freak docs reconciliation | changed-and-verified after this pass | Docs must remain one source of truth | Re-run closeout after implementation |
| Runtime/database file path | pending | Native `better-sqlite3` could not build on Node 24 in this environment | Verify on a compatible Node/toolchain |
| GitHub remote/account metadata | changed-and-verified; no remote CI evidence | `gh auth status` and `gh repo view` verified `rallsix66/Shipping-HOT` and `main`; `gh run list` returned no workflow runs | Keep local verification separate from GitHub CI claims |
| Real shipping data sources | changed-and-verified for V1 | AISStream is beta and key-gated; Open-Meteo Marine is optional-key for normal use and carries coastal-accuracy/attribution caveats | Keep keys server-side; Mock is default only, with no Mock fallback in an explicitly real mode |
| Current OAuth/cloud deployment code | implemented, not runtime-verified | May be unnecessary locally but dependencies are not mapped | Dependency analysis before removal |

## 16. Related ADRs

- `docs/adr/ADR-001-use-newsnow-as-shipping-hot-foundation.md`
- `docs/adr/ADR-002-local-first-single-user-architecture.md`
- `docs/adr/ADR-003-separate-information-and-operational-data.md`
- `docs/adr/ADR-004-v1-real-provider-adapters.md`
- Roadmap and deferred real-provider plan: `docs/plans/shipping-hot-v1.md`
All-real local API smoke showed no Mock Vessel/Port/Weather/Feed/Calendar source; mock-schedule remained the only Mock source. Native SQLite persistence remains pending because the current Node 24 runtime cannot load the bundled better-sqlite3 ABI.

The superseding local suite is 191/191 with production build, typecheck, targeted lint and `git diff --check` passed; the older 184/184 and 186/186 entries remain preceding trust-boundary and live-verification batch history.
