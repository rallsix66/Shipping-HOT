# ADR-005: Shipping HOT V3 Real-Data Boundaries

- Date: 2026-08-20
- Status: Accepted
- Decision owners: User (architecture approval completed 2026-08-20)
- Supersedes: none; extends ADR-004 only after explicit V3 approval

## Context

Shipping HOT V3 is a proposal for moving from the V2 mixed/mock runtime to a local-first, real-data operational runtime. The review found that adding search, translation and more Providers on top of the current request-triggered flow would leave several unsafe ambiguities: SQLite failure can expose a Mock snapshot, `vessels` emptiness is used as a seed signal, user watch state shares rows with Provider state, VesselAPI could be mistaken for live AIS, Port Search could become dependent on a paid entitlement, and translation would have no durable cache, secret or usage contract. The implementation order therefore separates **P1A Real Port Directory Foundation** from **P1B Mock Isolation + AIS Tracking Runtime**; P2 depends on both.

This ADR is **Accepted** as of 2026-08-20. It authorizes the approved V3 implementation boundaries, beginning with P0 Persistence. It does not authorize account creation, paid subscriptions, key entry, or any phase beyond the explicitly approved phase.

## Current implementation note — 2026-08-29

The controlled Real Data Activation slice reuses the Providers already approved by this ADR: AISStream tracking, public Feed sources, Calendarific, Portcast public pages and Open-Meteo Marine. It adds only their server-side Background Runtime registration, SQLite persistence/repository reads, provider-runtime usage records and capability-level Readiness reporting. Feed sources are isolated as `feed-sync:<sourceId>` Jobs; Calendar, Port and Weather use independent Jobs; the legacy Shipping Snapshot is repository/SQLite-only. This is not authorization for a new Provider, paid account, secret, deployment or later business phase.

The activation evidence is recorded in `docs/live-verification.md`. Real Voyage/ETA adapter coverage, VesselAPI credentials/entitlement, AIS PositionReport observation and official weather-alert coverage remain pending. `docs/voyage-provider-gap.md` records that the Voyage gap is not an entitlement result because no credentialed probe was made.

## Accepted decision

### 0. P0 scope boundary

P0 is the SQLite persistence foundation only. It is limited to:

- opening SQLite successfully under the fixed Node runtime;
- the schema migration runner and authoritative schema version;
- App/DB bootstrap state (`bootstrap_completed_at`);
- Repository persistence and user-owned data persistence;
- removal of the mutable in-memory fallback.

P0 does not implement or activate V3 AIS WebSocket tracking, VesselAPI, Translation Adapters, complete Provider Runtime behavior, or complete Provider Usage accounting. Those later capabilities retain interfaces/contracts only. The approved P0 placeholder tables (`translation_cache`, `provider_usage`, `provider_runtime` and `sync_runs`) and the `ProviderConfig`/`ProviderSecret`/`SecretStore`/`TranslationProvider` contracts do not constitute working Provider business logic. Existing V1 adapters are outside this P0 boundary and are not expanded by it.

### 1. Real-only operational boundary

- `SHIPPING_DATA_MODE=real` and production reject Mock Providers, Mock seed, fixture coordinates and `mock-schedule`.
- SQLite is the only persistent truth. P0 startup records `app_metadata.schema_version` and `bootstrap_completed_at` for App/DB foundation completion only; Port Directory separately records `port_directory_status`, `port_directory_version` and `port_directory_imported_at`. Empty AIS observations do not mean that bootstrap has not completed.
- SQLite states are `healthy`, `read_only_degraded` and `unavailable`. An unavailable database does not create a mutable memory store or silently expose the complete Mock snapshot. Mutations return `503 persistence_unavailable`.
- Provider failures return same-Provider real last-known data as stale/degraded, otherwise empty/unavailable/unknown.

### 2. Provider boundaries and ownership

