# Project Status — Shipping HOT / NewsNow Foundation

> Snapshot date: 2026-08-13
> Evidence scope: local code / configuration / Git metadata; V1 ports, AISStream/Open-Meteo adapters, fallback boundaries and provider/event tests are implemented; typecheck, full tests, fresh API smoke and SQLite restart persistence passed on the compatible Node 22.23.2 environment; lint remains pending for the recorded findings
> Source of truth for: current implementation and verification state

## 1. One-Sentence Status

Shipping HOT V1 is implemented on the retained NewsNow stack with deterministic Domain/Event rules, local API routes, Mock fallback, optional AISStream Vessel data, optional Open-Meteo Marine weather risk signals, structured Feed/Vessel/Port/Voyage/Event/Settings models, and a usable HOT UI; fresh runtime verification is verified on the compatible Node 22.23.2 environment, with the Node 24 native-module caveat recorded below.

## 2. Current Environment

- Active branch: `main`; package version: `0.0.41`
- Git remotes: `origin=https://github.com/rallsix66/Shipping-HOT.git` and `upstream=https://github.com/ourongxing/newsnow.git`; GitHub CLI API authentication is still invalid, so account metadata was not API-verified
- Local run status: `verified on Node 22.23.2`; fresh Nitro smoke covered Shipping API, 8 ports, CNNSA, Provider mode, watch toggle and settings update
- Deployment status: `out-of-scope`; repository contains optional Cloudflare/Vercel/Bun/Docker configuration, but no deployment was performed
- Database / external services: Repository paths are implemented; SQLite watch/settings restart persistence is verified on Node 22.23.2 with the compatible native module. Node 24.15.0 currently mismatches the bundled native module ABI and falls back to memory; AISStream and Open-Meteo remain optional server-side V1 sources
- Mock fixture timestamps: generated relative to the runtime clock when a snapshot is created; deterministic fixed time is limited to `shared/shipping-engine.test.ts`
- V1 focus-port seed: all eight requested ports are present in the shared fixture and Repository seed path: Shekou, Yantian, Nansha, Laem Chabang, Port Klang, Manila, Jakarta and Ho Chi Minh City
- Last verified surface: source inspection, `git diff --check`, typecheck passed, targeted Provider tests passed (9/9), full test suite passed (75/75), production build passed, and Node 22.23.2 fresh API/SQLite restart smoke passed; lint remains pending with recorded existing/new style findings

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
| Shipping HOT API and local tables | implemented / runtime persistence verified on Node 22 | `server/api/shipping/**`, `server/database/shipping.ts`, `server/shipping-store.ts` | Provider → service → Repository path is implemented; eight V1 focus-port seeds are present; SQLite watch/settings restart persistence passed on the compatible Node 22.23.2 runtime |
| Shipping HOT UI/routes | implemented | `src/routes/**`, `src/components/shipping/**` | `/`, `/vessels`, `/ports`, `/voyages`, `/events`, `/feed`, `/settings` and detail routes |

## 5. Decision Status

### Current Active Decisions

- Retain NewsNow as the foundation until migration cost and risk are proven higher.
- Treat the current NewsNow code/config as the authority for current implementation facts.

### Approved and Implemented for V1

- AISStream Vessel and Open-Meteo Marine Weather adapters with server-side environment selection and fallback.

### Approved but Deferred

- Deployment and Port/Schedule real Providers remain deferred. SQLite persistence and fresh API smoke are verified on Node 22.23.2; Node 24.15.0 still uses the documented native-module fallback.

### Implemented Local Mock Scope

- Local-first single-user Shipping HOT architecture.
- Separate Information Feed from Operational Data through Event/HOT convergence.
- Vessel/Port/Voyage/Event/Settings model, isolated Provider interfaces, Mock adapters, approved V1 real adapters and deterministic Event Engine.

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
| P1 | External Provider runtime access is environment-dependent | AISStream needs a server-side key; Open-Meteo access is external; both have offline adapter tests | Keep Mock fallback; verify fresh runtime when credentials/network are available |
| P1 | Legacy NewsNow Source failures use a different contract | `server/api/s/index.ts`, `shared/types.ts` | Keep legacy path; Shipping HOT DTOs use freshness/sourceStatus/error fields |
| P2 | OAuth/cloud deployment dependencies may be unnecessary locally | `server/api/oauth/**`, `nitro.config.ts`, Docker files | Dependency analysis before removal |
| P2 | Native SQLite runtime remains environment-dependent | `better-sqlite3` build requires compatible Node/toolchain | Verify persistent mode on a supported local toolchain |

## 8. Current Work and Blockers

- Active work: V1 implementation and verification closeout; eight ports, AISStream Vessel, Open-Meteo Marine Weather, fallback and Real → Event → HOT tests are implemented.
- Blockers: Node 24.15.0 cannot load the bundled Node 22 native module, so Node 24 startup uses the documented in-memory fallback. Node 22.23.2 persistence smoke passed. Lint remains pending with 375 errors / 4 warnings after the approved V1 files were added; GitHub CLI account authentication remains invalid but is unrelated to local V1 code.
- Verification: targeted Provider tests = passed (9/9); typecheck = passed; full test = passed (75/75); build = passed; lint = pending (375 errors / 4 warnings); fresh API smoke = verified on Node 22.23.2; SQLite restart persistence = verified on Node 22.23.2; Neat Freak Closeout = verified.
- V1 status: `implemented / v1-provider-complete / runtime-verified-on-node22`; Phase 5/6/7 code acceptance and Node 22 runtime smoke are complete. Live external Provider calls remain unconfigured without user-supplied credentials/network access; the approved Mock fallback remains healthy.
- Neat Freak Closeout: verified. Real Skill loaded from `C:\Users\Administrator\.codex\skills\neat-freak\SKILL.md`; final `audit-inventory.sh` completed successfully at 2026-08-13T10:21:23Z, found no other-agent rule artifacts and no database/env/build artifact in the change set; the audit recorded 15 current working-tree entries, including the 2 pre-existing unrelated modifications.

## 9. Recommended Next Action

Next: keep the compatible Node 22 runtime for local persistence verification, or rebuild native dependencies for Node 24 through an authorized toolchain change; do not start V2.

## 10. Knowledge Closeout Surface

| Fact surface | State | Evidence / limitation | Action |
|---|---|---|---|
| Code | changed-and-verified | Shipping HOT shared Domain, Provider orchestration, local Vessel/Voyage ownership merge, API validation, Repository paths, routes, UI and tests inspected; runtime-relative Mock fixture timestamps and Event Engine test determinism are covered by passing checks | Treat code/config as authority for current implementation |
| Runtime | changed-and-verified | Fresh Nitro API smoke and SQLite watch/settings restart persistence passed on Node 22.23.2; Node 24.15.0 has a native-module ABI mismatch and uses fallback | Keep runtime caveat explicit |
| Documentation | changed-and-verified | Architecture, status, ADR-004 and roadmap describe approved V1 Provider adapters and pending runtime evidence | Keep V1/V2 boundary explicit |
| Rules | changed-and-verified | Root `AGENTS.md` defines project guardrails, verification rules, architecture-change workflow, and mandatory task Closeout; no project `CLAUDE.md` or override; global Codex `AGENTS.md` is empty | Use `AGENTS.md` as the project entry point |
| Memory | not-applicable | No project memory store or user-authorized memory write was identified | No memory files changed |
| Workspace | changed-and-verified | Final Neat Freak inventory found no other-agent rule artifacts, no project database/env/build artifact in the change set, and 15 current working-tree entries including 2 pre-existing unrelated modifications | Review the final `git status` before any commit |
