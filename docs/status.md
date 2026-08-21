# Project Status — Shipping HOT / NewsNow Foundation

> Snapshot date: 2026-08-21
> Evidence scope: local code / configuration / Git metadata; V2.0 is sealed, V2.1 is implemented, V2.2/V2.3/V2.4 local closeout gates passed, V2.5 AIS / Port Derived Intelligence is implemented and locally verified, and accepted V3 P0 Persistence, P1A Port Directory Foundation, P1B Mock Isolation and P2A Search Foundation are implemented and verified. The final V2.5 trust and reconnect lifecycle seals are local-only: a 60-second Shekou Area probe opened the socket and sent one small bounding-box subscription but received no PositionReport, so Area remains `connection_verified / coverage_pending`. AISStream Watched remains `connection_verified / pending_observation`; Calendarific is `verified_live` for five HTTP 200/parser-success country responses with partial coverage; official-alert verification remains `live_pending`. V3 fixed Node `24.15.0`, verified `better-sqlite3` ABI `137`, established the side-by-side `.data/shipping-hot-v3.sqlite3` database, schema migration runner, ownership-separated watchlists, SecretStore contracts, placeholder runtime/usage/translation schemas, P1A `port_directory` baseline, P1B `source_type` lineage isolation and P2A `vessel_metadata`/search cache. AIS Tracking Runtime, remaining P2 watch/tracking and later Provider business remain deferred. Full lint retains four pre-existing errors outside this batch.
> Source of truth for: current implementation and verification state

## 1. One-Sentence Status

Shipping HOT V2.2–V2.5 local closeout is complete on the retained NewsNow stack, and V3 P0 Persistence, P1A Port Directory Foundation, P1B Mock Isolation and P2A Search Foundation are implemented on the same modular monolith: SQLite is the only Shipping HOT persistence truth, App/DB bootstrap is separate from Port Directory readiness, the eight-port directory baseline is ready, watchlists are user-owned, Provider upserts are field-scoped, Real Mode reads only `real/imported/derived` lineage, and unavailable persistence/provider capability cannot silently fall back to Mock. P2A provides server-side Vessel name/IMO/MMSI/callsign discovery with a 24-hour SQLite metadata/search cache, a static-only VesselAPI adapter boundary and local Port Directory Search. V2.5 keeps Watched AIS separate from Area AIS, stores only bounded aggregate metrics, uses reliable-source timestamp semantics, five-minute real buckets with gap/restart reset, stationary-count trend rules and warning-only Event/HOT signals for fresh usable watched-port samples. The real Area probe reached `connection_verified / coverage_pending` without an observation, so no `verified_live` claim is made.

`Mock isolation: complete` for V3 Real Mode: repository lineage filters, unavailable real-provider defaults, Schedule Mock removal and Event/HOT mixed-evidence rejection are verified. P2A Search Foundation is locally verified with Real Mode Mock cache isolation. AIS Tracking Runtime, AIS observation evidence, official-alert live verification and remaining P2 watch/tracking work remain pending/deferred.

## V2 Plan Archive

V2.0–V2.5 development plan is archived as completed.

Archive file: `docs/archive/shipping-hot-v2-completion.md`

Remaining pending work: real data coverage / runtime follow-up.

## 2. Current Environment

- Active branch: `codex/shipping-hot-v3-real-data`; package version: `0.0.41`
- Git remotes: `origin=https://github.com/rallsix66/Shipping-HOT.git` and `upstream=https://github.com/ourongxing/newsnow.git`; `gh auth status` and `gh repo view` are currently verified, while `gh run list` returned no remote workflow runs (`no remote CI evidence`)
- Local run status: Vite development smoke returned 200 for `/`, `/feed` and `/api/shipping`; default `provider.feed=mock`, `provider.weather=mock` and `provider.weatherAlerts=off`, one non-weather Feed item and one Mock weather item were returned without external weather calls; production Nitro API/root returned 200, while production subroutes hit the existing `#nitro/index` package-import error
- Deployment status: `out-of-scope`; repository contains optional Cloudflare/Vercel/Bun/Docker configuration, but no deployment was performed
- Database / external services: P0 uses fixed Node `24.15.0` / ABI `137`, `better-sqlite3@12.6.2`, db0 path `.data/shipping-hot-v3.sqlite3`, and passed native read/write plus process-A-write → close → process-B-read smoke. The ignored local `.data/db.sqlite3` artifact is a prior database and was not deleted; it is not the V3 runtime path. AISStream, Portcast public pages and Open-Meteo remain optional server-side sources.
- Mock fixture timestamps: generated relative to the runtime clock when a snapshot is created; deterministic fixed time is limited to `shared/shipping-engine.test.ts`
- V1 focus-port seed: all eight requested ports are present in the shared fixture and Repository seed path: Shekou, Yantian, Nansha, Laem Chabang, Port Klang, Manila, Jakarta and Ho Chi Minh City
- Last verified surface: source inspection, 248/248 tests, typecheck, production build, native SQLite read/write, migration-aware process restart persistence smoke including schema v5 search tables, P2A VesselAPI static-only/cache tests, Port Search tests, corrected public re-probe, targeted Calendarific scope/count probe and persisted Calendar sync test passed; full lint retains four pre-existing unrelated errors and no new P2A lint errors. Neat Freak Closeout is complete via the loaded skill and manual Windows-equivalent audit; the official Bash inventory sub-step is pending/unavailable because Bash is not installed in this Windows environment.

## 3. Current Architecture Summary

- Tech stack: React 19, Vite 7, TypeScript, TanStack Router, React Query, Jotai, Nitro, db0, better-sqlite3, Vitest, Vite PWA
- Main modules: `src/` UI/router/state, `server/api/` handlers, `server/sources/` fetchers, `server/database/` cache/user tables, `shared/` types/metadata, `scripts/` generated metadata
- Data source of truth: Source definitions in `shared/pre-sources.ts`; generated metadata in `shared/sources.json`; cache/user data in db0 tables; browser focus/order in localStorage
- Authentication / authorization: optional GitHub OAuth and JWT middleware; not required for local-only Mock mode
- Deployment: local Node is the intended foundation; Cloudflare/D1, Vercel, Bun and Docker are existing optional adapters

## 4. Feature Status

