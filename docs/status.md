# Project Status — Shipping HOT / NewsNow Foundation

> Snapshot date: 2026-08-12
> Evidence scope: local code / configuration / Git metadata; Mock runtime smoke, tests, typecheck and build verified; real external Providers not used
> Source of truth for: current implementation and verification state

## 1. One-Sentence Status

Shipping HOT now runs locally on the retained NewsNow stack with Mock Providers, deterministic Domain/Event rules, local API routes, structured Feed/Vessel/Port/Voyage/Event/Settings models, and a usable HOT UI. Real AIS, port, schedule and weather Providers remain deferred.

## 2. Current Environment

- Active branch: `main`; package version: `0.0.41`
- Git remotes: `origin=https://github.com/rallsix66/Shipping-HOT.git` and `upstream=https://github.com/ourongxing/newsnow.git`; GitHub CLI API authentication is still invalid, so account metadata was not API-verified
- Local run status: `verified-current`; built Nitro server smoke returned Mock data, HOT aggregation, watch toggles and Settings updates
- Deployment status: `out-of-scope`; repository contains optional Cloudflare/Vercel/Bun/Docker configuration, but no deployment was performed
- Database / external services: `feed_items`, `vessels`, `ports`, `voyages`, `events`, and `settings` SQLite tables are defined; runtime used the documented in-memory fallback because `better-sqlite3` could not build under Node 24 without Visual Studio C++ tools; real external services are deferred
- Last verified surface: source tree, API/UI bundle, Mock API smoke, tests, typecheck and build

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
| Shipping HOT Domain and Event Engine | implemented | `shared/shipping.ts`, `shared/shipping-rules.ts`, `shared/shipping-engine.ts` | Mock/fixture driven; real Providers deferred |
| Shipping HOT API and local tables | implemented | `server/api/shipping/**`, `server/database/shipping.ts`, `server/shipping-store.ts` | SQLite init has in-memory fallback when native driver is unavailable |
| Shipping HOT UI/routes | implemented | `src/routes/**`, `src/components/shipping/**` | `/`, `/vessels`, `/ports`, `/voyages`, `/events`, `/feed`, `/settings` and detail routes |

## 5. Decision Status

### Current Active Decisions

- Retain NewsNow as the foundation until migration cost and risk are proven higher.
- Treat the current NewsNow code/config as the authority for current implementation facts.

### Approved but Deferred

- Real AIS, port, schedule and weather Provider integrations; persistent SQLite verification on a compatible native toolchain; deployment.

### Implemented Local Mock Scope

- Local-first single-user Shipping HOT architecture.
- Separate Information Feed from Operational Data through Event/HOT convergence.
- Vessel/Port/Voyage/Event/Settings model, isolated Provider interfaces, Mock adapters and deterministic Event Engine.

### Deprecated / Rejected

- None recorded. Do not infer deletion approval from the proposal's `REMOVE` section.

## 6. Known Inconsistencies

| Source of truth | Conflicting surface | Impact | Action |
|---|---|---|---|
| NewsNow foundation and Shipping HOT implementation coexist | Legacy NewsNow routes and Source modules remain | A reader could mistake retained legacy capability for the new core | Keep legacy paths; Shipping HOT is the local product surface |
| Native `better-sqlite3` build | Current environment has Node 24 without Visual Studio C++ tools | SQLite-backed persistence was not runtime-verified in this environment | Keep schema/init code; use fallback and verify persistence in a compatible Node/toolchain |
| `nitro.config.ts` selects SQLite connector | No explicit local DB path in repo | Exact DB file location is unknown | Mark pending until authorized runtime verification |
| GitHub API auth is invalid | `gh auth status` / `gh repo view` fail with 401 | Account visibility and repo metadata cannot be verified through `gh` | Keep API verification pending; local `origin` remains evidence of configured remote |

## 7. Current Risks

| Priority | Risk | Evidence | Recommended action |
|---|---|---|---|
| P1 | Real Provider access is not available | Provider adapters are intentionally deferred | Continue with Mock/fixture behavior; evaluate Providers separately |
| P1 | Legacy NewsNow Source failures use a different contract | `server/api/s/index.ts`, `shared/types.ts` | Keep legacy path; Shipping HOT DTOs use freshness/sourceStatus/error fields |
| P2 | OAuth/cloud deployment dependencies may be unnecessary locally | `server/api/oauth/**`, `nitro.config.ts`, Docker files | Dependency analysis before removal |
| P2 | Native SQLite runtime remains environment-dependent | `better-sqlite3` build requires compatible Node/toolchain | Verify persistent mode on a supported local toolchain |

## 8. Current Work and Blockers

- Active work: Mock-based local Shipping HOT implementation and closeout.
- Blockers: real Provider selection/access and compatible native SQLite toolchain are deferred; GitHub CLI API re-authentication is still needed for account-level operations.
- Pending verification: persistent SQLite mode on a compatible toolchain, deployment/live state, real Provider behavior.

## 9. Recommended Next Action

Next: review the implemented Mock loop, then separately evaluate any real Provider and compatible persistent SQLite toolchain before enabling them.

## 10. Knowledge Closeout Surface

| Fact surface | State | Evidence / limitation | Action |
|---|---|---|---|
| Code | changed-and-verified | Shipping HOT shared Domain, providers, API, storage init, routes, UI and tests inspected | Treat code/config as authority for current implementation |
| Runtime | changed-and-verified | Built Nitro server smoke returned Mock snapshot, HOT items, watch toggle and Settings update | Keep real Provider and persistent SQLite claims deferred |
| Documentation | changed-and-verified | Architecture, status, ADRs and roadmap now distinguish implemented Mock scope from deferred real integrations | Keep implementation/deferred split |
| Rules | changed-and-verified | Root `AGENTS.md` defines project guardrails, verification rules, architecture-change workflow, and mandatory task Closeout; no project `CLAUDE.md` or override; global Codex `AGENTS.md` is empty | Use `AGENTS.md` as the project entry point |
| Memory | not-applicable | No project memory store or user-authorized memory write was identified | No memory files changed |
| Workspace | changed-and-verified | Current implementation changes are reviewable; generated route metadata is tracked and build output is ignored | No cleanup performed |