- VesselAPI is a low-frequency Vessel Discovery/static metadata candidate. Its quota is per account in a billing-date monthly window: Free is 150 calls; Basic is $14.99/month for 1,500 calls and lists Port data; successful 2xx responses count, errors including 404/429 do not, and `X-RateLimit-Remaining` is the official remainder when present. Only concrete endpoint entitlement requires an account-level contract test; search does not imply live position or ETA/event access.
- AISStream is the watched-vessel tracking source. A long-lived server-side singleton `AisTrackingService` subscribes only to watched MMSI values and consumes `PositionReport` plus available `ShipStaticData`/`StaticDataReport`; HTTP GET does not open a short-lived WebSocket. `ShipStaticData` may provide `IMO`/`Callsign`/`Name`/`Type`/`ETA`/`Draught`/`Destination`/`Dimensions`; `StaticDataReport` may provide `Name`/`Callsign`/`ShipType`/`Dimensions` and must not be assumed to contain `ETA`/`Destination`/`Draught`. V3 first release caps one session at 50 MMSI (`FiltersShipMMSI` current limit); no sharding is designed before that limit is reached.
- Port Search defaults to a local UNECE UN/LOCODE directory, normalized coordinates and a curated Chinese-alias table. VesselAPI Port API is optional enrichment only.
- DCSA Commercial Schedules is an internal normalization contract, not a data Provider. Carrier adapters require separate official access, terms and price confirmation. Without one, Commercial Schedule is empty/unavailable and never Mock.
- Fields are provider-owned, user-owned, directory-owned or translation-owned. Provider upserts can update only provider-owned columns; user watch, aliases, settings and overrides cannot be replaced by Provider rows.

P0 only completes App/DB foundation and does not wait for Port Directory readiness. P1A establishes the real Port Directory (UN/LOCODE, verified identities, coordinates and aliases) and sets `port_directory_status=ready` only after its baseline is imported and validated. P1B depends on `port_directory_status=ready` before removing Real Mode imports of `shared/shipping-fixtures.ts`; its approved Mock Isolation slice is complete, while the long-lived AIS runtime remains separately deferred. P2A Search Foundation may start after both P1A and P1B acceptance gates pass; remaining watch/tracking work still requires its own phase boundary.

The completed P1B execution slice was Mock Isolation only: migration lineage, Repository read/write filtering, unavailable real-provider defaults, Schedule Mock removal and Event/HOT evidence gating. It did not start AIS Tracking Runtime or Search/Watch. P2A is a separate Search Foundation slice and does not imply any AIS, watchlist, Feed, Calendar, Voyage or Translation business functionality.

### 2.2 P2A Search Foundation boundary

- `vessel_metadata` is the SQLite cache for VesselAPI discovery/static identity: name, IMO, MMSI, callsign, type, flag, source and fetched time. `vessel_search_cache` stores normalized search keys and result identities for 24 hours.
- `VesselSearchProvider` is the server-side search contract. `VesselSearchService` reads the SQLite cache before invoking a Provider; page/UI code does not call VesselAPI directly.
- VesselAPI is limited to discovery/static metadata. The adapter must not return real-time position, create AIS sessions or substitute for AISStream tracking. Missing configuration fails explicitly, and Mock records are excluded from Real Mode.
- Port Search uses the SQLite-backed UN/LOCODE `port_directory` and supports Chinese/English names, UN/LOCODE and aliases. VesselAPI Port enrichment is not required.
- P2A does not implement watchlist workflow changes, AIS WebSocket/Tracking Runtime, Feed, Calendar, Voyage, Translation Adapter or complete Provider Runtime/Usage business.

### 2.3 P2C Background Runtime Foundation boundary

P2C establishes the shared background execution foundation without activating any real business Provider:

- `BackgroundRuntime` is a process-level singleton. It owns Job registration, simple Node timers, `runNow()`, stop/shutdown behavior and one in-flight guard per Job. A Job failure is isolated from other Jobs and does not crash the Runtime.
- `RuntimeJob` is limited to `id`, `providerId`, `capability`, `intervalMs`, `enabled` and `run()`. `SyncResult` is limited to status, record counts, source update time and redacted error fields. The production Registry is empty in P2C; AIS, Feed, Calendar, Voyage and Translation Jobs remain separately approved workstreams.
- Migration v6 rebuilds the P0 `provider_runtime` table to use `PRIMARY KEY(provider_id, capability)` while preserving existing rows and columns. `RuntimeRepository` uses that composite identity for all reads/upserts, so capability health and failure counters cannot overwrite each other.
- `RuntimeRepository` is the only SQL boundary for the existing `sync_runs` and `provider_runtime` tables. Actual executions write `running` then `success`/`failed`/`skipped`; Provider runtime health uses `healthy`, `degraded`, `failed`, `disabled` and `never_succeeded`, with the next schedule and consecutive failure count persisted in SQLite. Manual `runNow()` cancels the old timer and restarts cadence from completion; returned `skipped` results persist their next schedule.
- Nitro startup initializes DB/migrations before Runtime startup, and SIGTERM/SIGINT/Nitro close stop the Runtime. A failed Runtime start clears timers/running state; bootstrap publishes the singleton and installs signal handlers only after successful initialization. `SHIPPING_RUNTIME_ENABLED=false` disables startup. `GET /api/shipping/runtime` exposes only local non-sensitive status.
- The existing `GET /api/shipping` request-triggered Provider path is explicitly legacy/deferred. P2C adds no new request-triggered sync and does not claim that all Shipping HOT reads are already background-only.

