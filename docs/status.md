# Project Status — Shipping HOT / NewsNow Foundation

> Snapshot date: 2026-08-18
> Evidence scope: local code / configuration / Git metadata; V2.0 is sealed, V2.1 is implemented, and V2.2/V2.3/V2.4 local closeout gates passed. The corrected 2026-08-18 public re-probe verified Portcast 8/8 page/parser responses (7 fresh, 1 stale), Open-Meteo 8/8 port responses and Shekou `/ywgg/` parsing; Loadstar returned 10 items and Maritime Executive remained failed. AISStream and Calendarific remain `pending_credentials`. Full lint retains four pre-existing errors and native SQLite runtime is pending on this Node 24 environment.
> Source of truth for: current implementation and verification state

## 1. One-Sentence Status

Shipping HOT V2.2–V2.4 local closeout is complete on the retained NewsNow stack: V2.0 trust rules remain sealed, V2.1 is implemented, Mock remains the default, and the fixes cover composed calendar sources, verified Calendar provenance source activation, unknown Feed publication times, three weather windows, wave/swell directions, source-specific official warning contracts and final Mock isolation. The latest local batch additionally re-evaluates Portcast source age on cache hits, records Open-Meteo completion-time `fetchedAt`, and limits Shekou official HTML parsing to `/ywgg/` operational notices. The corrected public re-probe completed the Portcast/Open-Meteo/Shekou live-path closeout. The final isolation batch separates AIS watch configuration from observations, derives AIS status duration only from same-source observations, and filters incompatible historical Events out of the current Event/HOT view without deleting them.

`Mock isolation: complete` for the local operational boundary; native SQLite runtime and real external-provider live verification remain pending.

## 2. Current Environment

