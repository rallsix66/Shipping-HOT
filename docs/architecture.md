# Architecture — NewsNow Foundation / Shipping HOT Proposal

> Last verified: 2026-08-11
> Architecture status: draft; retained NewsNow foundation is current, Shipping HOT target is proposal
> Source of truth for: the current retained system structure and approved boundaries

## 1. Project Purpose

The current repository is NewsNow, a React/Vite/Nitro news aggregation application. The user proposes adapting it into Shipping HOT, a local single-user shipping information and vessel-tracking tool. The Shipping HOT target is not yet approved or implemented.

## 2. Current Scope

### In Scope

- Current NewsNow news Source aggregation, cache, UI cards, local preferences, optional GitHub login/sync, and deployment adapters.
- Preserving the existing modular monolith as the foundation while the Shipping HOT proposal is reviewed.

### Explicitly Out of Scope

- Any unapproved Shipping HOT business implementation.
- Real AIS, port, schedule, weather or typhoon API integration.
- Next.js, Prisma, Supabase, microservices, event buses, or a global vessel database.

### Later Proposals

| Proposal | State | Reason not in current scope |
|---|---|---|
| Shipping HOT domain and HOT feed | proposal | Requires explicit architecture confirmation |
| Vessel/Port/Voyage/Event storage | proposal | No current implementation or approved schema |
| Structured shipping Providers | proposal | No provider contract or real source selected |

## 3. Architecture Summary

The current retained architecture is a single repository modular monolith: React and TanStack Router render the browser UI; React Query and Jotai manage query/local state; Nitro exposes server handlers; `server/sources/**` fetches and normalizes news; db0 provides the local database abstraction; and the cache stores normalized `NewsItem[]` payloads.

This is the smallest existing foundation compatible with the proposed local Shipping HOT product. No framework or ORM migration is approved.

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
- Current implementation has no separate Domain/Provider layer for Shipping HOT; that target remains in `docs/plans/shipping-hot-v1.md` as proposal.
- New structured shipping code, if later approved, must use `UI → Application → Domain → Provider interface → Adapter → External API`.

## 7. Data Model and Ownership

| Entity / Data | Owning module | Writers | Readers | Source of truth |
|---|---|---|---|---|
| `NewsItem` | `shared` contract, Source server | `server/sources` / cache | API/UI | Source response or cache row |
| Source metadata | `shared` + generation script | `shared/pre-sources.ts`, `scripts/source.ts` | server/UI | `pre-sources.ts` source definition |
| `cache` row | `server/database/cache.ts` | server cache service | `/api/s`, `/api/s/entire` | db0 table |
| `user` row | `server/database/user.ts` | OAuth/sync handlers | authenticated sync | db0 table |
| local focus/order metadata | `src/atoms` | browser Jotai/localStorage; optional sync | UI | browser localStorage, or synced user data when enabled |
| Vessel/Port/Voyage/Event | Not implemented | None | None | proposal only |

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

### Proposed future flow — Shipping HOT

Information Feed and Operational Data must remain separate and meet at an Event/HOT query layer. This is a proposal, not current architecture.

## 9. Interfaces and External Dependencies

| Dependency / Interface | Purpose | Failure behavior | Replacement / fallback |
|---|---|---|---|
| `SourceGetter` | Fetch one normalized news source | Cache fallback or error | Disable Source / RSS or RSSHub adapter |
| `myFetch` | HTTP requests with timeout/retry | Throws after retry | Source-specific fallback where implemented |
| db0 + local `better-sqlite3` | Local cache/user persistence | Cache can be disabled; auth requires DB | In-memory/no-cache only where current code supports it |
| GitHub OAuth/JWT | Optional identity and sync | Login disabled when env is absent | Local browser preferences |
| Cloudflare D1/Vercel/Bun | Optional runtime adapters | Runtime-specific failure | Local Node runtime |
| Future shipping Provider interfaces | proposal only | Must isolate provider failure | Mock/last-known/no-data state |

## 10. Authentication, Authorization and Security

- Authentication: optional GitHub OAuth with JWT; disabled when required env vars are absent.
- Roles and permissions: none beyond authenticated sync access in current code.
- Sensitive data: GitHub secrets, JWT secret and future provider keys.
- Validation: `verifyPrimitiveMetadata` validates sync payload shape; provider validation is not yet implemented.
- Secret handling: environment variables or local untracked configuration; never commit keys.
- Shipping HOT must not make OAuth or AI a core runtime dependency without a new decision.

## 11. Error Handling and Recovery

- Source fetch failures are logged and may fall back to an existing cache row.
- Missing auth configuration disables login-related behavior through middleware.
- Current system has no universal `stale`, `sourceStatus`, or structured provider error DTO.
- A future Shipping HOT implementation must add last-known data, original `updatedAt`, stale/error/source status, and independent provider failure handling.

## 12. Deployment, Backup and Restore

- Local development: Vite/Nitro Node runtime, intended to use `pnpm dev` after dependencies are installed.
- Optional deployment: Cloudflare Pages/D1, Vercel, Bun, and Docker are configured in existing files.
- Local database path: not explicitly configured in the repository; exact runtime location is pending dependency/runtime verification.
- Docker persists `/usr/app/.data` through the compose volume.
- No Shipping HOT migration, backup or restore procedure is approved yet.

## 13. Testing and Verification Boundaries

- Current tests: Vitest, primarily date parsing plus a placeholder common test.
- Current verification state: code/config inspected; runtime/build not verified because `node_modules` is absent and no dependency installation was authorized.
- Future Shipping HOT rules require deterministic unit tests for delay, freshness, congestion and event detection, plus adapter fixtures.
- Minimum release checks after implementation: typecheck, lint, relevant tests, build and local smoke verification.

## 14. Architecture Change Rules

Changes that require `/architect change`:

- Database tables/fields/ownership or migration changes.
- New authentication, deployment platform, external provider or secret class.
- Framework/ORM/runtime migration.
- Deleting or renaming current NewsNow Source, cache, OAuth, PWA or deployment capabilities.
- Promoting the Shipping HOT proposal to an approved target.

Changes that can remain local implementation decisions:

- Pure UI styling within the current component boundary.
- Pure helper refactors that preserve API/data contracts and pass existing checks.
- Additional tests and documentation corrections grounded in current code.

## 15. Known Risks and Pending Decisions

| Item | State | Impact | Owner / next action |
|---|---|---|---|
| Shipping HOT target architecture | proposal | Must not be implemented yet | User confirms or requests `/architect change` |
| Project Architect/Neat Freak docs reconciliation | changed-and-verified after this pass | Docs must remain one source of truth | Re-run closeout after implementation |
| Runtime/database file path | pending | Cannot claim local DB behavior verified | Install/execute only in a later authorized verification task |
| GitHub Fork/origin | pending | No personal `origin` exists | Re-authenticate `gh`, then create fork if desired |
| Real shipping data sources | pending | Cost/access/licensing unknown | Evaluate one provider before Phase 5 |
| Current OAuth/cloud deployment code | implemented, not runtime-verified | May be unnecessary locally but dependencies are not mapped | Dependency analysis before removal |

## 16. Related ADRs

- `docs/adr/ADR-001-use-newsnow-as-shipping-hot-foundation.md`
- `docs/adr/ADR-002-local-first-single-user-architecture.md`
- `docs/adr/ADR-003-separate-information-and-operational-data.md`
- Detailed unapproved proposal: `docs/plans/shipping-hot-v1.md`