### 2.4 P3A AIS Tracking Runtime Foundation boundary

P3A is the first approved business Provider Workstream after P2C. It uses the existing process-local Runtime and SQLite boundaries and does not change the application architecture.

- `AisTrackingProvider` is server-only and exposes `subscribe`, `unsubscribe` and bounded `getLatestPositions`; the first implementation uses a short-lived AISStream PositionReport read and does not create a long-lived WebSocket service, queue, worker or separate service.
- Migration v7 adds append-only `ais_positions` history and keyed `ais_latest_positions`. Every position carries `source_type`; Real Mode reads only `real`, `imported` and `derived`, and Mock positions are rejected in Real Mode.
- `AisTrackingJob` is registered through `BackgroundRuntime` with capability `ais_tracking`. Its input is exclusively the user-owned `vessel_watchlist` joined to canonical `vessel_metadata`; only `ais_enabled=true` rows with an existing valid 9-digit MMSI and Real Mode-eligible lineage are sent to the Provider. No MMSI guessing or vessel-name AIS lookup is allowed.
- Unknown/out-of-target MMSI, missing trusted Provider timestamp and invalid coordinates never create a Vessel or position row; local `fetchedAt` is not promoted to source time. Provider failures preserve the last-known position. The latest-position API is Repository → SQLite only, and the UI is limited to status/latest position/source/stale metadata without a map or trajectory surface.
- The default configuration is Mock for Mock/Test Mode. AISStream credentials are environment-first with server-only FileSecretStore fallback. P3A does not authorize Feed, Calendar, Voyage or Translation Jobs.

### 2.1 Migration strategy and source classification

V3 migration is side-by-side. The V2 database is backed up and never rewritten; a new V3 SQLite file runs the migration runner before any approved import. Every migrated or newly persisted record that participates in the migration boundary carries the lineage classification `source_type`:

| `source_type` | Meaning | Real Mode read policy |
| --- | --- | --- |
| `real` | Fact received from an approved real Provider and retained with provenance | Readable when the Provider/source is allowed and the freshness contract permits it |
| `mock` | Mock Provider, fixture, demo seed or Mock-derived operational record | Never read as current data in Real Mode; may remain only in an audit/quarantine path |
| `imported` | User-approved data imported from V2/manual/official snapshots after identity and provenance checks | Readable only after the migration policy accepts the record and preserves its origin |
| `derived` | Domain/Event/aggregate data derived from accepted `real` or approved `imported` facts | Readable only when its input lineage is allowed; it must not derive from `mock` in Real Mode |

Real Mode therefore reads `real`, approved `imported` and permitted `derived` records, and never reads `mock` records. V2 Mock vessels/ports are not promoted by table emptiness or blind copy. User watch state is migrated only after exact identity resolution; unresolved items go to a migration report. Mock schedule, Mock Feed, Mock Calendar, Mock operational Events and other Mock-derived rows are excluded from current V3 operational reads. Secrets are never migrated into SQLite.

`source_type` is migration lineage, distinct from the existing Provider provenance `sourceType` and `dataNature`; the fields must not be conflated or silently substituted.

### 3. Translation and secrets

