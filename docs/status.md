# Project Status — Shipping HOT / NewsNow Foundation

> Snapshot date: 2026-08-13
> Evidence scope: local code / configuration / Git metadata; V1 port seed completion, targeted provider/repository checks and full test/build verification completed in this pass; real external Providers remain deferred pending architecture confirmation; lint, fresh API smoke and SQLite restart persistence remain pending or blocked for their recorded reasons
> Source of truth for: current implementation and verification state

## 1. One-Sentence Status

Shipping HOT local Mock implementation is in place on the retained NewsNow stack with deterministic Domain/Event rules, local API routes, structured Feed/Vessel/Port/Voyage/Event/Settings models, and a usable HOT UI; fresh runtime verification remains pending. Real AIS, port, schedule and weather Providers remain deferred.

## 2. Current Environment

- Active branch: `main`; package version: `0.0.41`
- Git remotes: `origin=https://github.com/rallsix66/Shipping-HOT.git` and `upstream=https://github.com/ourongxing/newsnow.git`; GitHub CLI API authentication is still invalid, so account metadata was not API-verified
- Local run status: `pending`; the service path now routes through Mock Providers and Repository code, but a fresh Nitro smoke run was blocked by the incomplete dependency tree
- Deployment status: `out-of-scope`; repository contains optional Cloudflare/Vercel/Bun/Docker configuration, but no deployment was performed
- Database / external services: `feed_items`, `vessels`, `ports`, `voyages`, `events`, and `settings` now have Repository seed/list/upsert/reconcile/settings/retention paths; compatible SQLite restart persistence remains pending because `better-sqlite3` could not build under Node 24 without Visual Studio C++ tools; real external services are deferred
- Mock fixture timestamps: generated relative to the runtime clock when a snapshot is created; deterministic fixed time is limited to `shared/shipping-engine.test.ts`
- V1 focus-port seed: all eight requested ports are present in the shared fixture and Repository seed path: Shekou, Yantian, Nansha, Laem Chabang, Port Klang, Manila, Jakarta and Ho Chi Minh City
- Last verified surface: source tree inspection, `git diff --check`, typecheck passed, full test suite (69/69 passed), and production build passed in this pass; lint, fresh Mock API smoke and SQLite restart persistence remain pending or blocked for their recorded reasons

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
| Shipping HOT Domain and Event Engine | implemented | `shared/shipping.ts`, `shared/shipping-rules.ts`, `shared/shipping-engine.ts` | Event reconcile covers update, resolve and reopen; HOT removes FeedItem/Event duplicates, uses related entity freshness, and ranks severity, watched relevance, freshness and recency; real Providers deferred |
| Shipping HOT API and local tables | implemented / runtime persistence pending | `server/api/shipping/**`, `server/database/shipping.ts`, `server/shipping-store.ts` | Provider → service → Repository path is implemented; eight V1 focus-port seeds are present; SQLite restart verification is pending in the current native-toolchain environment |
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

- Active work: V1 remaining work; eight-port Mock seed completed, real Vessel/Weather Provider work not started because the required architecture confirmation is absent.
- Blockers: enabling an external Vessel or Weather Provider is an architecture change under `AGENTS.md` and `docs/architecture.md`; no provider-specific external secret class has been authorized. Lint remains pending with 356 existing style/import/format errors and 4 warnings, mainly across retained NewsNow and existing Shipping HOT surfaces. Compatible native SQLite toolchain, fresh API smoke and GitHub CLI account authentication remain deferred/pending.
- Verification: targeted provider/repository tests = passed (6/6); typecheck = passed; full test = passed (69/69); build = passed; lint = pending (356 errors / 4 warnings); fresh API smoke = pending; SQLite restart persistence = pending; Neat Freak Closeout = verified.
- V1 status: `implemented-mock / v1-port-seed-complete / real-providers-deferred`; Phase 5/6/7 acceptance is not complete. The remaining blocker is architecture confirmation for real Provider integration, not a Mock core logic defect.
- Neat Freak Closeout: verified. Real Skill loaded from `C:\Users\Administrator\.codex\skills\neat-freak\SKILL.md` and its `scripts/audit-inventory.sh` audit executed successfully after this pass; the audit found six intended working-tree entries and no project database, environment file or build artifact in the change set.

## 9. Recommended Next Action

Next: review the implemented Mock loop, then separately evaluate any real Provider and compatible persistent SQLite toolchain before enabling them.

## 10. Knowledge Closeout Surface

| Fact surface | State | Evidence / limitation | Action |
|---|---|---|---|
| Code | changed-and-verified | Shipping HOT shared Domain, Provider orchestration, local Vessel/Voyage ownership merge, API validation, Repository paths, routes, UI and tests inspected; runtime-relative Mock fixture timestamps and Event Engine test determinism are covered by passing checks | Treat code/config as authority for current implementation |
| Runtime | pending | Fresh Nitro server smoke and SQLite restart persistence could not run because the dependency tree could not be restored offline | Do not claim runtime persistence verified |
| Documentation | changed-and-verified | Architecture, status, ADRs and roadmap now distinguish implemented Mock scope from deferred real integrations | Keep implementation/deferred split |
| Rules | changed-and-verified | Root `AGENTS.md` defines project guardrails, verification rules, architecture-change workflow, and mandatory task Closeout; no project `CLAUDE.md` or override; global Codex `AGENTS.md` is empty | Use `AGENTS.md` as the project entry point |
| Memory | not-applicable | No project memory store or user-authorized memory write was identified | No memory files changed |
| Workspace | changed-and-verified | Neat Freak inventory found only the intended project files plus ignored/generated local directories; no project database, env file or build artifact was added to the change set | Review the final `git status` before commit |
