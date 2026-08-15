# Project Status — Shipping HOT / NewsNow Foundation

> Snapshot date: 2026-08-15
> Evidence scope: local code / configuration / Git metadata; V2.0 is sealed, V2.1 Port Intelligence and V2.2 Country Calendar are implemented and verified; 108/108 tests and production build passed; targeted lint on V2.2 files passed; typecheck retains the documented baseline TS6142/TS6307 findings; Vite development route/API smoke passed, including calendar GET and sync POST; production Nitro subroute smoke remains pending because of the existing `#nitro/index` package-import runtime error.
> Source of truth for: current implementation and verification state

## 1. One-Sentence Status

Shipping HOT V2.2 Country Calendar is implemented and verified on the retained NewsNow stack: V2.0 trust rules remain sealed, V2.1 Port Intelligence remains verified, Mock remains the default, and the five-country calendar path provides cached Calendarific/official/manual/mock contracts, coverage persistence, conflict handling and Calendar → Event → HOT reminders. The frontend remains the aurora glass/bento system with port and calendar attribution/detail fields, and runtime caveats are recorded below.

## 2. Current Environment

- Active branch: `main`; package version: `0.0.41`
- Git remotes: `origin=https://github.com/rallsix66/Shipping-HOT.git` and `upstream=https://github.com/ourongxing/newsnow.git`; GitHub CLI API authentication is still invalid, so account metadata was not API-verified
- Local run status: Vite development smoke returned 200 for `/`, `/calendar`, `/api/shipping`, `/api/shipping/calendar`, filtered calendar GET and calendar sync POST; production Nitro API/root returned 200, while production subroutes hit the existing `#nitro/index` package-import error
- Deployment status: `out-of-scope`; repository contains optional Cloudflare/Vercel/Bun/Docker configuration, but no deployment was performed
- Database / external services: Repository paths are implemented; SQLite watch/settings restart persistence is verified on Node 22.23.2 with the compatible native module. Node 24.15.0 currently mismatches the bundled native module ABI and falls back to memory; AISStream, Portcast public pages and Open-Meteo remain optional server-side sources
- Mock fixture timestamps: generated relative to the runtime clock when a snapshot is created; deterministic fixed time is limited to `shared/shipping-engine.test.ts`
- V1 focus-port seed: all eight requested ports are present in the shared fixture and Repository seed path: Shekou, Yantian, Nansha, Laem Chabang, Port Klang, Manila, Jakarta and Ho Chi Minh City
- Last verified surface: source inspection, `git diff --check`, full test suite passed (108/108), production build passed, Vite development route/API smoke passed, targeted lint on all V2.2 modified files passed; `pnpm typecheck` remains pending on pre-existing TS6142/TS6307 test-config errors.

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
| Shipping HOT API and local tables | implemented / V2.2 verified | `server/api/shipping/**`, `server/database/shipping.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `shared/calendar.ts` | Provider → service → Repository path carries provenance, sourceUpdatedAt, fetchedAt and freshness; V2.2 adds the authorized minimal `calendar_events` table and persists calendar coverage in settings; eight V1 focus-port seeds remain present |
| Shipping HOT UI/routes | implemented / redesigned 2026-08-14 | `src/routes/**`, `src/components/shipping/**` | `/`, `/vessels`, `/ports`, `/voyages`, `/events`, `/feed`, `/calendar`, `/settings` and detail routes; UI uses the aurora glass/bento system with calendar country/year/month/type/impact/verification filters, 14-day reminders and visible Calendarific attribution |
| Shipping HOT V2.0 Data Trust Foundation | sealed | `shared/shipping.ts`, `server/database/shipping.ts`, `server/providers/shipping.ts`, `server/shipping-store.ts`, `shared/shipping-engine.ts`, `src/components/shipping/format.ts`, `src/components/shipping/ui.tsx` | `sourceType`/`dataNature` provenance, independent freshness timestamps/status, deterministic legacy backfill, source-aware Event reconciliation/evidence and explicit Mock/Chinese UI labels |
| Shipping HOT V2.1 Port Intelligence | implemented / verified | `server/providers/shipping.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `src/components/shipping/pages.tsx` | Opt-in `PortcastPublicPageProvider`, eight public-page mappings, visible-field parser, 24-hour cache/fingerprint, `public`/`no_public_data` detail and source attribution; Mock remains default |
| Shipping HOT V2.2 Country Calendar | implemented / verified | `shared/calendar.ts`, `server/providers/calendar.ts`, `server/database/shipping.ts`, `server/api/shipping/calendar/**`, `src/routes/calendar.tsx`, `src/components/shipping/pages.tsx` | TH/ID/MY/PH/VN annual cache, Calendarific server-only key path, official/manual/mock source contracts, coverage persistence, source conflict handling, `calendar_events` storage and Calendar → Event → HOT reminders; Mock remains default |

## 5. Decision Status

### Current Active Decisions

- Retain NewsNow as the foundation until migration cost and risk are proven higher.
- Treat the current NewsNow code/config as the authority for current implementation facts.

### Approved and Implemented for V1

- AISStream Vessel and Open-Meteo Marine Weather adapters with server-side environment selection and fallback.

### Approved and Implemented for V2.0

- Data Trust Foundation: `sourceType`/`dataNature` provenance, `ProviderResult`-compatible freshness envelope, source/fetch/update timestamp separation, degraded status preservation, last-known failure behavior, Event evidence propagation and UI attribution labels.

### Approved and Implemented for V2.2

- Country Calendar: TH/ID/MY/PH/VN contracts, server-only Calendarific integration with visible attribution, official/manual/mock source boundaries, minimal `calendar_events` storage, persisted coverage, conflict evidence and deduplicated Event/HOT reminders.

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
| Native `better-sqlite3` build | Node 24.15.0 cannot load the bundled Node 22 native module | Node 24 startup uses the documented in-memory fallback; Node 22.23.2 persistence smoke passed | Keep schema/init code; use the compatible Node 22 runtime or rebuild through an authorized toolchain |
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

- Active work: V2.2 Country Calendar closeout is complete; V2.3 Shipping Information Feed is next; V2.4 and V2.5 remain not started.
- 2026-08-14 frontend redesign round (completed): all seven pages plus navigation rebuilt with the aurora glass/bento design system — `src/components/shipping/aurora.tsx` (CSS gradient-blob background + grid/noise/vignette), `src/components/shipping/ui.tsx` (Reveal, SpotlightCard, AnimatedNumber, Segmented, Marquee, ProviderChip, StatusDot, EmptyState), rewritten `app.tsx` (floating glass nav with layoutId active pill, route transitions, dark-first theme toggle, restyled badges/StatCard/VoyageCard/EventCard/FeedCard) and `pages.tsx` (bento hero dashboard, segmented filters, congestion gauges, staggered reveals). Data flow, API calls and routes are unchanged; no new dependencies. A follow-up smoothness pass removed per-frame GPU hotspots (blob `filter: blur(90px)`, dark-mode `mix-blend-mode: screen`, per-card `backdrop-filter`) in favor of pre-feathered gradients and opaque frosted fills; only the sticky nav keeps a reduced backdrop blur. An adversarial review round then fixed: watch/save busy-state reset via try/finally, `MotionConfig reducedMotion="user"` for JS animations, route-transition remount removal (hero-only entrance), dark-mode secondary-text contrast tier bump, settings save error state machine, `freshness=unknown` status label, mobile nav active-pill scrollIntoView, anti-FOUC theme script in `index.html`, react-refresh warnings eliminated by splitting `format.ts`/`data.ts`, and a `test/ui-smoke.test.ts` renderToString guard (86/86 tests). Verification: `pnpm typecheck` passed, eslint on changed files 0 errors / 0 warnings, full test suite passed (86/86), `pnpm build` passed.
- Blockers: Node 24.15.0 cannot load the bundled Node 22 native module, so Node 24 startup uses the documented in-memory fallback. Production Nitro subroutes reproduce the existing `#nitro/index` package-import runtime error; Vite development routes are healthy. GitHub CLI account authentication remains invalid but direct Git push is available through the configured network path.
- Verification: `pnpm test --run` = passed (108/108); `pnpm build` = passed; `pnpm typecheck` = pending on pre-existing TS6142/TS6307 test-config errors; targeted lint on all V2.2 modified files = passed; full lint still reports six pre-existing errors outside this phase; Vite development route/API smoke = passed for the calendar page, filtered GET and sync POST; production API/root smoke = passed, production subroutes = pending existing Nitro runtime issue; `git diff --check` = passed; `shared/updated-sources.ts` unchanged; Neat Freak official Bash script = pending because Bash is unavailable, manual equivalent closeout = completed with no cleanup.
- V2 status: `V2.0 sealed`; `V2.1 implemented`; `V2.2 implemented`; `V2.3 not started`. Live external Provider calls remain optional; the approved Mock fallback remains healthy unless `SHIPPING_PORT_PROVIDER=portcast` or `SHIPPING_CALENDAR_PROVIDER=calendarific` with a server-side key is explicitly configured.
- Neat Freak Closeout: pending official `audit-inventory.sh` execution because Bash is unavailable in this Windows environment; manual equivalent audit completed from the loaded Skill instructions. No cleanup candidates were deleted.

## 9. Recommended Next Action

Next: proceed to the explicitly approved V2.3 Shipping Information Feed gate. Separately, use the compatible Node 22 runtime for persistence verification or rebuild native dependencies through an authorized toolchain change. Optional UI follow-ups stay out of scope.

## 10. Knowledge Closeout Surface

| Fact surface | State | Evidence / limitation | Action |
|---|---|---|---|
| Code | changed-and-verified | Shipping HOT shared Domain, Provider orchestration, local Vessel/Voyage ownership merge, API validation, Repository paths, routes, UI and tests inspected; runtime-relative Mock fixture timestamps and Event Engine test determinism are covered by passing checks | Treat code/config as authority for current implementation |
| Runtime | changed-and-verified | Fresh Nitro API smoke and SQLite watch/settings restart persistence passed on Node 22.23.2; Node 24.15.0 has a native-module ABI mismatch and uses fallback | Keep runtime caveat explicit |
| Documentation | changed-and-verified | Architecture, status and V2 roadmap describe sealed V2.0, implemented V2.1 Portcast boundary, implemented V2.2 Calendar boundary and current runtime evidence | Keep V2.3+ explicitly not started until the next gate is handed off |
| Rules | changed-and-verified | Root `AGENTS.md` defines project guardrails, verification rules, architecture-change workflow, and mandatory task Closeout; no project `CLAUDE.md` or override; global Codex `AGENTS.md` is empty | Use `AGENTS.md` as the project entry point |
| Memory | not-applicable | No project memory store or user-authorized memory write was identified | No memory files changed |
| Workspace | changed-and-verified | Manual Neat Freak-equivalent inventory found no other-agent rule artifacts, no tracked database/env artifact, and the final `git status` is recorded at closeout; `.data` is empty and `dist` remains ignored build output | Review the final `git status` before any commit; no cleanup performed |

## 11. Shipping HOT V2 Planning and Implementation Status

- V2 plan created: `docs/plans/shipping-hot-v2.md`.
- V2 plan reviewed and corrected on 2026-08-14.
- V2 plan wording follow-up: `sourceStatus` includes `degraded`; data-model references use `sourceType/dataNature`; V2.2 UI explicitly includes Calendarific Attribution; V2.2 implementation is now reflected in code and docs.
- V2.0 implementation authorization: explicitly granted for the Data Trust Foundation; implemented without external Provider expansion, database schema/migration changes or dependency changes.
- V2.0 implementation: `sourceType` = `official | third_party | user | mock`; `dataNature` = `observed | reported | forecast | modelled | derived | estimated | planned`; `sourceStatus` retains `healthy | degraded | failed | disabled | never_succeeded`; timestamp roles remain separate as `updatedAt`, `sourceUpdatedAt`, `fetchedAt` and `detectedAt` where applicable.
- V2.0 evidence path: Provider → Domain → Repository JSON → API → Event evidence → HOT/UI; Mock is explicitly labeled “模拟数据”; AISStream and Open-Meteo are shown with Chinese source type/data nature labels.
- V2.0 scope guard at its historical checkpoint: no Calendarific implementation, no new providers, no `calendar_events` table, no database migration, no new dependency and no major NewsNow/Event/UI rewrite. These restrictions were phase-scoped; the explicitly approved V2.2 batch now adds the minimal calendar table and provider boundary.
- Fixed NewsNow updated-source metadata generation side effect: normal `dev`/`build`/`presource` no longer rewrites `shared/updated-sources.ts`; explicit `--updated-sources` generation is required.
- Closeout: pending official `audit-inventory.sh` execution because Bash is unavailable in this Windows environment; the required manual Neat Freak-equivalent audit completed with no tracked database/env artifact or cleanup action.
- Final V2 state at this closeout checkpoint: `V2.0 sealed`; `V2.1 implemented`; `V2.2 implemented`; `V2.3 not started`.