- Define a switchable `TranslationProvider` interface. Candidate adapters include DeepSeek, Qwen-MT, Gemini, OpenAI, Claude, Google Cloud Translation, DeepL, Azure Translator and Custom OpenAI-compatible; no single Provider is an architectural default.
- Store original text first. Translation is asynchronous enrichment and never blocks ingestion. Identifiers such as registered vessel name, IMO, MMSI, Callsign, Voyage number, SCAC and UN/LOCODE are never translated.
- `translation_cache` is the only translation source of truth. Business tables keep only original facts; they do not duplicate `title_zh`/`summary_zh`. The UI selects the preferred provider/model when available, otherwise shows the most recent successful Chinese cache entry and queues the preferred version. Old provider/model versions remain auditable.
- `ProviderConfig` (provider/model/base URL/enabled/budget) is separate from `ProviderSecret` (API key). P0 stores only non-secret ProviderConfig in SQLite settings and establishes the contracts, registry refresh and redacted APIs; actual AI adapters belong to P6 or a separately approved Provider phase.
- `provider_usage` is a P0 schema/contract placeholder for future local request outcomes, cache hits, characters/tokens, estimated cost and last call. Complete Provider Usage accounting is not implemented in P0. A future balance is shown as “本地统计/估算” unless the Provider returns an official remaining value.
- Settings exposes an AI Translation Center with Provider/model, endpoint for Custom, enable state, locale, budget and sanitized health. When no official balance API is available, usage is labeled “本地统计/估算”, not account balance.
- Define a server-only `SecretStore` interface (`get/set/delete/has/source`). Local mode uses `FileSecretStore` at `.data/provider-secrets.json`; environment variables or a platform Secret Manager take precedence and are immutable from the UI. SQLite settings may store ProviderConfig only; API keys/ProviderSecret must never enter SQLite settings or any ordinary SQLite column. A successful Settings mutation refreshes the Provider Registry immediately, so the next job/request uses the new secret without a restart. Secrets never enter LocalStorage, frontend bundles, Git, docs, fixtures, `provider_runtime`, logs or error messages.

### 4. Freshness and lifecycle

Feed uses three gates: Ingestion Gate, Current Feed Query Gate and HOT/Event Freshness Gate. Ordinary news defaults to 7 days, major operational news to at most 14 days, and official notices/alerts follow explicit effective/expiry rules. Unknown or malformed publication times are quarantined/history-only.

Calendar follows `Server Start → SQLite → UI → background check → sync`; current year and next year are independently tracked by country/year coverage and last success. The default TTL is about 7 days (roughly 40–50 calls/month for five countries × two years), while a year change forces a check and manual refresh remains available. Calendar freshness is not inferred from Feed age windows.

## Consequences

- V3 can provide a real watchlist and Current Voyage even when Commercial Schedule or a per-port intelligence capability is unavailable.
- The plan can be run at zero external Provider cost, with optional low-cost Discovery/static enrichment and separately budgeted translation.
- P0 is deliberately narrow: metadata/bootstrap, ownership isolation, SQLite persistence and the removal of memory fallback are the implementation work. P2C later adds only the shared process Runtime and minimal runtime/sync persistence boundary; approved future schema placeholders and `ProviderConfig`/`ProviderSecret`/`SecretStore`/`TranslationProvider` contracts may be present, but P2C must not implement AIS WebSocket, VesselAPI, Translation Adapters, Provider-specific business Jobs or complete Provider Usage accounting.
- Provider prices, entitlement, public signup and regional availability remain time-sensitive and must be rechecked before implementation.

## Verification required after approval

- Native SQLite persistence smoke under the selected Node LTS must write data in process A, terminate process A abnormally, start process B against the same database and verify the complete persisted state; no reseed when `vessels` is empty; mutation success only after commit. The smoke must use native SQLite, not FakeRepository.
- Production bundle scan proves no fixture import, Mock seed or `mock-schedule` in real mode.
- P1A real directory tests cover UN/LOCODE, coordinates and `Shekou`/`CNSHK`/`蛇口`; P1B proves Real Mode has no fixture/Mock seed and HTTP GET creates no AIS socket.
- P2A tests cover vessel query normalization, IMO/MMSI/name search, VesselAPI static-only mapping, SQLite metadata/cache hits and expiry, Real Mode Mock isolation, and Port Directory search/aliases.
- AIS long-lived session and watchlist resubscription tests cover Position + Static/Voyage facts, finite reconnect and the 50-MMSI ceiling.
- UN/LOCODE + `Shekou`/`CNSHK`/`蛇口` identity tests without VesselAPI.
- Translation identifier denylist, single-source cache selection, cache-hit/no-repeat billing, budget stop, SecretStore precedence/immediate reload, secret redaction and usage-label tests.
- Feed 7/14-day/future/unknown/expiry gates and Calendar restart/background-sync/7-day-TTL tests.
