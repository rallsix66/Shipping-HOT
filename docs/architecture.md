# Architecture — NewsNow Foundation / Shipping HOT Proposal

> Last verified: 2026-08-14
> Architecture status: approved for local Mock implementation, V1 AISStream/Open-Meteo adapters and the implemented V2.0 Data Trust Foundation; V2.1+ not started
> Source of truth for: the current retained system structure and approved boundaries

## 1. Project Purpose

The repository retains NewsNow as its foundation and now exposes Shipping HOT as a local single-user product surface. The implemented path uses normalized Mock or approved V1 real Provider adapters and deterministic Domain/Event rules; real provider credentials remain optional.

## 2. Current Scope

### In Scope

- Current NewsNow news Source aggregation, cache, UI cards, local preferences, optional GitHub login/sync, and deployment adapters.
- Preserving the existing modular monolith as the foundation for the local Mock loop and approved V1 Provider adapters.
- V2.0 Data Trust Foundation: provenance, freshness/status separation, last-known fallback semantics, Event evidence and UI attribution within the existing JSON/API boundaries.

### Explicitly Out of Scope

- Any unapproved Shipping HOT business implementation.
- Unapproved real AIS, port, schedule, weather or typhoon API integration; V1 AISStream and Open-Meteo Marine adapters are approved within this document's boundary.
- Next.js, Prisma, Supabase, microservices, event buses, or a global vessel database.

### Deferred Integrations

| Proposal | State | Reason not in current scope |
|---|---|---|
| Shipping HOT domain and HOT feed | implemented | Mock/fixture data, deterministic Event Engine and HOT query are active |
| Vessel/Port/Voyage/Event storage | implemented / runtime persistence verified on Node 22 | SQLite tables, Repository seed/read/write/reconcile paths and explicit last-known fallback are present; watch/settings restart persistence passed on the compatible Node 22.23.2 runtime |
| Structured shipping Providers | implemented | Mock adapters remain active; AISStream Vessel and Open-Meteo Marine Weather adapters are optional V1 paths |
| V2.0 Data Trust Foundation | implemented / verified | `sourceType`/`dataNature` provenance, independent freshness timestamps/status, ProviderResult-compatible API data, Event evidence and explicit Mock/UI attribution; no schema migration |

## 3. Architecture Summary

The current retained architecture is a single repository modular monolith: React and TanStack Router render the browser UI; React Query and Jotai manage query/local state; Nitro exposes server handlers; `server/sources/**` fetches and normalizes news; db0 provides the local database abstraction; and the cache stores normalized `NewsItem[]` payloads.

This is the smallest existing foundation compatible with the local Shipping HOT product. No framework or ORM migration is approved.

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
- Shipping HOT now has separate shared Domain rules, Provider interfaces/Mock adapters, server API/storage and UI routes.
- New structured shipping code must use the UI → Application/API → Domain → Provider interface → Adapter → External API boundary.

## 7. Data Model and Ownership

| Entity / Data | Owning module | Writers | Readers | Source of truth |
|---|---|---|---|---|
| `NewsItem` | `shared` contract, Source server | `server/sources` / cache | API/UI | Source response or cache row |
| Source metadata | `shared` + generation script | `shared/pre-sources.ts`, `scripts/source.ts` | server/UI | `pre-sources.ts` source definition |
| `cache` row | `server/database/cache.ts` | server cache service | `/api/s`, `/api/s/entire` | db0 table |
| `user` row | `server/database/user.ts` | OAuth/sync handlers | authenticated sync | db0 table |
| local focus/order metadata | `src/atoms` | browser Jotai/localStorage; optional sync | UI | browser localStorage, or synced user data when enabled |
| Vessel/Port/Voyage/Event | `shared`, `server` and `src/components/shipping` | Mock Providers through `server/shipping-store.ts`; `ShippingRepository` persists state; local Vessel `statusChangedAt` and Voyage baselines are retained by the service merge | HOT, detail pages and Event Engine | Repository-backed state when SQLite is available; explicit last-known in-memory fallback otherwise |

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

Provider data is normalized with `sourceType`, `dataNature`, `sourceId`, optional `sourceUrl`/`verified`, and independent `updatedAt`, `sourceUpdatedAt`, `fetchedAt`, `stale` and `sourceStatus` fields. Provider failures preserve last-known `updatedAt`, add the current fetch time, and expose `failed`/`degraded`/other status without presenting the data as fresh. Domain events derive their own provenance while retaining lower-level evidence; Repository JSON, API responses, HOT items and UI cards carry the same trust information. No database field/table migration is used.

## 9. Interfaces and External Dependencies

| Dependency / Interface | Purpose | Failure behavior | Replacement / fallback |
|---|---|---|---|
| `SourceGetter` | Fetch one normalized news source | Cache fallback or error | Disable Source / RSS or RSSHub adapter |
| `myFetch` | HTTP requests with timeout/retry | Throws after retry | Source-specific fallback where implemented |
| db0 + local `better-sqlite3` | Local cache/user persistence | Cache can be disabled; auth requires DB | In-memory/no-cache only where current code supports it |
| GitHub OAuth/JWT | Optional identity and sync | Login disabled when env is absent | Local browser preferences |
| Cloudflare D1/Vercel/Bun | Optional runtime adapters | Runtime-specific failure | Local Node runtime |
| Shipping Provider interfaces | Mock plus approved V1 adapters implemented | Must isolate provider failure | Mock/last-known/no-data state with stale/sourceStatus |

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
- Real adapters must preserve last-known data and the same freshness/error contract.

## 12. Deployment, Backup and Restore

- Local development: Vite/Nitro Node runtime, intended to use `pnpm dev` after dependencies are installed.
- Optional deployment: Cloudflare Pages/D1, Vercel, Bun, and Docker are configured in existing files.
- Local database path: not explicitly configured in the repository; exact runtime location is pending dependency/runtime verification.
- Docker persists `/usr/app/.data` through the compose volume.
- No Shipping HOT migration, backup or restore procedure is approved yet.

## 13. Testing and Verification Boundaries

- Current tests: Vitest covers Shipping HOT Domain, Provider, Repository, Event/HOT and UI trust contracts.
- Current verification state: 91/91 tests, build and `git diff --check` passed; Vite development smoke covered all requested Shipping HOT routes and `/api/shipping`. `pnpm typecheck` remains pending on pre-existing TS6142/TS6307 test-config errors; targeted lint retains historical style findings. Production Nitro subroutes remain pending because of the existing `#nitro/index` package-import runtime error.
- Shipping HOT tests cover delay, baseline preservation, Vessel/Voyage ownership merges, Provider normalization/failure/fallback, weather thresholds, Real → Event flow, status duration, Event update/resolve/reopen, freshness, Feed/Event dedupe, congestion threshold, settings bounds, HOT ranking and Repository seed/read/write/prune contracts.
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
| Real shipping data sources | changed-and-verified for V1 | AISStream is beta and key-gated; Open-Meteo Marine is optional-key for normal use and carries coastal-accuracy/attribution caveats | Keep keys server-side; retain Mock fallback |
| Current OAuth/cloud deployment code | implemented, not runtime-verified | May be unnecessary locally but dependencies are not mapped | Dependency analysis before removal |

## 16. Related ADRs

- `docs/adr/ADR-001-use-newsnow-as-shipping-hot-foundation.md`
- `docs/adr/ADR-002-local-first-single-user-architecture.md`
- `docs/adr/ADR-003-separate-information-and-operational-data.md`
- `docs/adr/ADR-004-v1-real-provider-adapters.md`
- Roadmap and deferred real-provider plan: `docs/plans/shipping-hot-v1.md`
