# Project Status — Shipping HOT / NewsNow Foundation

> Snapshot date: 2026-08-15
> Evidence scope: local code / configuration / Git metadata; V2.0 is sealed, V2.1 is implemented, and V2.2/V2.3/V2.4 local closeout gates passed; 136/136 tests and build passed, targeted lint passed, default-Mock route smoke passed, and live external-provider verification remains pending.
> Source of truth for: current implementation and verification state

## 1. One-Sentence Status

Shipping HOT V2.2–V2.4 local closeout is complete on the retained NewsNow stack: V2.0 trust rules remain sealed, V2.1 is implemented, Mock remains the default, and the fixes cover composed calendar sources, unknown Feed publication times, three weather windows, wave/swell directions and source-specific official warning contracts. Public live-provider verification remains pending and is recorded below.

## 2. Current Environment

- Active branch: `main`; package version: `0.0.41`
- Git remotes: `origin=https://github.com/rallsix66/Shipping-HOT.git` and `upstream=https://github.com/ourongxing/newsnow.git`; GitHub CLI API authentication is still invalid, so account metadata was not API-verified
- Local run status: Vite development smoke returned 200 for `/`, `/feed` and `/api/shipping`; default `provider.feed=mock` and `provider.weather=mock`, one non-weather Feed item and one Mock weather item were returned without external weather calls; production Nitro API/root returned 200, while production subroutes hit the existing `#nitro/index` package-import error
- Deployment status: `out-of-scope`; repository contains optional Cloudflare/Vercel/Bun/Docker configuration, but no deployment was performed
- Database / external services: Repository paths are implemented; SQLite watch/settings restart persistence is verified on Node 22.23.2 with the compatible native module. Node 24.15.0 currently mismatches the bundled native module ABI and falls back to memory; AISStream, Portcast public pages and Open-Meteo remain optional server-side sources
- Mock fixture timestamps: generated relative to the runtime clock when a snapshot is created; deterministic fixed time is limited to `shared/shipping-engine.test.ts`
- V1 focus-port seed: all eight requested ports are present in the shared fixture and Repository seed path: Shekou, Yantian, Nansha, Laem Chabang, Port Klang, Manila, Jakarta and Ho Chi Minh City
- Last verified surface: source inspection, 136/136 tests, production build, historical typecheck comparison, targeted lint, eight-route default-Mock smoke, security scan and `git diff --check` passed; official Neat Freak Bash inventory script remains unavailable on this Windows environment, with the manual equivalent completed.

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
| Shipping HOT API and local tables | implemented / locally verified; live pending | `server/api/shipping/**`, `server/database/shipping.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `shared/calendar.ts` | Provider → service → Repository path carries provenance, sourceUpdatedAt, fetchedAt and freshness; V2.2 source composition and source-scoped reconciliation are covered by tests; eight V1 focus-port seeds remain present |
| Shipping HOT UI/routes | implemented / locally verified; live pending | `src/routes/**`, `src/components/shipping/**` | `/`, `/vessels`, `/ports`, `/voyages`, `/events`, `/feed`, `/calendar`, `/settings` and detail routes; UI uses the aurora glass console layout (左侧可折叠侧栏 + 全局状态条 + 密集表格 + 筛选侧栏/时间线 + 双栏详情 + 移动端底部 tab), blue `#0ea5e9` brand icon, conditional Calendarific Attribution and weather window controls |
| Shipping HOT V2.0 Data Trust Foundation | sealed | `shared/shipping.ts`, `server/database/shipping.ts`, `server/providers/shipping.ts`, `server/shipping-store.ts`, `shared/shipping-engine.ts`, `src/components/shipping/format.ts`, `src/components/shipping/ui.tsx` | `sourceType`/`dataNature` provenance, independent freshness timestamps/status, deterministic legacy backfill, source-aware Event reconciliation/evidence and explicit Mock/Chinese UI labels |
| Shipping HOT V2.1 Port Intelligence | implemented / verified | `server/providers/shipping.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `src/components/shipping/pages.tsx` | Opt-in `PortcastPublicPageProvider`, eight public-page mappings, visible-field parser, 24-hour cache/fingerprint, `public`/`no_public_data` detail and source attribution; Mock remains default |
| Shipping HOT V2.2 Country Calendar | implemented / locally verified; live pending | `shared/calendar.ts`, `server/providers/calendar.ts`, `server/database/shipping.ts`, `server/api/shipping/calendar/**`, `src/routes/calendar.tsx`, `src/components/shipping/pages.tsx` | Calendarific + Official + Manual composition, source-scoped coverage reconciliation, stale last-known marking for partial/unknown coverage, conflict evidence and Calendar → Event → HOT reminders are implemented; Official live sync remains pending; Mock remains default |
| Shipping HOT V2.3 Shipping Information Feed | implemented / locally verified; live pending | `server/providers/feed.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `shared/shipping-engine.ts`, `src/components/shipping/**` | Unknown publication semantics, Chinese classification, realistic HTML handling and source registry states are implemented; public-source live runtime remains pending; Mock remains default |
| Shipping HOT V2.4 Weather Intelligence | implemented / locally verified; live pending | `server/providers/shipping.ts`, `server/providers/weather-alerts.ts`, `shared/shipping.ts`, `src/components/shipping/app.tsx` | Open-Meteo 24-hour/72-hour/7-day windows and direction fields are implemented; JMA sea-warning HTML, TMD CAP and BMKG official RSS adapters are registered as `live_pending` and disabled in public mode until live verification; Mock remains default |

## 5. Decision Status

### Current Active Decisions

- Retain NewsNow as the foundation until migration cost and risk are proven higher.
- Treat the current NewsNow code/config as the authority for current implementation facts.

### Approved and Implemented for V1

- AISStream Vessel and Open-Meteo Marine Weather adapters with server-side environment selection and fallback.

### Approved and Implemented for V2.0

- Data Trust Foundation: `sourceType`/`dataNature` provenance, `ProviderResult`-compatible freshness envelope, source/fetch/update timestamp separation, degraded status preservation, last-known failure behavior, Event evidence propagation and UI attribution labels.

### Approved / V2.2 Locally Verified; Live Pending

- Country Calendar: TH/ID/MY/PH/VN contracts, server-only Calendarific integration with conditional attribution, composed official/manual/mock boundaries, source-scoped coverage, conflict evidence and deduplicated Event/HOT reminders; official live sync is still pending.

### Approved / V2.3 Locally Verified; Live Pending

- Shipping Information Feed: opt-in The Loadstar/The Maritime Executive RSS and Shekou official HTML adapters, explicit parser-pending/deferred registry states, independent source failure handling, unknown publication semantics, Chinese classification, canonical/title dedupe and Feed → Event → HOT convergence.

### Approved / V2.4 Locally Verified; Live Pending

- Weather Intelligence: one 7-day Open-Meteo request with local 24-hour/72-hour/7-day windows and wave/swell directions, 30-minute server TTL, per-port failure isolation and last-known stale semantics, plus source-specific JMA sea-warning HTML, TMD CAP and BMKG RSS adapters. All three official sources remain `live_pending`; `public` enables only `verified_live` sources (currently none), while `experimental` is the explicit opt-in for pending adapters; model risk and official warning provenance remain separate.

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

- Active work: V2.2/V2.3/V2.4 local closeout and release verification are complete; live external-provider verification remains pending; the 2026-08-15 frontend console-layout round (plan A) is complete and locally verified; V2.5 AIS / Port Derived Intelligence remains not started.
- 2026-08-14 frontend redesign round (completed): all seven pages plus navigation rebuilt with the aurora glass/bento design system — `src/components/shipping/aurora.tsx` (CSS gradient-blob background + grid/noise/vignette), `src/components/shipping/ui.tsx` (Reveal, SpotlightCard, AnimatedNumber, Segmented, Marquee, ProviderChip, StatusDot, EmptyState), rewritten `app.tsx` (floating glass nav with layoutId active pill, route transitions, dark-first theme toggle, restyled badges/StatCard/VoyageCard/EventCard/FeedCard) and `pages.tsx` (bento hero dashboard, segmented filters, congestion gauges, staggered reveals). Data flow, API calls and routes are unchanged; no new dependencies. A follow-up smoothness pass removed per-frame GPU hotspots (blob `filter: blur(90px)`, dark-mode `mix-blend-mode: screen`, per-card `backdrop-filter`) in favor of pre-feathered gradients and opaque frosted fills; only the sticky nav keeps a reduced backdrop blur. An adversarial review round then fixed: watch/save busy-state reset via try/finally, `MotionConfig reducedMotion="user"` for JS animations, route-transition remount removal (hero-only entrance), dark-mode secondary-text contrast tier bump, settings save error state machine, `freshness=unknown` status label, mobile nav active-pill scrollIntoView, anti-FOUC theme script in `index.html`, react-refresh warnings eliminated by splitting `format.ts`/`data.ts`, and a `test/ui-smoke.test.ts` renderToString guard (86/86 tests). Verification: `pnpm typecheck` passed, eslint on changed files 0 errors / 0 warnings, full test suite passed (86/86), `pnpm build` passed.
- 2026-08-15 frontend console-layout round (completed, locally verified): user-approved plan A (指挥台化) implemented — `app.tsx` left collapsible sidebar (localStorage memory) + global status topbar (活跃 HOT / 最后刷新 / 数据源混合度) + mobile bottom tab; `pages.tsx` dashboard HOT-first with stat strip, vessels/ports (inline congestion gauge)/voyages (delay column) as dense tables, feed (filter panel + source counts) and events (status × severity combined filters) as timelines, vessel/port/voyage details as two columns with related events/weather/voyages, calendar as left filter panel + 3-column cards; `globals.css` gained the console layout system and dropped the legacy glass-nav/hero-sheen/spotlight/detail-grid styles; `ui.tsx` no longer exports unused SpotlightCard/SectionHeading; `format.ts` added voyage status labels; brand logo background changed to sky blue `#0ea5e9` (`public/shipping-hot-icon.svg` and sidebar glow); standalone comparison prototypes live under `prototypes/` (offline HTML, outside the build). Data flow, API calls, routes, database and dependencies are unchanged. The current tree passes `pnpm typecheck`, targeted eslint and `pnpm test --run` after this closeout batch; `pnpm build` also passed (client + PWA + Nitro, `shared/updated-sources.ts` unchanged). Neat Freak skill instructions were loaded; its Bash-only inventory script remains pending because Bash is unavailable in this Windows environment, while the required manual equivalent audit found no secrets/database artifacts and left `.baseline-typecheck-fdf3191/` plus the user/other-agent `prototypes/` files untouched as cleanup candidates.
- Blockers: Node 24.15.0 cannot load the bundled Node 22 native module, so Node 24 startup uses the documented in-memory fallback. Production Nitro subroutes reproduce the existing `#nitro/index` package-import runtime error; Vite development routes are healthy. Public weather/official warning runtime is intentionally opt-in and external network access is blocked in this environment. GitHub CLI account authentication remains invalid and direct GitHub network access is blocked; commits were synchronized through the connected GitHub operation path.
- Verification: `pnpm test --run` = passed (136/136); current `pnpm typecheck` = passed; in the current dependency/toolchain environment, rerunning historical commit `fdf3191` also reproduces only TS6142/TS6307 (the old status recorded a passed result at that earlier time and is not being reinterpreted); targeted eslint = 0 errors / 0 warnings; tracked-file full lint retains five pre-existing errors and two ignored-file warnings outside this batch; eight default-Mock routes = 200; Calendarific key client-bundle scan = clean; `git diff --check` = passed; `shared/updated-sources.ts` unchanged; official Neat Freak Bash inventory script = pending because Bash is unavailable, manual equivalent closeout = completed.
- V2 status: `V2.0 sealed`; `V2.1 implemented`; `V2.2 implemented / locally verified / live pending`; `V2.3 implemented / locally verified / live pending`; `V2.4 implemented / locally verified / live pending`; `V2.5 not started`. Live external Provider calls remain optional; the approved Mock fallback remains the default.
- Neat Freak Closeout: pending official `audit-inventory.sh` execution because Bash is unavailable in this Windows environment; manual equivalent audit completed from the loaded Skill instructions. No cleanup candidates were deleted.

## 9. Recommended Next Action

Next: complete final batch closeout and leave V2.5 explicitly not started. Separately, use the compatible Node 22 runtime for persistence verification or rebuild native dependencies through an authorized toolchain change. Optional UI follow-ups stay out of scope.

## 10. Knowledge Closeout Surface

| Fact surface | State | Evidence / limitation | Action |
|---|---|---|---|
| Code | changed-and-verified | Shipping HOT shared Domain, Provider orchestration, local Vessel/Voyage ownership merge, API validation, Repository paths, routes, UI and tests inspected; runtime-relative Mock fixture timestamps and Event Engine test determinism are covered by passing checks | Treat code/config as authority for current implementation |
| Runtime | changed-and-verified | Fresh Nitro API smoke and SQLite watch/settings restart persistence passed on Node 22.23.2; Node 24.15.0 has a native-module ABI mismatch and uses fallback | Keep runtime caveat explicit |
| Documentation | changed-and-verified with live caveat | Status, architecture and V2 roadmap record local gates, historical typecheck baseline, source contracts and live-provider limits | Keep live verification pending until public network/runtime access is available |
| Rules | changed-and-verified | Root `AGENTS.md` defines project guardrails, verification rules, architecture-change workflow, and mandatory task Closeout; no project `CLAUDE.md` or override; global Codex `AGENTS.md` is empty | Use `AGENTS.md` as the project entry point |
| Memory | not-applicable | No project memory store or user-authorized memory write was identified | No memory files changed |
| Workspace | changed-and-verified | Manual Neat Freak-equivalent inventory found no other-agent rule artifacts, no tracked database/env artifact, and the final `git status` is recorded at closeout; `.data` is empty and `dist` remains ignored build output | Review the final `git status` before any commit; no cleanup performed |

## 11. Shipping HOT V2 Planning and Implementation Status

- V2 plan created: `docs/plans/shipping-hot-v2.md`.
- V2 plan reviewed and corrected on 2026-08-14.
- V2 plan wording follow-up: `sourceStatus` includes `degraded`; data-model references use `sourceType/dataNature`; V2.2 UI explicitly includes Calendarific Attribution; V2.2/V2.3/V2.4 local closeout evidence and live caveats are reflected in code and docs.
- V2.0 implementation authorization: explicitly granted for the Data Trust Foundation; implemented without external Provider expansion, database schema/migration changes or dependency changes.
- V2.0 implementation: `sourceType` = `official | third_party | user | mock`; `dataNature` = `observed | reported | forecast | modelled | derived | estimated | planned`; `sourceStatus` retains `healthy | degraded | failed | disabled | never_succeeded`; timestamp roles remain separate as `updatedAt`, `sourceUpdatedAt`, `fetchedAt` and `detectedAt` where applicable.
- V2.0 evidence path: Provider → Domain → Repository JSON → API → Event evidence → HOT/UI; Mock is explicitly labeled “模拟数据”; AISStream and Open-Meteo are shown with Chinese source type/data nature labels.
- V2.0 scope guard at its historical checkpoint: no Calendarific implementation, no new providers, no `calendar_events` table, no database migration, no new dependency and no major NewsNow/Event/UI rewrite. These restrictions were phase-scoped; the explicitly approved V2.2 batch now adds the minimal calendar table and provider boundary.
- Fixed NewsNow updated-source metadata generation side effect: normal `dev`/`build`/`presource` no longer rewrites `shared/updated-sources.ts`; explicit `--updated-sources` generation is required.
- Closeout: pending official `audit-inventory.sh` execution because Bash is unavailable in this Windows environment; the required manual Neat Freak-equivalent audit completed with no tracked database/env artifact or cleanup action.
- Final local V2 state with explicit live caveat: `V2.0 sealed`; `V2.1 implemented`; `V2.2 implemented / locally verified / live pending`; `V2.3 implemented / locally verified / live pending`; `V2.4 implemented / locally verified / live pending`; `V2.5 not started`.
