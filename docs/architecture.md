# Architecture — NewsNow Foundation / Shipping HOT Proposal

> Last verified: 2026-08-17
> Architecture status: approved for local Mock implementation, V1 AISStream/Open-Meteo adapters, sealed V2.0 Data Trust Foundation and Mock Isolation boundary, implemented V2.1 Port Intelligence, and V2.2/V2.3/V2.4 implemented with local verification; live external-provider verification pending; V2.5 not started
> Source of truth for: the current retained system structure and approved boundaries

## 1. Project Purpose

The repository retains NewsNow as its foundation and now exposes Shipping HOT as a local single-user product surface. The implemented path uses normalized Mock or approved V1 real Provider adapters and deterministic Domain/Event rules; real provider credentials remain optional.

## 2. Current Scope

### In Scope

- Current NewsNow news Source aggregation, cache, UI cards, local preferences, optional GitHub login/sync, and deployment adapters.
- Preserving the existing modular monolith as the foundation for the local Mock loop and approved V1 Provider adapters.
- V2.0 Data Trust Foundation: provenance, freshness/status separation, last-known fallback semantics, Event evidence and UI attribution within the existing JSON/API boundaries.
- V2.1 Port Intelligence: an optional server-side Portcast public-page adapter normalizes only anonymous public HTML fields into the existing Port entity; Mock remains the default and no commercial API or hidden endpoint is used.
- V2.2 Country Calendar: a five-country annual path composes Calendarific, Official and Manual sources when explicitly configured, uses source-scoped coverage and reconciliation, persists facts/coverage and feeds Calendar → Event → HOT; Mock remains the default and official live sync is pending.
- V2.3 Shipping Information Feed: a small opt-in RSS/HTML registry normalizes industry and official notices into `FeedItem`, preserves unknown publication time without using `fetchedAt`, isolates source failures, classifies Chinese operational terms and converges explicit operational impact through Feed → Event → HOT; Mock remains the default.
- V2.4 Weather Intelligence: one opt-in Open-Meteo request supplies local 24-hour/72-hour/7-day wave/swell/wind windows and directions with TTL/stale fallback; JMA/TMD/BMKG are separate source-specific official-warning contracts, and model risk never receives official provenance.

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
| V2.2 Country Calendar | implemented / locally verified; live pending | TH/ID/MY/PH/VN contracts, Calendarific + Official + Manual composition, source-scoped reconciliation, minimal `calendar_events` table, settings-backed coverage and calendar reminder Events; no ORM migration |
| V2.3 Shipping Information Feed | implemented / locally verified; live pending | RSS/HTML adapters, normalized FeedItem metadata with unknown publication semantics, per-source stale fallback, Chinese classification, canonical/title dedupe and Feed → Event → HOT reasons; no new table or NewsNow cache rewrite |
| V2.4 Weather Intelligence | implemented / locally verified; live pending | Open-Meteo 24-hour/72-hour/7-day wave/swell/wind normalization and directions, 30-minute TTL, per-port failure isolation, source-specific warning contracts and expiry separation; no new table |

## 3. Architecture Summary

The current retained architecture is a single repository modular monolith: React and TanStack Router render the browser UI; React Query and Jotai manage query/local state; Nitro exposes server handlers; `server/sources/**` fetches and normalizes news; db0 provides the local database abstraction; and the cache stores normalized `NewsItem[]` payloads.

This is the smallest existing foundation compatible with the local Shipping HOT product. No framework or ORM migration is approved; the only persistence change in the final isolation seal is an idempotent SQLite table rebuild for the existing `vessels` table.

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
| CalendarEvent / CalendarCoverage | `shared/calendar.ts`, `server/providers/calendar.ts`, `server/database/shipping.ts` | Calendar Provider contracts through `server/shipping-store.ts`; `calendar_events` stores event facts and settings `calendarSync` stores coverage | `/api/shipping/calendar`, Calendar page, Event Engine | Cached event facts remain readable offline; unknown/partial coverage is explicit and source keys never cross the API boundary |

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

The V2.1 Portcast adapter is opt-in through `SHIPPING_PORT_PROVIDER=portcast`; its default remains Mock. It requests only mapped public port pages once per 24-hour interval, parses visible congestion category, median wait, previous wait, week-over-week change, long-tail flag and page date, and stores no raw HTML. 404/no-public pages become an explicit degraded `no_public_data` state; parse/network failures retain last-known values and expose failed/stale status. Public-page attribution is carried in Port provenance and the port detail UI.

The V2.2 Calendar path is opt-in for Calendarific through `SHIPPING_CALENDAR_PROVIDER=calendarific` plus `CALENDARIFIC_API_KEY`; otherwise Mock is the default. In Calendarific mode the server composes Calendarific + Official + Manual sources, normalizes them into `CalendarEvent`, strips the key from errors and stored/API data, persists event facts in `calendar_events`, and persists per-country/year/source coverage in `settings.calendarSync`. Official is currently a contract/local-verified source with live sync pending. `mergeCalendarSources` gives official facts priority over third-party facts and records ManualOverride conflicts instead of erasing evidence; source-scoped reconciliation deletes only facts covered by explicit complete coverage. Calendarific attribution is conditional on actual provider/data usage. Calendar events enter the existing Event Engine with 14/7/3-day lead rules plus an immediate `announced` lifecycle for newly discovered future `government_special` events.