- Active branch: `main`; package version: `0.0.41`
- Git remotes: `origin=https://github.com/rallsix66/Shipping-HOT.git` and `upstream=https://github.com/ourongxing/newsnow.git`; GitHub CLI API authentication is still invalid, so account metadata was not API-verified
- Local run status: Vite development smoke returned 200 for `/`, `/feed` and `/api/shipping`; default `provider.feed=mock`, `provider.weather=mock` and `provider.weatherAlerts=off`, one non-weather Feed item and one Mock weather item were returned without external weather calls; production Nitro API/root returned 200, while production subroutes hit the existing `#nitro/index` package-import error
- Deployment status: `out-of-scope`; repository contains optional Cloudflare/Vercel/Bun/Docker configuration, but no deployment was performed
- Database / external services: Repository paths are implemented; the nullable `vessels.status_changed_at` rebuild, row/watch-state preservation and NULL identity-only writes passed an offline Python stdlib SQLite smoke. Node 24.15.0 currently mismatches the bundled native module ABI, so native SQLite persistence remains pending and the app uses its documented memory fallback; the ignored local `.data/db.sqlite3` artifact remains from prior/local runtime work and was not deleted; AISStream, Portcast public pages and Open-Meteo remain optional server-side sources
- Mock fixture timestamps: generated relative to the runtime clock when a snapshot is created; deterministic fixed time is limited to `shared/shipping-engine.test.ts`
- V1 focus-port seed: all eight requested ports are present in the shared fixture and Repository seed path: Shekou, Yantian, Nansha, Laem Chabang, Port Klang, Manila, Jakarta and Ho Chi Minh City
- Last verified surface: source inspection, final 173/173 tests, typecheck, targeted lint, production build, corrected public re-probe, no-network provider-mode smoke, SQLite migration smoke, `git diff --check` and `shared/updated-sources.ts` stability passed; full lint retains four pre-existing errors outside this batch; official Neat Freak Bash inventory script is unavailable on this Windows environment, with the manual equivalent completed.

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
| Shipping HOT UI/routes | implemented / locally verified; live pending | `src/routes/**`, `src/components/shipping/**` | `/`, `/vessels`, `/ports`, `/voyages`, `/events`, `/feed`, `/calendar`, `/settings` and detail routes; UI uses the aurora glass console layout (左侧可折叠侧栏 + 全局状态条 + 密集表格 + 筛选侧栏/时间线 + 双栏详情 + 移动端底部 tab), blue `#0ea5e9` brand icon, conditional Calendarific Attribution and weather window controls |
| Shipping HOT V2.0 Data Trust Foundation | sealed | `shared/shipping.ts`, `server/database/shipping.ts`, `server/providers/shipping.ts`, `server/shipping-store.ts`, `shared/shipping-engine.ts`, `src/components/shipping/format.ts`, `src/components/shipping/ui.tsx` | `sourceType`/`dataNature` provenance, independent freshness timestamps/status, deterministic legacy backfill, source-aware Event reconciliation/evidence and explicit Mock/Chinese UI labels |
| Shipping HOT V2.1 Port Intelligence | implemented / verified | `server/providers/shipping.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `src/components/shipping/pages.tsx` | Opt-in `PortcastPublicPageProvider`, eight public-page mappings, visible-field parser, 24-hour cache/fingerprint, `public`/`no_public_data` detail and source attribution; Mock remains default |
| Shipping HOT V2.2 Country Calendar | implemented / locally verified; live pending | `shared/calendar.ts`, `server/providers/calendar.ts`, `server/database/shipping.ts`, `server/api/shipping/calendar/**`, `src/routes/calendar.tsx`, `src/components/shipping/pages.tsx` | Calendarific + Official + Manual composition, actual provenance `calendarSourceIds` activation mapping, source-scoped coverage reconciliation, stale last-known marking for partial/unknown coverage, conflict evidence and Calendar → Event → HOT reminders are implemented; Official live sync remains pending; Mock remains default |
| Shipping HOT V2.3 Shipping Information Feed | implemented / locally verified; live pending | `server/providers/feed.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `shared/shipping-engine.ts`, `src/components/shipping/**` | Unknown publication semantics, Chinese classification, realistic HTML handling and source registry states are implemented; public-source live runtime remains pending; Mock remains default |
| Shipping HOT V2.4 Weather Intelligence | implemented / locally verified; live pending | `server/providers/shipping.ts`, `server/providers/weather-alerts.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `src/components/shipping/app.tsx` | Open-Meteo 24-hour/72-hour/7-day windows and direction fields are implemented; model weather and JMA/TMD/BMKG official alerts are independently selected and composed with failure isolation; official sources remain `live_pending` and are disabled without requests in public mode until live verification; Mock remains default |

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

- Weather Intelligence: one 7-day Open-Meteo request with local 24-hour/72-hour/7-day windows and wave/swell directions, 30-minute server TTL, per-port failure isolation and last-known stale semantics, plus source-specific JMA sea-warning HTML, TMD CAP and BMKG RSS adapters. Model weather and official alerts are independently selected and composed; all three official sources remain `live_pending`; `public` enables only `verified_live` sources (currently none), while `experimental` is the explicit opt-in for pending adapters; model risk and official warning provenance remain separate.

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

### Provider activation semantics

- AISStream missing key → `aisstream / never_succeeded`, `AISSTREAM_API_KEY missing`, vessel data `[]`.
- Calendarific missing key → `calendarific`, unknown Calendarific coverage with `CALENDARIFIC_API_KEY missing`, no Mock Calendar events.
- Calendar source activation mapping is verified: Mock → `mock-calendar`; Calendarific with key → `calendarific` + `official-holiday-source` + `manual-holiday`; Calendarific without key → `calendarific` only; Official → `official-holiday-source` + `manual-holiday`; Manual → `manual-holiday`. These are provenance IDs, not composite provider option keys, and current Calendar/Event/HOT reads use the configured set.
- Open-Meteo first failure → no model data; only prior `open-meteo-marine` records may be retained stale/failed.
- Portcast first failure → static port identity only; dynamic fields are unknown. A later failure may retain only prior `portcast-public` dynamic fields.
- Public Feed failure → only last-known records from enabled public source IDs may be retained; `mock-port-notice` is excluded.

The requested Provider mode is shown independently from runtime `sourceStatus` (`healthy`, `degraded`, `failed`, `disabled`, `never_succeeded`).

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
| Official Alerts | TMD | independent probe | failed parser | 0 | `live_pending` | HTTP 200 CAP endpoint, payload had no recognizable alert root |
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
| AISStream / Calendarific | No credentials are present in the current process environment; requested real modes remain no-data/`never_succeeded` or unknown coverage and do not fall back to Mock. | `pending_credentials` |
| Official alerts | JMA/TMD/BMKG registry statuses remain unchanged and no new alert probe was required by this pass. | `live_pending` |

Current implementation matrix: Portcast supports fresh / stale / failed / no-public states and re-evaluates source age on every read, including cache hits; Open-Meteo keeps model forecast evidence without fabricating a source update time and records completion-time `fetchedAt`; Shekou Feed is official operational notices only. `mock-schedule` remains the only Mock source permitted in the all-real requested-mode smoke; V2.5 remains not started.

## 6. Known Inconsistencies

| Source of truth | Conflicting surface | Impact | Action |
|---|---|---|---|
| NewsNow foundation and Shipping HOT implementation coexist | Legacy NewsNow routes and Source modules remain | A reader could mistake retained legacy capability for the new core | Keep legacy paths; Shipping HOT is the local product surface |
| Native `better-sqlite3` build | Node 24.15.0 cannot load the bundled Node 22 native module | Node 24 startup uses the documented in-memory fallback; Python stdlib SQLite migration smoke passed, but native persistence is not verified here | Keep schema/init code; rebuild the native module or use a compatible authorized toolchain |
| `nitro.config.ts` selects SQLite connector | No explicit local DB path in repo | Exact DB file location is unknown | Mark pending until authorized runtime verification |
| GitHub API auth is invalid | `gh auth status` / `gh repo view` fail with 401 | Account visibility and repo metadata cannot be verified through `gh` | Keep API verification pending; local `origin` remains evidence of configured remote |

## 7. Current Risks

| Priority | Risk | Evidence | Recommended action |
|---|---|---|---|
| P1 | External Provider runtime access is environment-dependent | AISStream needs a server-side key; Open-Meteo access is external; both have offline adapter tests | Keep Mock as the default; explicit real modes show no-data until fresh evidence is available |
| P1 | Legacy NewsNow Source failures use a different contract | `server/api/s/index.ts`, `shared/types.ts` | Keep legacy path; Shipping HOT DTOs use freshness/sourceStatus/error fields |
| P2 | OAuth/cloud deployment dependencies may be unnecessary locally | `server/api/oauth/**`, `nitro.config.ts`, Docker files | Dependency analysis before removal |
| P2 | Native SQLite runtime remains environment-dependent | `better-sqlite3` build requires compatible Node/toolchain | Verify persistent mode on a supported local toolchain |

## 8. Current Work and Blockers

- Active work: V2.2/V2.3/V2.4 local closeout and release verification are complete; the 2026-08-17 V2 final cleanup decoupled official weather alerts from model weather and clarified provider-status labels; live external-provider verification remains pending; the 2026-08-15 frontend console-layout round (plan A) is complete and locally verified; V2.5 AIS / Port Derived Intelligence remains not started.
- 2026-08-14 frontend redesign round (completed): all seven pages plus navigation rebuilt with the aurora glass/bento design system — `src/components/shipping/aurora.tsx` (CSS gradient-blob background + grid/noise/vignette), `src/components/shipping/ui.tsx` (Reveal, SpotlightCard, AnimatedNumber, Segmented, Marquee, ProviderChip, StatusDot, EmptyState), rewritten `app.tsx` (floating glass nav with layoutId active pill, route transitions, dark-first theme toggle, restyled badges/StatCard/VoyageCard/EventCard/FeedCard) and `pages.tsx` (bento hero dashboard, segmented filters, congestion gauges, staggered reveals). Data flow, API calls and routes are unchanged; no new dependencies. A follow-up smoothness pass removed per-frame GPU hotspots (blob `filter: blur(90px)`, dark-mode `mix-blend-mode: screen`, per-card `backdrop-filter`) in favor of pre-feathered gradients and opaque frosted fills; only the sticky nav keeps a reduced backdrop blur. An adversarial review round then fixed: watch/save busy-state reset via try/finally, `MotionConfig reducedMotion="user"` for JS animations, route-transition remount removal (hero-only entrance), dark-mode secondary-text contrast tier bump, settings save error state machine, `freshness=unknown` status label, mobile nav active-pill scrollIntoView, anti-FOUC theme script in `index.html`, react-refresh warnings eliminated by splitting `format.ts`/`data.ts`, and a `test/ui-smoke.test.ts` renderToString guard (86/86 tests). Verification: `pnpm typecheck` passed, eslint on changed files 0 errors / 0 warnings, full test suite passed (86/86), `pnpm build` passed.
- 2026-08-15 frontend console-layout round (completed, locally verified): user-approved plan A (指挥台化) implemented — `app.tsx` left collapsible sidebar (localStorage memory) + global status topbar (活跃 HOT / 最后刷新 / 数据源混合度) + mobile bottom tab; `pages.tsx` dashboard HOT-first with stat strip, vessels/ports (inline congestion gauge)/voyages (delay column) as dense tables, feed (filter panel + source counts) and events (status × severity combined filters) as timelines, vessel/port/voyage details as two columns with related events/weather/voyages, calendar as left filter panel + 3-column cards; `globals.css` gained the console layout system and dropped the legacy glass-nav/hero-sheen/spotlight/detail-grid styles; `ui.tsx` no longer exports unused SpotlightCard/SectionHeading; `format.ts` added voyage status labels; brand logo background changed to sky blue `#0ea5e9` (`public/shipping-hot-icon.svg` and sidebar glow); standalone comparison prototypes live under `prototypes/` (offline HTML, outside the build). Data flow, API calls, routes, database and dependencies are unchanged. The current tree passes `pnpm typecheck`, targeted eslint and `pnpm test --run` after this closeout batch; `pnpm build` also passed (client + PWA + Nitro, `shared/updated-sources.ts` unchanged). Neat Freak skill instructions were loaded; its Bash-only inventory script remains pending because Bash is unavailable in this Windows environment, while the required manual equivalent audit found no secrets/database artifacts; the prior `.baseline-typecheck-fdf3191/` checkout metadata is now prunable and the matching temporary baseline worktree remains for review, while `prototypes/` remains user/other-agent content.
- 2026-08-15 sidebar rail follow-up (completed, verified): fixed the collapsed-sidebar header overflow (the collapse button was clipped half behind the logo) by moving the expand control to the sidebar footer and centering the logo / nav icons / provider dots in the 76px rail; the same fix is mirrored in `prototypes/`. The obsolete `.baseline-typecheck-fdf3191/` checkout metadata and matching temporary baseline worktree are retained as Neat Freak cleanup candidates; no cleanup was performed on them or `prototypes/`. Verification: typecheck passed, eslint on changed file 0/0, tests 136/136, build passed.
- 2026-08-17 Mock Isolation Final Fix (completed, locally verified; live pending): requested real modes no longer switch to Mock when AISStream or Calendarific configuration is missing; Store fallback reads are source-filtered for Vessel, Port, Weather, Calendar and Feed; Open-Meteo first failure excludes `mock-weather`; Portcast outputs only public dynamic fields and leaves missing fields unknown; Portcast first failure retains static identity only; public Feed excludes `mock-port-notice`; the top Provider summary includes official weather alerts and all-Mock detection includes Calendar. Added Provider, Store-boundary, Event Engine and UI-format tests. Verification: 146/146 tests, typecheck, targeted eslint, build and runtime matrix passed; live external calls remain pending.
- 2026-08-17 Shipping HOT Final Mock Isolation — AIS + Event Boundary (completed, locally verified; live pending): AIS now receives identity-only Watch Targets plus same-source AIS last-known observations; successful PositionReports emit only AIS-proven fields, same-source `statusChangedAt` continuity, identity-only/degraded results for missing MMSI or missed first observations, and source-aware Vessel merges. `status_changed_at` is nullable with an idempotent old-schema rebuild. Source-scoped Event identities let Mock/AIS histories coexist; current operational Event/HOT reads use Provider mode plus active registry source IDs, while SQLite retains incompatible historical Events and source switching does not resolve them. Empty real-mode seed snapshots therefore contain no Mock active Events/HOT. Verification: 161/161 tests passed; final typecheck, targeted lint, build, no-network runtime smoke, SQLite migration smoke and Neat Freak Closeout are recorded below; native SQLite and live external calls remain pending.
- 2026-08-17 Shipping HOT Calendar Operational Source ID Final Fix (completed, locally verified; live pending): Calendar configuration now returns actual provenance `calendarSourceIds` instead of composition option keys; Calendarific with a key activates `calendarific` + `official-holiday-source` + `manual-holiday`, missing-key Calendarific activates only `calendarific`, Official activates Official + Manual, and Manual activates Manual. Store Calendar reads and Calendar → Event → HOT operational filtering use the configured IDs, so retained incompatible Calendar history cannot surface in the current view. Verification: 165/165 tests, typecheck, targeted lint, build, offline provider/context/Store smoke, `git diff --check` and documentation closeout passed; full lint retains the four pre-existing errors, native SQLite and live external calls remain pending.
- 2026-08-18 Real Provider Trust Closeout (completed, corrected public re-probe verified): Portcast cache hits re-evaluate source age without refetching or changing the last real `fetchedAt`; Open-Meteo records each port's `fetchedAt` after both responses and JSON parsing; Shekou `/ywgg/` was re-probed with 5 `/ywgg/` items and zero `/gsxw/` leakage. Corrected public results: Portcast 8/8 (7 fresh, Nansha stale), Open-Meteo 8/8, Loadstar 10, Maritime Executive failed, Shekou parser verified. The local suite is 173/173.
- Blockers: Node 24.15.0 cannot load the bundled Node 22 native module, so Node 24 startup uses the documented in-memory fallback. Production Nitro subroutes reproduce the existing `#nitro/index` package-import runtime error; Vite development routes are healthy. Portcast/Open-Meteo/Shekou corrected public paths are verified; AISStream/Calendarific remain `pending_credentials` and official alert criteria remain pending. GitHub CLI account authentication remains invalid; Git HTTPS uses the repository-local OpenSSL backend because Windows Schannel failed with `SEC_E_NO_CREDENTIALS`.
- Verification: prior local gate `pnpm test --run` = 146/146; final AIS/Event batch `pnpm test --run` = 161/161; Calendar source activation batch `pnpm test --run` = 165/165; current Provider/live-path `pnpm test --run` = 173/173; current `pnpm typecheck`, targeted eslint, `pnpm build`, corrected public re-probe, no-network provider/context/Store smoke, Python stdlib SQLite migration smoke, `git diff --check`, `git status` and manual Neat Freak inventory passed; full `pnpm lint` retains four pre-existing errors in `server/api/shipping/settings.post.ts`, `shared/updated-sources.ts`, and `src/routes/__root.tsx`; `shared/updated-sources.ts` itself is unchanged; native better-sqlite3 remains pending.
- V2 status: `V2.0 sealed`; `V2.1 implemented`; `V2.2 implemented / locally verified / live pending`; `V2.3 implemented / locally verified / live pending`; `V2.4 implemented / locally verified / live pending`; `V2.5 not started`. Live external Provider calls remain optional; explicit Mock mode remains the default and real modes do not fall back to it.
- Neat Freak Closeout: manual equivalent completed against the loaded skill (rules, Markdown surfaces, stale claims, secrets, local database, residue and Git/worktree state); the official Bash inventory script remains pending/unavailable because Bash is not installed in this Windows environment. Cleanup candidates (`.data/db.sqlite3`, the prunable `.baseline-typecheck-fdf3191/` metadata, the temporary baseline worktree, and `prototypes/`) were reported and retained; no deletion was performed.

## 9. Recommended Next Action

Next: keep live external-provider verification pending and leave V2.5 explicitly not started. Separately, rebuild better-sqlite3 or use a compatible Node toolchain for native persistence verification. Optional UI follow-ups stay out of scope.

## 10. Knowledge Closeout Surface

| Fact surface | State | Evidence / limitation | Action |
|---|---|---|---|
| Code | changed-and-verified | Shipping HOT shared Domain, Provider orchestration, local Vessel/Voyage ownership merge, API validation, Repository paths, routes, UI and tests inspected; runtime-relative Mock fixture timestamps and Event Engine test determinism are covered by passing checks | Treat code/config as authority for current implementation |
| Runtime | changed-and-verified with native SQLite pending | No-network provider-mode smoke and SQLite migration SQL smoke passed; Node 24.15.0 has a native-module ABI mismatch and uses fallback | Keep native persistence and live external verification pending |
| Documentation | changed-and-verified with live caveat | Status, architecture and V2 roadmap record local gates, historical typecheck baseline, source contracts and live-provider limits | Keep live verification pending until public network/runtime access is available |
| Rules | changed-and-verified | Root `AGENTS.md` defines project guardrails, verification rules, architecture-change workflow, and mandatory task Closeout; no project `CLAUDE.md` or override; global Codex `AGENTS.md` is empty | Use `AGENTS.md` as the project entry point |
| Memory | not-applicable | No project memory store or user-authorized memory write was identified | No memory files changed |
| Workspace | changed-and-verified with retained cleanup candidate | Manual Neat Freak-equivalent inventory found no other-agent rule artifacts, no tracked database/env artifact, and the final `git status` is recorded at closeout; ignored `.data/db.sqlite3`, `dist`, the prunable baseline worktree metadata and its temporary baseline worktree remain local artifacts; `prototypes/` and `screenshots/` remain user workspace content | Review the final `git status`; no cleanup performed without explicit confirmation |

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