| Feature | State | Evidence | Notes |
|---|---|---|---|
| News Source aggregation | implemented | `server/getters.ts`, `server/sources/**`, `server/api/s/index.ts` | Runtime not verified |
| News cache | implemented | `server/database/cache.ts` | Uses db0 SQL; runtime DB path pending |
| User table and sync | implemented | `server/database/user.ts`, `server/api/me/sync.ts` | Optional GitHub/JWT path; runtime not verified |
| GitHub OAuth | implemented | `server/api/oauth/github.ts`, `server/middleware/auth.ts` | Credentials not configured |
| Search | implemented | `src/components/common/search-bar/index.tsx` | Searches Source entries, not full articles |
| Focus/order persistence | implemented | `src/atoms/primitiveMetadataAtom.ts`, `src/hooks/useFocus.ts` | Browser localStorage; optional sync |
| PWA | implemented | `pwa.config.ts`, `src/hooks/usePWA.ts` | Build/runtime not verified |
| Cloudflare/Vercel/Bun/Docker adapters | implemented | `nitro.config.ts`, `Dockerfile`, compose and wrangler examples | Deployment not performed |
| Shipping HOT Domain and Event Engine | implemented | `shared/shipping.ts`, `shared/shipping-rules.ts`, `shared/shipping-engine.ts` | Event reconcile covers update, resolve and reopen; HOT removes FeedItem/Event duplicates, uses related entity freshness, and ranks severity, watched relevance, freshness and recency; normalized Real Vessel/Weather signals use the same path |
| Shipping HOT API and local tables | implemented / locally verified; live pending | `server/api/shipping/**`, `server/database/shipping.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `shared/calendar.ts` | Provider → service → Repository path carries provenance, sourceUpdatedAt, fetchedAt and freshness; nullable Vessel status persistence has an idempotent old-schema rebuild; source-scoped Event identity and operational source filtering keep incompatible history out of current HOT; eight V1 focus-port seeds remain present |
| Shipping HOT V3 P0 Persistence | implemented / locally verified; P1A complete | `server/database/runtime.ts`, `server/database/migrations/001-p0-foundation.ts`, `server/database/migrations/002-watchlist-isolation.ts`, `server/database/shipping.ts`, `server/secrets/file-secret-store.ts`, `server/providers/contracts.ts` | Fixed Node 24.15.0 native SQLite, schema migration runner, App/DB bootstrap metadata, user-owned watchlists, Provider-owned upserts, and memory fallback removal. `translation_cache`/usage/runtime/sync are placeholder schemas/contracts only; no Provider Runtime/Usage business started |
| Shipping HOT V3 P1A Port Directory Foundation | implemented / locally verified | `shared/port-directory.ts`, `server/database/migrations/003-p1a-port-directory.ts`, `server/database/port-directory.ts`, `server/providers/shipping.ts`, `server/providers/aisstream-area.ts`, `shared/ais-area.ts` | `port_directory` migration v3, first 8 UN/LOCODE baseline rows, `PortDirectoryRepository`, Real Mode mock-source filter, and SQLite-backed production coordinate lookup for Open-Meteo/AIS Area; no Port Search UI/API |
| Shipping HOT V3 P1B Mock Isolation | implemented / locally verified; AIS Tracking Runtime deferred | `server/database/migrations/004-p1b-mock-isolation.ts`, `server/database/shipping.ts`, `server/providers/shipping.ts`, `server/providers/feed.ts`, `server/providers/calendar.ts`, `server/shipping-store.ts`, `shared/shipping.ts` | migration v4 adds `source_type` lineage; Real Mode Repository reads only `real/imported/derived`, rejects Mock/mixed evidence, does not select Mock providers or `MockScheduleProvider`; Test/Mock Mode remains available; no AIS long connection or P2 functionality started |
| Shipping HOT V3 P2A Search Foundation | implemented / locally verified; remaining P2 watch/tracking deferred | `server/database/migrations/005-p2a-search-foundation.ts`, `shared/vessel-search.ts`, `server/database/vessel-search.ts`, `server/providers/vessel-search.ts`, `server/search/vessel.ts`, `server/search/port.ts`, `server/api/shipping/search/**` | `vessel_metadata` stores static discovery identity and `vessel_search_cache` stores normalized 24-hour results; `VesselSearchProvider` keeps pages away from VesselAPI; VesselAPI adapter is static-only; Port Search uses local UN/LOCODE names/aliases; no AIS WebSocket, Tracking Runtime, Feed, Calendar, Voyage, Translation or Watchlist workflow |
| Shipping HOT UI/routes | implemented / locally verified; live pending | `src/routes/**`, `src/components/shipping/**` | `/`, `/vessels`, `/ports`, `/voyages`, `/events`, `/feed`, `/calendar`, `/settings` and detail routes; UI uses the aurora glass console layout (左侧可折叠侧栏 + 全局状态条 + 密集表格 + 筛选侧栏/时间线 + 双栏详情 + 移动端底部 tab), blue `#0ea5e9` brand icon, conditional Calendarific Attribution and weather window controls |
| Shipping HOT V2.0 Data Trust Foundation | sealed | `shared/shipping.ts`, `server/database/shipping.ts`, `server/providers/shipping.ts`, `server/shipping-store.ts`, `shared/shipping-engine.ts`, `src/components/shipping/format.ts`, `src/components/shipping/ui.tsx` | `sourceType`/`dataNature` provenance, independent freshness timestamps/status, deterministic legacy backfill, source-aware Event reconciliation/evidence and explicit Mock/Chinese UI labels |
| Shipping HOT V2.1 Port Intelligence | implemented / verified | `server/providers/shipping.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `src/components/shipping/pages.tsx` | Opt-in `PortcastPublicPageProvider`, eight public-page mappings, visible-field parser, 24-hour cache/fingerprint, `public`/`no_public_data` detail and source attribution; Mock remains default |
| Shipping HOT V2.2 Country Calendar | implemented / locally verified; Calendarific verified_live; Official live pending | `shared/calendar.ts`, `server/providers/calendar.ts`, `server/database/shipping.ts`, `server/api/shipping/calendar/**`, `src/routes/calendar.tsx`, `src/components/shipping/pages.tsx` | Calendarific + Official + Manual composition, actual provenance `calendarSourceIds` activation mapping, national/local scope evidence, date/scope-aware dedupe and reconciliation, legacy unscoped Calendarific-local migration, unsupported-type quarantine, stale last-known marking for partial/unknown coverage, live type-label normalization/deduplication, conflict evidence and national Calendar → Event → HOT reminders are implemented; local/unknown/unsupported Calendar facts remain visible but do not create national Event/HOT; Official live sync remains pending; Mock remains default |
| Shipping HOT V2.3 Shipping Information Feed | implemented / locally verified; live pending | `server/providers/feed.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `shared/shipping-engine.ts`, `src/components/shipping/**` | Unknown publication semantics, Chinese classification, realistic HTML handling and source registry states are implemented; public-source live runtime remains pending; Mock remains default |
| Shipping HOT V2.4 Weather Intelligence | implemented / locally verified; live pending | `server/providers/shipping.ts`, `server/providers/weather-alerts.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `src/components/shipping/app.tsx` | Open-Meteo 24-hour/72-hour/7-day windows and direction fields are implemented; model weather and JMA/TMD/BMKG official alerts are independently selected and composed with failure isolation; official sources remain `live_pending` and are disabled without requests in public mode until live verification; Mock remains default |
| Shipping HOT V2.5 AIS / Port Derived Intelligence | implemented / locally verified; live pending (`connection_verified / coverage_pending`) | `shared/ais-area.ts`, `server/providers/aisstream-area.ts`, `server/database/shipping.ts`, `server/shipping-store.ts`, `shared/shipping-engine.ts`, `src/components/shipping/pages.tsx` | Explicit `SHIPPING_AIS_AREA_PROVIDER=off|aisstream` area session, configured heuristic watched-port boxes, PositionReport-only bounded observations, reliable timestamp separation, five-minute bucket/gap-reset trend metrics, TTL prune + 5000 hard cap, separate `ais_port_metrics` aggregate persistence, finite automatic reconnect budget (default 4 attempts) and warning-only Event/HOT path; 60-second Shekou Area probe opened/subscribed but received 0 PositionReports; no Portcast field mutation or raw track table; Mock remains default |

## 5. Decision Status

### Current Active Decisions

- Retain NewsNow as the foundation until migration cost and risk are proven higher.
- Treat the current NewsNow code/config as the authority for current implementation facts.

### Approved and Implemented for V1

- AISStream Vessel and Open-Meteo Marine Weather adapters with server-side environment selection and fallback.

### Approved and Implemented for V2.0

- Data Trust Foundation: `sourceType`/`dataNature` provenance, `ProviderResult`-compatible freshness envelope, source/fetch/update timestamp separation, degraded status preservation, last-known failure behavior, Event evidence propagation and UI attribution labels.

### Accepted V3 P0 — 2026-08-20

- ADR-005 V3 Real-Data Boundaries is `Accepted`. P0 Persistence is implemented and verified on Node `24.15.0` / ABI `137`: `.data/shipping-hot-v3.sqlite3` is the configured local database, `schema_migrations` is authoritative for migrations, `bootstrap_completed_at` only records App/DB foundation, and `port_directory_status/version/imported_at` remains independent from bootstrap and is now `ready` after P1A baseline import.
- SQLite is the only Shipping HOT persistence truth. SQLite failure never creates a mutable memory replacement; Shipping HOT mutations return `503 persistence_unavailable` or `persistence_write_failed`.
- `vessel_watchlist` and `port_watchlist` own user state; Provider upserts update only Provider-owned columns with explicit conflict updates. `translation_cache`, `provider_usage`, `provider_runtime` and `sync_runs` are placeholder schemas/contracts, not complete Provider Runtime/Usage business. `ProviderConfig` is the only Provider configuration allowed in SQLite settings; API keys/`ProviderSecret` use server-only `SecretStore` and local `.data/provider-secrets.json`. AI adapters, VesselAPI, AIS long connection, Feed/Calendar/Voyage/Translation adapters remain deferred; P1A imported the initial UN/LOCODE baseline but did not implement an external snapshot importer.
- V3 migration lineage is documented as `source_type = real | mock | imported | derived`; Real Mode never reads `mock` records. P1A adds the separate `port_directory.source` filter and does not add the broader V3 migration importer. Existing P0 evidence covers a normal process-A write → close → process-B read; the abnormal-exit restart scenario remains an additional pending verification gate.

### Implemented V3 P1B Mock Isolation — 2026-08-21

- Migration v4 adds `source_type` to all Shipping operational tables: `vessels`, `ports`, `voyages`, `feed_items`, `events`, `calendar_events` and `ais_port_metrics`. Old rows are classified from Mock provenance/evidence; rows without reliable lineage are conservatively excluded from Real Mode.
- `ShippingRepository` applies the Real Mode allow-list (`real`, `imported`, `derived`) to every operational query and rejects Mock or mixed Mock-evidence writes. Test/Mock Mode retains the fixture seed and reads.
- Real Mode no longer defaults Vessel, Port, Weather, Feed, Calendar or Schedule to Mock. Missing real capability is `unavailable`/`misconfigured`; `MockScheduleProvider` is never an operational source. Mock last-known data is not used in Real Mode.
- Event and HOT boundaries reject Mock provenance or any Mock evidence, including mixed-evidence records. No AIS long connection, VesselAPI, Search/Watch or other new business function was started.
- Verification: `241/241` tests, typecheck, native SQLite process-A-write → close → process-B-read smoke (Node `24.15.0`, ABI `137`, schema v4), and full lint with only four pre-existing unrelated errors.

### Implemented V3 P2A Search Foundation — 2026-08-21

- Migration v5 adds `vessel_metadata` and `vessel_search_cache`. Metadata stores `name`, `imo`, `mmsi`, `callsign`, `type`, `flag`, `source` and `fetched_at`; the cache stores normalized query keys, result identities, Provider and 24-hour expiry. `source_type` is enforced so Real Mode never reads Mock search rows.
- Vessel Search Domain supports vessel name, IMO, MMSI and callsign. `VesselSearchProvider` and `VesselSearchService` are server-only; the service checks SQLite cache before calling a Provider and persists normalized results.
- VesselAPI is the first adapter but only for discovery/static metadata. It does not emit realtime position, open AIS or replace AISStream. Missing API/provider configuration fails explicitly; Mock search capability remains test-mode only.
- Port Search is exposed through `PortSearchService` and `/api/shipping/search/ports`, backed by `port_directory` and supporting Chinese name, English name, UN/LOCODE and aliases. Vessel Search is exposed through `/api/shipping/search/vessels`; no UI direct-to-provider path exists.
- Verification: `248/248` tests, typecheck, production build, native SQLite restart smoke (Node `24.15.0`, ABI `137`, schema v5) passed. Full lint has no new P2A errors; four unrelated pre-existing errors remain.

### Approved / V2.2 Locally Verified; Live Pending

- Country Calendar: TH/ID/MY/PH/VN contracts, server-only Calendarific integration with conditional attribution, composed official/manual/mock boundaries, source-scoped coverage, conflict evidence, national/local scope evidence, date/scope-aware normalization and deduplicated national Event/HOT reminders; Calendarific is verified_live, while official live sync is still pending.

### Approved / V2.3 Locally Verified; Live Pending

- Shipping Information Feed: opt-in The Loadstar/The Maritime Executive RSS and Shekou official HTML adapters, explicit parser-pending/deferred/failed-live registry states, independent source failure handling, unknown publication semantics, Chinese classification, canonical/title dedupe and Feed → Event → HOT convergence.

### Approved / V2.4 Locally Verified; Live Pending

- Weather Intelligence: one 7-day Open-Meteo request with local 24-hour/72-hour/7-day windows and wave/swell directions, 30-minute server TTL, per-port failure isolation and last-known stale semantics, plus source-specific JMA sea-warning HTML, TMD public RSS and BMKG RSS adapters. Model weather and official alerts are independently selected and composed; all three official sources remain `live_pending`; `public` enables only `verified_live` sources (currently none), while `experimental` is the explicit opt-in for pending adapters; model risk and official warning provenance remain separate.

### Approved / V2.5 Locally Verified; Live Pending

- AIS / Port Derived Intelligence: Watched AIS and Area AIS use separate Provider/session boundaries. `SHIPPING_AIS_AREA_PROVIDER=off` is the default rollback; `aisstream-area` subscribes only to small configured heuristic boxes for watched current-port identities and sends `FilterMessageTypes=["PositionReport"]` without `FiltersShipMMSI`. `sourceUpdatedAt` is copied only from a reliable AIS payload timestamp; `updatedAt` falls back to the latest local observation time only when no reliable source timestamp exists, and observation windows do not rewrite provenance. Metrics use five-minute bucket boundaries, do not increment within a bucket, reset on gaps/stale/insufficient/restart state, and use stationary-count plus ratio evidence so sample shrink cannot create a false rising trend. The session prunes observations at the 15-minute TTL and enforces a 5000-entry hard cap, while persisting only one bounded aggregate per port. Automatic reconnects use a finite budget: the initial connection is free, the default delay list permits four reconnect attempts, exhaustion stops background socket creation, a successful open resets the cycle, and a later explicit provider request starts a new cycle; `close()` cancels pending reconnects and clears retry state. Warning-only `ais_port_congestion_trend` still requires five distinct MMSIs and three consecutive rising buckets. A 60-second real Shekou Area probe opened one subscription but received 0 PositionReports, so Area remains `connection_verified / coverage_pending` and external observation is live pending.

## Real Provider Activation

Real Providers remain opt-in and require user-supplied configuration. Keys are never stored in this document.

| Area | Provider | Environment configuration |
|---|---|---|
| Vessel | AISStream | `SHIPPING_VESSEL_PROVIDER=aisstream` + `AISSTREAM_API_KEY` |
| Port | Portcast | `SHIPPING_PORT_PROVIDER=portcast` |
| Weather Model | Open-Meteo | `SHIPPING_WEATHER_PROVIDER=open-meteo` |
| Official Weather Alerts | JMA / TMD / BMKG | `SHIPPING_WEATHER_ALERT_PROVIDER=public` (only `verified_live`) or `experimental` (explicitly allows `live_pending`) |
| Feed | Public Feed | `SHIPPING_FEED_PROVIDER=public` |
| Calendar | Calendarific | `SHIPPING_CALENDAR_PROVIDER=calendarific` + `CALENDARIFIC_API_KEY` |
| AIS area | AISStream area PositionReport | `SHIPPING_AIS_AREA_PROVIDER=aisstream` + `AISSTREAM_API_KEY` (default `off`) |

Current JMA, TMD and BMKG `liveStatus` remain `live_pending`; `public` therefore makes no real requests until a source is verified, while `experimental` is the explicit pending-adapter opt-in.

## Mock Isolation Rule

Only explicit Mock mode may surface Mock data.

Real Provider modes:

- never fall back to Mock on missing configuration;
- never use Mock as last-known;
- preserve only same-provider successful historical data;
- first failure with no same-provider history returns no data / `never_succeeded`;
- unknown fields remain unknown rather than inheriting Mock values.
- Vessel watch configuration is passed to AIS as identity-only `VesselWatchTarget` records; Mock dynamic Vessel fields never enter AIS observation input.
- AIS `statusChangedAt` means the first continuously observed timestamp of the current navigation state from AIS, not a guaranteed real-world transition time.
- Historical Events whose provenance is incompatible with the current Provider modes remain in SQLite but are excluded from current operational Events and HOT; Provider switching never resolves them.
- AIS area metrics use `aisstream-area` provenance and never become Portcast `congestionLevel`, `waitingHours` or waiting-vessel facts; area-derived trend Events are warning-only and require fresh usable watched-port evidence.
- `ais_port_metrics` stores only current/last-known aggregate JSON; raw AIS messages, tracks and unbounded history are not persisted. Disabling area removes historical metrics/Events from the current operational view without deleting audit rows.

### Provider activation semantics

- AISStream missing key → `aisstream / never_succeeded`, `AISSTREAM_API_KEY missing`, vessel data `[]`.
- Calendarific missing key → `calendarific`, unknown Calendarific coverage with `CALENDARIFIC_API_KEY missing`, no Mock Calendar events.
- Calendar source activation mapping is verified: Mock → `mock-calendar`; Calendarific with key → `calendarific` + `official-holiday-source` + `manual-holiday`; Calendarific without key → `calendarific` only; Official → `official-holiday-source` + `manual-holiday`; Manual → `manual-holiday`. These are provenance IDs, not composite provider option keys, and current Calendar/Event/HOT reads use the configured set.
- Open-Meteo first failure → no model data; only prior `open-meteo-marine` records may be retained stale/failed.
- Portcast first failure → static port identity only; dynamic fields are unknown. A later failure may retain only prior `portcast-public` dynamic fields.
- Public Feed failure → only last-known records from enabled public source IDs may be retained; `mock-port-notice` is excluded.

The requested Provider mode is shown independently from runtime `sourceStatus` (`healthy`, `degraded`, `failed`, `disabled`, `never_succeeded`).

## Calendarific Final Operational Semantics Seal — 2026-08-18

- National/public/federal/bank holiday labels normalize to `type=public_holiday`, `isPublicHoliday=true`, `scope=national`. Local/regional/state/provincial/subdivision labels remain Calendar facts but use `scope=subdivision` when Calendarific supplies region evidence, otherwise `scope=unknown`.
- The targeted five-country payload probe found actual `states[].iso` codes and `locations` text in MY, plus local-scope records in PH. No subdivision code is fabricated: a single supplied ISO is stored as `subdivisionCode`, multiple supplied ISOs are preserved in `subdivisionCodes`, and names/location text remain `scopeLabel` evidence.
- Local and unknown-scope Calendar facts remain visible in the Calendar repository/API, but `isCalendarOperationallyRelevant()` excludes them from national Calendar Event/HOT generation. `government_special` keeps its existing immediate-announcement behavior. National Calendar IDs remain stable; only scoped facts receive scope identity suffixes.
- Unknown Calendarific type labels normalize to `type=commercial`, `scope=unknown`, `businessImpact=low`, `recognized=false`; the fact remains Calendar-visible but is non-operational and cannot create a Calendar Event/HOT. The live unsupported labels were `Season` in TH/ID/MY/VN and `Weekend` plus `Season` in PH.
- 2026 targeted probe reconciliation: raw `201` − invalid date `0` − missing name `0` → `201` normalized candidates; scope-aware dedupe retained `201` unique facts (`TH=36`, `ID=31`, `MY=67`, `PH=37`, `VN=30`), comprising `98` national + `44` subdivision + `59` unknown, with `25` unsupported-type records and `98` operationally eligible records. All `201` provider facts merged successfully. The old `198` direct / `189` operational and `48` local/unknown counts are superseded measurements from the pre-scope key and must not be used as the current invariant. Repository JSON scope round-trip is covered by tests; native better-sqlite3 runtime remains pending.
- Legacy unscoped Calendarific facts are removed from the current `calendar_events` set only when the same country/date/name/type is represented by an incoming scoped subdivision/unknown fact. The linked historical ShippingEvent remains in the Event audit repository, is excluded from the current operational view, and is not marked resolved. Legacy unscoped national, Official and Manual facts remain unaffected.
- The current reminder window contains `3` Calendarific Calendar → ShippingEvent → HOT samples: PH `2026-08-21` Ninoy Aquino Day, ID `2026-08-25` Maulid Nabi Muhammad and MY `2026-08-25` The Prophet Muhammad's Birthday. All are `scope=national`; current subdivision, unknown-scope and unsupported reminder counts are `0`. The prior four-reminder sample cannot be reconstructed exactly from the stored aggregate evidence.
- The five countries remain `coverageStatus=partial`; this closeout does not claim complete national-calendar coverage. AISStream remains `connection_verified / pending_observation`, JMA/TMD/BMKG remain `live_pending`, and V2.5 local implementation is complete with external area observation pending.

## Calendar Sync Persisted Baseline Seal — 2026-08-19

- `syncCalendarEvents()` now calls `readStoredSnapshot()` after `initialize()` and uses that snapshot for existing Calendar facts, coverage, settings, entities, FeedItems and previous ShippingEvents.
- When Repository is available, persisted state wins. Legacy Calendarific local migration can therefore discover the persisted unscoped row after a process-like restart, execute `removedIds` deletion, persist the new scoped row, and retain the linked historical ShippingEvent without resolving it.
- Historical V2 behavior: `fallbackSnapshot` was the Repository-unavailable memory fallback and was not authoritative when persisted state existed. V3 P0 supersedes this path with an explicit unavailable status and no mutable memory replacement.
- Restart-style V2 tests remain historical evidence for legacy Calendar reconciliation; the current P1B native restart smoke verifies process-A write → close → process-B read through SQLite. The architecture's abnormal-exit variant remains pending. Real Mode no longer permits `mock-schedule` as an operational source.

## Calendar Sync Operational Source Isolation Seal — 2026-08-19

- Repository rows remain historical facts and are not deleted merely because Provider mode changes. Calendar sync filters Vessel, Port, Voyage and Feed inputs through the existing `OperationalSourceContext` before Event detection.
- The same context now checks Provider mode, active registry source IDs and P1B lineage/evidence: current real sources may produce current evidence, inactive Mock sources cannot, and `mock-schedule` is excluded in Real Mode.
- Persisted historical Mock Events remain in the audit repository, but are excluded from current reconciliation/HOT and are not re-upserted or falsely resolved.

### Local runtime smoke — 2026-08-18

- Default all-Mock request: `/api/shipping` returned HTTP 200 with Mock vessels/calendar/HOT present.
- AIS requested with an empty key and all other sources Mock: `/api/shipping` returned HTTP 200, `provider.vessel=aisstream`, `providerFreshness.vessel.sourceStatus=never_succeeded`, `vessels=[]`, and no `mock-vessel` Event/HOT.
- Calendarific requested with an empty key: `/api/shipping` and Calendar sync returned HTTP 200, five `calendarific / unknown / CALENDARIFIC_API_KEY missing` coverage rows, zero Calendar events and zero `mock-calendar` Event/HOT.
- Open-Meteo and Portcast forced-failure semantics remain covered by the no-network Provider tests; no new external Provider smoke was started in this closeout.

### Approved but Deferred

- Deployment and Port/Schedule real Providers remain deferred. SQLite migration SQL is offline-verified; native persistence remains pending until the bundled module is rebuilt or run under a compatible Node toolchain.

### Implemented Local Mock Scope

- Local-first single-user Shipping HOT architecture.
- Separate Information Feed from Operational Data through Event/HOT convergence.
- Vessel/Port/Voyage/Event/Settings model, isolated Provider interfaces, Mock adapters, approved V1 real adapters and deterministic Event Engine.

### Deprecated / Rejected

- None recorded. Do not infer deletion approval from the proposal's `REMOVE` section.

## Historical Real Provider Probe — 2026-08-17 (before the current live-path fixes)

The requested one-shot mode configuration was applied to the local App without writing secrets:

`vessel=aisstream`, `port=portcast`, `weather=open-meteo`, `weatherAlerts=public`, `feed=public`, `calendar=calendarific`; Schedule remains Mock by approved scope.

Required secrets were absent from the process environment and no `.env` file was present: `AISSTREAM_API_KEY` and `CALENDARIFIC_API_KEY`. No placeholder or fabricated secret was used.

| Module | Source | Requested | Live result | Data count | Freshness / status | Notes |
|---|---|---:|---|---:|---|---|
| AISStream | AISStream | yes | not requested; key absent | 0 vessels | `never_succeeded` | Connection/PositionReport observation pending; no Mock fallback |
| Portcast | Shekou | yes | verified | 1/1 | healthy, fresh | public page, medium, 62.88h; source date 2026-08-16 |
| Portcast | Yantian | yes | verified | 1/1 | healthy, fresh | public page, medium, 32.40h; source date 2026-08-16 |
| Portcast | Nansha | yes | verified | 1/1 | healthy, fresh | public page, medium, 26.88h; source date 2026-02-16 |
| Portcast | Laem Chabang | yes | verified | 1/1 | healthy, fresh | public page, low, 4.56h; source date 2026-08-16 |
| Portcast | Port Klang | yes | verified | 1/1 | healthy, fresh | public page, low, 3.84h; source date 2026-08-16 |
| Portcast | Manila | yes | verified | 1/1 | healthy, fresh | public page, medium, 27.60h; source date 2026-08-16 |
| Portcast | Jakarta | yes | verified | 1/1 | healthy, fresh | public page, low, 7.44h; long-tail=true; source date 2026-08-16 |
| Portcast | Ho Chi Minh | yes | verified | 1/1 | healthy, fresh | public page, low, 1.92h; source date 2026-02-16 |
| Open-Meteo | 8 focus ports | yes | 8/8 HTTP + parser responses | 8 responses / 6 risk FeedItems | healthy, fresh | 16 requests total; each port uses one Marine + one Forecast request; emitted items contain `h24/h72/d7`; Port Klang/Jakarta were below risk emission threshold |
| Shipping Feed | The Loadstar | yes | verified | 10 | parser success | HTTP 200 RSS; latest publishedAt 2026-08-16T23:01:39Z; publication times known |
| Shipping Feed | Maritime Executive | yes | failed | 0 | `failed_live` | direct HTTPS fetch failed; no fabricated item or Mock fallback |
| Shipping Feed | Shekou Official | yes | partial | 14 | parser success, publication unknown | HTTP 200 HTML; all 14 items had unknown publication time and therefore cannot create Event/HOT |
| Calendarific | TH/ID/MY/PH/VN | yes | not requested; key absent | 0 | `live_pending` | requested mode remained `calendarific`; no Mock Calendar records |
| Official Alerts | JMA | independent probe | partial | 0 | `live_pending` | HTTP 200 HTML, current parser produced no alerts |
| Official Alerts | TMD | independent probe | failed parser | 0 | `live_pending` | HTTP 200 XML endpoint, payload had an RSS root while the registry still expected CAP |
| Official Alerts | BMKG | independent probe | partial | 6 | `live_pending` | HTTP 200 XML/RSS and 6 parsed items; registry remains disabled/live_pending |

No `live_pending` source was upgraded to `verified_live`; the live results above do not yet satisfy every registry upgrade criterion. Public mode therefore still activates no Official Alert source by default.

## Current Live-Path Fix Status — 2026-08-18

The corrected public re-probe completed successfully and is kept separate from the historical 2026-08-17 probe. Portcast and Open-Meteo used direct public endpoints; Shekou used the corrected `/ywgg/` page; no proxy, mirror or credential was used.

| Area | Current contract / last evidence | Status |
|---|---|---|
| Portcast | HCM mapping is `https://www.portcast.io/port-congestion/ho-chi-minh`; source-age threshold is 14 days; missing source date is `source_update_time_unknown`; stale pages retain real Portcast values but cannot create Port Events/HOT. Corrected probe: 8/8 HTTP+parser, 7 `verified_live_fresh`, 1 `verified_live_stale` (Nansha, source date 2026-02-16); HCM 200, source date 2026-08-16, fresh. | verified_live_fresh / verified_live_stale |
| Open-Meteo | Corrected probe: 16 requests for 8 ports, 8/8 HTTP+parser; 6 risk FeedItems emitted, Port Klang/Jakarta below risk threshold; `updatedAt` is forecast valid time, `sourceUpdatedAt` undefined, `fetchedAt` is later local completion time; all emitted items contain h24/h72/d7. | verified_live |
| Shekou Official Feed | Corrected probe: `/ywgg/` HTTP 200, 5 parsed items, every canonical path is `/ywgg/`, zero `/gsxw/` items; latest page item has unknown publication time, so it does not create Event/HOT. | verified_live_parser |
| The Loadstar / Maritime Executive | Corrected probe: Loadstar HTTP/parser success with 10 items; Maritime Executive direct fetch failed (`fetch failed`) and provider returned 0 without Mock fallback. | Loadstar `verified_live`; Maritime `failed_live` |
| AISStream | The verified WebSocket session received no PositionReport within 120 seconds; no observation evidence was claimed. | `connection_verified / pending_observation` |
| Calendarific | Five-country HTTP/parser probe succeeded; all country coverage remains partial and no Mock Calendar source entered the requested real-mode view. | `verified_live / partial` |
| Official alerts | JMA/TMD/BMKG remain registry-disabled pending independent probes and full live criteria; TMD's public endpoint format was corrected from CAP to RSS without upgrading its live status. | `live_pending` |

Current implementation matrix: Portcast supports fresh / stale / failed / no-public states and re-evaluates source age on every read, including cache hits; Open-Meteo keeps model forecast evidence without fabricating a source update time and records completion-time `fetchedAt`; Shekou Feed is official operational notices only; AIS area remains explicit off by default and locally verified with a connection-only external probe that received no valid observation. Real Mode now has no Mock operational source; Schedule is unavailable until a real entitlement is added.

## Historical Credential-Gated Verification — 2026-08-18

This historical pass checked the credential-gated and public-source paths directly while credentials were absent. No secret value was printed, stored or written to documentation. Its Calendarific `pending_credentials` result is superseded by the later verified-live probe below; the AISStream no-observation result remains current.

| Area | Requested mode / source | Direct result | Current status | Decision |
|---|---|---|---|---|
| AISStream | `aisstream` | `AISSTREAM_API_KEY: missing`; no WebSocket request; no-data path returned `Error: AISSTREAM_API_KEY missing` and no Mock vessel | `pending_credentials` / `never_succeeded` | Keep requested real mode; do not fall back to Mock |
| Calendarific | `calendarific` | Historical no-key run: no external request; five-country result had zero events and `unknown` coverage | historical `pending_credentials` | Keep requested real mode; do not seed Mock Calendar events; superseded by the later verified-live probe |
| JMA | `https://www.jma.go.jp/bosai/seawarning/` | HTTP 200 `text/html`; current source-specific parser recognized the page and returned 0 alerts; no fabricated warning | `live_pending` | Valid empty observation, but no positive sample to verify timestamps/area/severity/expiry; remain disabled |
| TMD | `https://www.tmd.go.th/en/api/xml/CAP` | HTTP 200 `text/xml`; payload root is RSS; after the minimal registry correction from `cap` to `rss`, parser returned 7 items; port association is empty unless the alert text/area names a known port, and the RSS index does not provide verified expiry fields | `live_pending` | Keep disabled until full warning-field and lifecycle criteria are verified |
| BMKG | `https://www.bmkg.go.id/alerts/nowcast/en` | HTTP 200 `application/xml`; RSS parser returned 2 items; port association is empty unless the alert text/area names a known port, and no verified expiry field was present in the index response | `live_pending` | Keep disabled until full warning-field and lifecycle criteria are verified |
| Maritime Executive | `https://maritime-executive.com/rss` | DNS resolved A/AAAA records, but TCP 443 timed out and direct HTTPS fetch failed; no RSS/XML response was received | `failed_live` | Retain the source as disabled `failed_live`; it is excluded from active public fetch scheduling and does not affect Loadstar or Shekou |

The previous no-network all-real mode smoke requested `vessel=aisstream`, `port=portcast`, `weather=open-meteo`, `weatherAlerts=public`, `feed=public`, `calendar=calendarific`, with `schedule=mock`. After this closeout, active source IDs contain `aisstream`, `calendarific`, `portcast-public`, `open-meteo-marine`, `the-loadstar`, `shekou-official` and `mock-schedule`; `maritime-executive`, `mock-vessel`, `mock-port`, `mock-weather`, `mock-port-notice` and `mock-calendar` are absent. No official alert source is active in `public` mode because JMA/TMD/BMKG remain unverified.

No source was upgraded to `verified_live` in this pass. V2.2 remains `implemented / locally verified / live pending`; V2.3 remains live-verified for Loadstar + Shekou with Maritime Executive `failed_live`; V2.4 model weather remains live-verified while official alerts remain `live_pending`. V2.5 had not started at this historical checkpoint.

## Final Alert Lifecycle + Feed Timeout Closeout — 2026-08-18

- `warning_missing_from_current_index` now means lifecycle unknown: the item remains warning/critical history with official timestamps and provenance, but becomes `eventEligibility=false`, `hotReason=undefined`, `weather.alertState=unknown`, `stale=true` and `sourceStatus=degraded`; it cannot enter new Event/HOT output.
- Public Feed applies a 10-second timeout independently to each active source's fetch, response body and parser. One source timeout returns its own stale/failed last-known records without delaying successful Loadstar/Shekou results.
- Weather alert aliases now map `Chonburi`/`Chon Buri` to Laem Chabang and `Tanjung Priok`/`North Jakarta` to Jakarta; registry-wide default port association remains disabled.
- JMA strict validation no longer accepts `#contents table`; it requires the JMA `#seawarning-container`/warning structure or an explicit empty marker.
- Regression coverage is now 181/181. Mock Isolation, Portcast/Open-Meteo trust semantics, Schedule and the then-not-started V2.5 scope remained unchanged at this historical checkpoint.

## Final Trust Boundary Seal — 2026-08-18

- Direct FeedItem → HOT now requires `sourceStatus=healthy` and `stale=false` in addition to severity, publication-time and event-eligibility checks; stale/failed/degraded FeedItems cannot bypass Event/HOT freshness through the direct Feed path. Existing active Event → HOT behavior is unchanged.
- Public Feed retains a 10-second per-source deadline over fetch, response body and parser, and calls `AbortController.abort()` when the deadline expires so the underlying HTTP fetch receives cancellation. Timed-out sources keep only their own stale/failed last-known items; without previous data they return no placeholder item.
- Official Weather Alert port association is alert-evidence-only: `WeatherAlertSource` no longer exposes `relatedPortIds`, and parser logic ignores any runtime-injected provider-wide default. Matching uses alert title/summary/area, canonical port names/UNLOCODEs and the verified aliases only.
- Regression coverage is now 184/184. Mock Isolation, Portcast/Open-Meteo trust semantics, Schedule and the then-not-started V2.5 scope remained unchanged at this historical checkpoint.

## AISStream + Calendarific Live Verification — 2026-08-18

### Credentials

- AISSTREAM_API_KEY: present in local .env.local; value was never printed, persisted to docs, or included in a request log.
- CALENDARIFIC_API_KEY: present in local .env.local; value was never printed, persisted to docs, or included in a request log.
- .env.local is ignored and untracked; git diff, git status, and generated/API outputs contained no secret values.

### AISStream

- Watched targets: 2; valid watched MMSI: 2; subscription filter contained only those 2 MMSIs and PositionReport.
- Provider observation window: 120 seconds; provider returned AISStream request timed out; normalized PositionReports: 0; matched MMSIs: 0.
- Wire-level check: WebSocket opened=true for the full 120-second window; no explicit WebSocket error or server close was observed. The subscription was sent with the current MMSI filter, but no PositionReport arrived, so this is connection_verified / pending_observation, not verified_live.
- No real AIS Event/HOT sample was claimed. Existing AIS normalization, Mock-field isolation, same-source statusChangedAt continuity and Event/HOT rules remain covered by the local suite; the no-observation live run did not provide a new status transition sample.
- Current all-real API freshness is vessel=never_succeeded with no vessels, and no mock-vessel entered current Vessel/Event/HOT output.

### Calendarific

- Historical pre-scope count: TH 200 / 36, ID 200 / 31, MY 200 / 64, PH 200 / 37, VN 200 / 30; total 198 normalized events before operational composition. That count used a key without local scope and is superseded.
- All five responses were legal JSON and parser-successful. Each country had eventSourceStatus=healthy, coverageStatus=partial, sourceId=calendarific, and valid country/date fields. The API did not declare complete coverage, so no country was upgraded to complete.
- The scope closeout probe found actual `locations` and `states[].iso` evidence in local records. The normalizer now maps national/public/federal/bank labels to `public_holiday + national`, local labels to `subdivision`/`unknown`, and deduplicates by country/date/name/type/scope. Same-day same-name facts from different subdivisions remain separate. Regression tests cover exact duplicates, type-normalization collisions, date stability and subdivision-aware dedupe.
- The current CalendarEvent contract has no localName field, and the sampled Calendarific payloads did not provide a local-name field; no localName value was fabricated.
- The targeted current-year scope probe reconciled 201 raw → 201 normalized unique → 201 provider/merge facts (`MY=67`, local/unknown scope=48); `calendarSourceIds` remains source-accurate and mock-calendar remains excluded in Calendarific mode. The earlier 189 persisted/read-back result belongs to the pre-scope reconciliation and is not a current count. Repository scope JSON round-trip is covered; the native-persistence wording in this historical 2026-08-19 entry is superseded by the V3 P0 seal below.
- Current-year reminder window produced 3 Calendar → ShippingEvent → HOT samples, all fresh and provenance.sourceId=calendarific, all `scope=national`. The prior four-reminder sample cannot be reconstructed exactly; no national/local/unknown/unsupported breakdown is inferred for it. Native SQLite verification is recorded in the V3 P0 seal below.
- Final Calendarific status: verified_live with per-country partial coverage; it is not an assertion of complete national-calendar coverage.

### All-real requested-mode smoke

- Requested modes: aisstream, portcast, open-meteo, public alerts, public Feed, calendarific; Schedule remained Mock.
- /, /vessels, /ports, /voyages, /feed, /calendar, /events, /settings and /api/shipping returned HTTP 200.
- API provider modes matched the request. Portcast returned configured real data with current source_stale freshness for old public page dates; Open-Meteo and public Feed were healthy; public JMA/TMD/BMKG remained inactive/live_pending and were not requested; Calendarific attribution was present.
- Across the current snapshot there were no mock-vessel, mock-port, mock-weather, mock-port-notice or mock-calendar records. mock-schedule remained the only Mock source.

- Regression coverage after the Calendarific final operational-semantics closeout: recorded after the full verification gate below.

## Official Alert Trust + Feed Failure Isolation Closeout — 2026-08-18

- TMD/BMKG no longer receive registry-wide default `relatedPortIds`; known port association is derived only from explicit alert title/summary/area text.
- A warning disappearing from a TMD/BMKG/JMA result is not treated as official resolution unless the retained item contains a reliable expiry timestamp that has passed. Otherwise it remains visible as stale/degraded with `warning_missing_from_current_index`, so it cannot create fresh Event/HOT evidence or be falsely marked expired.
- JMA strict empty-result validation requires a JMA-specific structure (`#seawarning-container` or `.jma-information-list`) or an explicit empty marker; a generic `<main>` or ordinary `#contents table` no longer qualifies.
- Maritime Executive remains retained as `failed_live` but is disabled and excluded from the active Public Feed source set, preventing known TCP/HTTPS failure from delaying Loadstar/Shekou.
- Regression coverage increased the local suite to 178/178. No Mock Isolation, Portcast trust, Open-Meteo trust, Schedule or the then-not-started V2.5 scope was changed at this historical checkpoint.

## 6. Known Inconsistencies

| Source of truth | Conflicting surface | Impact | Action |
|---|---|---|---|
| NewsNow foundation and Shipping HOT implementation coexist | Legacy NewsNow routes and Source modules remain | A reader could mistake retained legacy capability for the new core | Keep legacy paths; Shipping HOT is the local product surface |
| Native `better-sqlite3` build | Fixed Node 24.15.0 / ABI 137 prebuilt is installed and loaded | Native read/write and process restart persistence smoke passed | Preserve the fixed Node 24 toolchain |
| `nitro.config.ts` selects SQLite connector | P0 explicitly sets `.data/shipping-hot-v3.sqlite3` | Side-by-side V3 path is known and verified by the native smoke | Do not reuse the prior `.data/db.sqlite3` without a new migration decision |
| Remote CI evidence is absent | `gh run list --repo rallsix66/Shipping-HOT` returned no workflow runs | GitHub-side test/build status cannot be claimed from this checkout | Report local verification separately; do not infer remote CI success |

## 7. Current Risks

| Priority | Risk | Evidence | Recommended action |
|---|---|---|---|
| P1 | External Provider runtime access is environment-dependent | AISStream needs a server-side key; Open-Meteo access is external; both have offline adapter tests | Keep Mock as the default; explicit real modes show no-data until fresh evidence is available |
| P1 | Legacy NewsNow Source failures use a different contract | `server/api/s/index.ts`, `shared/types.ts` | Keep legacy path; Shipping HOT DTOs use freshness/sourceStatus/error fields |
| P2 | OAuth/cloud deployment dependencies may be unnecessary locally | `server/api/oauth/**`, `nitro.config.ts`, Docker files | Dependency analysis before removal |
| P2 | Native addon/toolchain must remain pinned | `package.json` engines and `.nvmrc` pin Node `24.15.0`; official ABI 137 prebuilt is verified | Keep Node/pnpm/native versions aligned during future dependency updates |

## 8. Current Work and Blockers

- Active work: V2.2/V2.3/V2.4/V2.5 local closeout and release verification are complete; the 2026-08-19 Calendar sync persisted-baseline seal closes the restart-state boundary; the 2026-08-19 V2.5 Final Trust Seal closes timestamp, bucket, trend, memory-bound and disabled-state semantics; remaining live gates are Watched/Area AIS observation evidence and official alerts; the 2026-08-15 frontend console-layout round (plan A) is complete and locally verified.
- 2026-08-14 frontend redesign round (completed): all seven pages plus navigation rebuilt with the aurora glass/bento design system — `src/components/shipping/aurora.tsx` (CSS gradient-blob background + grid/noise/vignette), `src/components/shipping/ui.tsx` (Reveal, SpotlightCard, AnimatedNumber, Segmented, Marquee, ProviderChip, StatusDot, EmptyState), rewritten `app.tsx` (floating glass nav with layoutId active pill, route transitions, dark-first theme toggle, restyled badges/StatCard/VoyageCard/EventCard/FeedCard) and `pages.tsx` (bento hero dashboard, segmented filters, congestion gauges, staggered reveals). Data flow, API calls and routes are unchanged; no new dependencies. A follow-up smoothness pass removed per-frame GPU hotspots (blob `filter: blur(90px)`, dark-mode `mix-blend-mode: screen`, per-card `backdrop-filter`) in favor of pre-feathered gradients and opaque frosted fills; only the sticky nav keeps a reduced backdrop blur. An adversarial review round then fixed: watch/save busy-state reset via try/finally, `MotionConfig reducedMotion="user"` for JS animations, route-transition remount removal (hero-only entrance), dark-mode secondary-text contrast tier bump, settings save error state machine, `freshness=unknown` status label, mobile nav active-pill scrollIntoView, anti-FOUC theme script in `index.html`, react-refresh warnings eliminated by splitting `format.ts`/`data.ts`, and a `test/ui-smoke.test.ts` renderToString guard (86/86 tests). Verification: `pnpm typecheck` passed, eslint on changed files 0 errors / 0 warnings, full test suite passed (86/86), `pnpm build` passed.
- 2026-08-15 frontend console-layout round (completed, locally verified): user-approved plan A (指挥台化) implemented — `app.tsx` left collapsible sidebar (localStorage memory) + global status topbar (活跃 HOT / 最后刷新 / 数据源混合度) + mobile bottom tab; `pages.tsx` dashboard HOT-first with stat strip, vessels/ports (inline congestion gauge)/voyages (delay column) as dense tables, feed (filter panel + source counts) and events (status × severity combined filters) as timelines, vessel/port/voyage details as two columns with related events/weather/voyages, calendar as left filter panel + 3-column cards; `globals.css` gained the console layout system and dropped the legacy glass-nav/hero-sheen/spotlight/detail-grid styles; `ui.tsx` no longer exports unused SpotlightCard/SectionHeading; `format.ts` added voyage status labels; brand logo background changed to sky blue `#0ea5e9` (`public/shipping-hot-icon.svg` and sidebar glow); standalone comparison prototypes live under `prototypes/` (offline HTML, outside the build). Data flow, API calls, routes, database and dependencies are unchanged. The current tree passes `pnpm typecheck`, targeted eslint and `pnpm test --run` after this closeout batch; `pnpm build` also passed (client + PWA + Nitro, `shared/updated-sources.ts` unchanged). Neat Freak skill instructions were loaded; its Bash-only inventory script remains pending because Bash is unavailable in this Windows environment, while the required manual equivalent audit found no secrets/database artifacts; the prior `.baseline-typecheck-fdf3191/` checkout metadata is now prunable and the matching temporary baseline worktree remains for review, while `prototypes/` remains user/other-agent content.
- 2026-08-15 sidebar rail follow-up (completed, verified): fixed the collapsed-sidebar header overflow (the collapse button was clipped half behind the logo) by moving the expand control to the sidebar footer and centering the logo / nav icons / provider dots in the 76px rail; the same fix is mirrored in `prototypes/`. The obsolete `.baseline-typecheck-fdf3191/` checkout metadata and matching temporary baseline worktree are retained as Neat Freak cleanup candidates; no cleanup was performed on them or `prototypes/`. Verification: typecheck passed, eslint on changed file 0/0, tests 136/136, build passed.
- 2026-08-17 Mock Isolation Final Fix (completed, locally verified; live pending): requested real modes no longer switch to Mock when AISStream or Calendarific configuration is missing; Store fallback reads are source-filtered for Vessel, Port, Weather, Calendar and Feed; Open-Meteo first failure excludes `mock-weather`; Portcast outputs only public dynamic fields and leaves missing fields unknown; Portcast first failure retains static identity only; public Feed excludes `mock-port-notice`; the top Provider summary includes official weather alerts and all-Mock detection includes Calendar. Added Provider, Store-boundary, Event Engine and UI-format tests. Verification: 146/146 tests, typecheck, targeted eslint, build and runtime matrix passed; live external calls remain pending.
- 2026-08-17 Shipping HOT Final Mock Isolation — AIS + Event Boundary (completed, locally verified; live pending): AIS now receives identity-only Watch Targets plus same-source AIS last-known observations; successful PositionReports emit only AIS-proven fields, same-source `statusChangedAt` continuity, identity-only/degraded results for missing MMSI or missed first observations, and source-aware Vessel merges. `status_changed_at` is nullable with an idempotent old-schema rebuild. Source-scoped Event identities let Mock/AIS histories coexist; current operational Event/HOT reads use Provider mode plus active registry source IDs, while SQLite retains incompatible historical Events and source switching does not resolve them. Empty real-mode seed snapshots therefore contain no Mock active Events/HOT. Verification: 161/161 tests passed; final typecheck, targeted lint, build, no-network runtime smoke, SQLite migration smoke and Neat Freak Closeout are recorded below; native SQLite and live external calls remain pending.
- 2026-08-17 Shipping HOT Calendar Operational Source ID Final Fix (completed, locally verified; live pending): Calendar configuration now returns actual provenance `calendarSourceIds` instead of composition option keys; Calendarific with a key activates `calendarific` + `official-holiday-source` + `manual-holiday`, missing-key Calendarific activates only `calendarific`, Official activates Official + Manual, and Manual activates Manual. Store Calendar reads and Calendar → Event → HOT operational filtering use the configured IDs, so retained incompatible Calendar history cannot surface in the current view. Verification: 165/165 tests, typecheck, targeted lint, build, offline provider/context/Store smoke, `git diff --check` and documentation closeout passed; full lint retains the four pre-existing errors, native SQLite and live external calls remain pending.
- 2026-08-18 Real Provider Trust Closeout (completed, corrected public re-probe verified): Portcast cache hits re-evaluate source age without refetching or changing the last real `fetchedAt`; Open-Meteo records each port's `fetchedAt` after both responses and JSON parsing; Shekou `/ywgg/` was re-probed with 5 `/ywgg/` items and zero `/gsxw/` leakage. Corrected public results: Portcast 8/8 (7 fresh, Nansha stale), Open-Meteo 8/8, Loadstar 10, Maritime Executive failed, Shekou parser verified. The local suite is 173/173.
- 2026-08-18 Historical Credential-Gated Verification (superseded for Calendarific): direct JMA/TMD/BMKG probes recorded HTTP/parser/timestamp/area/severity evidence; TMD's public endpoint was corrected from registry `cap` to `rss` and its regression fixture passed, while all three official sources remain `live_pending`; Maritime Executive DNS resolved but TCP 443 timed out and remains `failed_live`; the historical AISStream and Calendarific no-key results were `pending_credentials`. The later Calendarific probe upgraded Calendarific to `verified_live / partial`; AISStream remains `connection_verified / pending_observation`. The preceding local suite was 174/174; V2.5 was not started at that historical checkpoint.
- 2026-08-18 Official Alert Trust + Feed Failure Isolation Closeout: TMD/BMKG associations are text-derived only; warning disappearance without reliable expiry preserves stale/degraded last-known evidence; JMA generic `<main>` no longer counts as a valid empty structure; Maritime Executive is disabled as `failed_live` and excluded from active public scheduling. Current suite: 178/178; front-end dirty lane remains user-owned and untouched.
- 2026-08-18 Final Alert Lifecycle + Feed Timeout Closeout: missing-index warnings are lifecycle-unknown and excluded from Event/HOT eligibility; active Public Feed sources have independent 10-second fetch/body/parser timeouts; Chonburi/Chon Buri and Tanjung Priok/North Jakarta aliases map to canonical focus ports; JMA requires its sea-warning mount or explicit empty marker. Current suite: 181/181.
- 2026-08-18 AISStream + Calendarific Live Verification (pre-scope baseline): AISStream WebSocket opened for a 120-second watched-MMSI subscription but received no PositionReport, so status is connection_verified / pending_observation; Calendarific TH/ID/MY/PH/VN each returned HTTP 200 and valid JSON, normalized 198 direct events with partial coverage, and the old operational sync read back 189 Calendarific events and produced 4 reminder Event/HOT samples. Calendarific is verified_live; no Mock source entered the all-real operational view; suite was 186/186. The later scope-aware reconciliation supersedes the Calendar counts, while the AIS observation status remains current.
  - Historical blockers at this 2026-08-19 checkpoint included the Node 24 native ABI mismatch; V3 P0 has since resolved it. Current deferred gates are the existing production subroute package-import issue, AISStream `connection_verified / pending_observation`, official-alert criteria, partial Calendarific coverage and all P1B/P2 work. GitHub CLI authentication and repository metadata are currently verified; `gh run list` returned no workflow runs (`no remote CI evidence`).
- Verification: prior local gates remain recorded above; the V3 P0 gate is recorded below. Full `pnpm lint` retains four pre-existing errors in `server/api/shipping/settings.post.ts`, `shared/updated-sources.ts`, and `src/routes/__root.tsx`.
- V2 status: `V2.0 sealed`; `V2.1 implemented`; `V2.2 implemented / locally verified / live pending`; `V2.3 implemented / locally verified / live pending`; `V2.4 implemented / locally verified / live pending`; `V2.5 implemented / locally verified / live pending`. Live external Provider calls remain optional; explicit Mock mode remains the default and real modes do not fall back to it.
- Neat Freak Closeout: manual equivalent completed against the loaded skill (rules, Markdown surfaces, stale claims, secrets, local database, residue and Git/worktree state); the official Bash inventory script remains pending/unavailable because Bash is not installed in this Windows environment. Cleanup candidates (`.data/db.sqlite3`, the prunable `.baseline-typecheck-fdf3191/` metadata, the temporary baseline worktree, `prototypes/`, and the prior SSH publishing residue `.git-publish-temp/`) were reported and retained; no deletion was performed.
- 2026-08-19 V2.5 Phase 1 Closeout: separate Watched/Area AIS boundaries, explicit-off area mode, heuristic watched-port boxes, PositionReport-only subscription without `FiltersShipMMSI`, 15-minute observation TTL, latest-per-MMSI aggregate, `ais_port_metrics` aggregate-only persistence, source-scoped Event/HOT filtering, warning-only three-window rising trend and independent UI labels are implemented. No real Area AIS live smoke was started. Runtime no-network smoke passed for default Mock, AIS no-key and Calendarific no-key; forced Open-Meteo/Portcast failure semantics passed in provider fixtures. Targeted lint passed; full lint has only the four pre-existing errors above.
- 2026-08-19 V2.5 Final Trust Seal: `V2.5 Trust Boundary=SEALED` for local semantics. Timestamp trust now keeps reliable AIS `sourceUpdatedAt` separate from local `fetchedAt`, with `updatedAt` and observationWindow fallback semantics explicit; trend uses five-minute buckets, same-bucket no-increment, stationary-count rules, gap/stale/insufficient/restart reset and three real rising buckets for Event/HOT; observations are pruned at TTL and bounded by a 5000-entry hard cap; Area disabled status is correct for provider-disabled/off/missing-key cases; 227/227 tests pass at that checkpoint. The 60-second Shekou Area probe opened the socket, sent one bbox subscription and received 0 PositionReports (0 valid/assigned/distinct MMSI/source timestamps), so `AISStream Area=connection_verified / coverage_pending` and overall V2.5 remains `implemented / locally verified / live pending`; no `verified_live` claim.
- 2026-08-19 V2.5 Final Reconnect Lifecycle Seal: Area automatic reconnects now have a finite budget. The initial socket is not counted; the default four configured delays allow at most four automatic reconnect sockets, exhaustion stops background retries, a successful reconnect resets the budget, a later explicit `getPortMetrics()` starts a fresh cycle, and `close()` cancels pending retry timers and resets lifecycle state. The Area live evidence remains unchanged at `connection_verified / coverage_pending`; no live probe was rerun.

## Historical Local Real Provider Activation — 2026-08-19

- Local configuration: `.env.local` is present, ignored by Git and persisted for daily startup. `AISSTREAM_API_KEY` and `CALENDARIFIC_API_KEY` are present; their values are not stored in documentation or source. The shared loader now loads `.env.local` first and `.env.server` as the fallback, so the server-side `process.env` receives the local Real Mode configuration with the documented precedence.
- Actual `/api/shipping` provider modes at that historical checkpoint: `vessel=aisstream`, `port=portcast`, `weather=open-meteo`, `feed=public`, `calendar=calendarific`, `aisArea=aisstream`, `weatherAlerts=public`, `schedule=mock`; P1B subsequently removes Mock Schedule from Real Mode.
- API evidence: `vessels=0` with AIS `never_succeeded`/no observation and no Mock vessel; `ports=8` with `portcast-public` on all ports (7 healthy, Nansha stale/degraded); Open-Meteo has 7 healthy model items with `h24/h72/d7` windows and Port Klang currently has no item; Feed has 10 `the-loadstar` items and 5 `shekou-official` notices; Calendarific sync has 201 events for TH/ID/MY/PH/VN = 36/31/67/37/30 with partial coverage; AIS Area retains 2 same-source metrics but both are `never_succeeded`, `no_observation`, sample 0.
- Historical operational Mock counts at that checkpoint: `mock-vessel=0`, `mock-port=0`, `mock-weather=0`, `mock-port-notice=0`, `mock-calendar=0`, `mock-schedule=2`. P1B now excludes all of these from Real Mode current reads.
- Official alerts remain `public` with no verified active source; JMA/TMD/BMKG were not moved to `experimental`. No 60–120 second Area live probe was rerun; prior Area evidence remains `connection_verified / coverage_pending`.
- UI verification: `/`, `/vessels`, `/ports`, `/ports/port-shekou`, `/voyages`, `/feed`, `/calendar`, `/events` and `/settings` were inspected. Real source labels render for AISStream, Portcast, Open-Meteo, Public Feed and Calendarific; unknown AIS/Area values remain empty/unknown; only Schedule shows Mock. The Feed/Events “模拟数据” filter counters are 0, not Mock records. Settings now explicitly shows Calendarific and `public · 无已验证来源` for official alerts.
- Historical Runtime note from 2026-08-19: the installed binary was Node 22 ABI (`127`). V3 P0 subsequently replaced it with the official Node 24 ABI `137` prebuilt; current native and restart persistence evidence is recorded below.
- Verification: Real Mode server restart and API/UI smoke completed; final local code gates are recorded below. This activation is local runtime evidence only; it does not upgrade AIS observation or official-alert live status.

## Real Mode Startup Seal — 2026-08-19

- Shared startup contract is now `process env > .env.local > .env.server > code defaults`. `scripts/load-env.ts` loads `.env.local` first and fills missing values from `.env.server` with `override=false`; `pnpm dev` and `pnpm start` both use it.
- `pnpm dev` was restarted on port 5173 and `/api/shipping` returned the Real modes `aisstream/portcast/open-meteo/public/calendarific/aisArea`, with `schedule=mock`, 8 Portcast ports, 7 Open-Meteo items, 22 total Feed/Weather items and no incompatible Mock source.
- Historical `pnpm start` note from 2026-08-19: that process used the then-pending native persistence baseline. The current V3 P0 runtime path is `.data/shipping-hot-v3.sqlite3`; no secret value is present in the production bundle.
- `example.env.server` now contains complete safe Mock/Off Shipping HOT defaults plus a commented Real Mode example. README.md, README.zh-CN.md and README.ja-JP.md document `.env.server`/`.env.local` responsibilities, precedence, Git ignore rules and the shared `pnpm dev`/`pnpm start` contract. No Provider business logic or default product safety was changed.
- Startup seal verification: env precedence tests passed, full suite is `235/235`, typecheck and build passed, targeted lint passed, full lint retains the four pre-existing errors, and `git diff --check` passed.

## V3 P0 Persistence Closeout — 2026-08-20

- ADR-005 is `Accepted`; this entry records the completed P0 batch. The fixed toolchain is Node `24.15.0`, pnpm `10.30.3`, `better-sqlite3@12.6.2` official `node-v137-win32-x64` prebuilt, and db0 local path `.data/shipping-hot-v3.sqlite3`.
- P0 implemented `schema_migrations`, `app_metadata`, independent `port_directory_status/version/imported_at`, ownership-separated `vessel_watchlist`/`port_watchlist`, explicit Provider-column conflict updates, placeholder `translation_cache`/`provider_usage`/`provider_runtime`/`sync_runs` schemas, interface/contracts, server-only FileSecretStore and redacted ProviderConfig metadata. P0 did not implement Provider Runtime/Usage business, Port Directory import, VesselAPI, AIS long connection, Feed, Calendar, Voyage or Translation adapters; the Port Directory import is recorded in the P1A closeout below.
- Persistence failure behavior is explicit: Shipping HOT does not create or read from a mutable memory replacement; GET exposes an unavailable status with empty state, while Shipping HOT mutations return HTTP 503 semantics. User watch state survives Provider upserts because it is stored independently.
- Verification: `pnpm typecheck` passed; targeted P0 tests passed; full `pnpm test --run` passed `235/235`; `pnpm build` passed; `pnpm run smoke:p0-native` passed a real process-A write → close → process-B read; direct native SQLite read/write passed under Node 24 ABI 137. The abnormal-exit restart test required by the revised architecture remains pending because this review is documentation-only. Full `pnpm lint` has exactly four pre-existing errors outside this batch.
- Neat Freak Closeout is complete for this implementation batch via the real skill instructions and manual Windows-equivalent audit. The official Bash inventory sub-step is `pending/unavailable` because Bash is not installed; cleanup candidates remain retained pending explicit confirmation.

## V3 P1A Real Port Directory Closeout — 2026-08-20

- Migration v3 creates `port_directory` with `unlocode`, `name_en`, `name_zh`, `country_code`, latitude/longitude, timezone, aliases, `source`, `verified_at` and `is_active`; it imports Shekou, Yantian, Nansha, Laem Chabang, Port Klang, Manila, Jakarta and Ho Chi Minh with `source=unlocode` and sets the independent directory status to `ready`.
- `PortDirectoryRepository` implements search, UN/LOCODE lookup, coordinate lookup and alias lookup. Real Mode excludes `source=mock`; Mock rows remain available for tests/mock mode.
- Open-Meteo and AIS Area production providers use SQLite-backed directory coordinate lookup. `shipping-fixtures.ts` remains test/mock data and is not used for production coordinates.
- Verification: `pnpm typecheck` passed; full `pnpm test --run` passed `239/239`; `pnpm build` passed; `pnpm run smoke:p0-native` passed migration-aware process-A write → close → process-B read with Node `24.15.0` / ABI `137` and 8 active directory rows. Full lint retains exactly four pre-existing errors outside this batch.
- Scope stop: no Port Search UI/API, no AIS long-connection changes, no VesselAPI, no P1B Mock Isolation runtime work, no P2 Search & Watch or later Provider functionality.

## V3 P1B Mock Isolation Closeout — 2026-08-21

- Migration v4 adds `source_type` lineage to `vessels`, `ports`, `voyages`, `feed_items`, `events`, `calendar_events` and `ais_port_metrics`. The enum is `real | mock | imported | derived`; old Mock/unknown rows are excluded from Real Mode current reads and Mock fixture rows carry `source_type=mock`.
- `ShippingRepository` filters every requested operational entity in Real Mode to `real/imported/derived` and rejects Mock or mixed Mock-evidence writes. Test/Mock Mode preserves Mock seed/read behavior.
- Real Mode does not select Mock Vessel/Port/Weather/Feed/Calendar providers and never selects `MockScheduleProvider`; missing real capability is explicit unavailable/misconfigured, with no Mock last-known fallback. Event/HOT uses the same Mock provenance/evidence gate.
- Scope stop: no AIS long connection, VesselAPI, Search/Watch, Translation Adapter, Provider Runtime/Usage business or other new business functionality was started.
- Verification: `pnpm typecheck` passed; `pnpm test --run` passed `241/241`; `pnpm build` passed; `pnpm run smoke:p0-native` passed real native SQLite process-A write → close → process-B read on Node `24.15.0` / ABI `137`; full lint retains exactly four pre-existing unrelated errors. Neat Freak Closeout is complete via the loaded skill and manual Windows-equivalent audit; Bash inventory remains pending/unavailable.

## V3 P2A Search Foundation Closeout — 2026-08-21

- Migration v5 creates `vessel_metadata` for static Vessel discovery identity and `vessel_search_cache` for normalized 24-hour query results. Both persist `source_type`; Real Mode excludes Mock metadata/cache rows.
- `shared/vessel-search.ts` provides name/IMO/MMSI/callsign query normalization and stable identity rules. `VesselSearchProvider` and `VesselSearchService` keep search behind a server-side boundary and check SQLite cache before calling the Provider.
- VesselAPI is implemented as the first discovery/static metadata adapter only. It maps name, IMO, MMSI, callsign, type and flag; it does not map realtime position, open AIS or act as an AIS substitute. Mock search remains isolated to Mock/Test Mode.
- Port Search uses `PortSearchService` over the existing SQLite `port_directory` and supports Chinese/English names, UN/LOCODE and aliases. Search APIs are server-side; no UI direct Provider call or Watchlist workflow was added.
- Verification: `pnpm typecheck` passed; `pnpm test --run` passed `248/248`; `pnpm build` passed; `pnpm run smoke:p0-native` passed native process-A write → close → process-B read on Node `24.15.0` / ABI `137` with schema v5 search tables; full lint has no new P2A errors and retains four pre-existing unrelated errors. Neat Freak Closeout manual Windows-equivalent audit completed; Bash inventory is pending/unavailable.

## V3 Architecture Scope Review — 2026-08-20

- Documentation-only review narrowed P0 to SQLite startup, migration runner, schema/bootstrap state, Repository persistence, user-owned persistence and memory-fallback removal.
- The migration strategy now defines `source_type = real | mock | imported | derived`; Real Mode never reads `mock`. This review changed the migration contract only; no importer/schema wiring was added. SQLite settings may contain only non-secret `ProviderConfig`; API keys/`ProviderSecret` remain in server-only `SecretStore` and local `.data/provider-secrets.json`.
- AIS WebSocket, VesselAPI, Translation Adapter, complete Provider Runtime behavior and complete Provider Usage accounting remain deferred; P0 keeps only approved interfaces/contracts and placeholder schemas. No implementation was started in this review.
- The required abnormal-exit persistence test is documented but remains `pending`; no code or test was changed in this review.

## 9. Recommended Next Action

Next: keep Watched/Area AIS external observation and official-alert live verification pending; retain Calendarific's verified-live/partial status; AIS Tracking Runtime, remaining P2 watch/tracking and later Provider work remain deferred. V3 P0/P1A/P1B Mock Isolation/P2A Search Foundation are complete locally; stop here for review.

## 10. Knowledge Closeout Surface

| Fact surface | State | Evidence / limitation | Action |
|---|---|---|---|
| Code | changed-and-verified | Shipping HOT shared Domain, Provider orchestration, local Vessel/Voyage ownership merge, API validation, Repository paths, routes, UI and tests inspected; runtime-relative Mock fixture timestamps and Event Engine test determinism are covered by passing checks | Treat code/config as authority for current implementation |
| Runtime | changed-and-verified | Node 24.15.0 / ABI 137 native read/write passed; process-A-write → close → process-B-read smoke passed; live external verification remains separate | Keep native persistence pinned; retain AIS/official-alert live caveats |
| Documentation | changed-and-verified with live caveat | Status, architecture and V2 roadmap record local gates, Calendarific final semantics, historical baselines, source contracts and remaining live-provider limits | Keep AIS/official-alert verification pending until fresh evidence is available |
| Rules | changed-and-verified | Root `AGENTS.md` defines project guardrails, verification rules, architecture-change workflow, and mandatory task Closeout; no project `CLAUDE.md` or override; global Codex `AGENTS.md` is empty | Use `AGENTS.md` as the project entry point |
| Memory | not-applicable | No project memory store or user-authorized memory write was identified | No memory files changed |
| Workspace | changed-and-verified with retained cleanup candidate | Manual Neat Freak-equivalent inventory found no other-agent rule artifacts, no tracked database/env artifact, and the final `git status` is recorded at closeout; ignored `.data/db.sqlite3`, `dist`, the prunable baseline worktree metadata and its temporary baseline worktree remain local artifacts; `prototypes/` and `screenshots/` remain user workspace content | Review the final `git status`; no cleanup performed without explicit confirmation |

## 11. Shipping HOT V2 Planning and Implementation Status

- V2 plan created: `docs/plans/shipping-hot-v2.md`.
- V2 plan reviewed and corrected on 2026-08-14.
- V2 plan wording follow-up: `sourceStatus` includes `degraded`; data-model references use `sourceType/dataNature`; V2.2 UI explicitly includes Calendarific Attribution; V2.2/V2.3/V2.4/V2.5 local closeout evidence and live caveats are reflected in code and docs.
- V2.0 implementation authorization: explicitly granted for the Data Trust Foundation; implemented without external Provider expansion, database schema/migration changes or dependency changes.
- V2.0 implementation: `sourceType` = `official | third_party | user | mock`; `dataNature` = `observed | reported | forecast | modelled | derived | estimated | planned`; `sourceStatus` retains `healthy | degraded | failed | disabled | never_succeeded`; timestamp roles remain separate as `updatedAt`, `sourceUpdatedAt`, `fetchedAt` and `detectedAt` where applicable.
- V2.0 evidence path: Provider → Domain → Repository JSON → API → Event evidence → HOT/UI; Mock is explicitly labeled “模拟数据”; AISStream and Open-Meteo are shown with Chinese source type/data nature labels.
- V2.0 scope guard at its historical checkpoint: no Calendarific implementation, no new providers, no `calendar_events` table, no database migration, no new dependency and no major NewsNow/Event/UI rewrite. These restrictions were phase-scoped; the explicitly approved V2.2 batch now adds the minimal calendar table and provider boundary.
- Fixed NewsNow updated-source metadata generation side effect: normal `dev`/`build`/`presource` no longer rewrites `shared/updated-sources.ts`; explicit `--updated-sources` generation is required.
- Closeout: pending official `audit-inventory.sh` execution because Bash is unavailable in this Windows environment; the required manual Neat Freak-equivalent audit completed with no tracked database/env artifact or cleanup action.
- Final local V2 state with explicit live caveat: `V2.0 sealed`; `V2.1 implemented`; `V2.2 implemented / locally verified / live pending`; `V2.3 implemented / locally verified / live pending`; `V2.4 implemented / locally verified / live pending`; `V2.5 implemented / locally verified / live pending`.