The V2.3 Shipping Information Feed path is opt-in through `SHIPPING_FEED_PROVIDER=public`; otherwise the Mock Feed remains the default. `server/providers/feed.ts` fetches each enabled source independently, supports RSS for The Loadstar/The Maritime Executive and source-structured HTML parsing for Shekou official notices, marks Laem Chabang/Port Klang as registered parser pending and Yantian/Nansha as deferred without a stable source, and emits normalized `FeedItem` records with `sourceType`, `dataNature=reported`, source timestamps, related ports, tags and optional `hotReason`. A source-provided publication time is never replaced by `fetchedAt`; unknown publication items remain visible but are not eligible for new Event/HOT creation. Canonical URLs and normalized titles deduplicate reposts with official-source priority. A failed source preserves only its own last-known records as stale/failed without changing their publication/update time.

The V2.4 Weather Intelligence path extends the existing Open-Meteo adapter without changing the Weather Feed boundary. `SHIPPING_WEATHER_PROVIDER=open-meteo` requests current plus hourly wave height/direction, swell height/direction, swell period, wind and gusts for one 7-day model response; local 24-hour, 72-hour and 7-day windows are calculated without repeating API calls, with a 30-minute in-process TTL. Each port is fetched independently, with its own last-known model FeedItem marked stale/failed when unavailable. Model items use `sourceType=third_party`, `dataNature=forecast`, `weather.riskSource=model` and the UI can switch windows. `SHIPPING_WEATHER_ALERT_PROVIDER=public` additionally enables independent source-specific JMA, TMD and BMKG official-warning contracts; warning items retain issued/expiry metadata, expose active/expired/unknown state, and downgrade to info at expiry without rewriting the official `updatedAt/sourceUpdatedAt`. Public live runtime remains pending; Mock remains the default, and a real model mode never consumes `mock-weather` as first-failure last-known.

The final AIS/Event boundary keeps watch configuration separate from observation data: `VesselWatchTarget` carries only identity/control fields, AIS receives only same-source sanitized last-known observations, and successful PositionReports never inherit Mock dynamic fields. AIS `statusChangedAt` is the first continuously observed timestamp of the current navigation state, not a guaranteed real-world transition time. Entity Event identities are source-scoped (`logical key + provenance.sourceId`) so Mock/AIS histories coexist. Current operational Event/HOT reads use an `OperationalSourceContext` that combines requested Provider modes with enabled/verified registry source IDs; incompatible historical Events remain in SQLite for audit and are not auto-resolved when a Provider switches.

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
- Current Event/HOT input uses explicit `sourceId` → `OperationalSourceContext` compatibility for vessels, ports, weather, feeds, calendars and alerts. Registry-disabled, parser-pending or otherwise inactive sources are excluded even when their broad Provider mode matches. Incompatible Events stay in Repository history and are not auto-resolved.

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
- No general Shipping HOT backup/restore procedure is approved; the only current migration is the startup-safe nullable `vessels.status_changed_at` compatibility rebuild.

## 13. Testing and Verification Boundaries

- Current tests: Vitest covers Shipping HOT Domain, Provider, Repository, Event/HOT and UI trust contracts.
- Current verification state: final AIS/Event batch 161/161 tests, build, typecheck, targeted lint, no-network provider-mode smoke, Python stdlib SQLite migration smoke, `git diff --check` and `shared/updated-sources.ts` stability passed. Full lint retains four pre-existing errors outside this batch; native better-sqlite3 runtime and official external-provider live runtime remain pending. Model weather and official weather alerts are independently configured and freshness-tracked.
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
| GitHub remote/account metadata | pending | Local `origin` reaches `rallsix66/Shipping-HOT` and exposes `main`; `gh auth status` still reports an invalid token | Re-authenticate `gh` before account-level operations |
| Real shipping data sources | changed-and-verified for V1 | AISStream is beta and key-gated; Open-Meteo Marine is optional-key for normal use and carries coastal-accuracy/attribution caveats | Keep keys server-side; Mock is default only, with no Mock fallback in an explicitly real mode |
| Current OAuth/cloud deployment code | implemented, not runtime-verified | May be unnecessary locally but dependencies are not mapped | Dependency analysis before removal |

## 16. Related ADRs

- `docs/adr/ADR-001-use-newsnow-as-shipping-hot-foundation.md`
- `docs/adr/ADR-002-local-first-single-user-architecture.md`
- `docs/adr/ADR-003-separate-information-and-operational-data.md`
- `docs/adr/ADR-004-v1-real-provider-adapters.md`
- Roadmap and deferred real-provider plan: `docs/plans/shipping-hot-v1.md`
