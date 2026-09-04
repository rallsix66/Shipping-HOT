# Project Status — Shipping HOT / NewsNow Foundation

> Snapshot date: 2026-09-04
> Current state authority: this rebaseline section. Dated sections below are historical checkpoints unless explicitly marked current.

## Current V3 State — 2026-09-04

| Item | Current state |
|---|---|
| Current Project Phase | `V3 — FINAL SEALED` |
| Current Git Head | Final P7 seal commit on `codex/shipping-hot-v3-real-data`; exact SHA is recorded in the completion report and verified against `origin` |
| P7 Entry Git Head | `4824d63f8e135ff3c9eb0849d9ba49e832ae000c` — `docs: rebaseline v3 state for p7 entry` |
| Business-code baseline | `f7281c7ea58444dc3b2d55930d0069c45055cab8` — `fix: preserve persisted feed lifecycle on reads` |
| Branch | `codex/shipping-hot-v3-real-data` |
| Schema | `v12`; migration changes in this review: none |
| Toolchain | Node `24.15.0`, ABI `137`, `better-sqlite3@12.6.2` |
| Operational Mode default | Mock; Real Mode remains explicit and fail-closed |
| Retained DB / Secret / env | Retained `.data/shipping-hot-v3.sqlite3`, Secrets and committed env were not changed; P7 used only process-scoped env and `.data/p7-final-seal-20260904.sqlite3` |
| External Provider calls | P7-D used only existing approved adapters; DeepSeek `0`; no Schedule endpoint, JMA, Maritime Executive or new Provider was called |

### Core Sealed Foundations

- P0 Persistence: `SEALED`; SQLite is the Shipping HOT persistence truth.
- P1 Port Directory / Mock Isolation: `SEALED`; the formal directory remains the eight-port baseline and Real Mode reads only `real|imported|derived` lineage.
- P2 Search / Identity / Runtime: `SEALED`; GFW is the accepted Vessel Search/canonical identity provider path, with provider-free repository reads.
- P3 Feed Freshness: `SEALED`; persisted `visibility`, `current_until` and `source_type` are the canonical lifecycle projection. Read hydration never re-runs `applyFeedFreshnessPolicy()`, explicit `history`/`quarantine` cannot reactivate, and read-time expiry is non-mutating.
- Home Feed-HOT display: `SEALED`; original Feed facts are ranked first, then only Feed-kind HOT presentation receives cached display enrichment.
- Translation Runtime Mode Decoupling and Placeholder Reliability: `SEALED`; row-level `translation_placeholder_changed` is non-circuit-blocking, while `provider_contract_changed` keeps Provider-level circuit semantics.
- Translation Settings UI: `IMPLEMENTED / VERIFIED`; fixed DeepSeek/model/target, budget and usage/cache state, redacted Secret metadata, safe write/delete and fixed harmless test are exposed without returning an API key.
- Root UI devtools: removed from `src/routes/__root.tsx`; no React Query or TanStack Router floating debug widgets remain.

### Verified Live Capabilities

- GFW Vessel Search / canonical identity: `VERIFIED_LIVE`.
- AIS PositionReport continuous tracking: `VERIFIED_LIVE`.
- AIS Area: `VERIFIED_LIVE` through its independent persisted metric and restart evidence.
- Port Intelligence / Portcast public-page path: `VERIFIED_LIVE`, with limited coverage.
- Open-Meteo Weather: `VERIFIED_LIVE`.
- Official Weather Alerts: `VERIFIED_LIVE` for enabled TMD/BMKG source Jobs; JMA remains `LIVE_PENDING`/disabled.
- VesselAPI Voyage/ETA Provider path: `VERIFIED_LIVE`; this is separate from focus-port operational coverage.
- DeepSeek Provider and automatic Translation Runtime: `VERIFIED_LIVE` based on accepted credential/connectivity, runtime, cache, recovery and Feed UI evidence. Translation remains optional enrichment; this does not silently promote the separate T3D browser/server finalizer beyond its accepted evidence.

### Partial / Coverage Pending

- Voyage operational focus-port coverage: `COVERAGE_PENDING / PARTIAL`; accepted destination `CNYPG` is outside the current Port Directory mapping. This is a coverage gap, not a Provider-path failure.
- Calendar: `IMPLEMENTED / COVERAGE_PENDING`; Calendarific persistence is verified, while full current+next-year and official/manual completeness remain open.
- Official Weather Alerts: enabled TMD/BMKG are live; JMA and geographic/focus-port association coverage remain partial.
- Port Intelligence, Weather and Feed: provider paths are live, but public-source/geographic coverage remains bounded and must be accepted explicitly.
- P7 Final Real-data Seal: `SEALED`; controlled Real Mode readiness is `ready=true / overall=degraded` with no failed hard checks, and approved coverage gaps remain explicit rather than inferred.

### Optional / Out of Scope

- Translation scope is FeedItem `title`/`summary` only, with Chinese-first Feed UI and `查看原文`; Home HOT enriches only `kind="feed"` display text.
- Event HOT Translation is `OUT_OF_SCOPE`; Event/HOT facts, severity, dedupe, freshness, relevance and ranking continue to use original facts.
- Commercial Schedule is `NOT CONFIGURED / ENTITLEMENT-DEPENDENT`; AIS/VesselAPI ETA is not carrier schedule. The UI must remain explicitly unavailable without Mock schedule data.
- Translation is outside the REAL_OPERATIONAL hard-readiness gate.

### Current P7 Final Seal Status

`P7-A` through `P7-G` are complete. The final controlled Real Mode acceptance passed the required Runtime → SQLite → Repository → API → Readiness boundaries; Event/HOT evidence, restart persistence, schema-discovered zero-Mock scans and the required browser routes passed. Readiness is intentionally `overall=degraded` only for approved coverage-pending capabilities; no hard check is blocked.

### P7 Final Real-data Seal — 2026-09-04

`V3 — FINAL SEALED` is the current project state. P7-A through P7-G are complete on branch `codex/shipping-hot-v3-real-data`.

| Gate | Final evidence |
|---|---|
| P7-B capability review | Voyage Provider path `VERIFIED_LIVE`; Voyage focus-port `COVERAGE_PENDING / PARTIAL`; Calendar `IMPLEMENTED / COVERAGE_PENDING`; TMD/BMKG `VERIFIED_LIVE`, JMA `LIVE_PENDING / disabled`; Commercial Schedule `NOT CONFIGURED / ENTITLEMENT-DEPENDENT`; Portcast public coverage limited; Translation `SEALED + VERIFIED_LIVE` optional; Event/HOT Translation `OUT_OF_SCOPE`. |
| P7-C decisions | No Port Directory expansion, no `destinationPortId` fabricated for `CNYPG`, no Schedule entitlement assumed, no JMA activation, no new Provider/schema/Secret. Approved gaps are non-blocking coverage boundaries. |
| P7-D activation | Existing `pnpm smoke:v3-real-activation` in process-scoped `SHIPPING_DATA_MODE=real`, `SHIPPING_VOYAGE_PROVIDER=vesselapi`, and temporary `.data/p7-final-seal-20260904.sqlite3`: 10 Jobs registered, Voyage safely skipped with `no_eligible_voyage_targets`, AIS Area safely skipped with `no_eligible_ais_area_ports`, Loadstar 10, Shekou 5, Calendar 259, Port 8, Weather 5, TMD 8 and BMKG 3 records written; Translation skipped `translation_disabled`. Exit `0`. |
| REAL_OPERATIONAL readiness | Existing `pnpm smoke:v3-readiness` against the same temporary DB: `ready=true`, `overall=degraded`, all hard checks pass, exact approved Job set, Node `24.15.0` / ABI `137`, pnpm `10.30.3`, better-sqlite3 `12.6.2`, schema `v12`. The degraded result is only approved capability coverage. |
| Event/HOT Real Evidence Gate | Provider-free API read returned 14 derived Events / 5 active Events and 2 HOT items. Active Event evidence was real third-party/derived (`open-meteo-marine` and `the-loadstar`); no Mock or mixed lineage entered operational Event/HOT. Original Feed facts remain ranking inputs. |
| Restart + read-only boundary | A new process read back Port 8, Feed 31, Feed history 62, Events 13 and Calendar 259 from the temporary DB; GET/API/UI reads did not add sync runs or call Providers. |
| Zero-Mock before/after | Schema-discovered scan before shutdown, after restart and after UI/API reads reported `actualMockRows.total=0` across all 13 `source_type` business tables. Retained `.data/shipping-hot-v3.sqlite3` was not opened. |
| UI acceptance | `/`, `/vessels`, `/ports`, `/voyages`, `/feed`, `/calendar`, `/settings` and `/events` rendered without loading/error state. Feed showed 33 `查看原文` disclosures and simulated count `0`; Schedule was `unavailable`; Settings exposed fixed DeepSeek metadata with redacted Secret only. Browser console errors/warnings: `0`; React Query/TanStack Devtools: `0`. |
| Translation boundary | Temporary Real DB settings remained `enabled=false`, monthly budget `0`; DeepSeek usage `0`. No new DeepSeek call was required or made by the final acceptance. Feed title/summary enrichment remains optional; Event/HOT translation remains out of scope. |
| Verification | P7 targeted suite: 20 files / 207 tests passed. Full Vitest: 726/727 tests, 63/64 files; the only failure is the pre-existing isolated dated Shekou assertion at `server/providers/feed.test.ts:156`, not changed in P7. `pnpm typecheck`, `pnpm lint`, `pnpm build` and Neat Freak closeout are recorded below. |

Known coverage gaps remain explicit:

- Voyage focus-port coverage is partial for destinations outside the approved Port Directory.
- Calendar official/manual completeness remains partial.
- JMA remains disabled/live-pending.
- Commercial Schedule remains unavailable without approved carrier entitlement.
- Public Port/Weather/Feed coverage remains source-bounded.

These coverage boundaries do not use Mock fallback and do not fabricate operational facts. Translation is `VERIFIED_LIVE` optional FeedItem title/summary enrichment and remains outside the Real Operational hard-readiness gate. No new Provider, paid entitlement, schema migration or Secret was introduced. Post-V3 enhancements require separate approval.

### P7 Final Blocker Matrix

| Capability | Current State | Hard Blocker? | Coverage Gap? | Final Decision |
|---|---|---|---|---|
| Vessel Search | `VERIFIED_LIVE` (GFW) | No | No for accepted provider path | Included in final provider-free evidence |
| AIS Position | `VERIFIED_LIVE` | No | Yes, watchlist/target dependent | Accepted historical live evidence retained |
| AIS Area | `VERIFIED_LIVE` | No | Yes, bounded focus-port sampling | Accepted historical live evidence retained; current empty target is explicit |
| Port Directory | `SEALED` | No | No for current eight-port baseline | Eight-port directory unchanged |
| Port Intelligence | `VERIFIED_LIVE` | No | Yes, public-page coverage limited | Uncovered ports remain unavailable |
| Weather | `VERIFIED_LIVE` | No | Yes, provider/port coverage bounded | Source-bounded data only |
| Official Weather Alerts | `PARTIAL / VERIFIED_LIVE for TMD/BMKG` | No | Yes, JMA/geographic association | TMD/BMKG enabled; JMA disabled/live-pending |
| Feed | `SEALED / VERIFIED_LIVE` source Runtime | No | Yes, public-source coverage bounded | Loadstar/Shekou accepted; no Mock fallback |
| Calendar | `IMPLEMENTED / COVERAGE_PENDING` | No | Yes, current+next-year and official/manual completeness | Calendarific transport/persistence accepted; completeness remains partial |
| Current Voyage | `VERIFIED_LIVE` provider path / `PARTIAL` coverage | No | Yes, `CNYPG` focus mapping | No port expansion; no fabricated destination ID |
| Commercial Schedule | `NOT CONFIGURED / ENTITLEMENT-DEPENDENT` | No | Yes | UI/API unavailable; no Mock schedule |
| Translation | `SEALED + VERIFIED_LIVE` optional enrichment | No | No for approved Feed scope | Outside hard gate; Event/HOT translation out of scope |
| Event/HOT | Real evidence gate passed | No | Source-bounded | Original facts/evidence/ranking accepted |
| Readiness | `ready=true / overall=degraded` | No | Inherits approved coverage gaps | No failed hard checks |
| Restart Persistence | Final temporary DB readback passed | No | No | Runtime → SQLite → Repository readback accepted |
| Zero-Mock | Final scans passed | No | No | `actualMockRows.total=0` before/after restart/UI |

### P7 Execution Order

1. `P7-A — Current State Rebaseline` — complete.
2. `P7-B — Real Operational Capability Gap Review` — complete.
3. `P7-C — Remaining Coverage Decisions` — complete.
4. `P7-D — Controlled Real Mode Full-System Acceptance` — complete.
5. `P7-E — Event / HOT Real Evidence Gate` — complete.
6. `P7-F — Final Chinese UI + Restart + Zero-Mock Acceptance` — complete.
7. `P7-G — V3 Final Seal` — complete; post-V3 enhancements require separate approval.

### P7-G Closeout Evidence — 2026-09-04

| Closeout item | Result |
|---|---|
| `git diff --check` | Passed; only normal Git LF→CRLF warnings were emitted for existing text files |
| Typecheck | `pnpm typecheck` passed |
| Lint | `pnpm lint` passed |
| Test | Targeted P7 suite: `20 files / 207 tests passed`; full Vitest: `63/64 files`, `726/727 tests`; only the pre-existing isolated dated Shekou Event/HOT assertion at `server/providers/feed.test.ts:156` fails |
| Build | `pnpm build` passed through Vite/PWA/Nitro; existing npm config, Browserslist and Node dependency deprecation warnings are non-blocking |
| Neat Freak | Manual Windows-equivalent audit completed for rules, code/status alignment, Markdown surfaces, ADR/roadmap state, secrets, local databases, temporary residue and Git/worktree. Official Bash inventory remains `pending/unavailable` because `bash` and `scripts/audit-inventory.sh` are unavailable; no cleanup was performed |
| Cleanup boundary | `.data/p7-final-seal-20260904.sqlite3` and `.data/shipping-hot-v3-browser.sqlite3` remain ignored cleanup candidates pending explicit confirmation; retained `.data/shipping-hot-v3.sqlite3`, `.env.local`, provider secret metadata, `dist/`, `prototypes/` and `screenshots/` were preserved |

> Historical snapshots below preserve the facts that were true at their checkpoint dates. They do not override the current state above; in particular, older `DeepSeek live verification pending`, zero-call and disabled-budget statements are historical, not current-state claims.

## Feed Persisted Lifecycle Read Semantics Repair — 2026-09-04

- `ShippingRepository.listFeedItems()` now treats SQLite `feed_items.visibility`, `current_until` and `source_type` as the canonical persisted lifecycle projection. Read hydration overlays those columns onto `data` and never re-runs `applyFeedFreshnessPolicy()`.
- `view="current"` selects only persisted current rows with a valid `current_until` strictly after `now`; `view="history"` also includes persisted-current rows whose canonical window is null, invalid or expired. Natural expiry is projected as effective `history` with `eventEligibility=false` and `stale=true` without updating SQLite. Explicit `history` and `quarantine` rows cannot be reactivated, including when `current_until` is in the future. `view="all"` hydrates every row with the same canonical/effective rules, and current/history returned visibility invariants are enforced after hydration.
- Retained Feed rows were not backfilled, schema remains v12, and no migration was added. Feed write paths, `archiveFeedItemsNotIn()`, `feed_item_history` snapshot semantics, Translation, HOT ranking, Event rules, Provider behavior and Readiness governance were not expanded.
- Isolated Repository lifecycle tests cover current/history/quarantine, natural expiry, equality boundary, null/invalid `current_until`, canonical column/JSON mismatch, canonical `currentUntil` override, invalid persisted visibility, archive/reappearance and read-only no-mutation behavior. The targeted cross-layer regression suite passed `120/120`; serialized full Vitest passed `726/727`, with the sole failure the pre-existing date-sensitive Shekou Event/HOT assertion at `server/providers/feed.test.ts:156`. The AIS area retry-budget test passed `30/30` in isolation; parallel full runs can exhibit its existing timing-sensitive socket-count flake.

## UI Cleanup — Remove Bottom Debug / Floating Widgets — 2026-09-04

- Removed the dev-only `TanStackRouterDevtools` bottom-right badge and `ReactQueryDevtools` bottom-left launcher from the root route. Both were project-owned components mounted in `src/routes/__root.tsx`; no layout, style, route, business, Translation, Runtime, Provider, API, settings, schema, migration, Secret or retained SQLite behavior changed.
- Browser read-only verification loaded `/`, `/vessels`, `/ports`, `/voyages`, `/feed`, `/calendar` and `/settings`. Every route rendered the existing console shell, both TanStack/React Query widget selector groups returned zero, and console errors were `0`. UI smoke passed `12/12`; typecheck, lint, build and `git diff --check` passed. Full Vitest remained `725/726`, with only the existing date-sensitive `server/providers/feed.test.ts:156` failure.

## Post-T3 Home HOT Translation Display Repair — 2026-09-04

- The `/api/shipping` display boundary now materializes `displayFeedItems` once, ranks HOT from the original `snapshot.feedItems`, then enriches only `kind="feed"` HOT `title`/`summary` through a Map keyed by `feedItemId`. Feed HOT without a successful cache entry falls back to the original text; pending, failed and source-changed display states never surface placeholder/error text.
- Event HOT items are returned unchanged, even when an event is associated with a translated Feed item. HOT order, severity, dedupe identity, relevance, freshness, `eventEligibility` and Event derivation remain owned by the original-fact calculation path; `rankHotItems()` and the shared HOT rules were not changed.
- The repair is provider-free and read-only: it reuses the existing `FeedItemDisplay` batch result, introduces no second cache-selection path or N+1 lookup, and does not call TranslationService execution, SecretStore/provider, Translation Runtime, DeepSeek or T3D. No Translation scope, eligibility, settings, schema, migration or retained SQLite data changed; schema remains v12. The Feed page and its `查看原文` disclosure remain the original-text surface; Home HOT received no UI redesign or new disclosure control.
- Verification: Home HOT/API/display and HOT-rule targeted tests passed `64/64` across 5 files; Translation/T3B/T3C regression passed `151/151` across 13 files; Shipping read-boundary tests passed `6/6` across 3 files; UI smoke passed `12/12`. Typecheck, lint, build and `git diff --check` passed. Full Vitest passed `725/726` tests across `63/64` files; the only failure remains the unrelated date-sensitive `server/providers/feed.test.ts:156` Shekou Event/HOT assertion.
- Browser read-only verification on the retained Web session loaded `/` with 7 HOT cards and `/feed` with `displayTitle`/`displaySummary` plus 14 `查看原文` disclosures and no reported console errors. The current retained HOT sample contains the translated CINS record as `kind="event"`, so it correctly stays in original English under the Event-HOT boundary; the same Feed record displays its cached Chinese title in the Feed list. No DeepSeek or Translation Provider call was made. The ignored `.data/shipping-hot-v3-browser.sqlite3` remains retained pending explicit cleanup confirmation; official Bash inventory remains unavailable on Windows, so Neat Freak uses the required manual equivalent audit.

## Post-T3 Translation Placeholder Reliability Repair — 2026-09-03

- Translation T3 remains formally sealed; this is a post-T3 reliability repair, not a T4 scope expansion. Placeholder transport tokens now use short opaque markers of the form `__SH_<index>_<10 uppercase hex>__` (under 24 characters). The marker digest is derived from source text, literal value, index and a collision nonce; generated markers are checked against source text and prior markers, and marker-like source literals are protected as data.
- Restoration is strict and exact: every expected marker must occur exactly once, unknown/mutated markers, missing or duplicated markers, residual marker-like text and unprotected collisions fail closed with row-level `translation_placeholder_changed` / `translation placeholders changed`. The code is intentionally not a `ProviderFailureCode`, is non-retryable and is excluded from circuit-blocking classifications; true `provider_contract_changed` responses retain their existing Provider-level circuit behavior.
- Ordinary runtime processing persists the failed cache row, does not open the Provider circuit and continues to the next eligible field/run. The shared Mock Feed guard remains fail-closed, so Mock Feed text cannot create a source, claim, cache row, usage record or DeepSeek call. The DeepSeek system prompt also requires every Shipping-HOT placeholder token to be copied byte-for-byte exactly once.
- A blocked periodic Translation skip now preserves the existing safe runtime `errorMessage`. Blocked diagnostics remain usage-only Provider probes: no translation-cache write, clear/requeue, circuit recovery or runtime mutation; the existing budget, Secret and Provider gates remain effective.
- T3D governance is unchanged: Real Mode eligibility, fixed diagnostic/current Feed phases, hard maximum of two external calls, browser/server evidence separation and existing retry/backoff/circuit semantics remain intact. The new row-level code is recognized by shared policy without being coerced into `provider_contract_changed`.
- Verification: the repair-targeted suite passed `107/107` tests across 6 files; the full suite passed `715/716` tests across `62/63` files, with only the pre-existing date-sensitive `server/providers/feed.test.ts:156` Shekou Event/HOT assertion failing. An isolated AISStream timing test passed `30/30`. `pnpm typecheck`, `pnpm lint`, `pnpm build` and `git diff --check` passed.
- Schema remains v12 and no migration, settings, Secret, environment or retained SQLite change was made. No external DeepSeek call was made; all new runtime tests use Fake Provider/Fake SecretStore/temp SQLite evidence. The official Bash inventory is unavailable on Windows; the required manual Neat Freak closeout found no code/docs/rules blocker, and cleanup candidates remain pending explicit confirmation.

## Post-T3 Translation Settings UI — 2026-09-03

- Translation T3 remains formally sealed. This product-layer slice adds the AI 翻译 section to `/settings` without changing `sourceHash`, cache identity/selection, claim/finalize lifecycle, retry/backoff, circuit policy, T3D runner, Feed/Event/HOT facts or Readiness semantics.
- The UI reads the existing Shipping settings, `GET /api/shipping/translation/status` and redacted `GET /api/shipping/translation/secret`. It exposes only the current DeepSeek provider, `deepseek-v4-flash` model and `zh-CN` target; provider/model are read-only, the automatic-translation switch defaults from persisted settings and does not auto-save, and saving settings never includes an API Key.
- `POST /api/shipping/translation/secret` accepts only a trimmed non-empty `apiKey` of at most 4096 characters and returns redacted metadata. `DELETE /api/shipping/translation/secret` removes only a file-managed DeepSeek secret; environment-managed `DEEPSEEK_API_KEY` remains immutable and returns `409 managed_by_environment`. The raw key is never rendered, returned, logged by the UI or written to settings/usage.
- Translation status now reports `provider_blocked` only when `RuntimeRepository.getProviderRuntime("deepseek", "translation")` satisfies `isProviderCircuitBlocked()`, after disabled/budget/secret gate precedence. The Settings UI maps disabled, zero/exhausted budget, missing secret, blocked Provider and ready states to safe Chinese labels and displays current usage/cache aggregates without creating a dashboard.
- The “测试连接” button submits only `{}` to the existing fixed harmless `POST /api/shipping/translation/test` contract. It never exposes T3D acceptance, accepts no prompt/source input, does not start ordinary `translation-sync`, and does not auto-enable Translation. Current retained settings remain `enabled=false`, `monthlyBudget=0`; this implementation caused `0` external DeepSeek calls.
- Verification: Translation Settings/Secret targeted tests passed `24/24` (including five route-level Secret API tests); Translation/T3A–T3D regression passed `123/123`; `/settings` browser verification found all required controls, confirmed `OFF`, empty password input, no raw key text and zero browser error logs; the disabled test gate returned the safe Chinese prompt without a Provider call. Full Vitest passed `695/696` tests across `62/63` files; the sole failure remains the pre-existing date-sensitive `server/providers/feed.test.ts:156` Shekou Event/HOT assertion. `pnpm typecheck`, `pnpm lint`, `pnpm build` and `git diff --check` passed.
- Schema remains v12; migration changes are `none`; Secret changes to repository/runtime configuration are `none`; `.env.local` and retained production Secret files were not modified; external DeepSeek calls are `0`. Official Neat Freak Bash inventory remains `pending/unavailable` on Windows; the manual audit found no blocker. The ignored `.data/shipping-hot-v3-browser.sqlite3` verification copy remains pending explicit cleanup confirmation.

## Translation Runtime Mode Decoupling — 2026-09-03

- Ordinary `translation-sync` is now registered and schedulable in both global `SHIPPING_DATA_MODE=mock` and `SHIPPING_DATA_MODE=real`; its default Job enablement no longer depends on global data mode. The Job re-reads Translation settings, monthly usage, Secret availability and Provider circuit state on every run, so Settings/ budget/ Secret changes do not require recreating the Job or restarting Node.
- Removing the ordinary Runtime Real Mode gate does not open Mock Feed to DeepSeek. Provider candidates are filtered before source creation and must have explicit persistence lineage `source_type=real|imported|derived`, while `source_type=mock`, Mock provenance or Mock evidence is fail-closed. Mock Feed therefore creates no source, claim, pending cache row, Provider call, usage record or estimated cost, and does not consume the five-field limit.
- Global Mock Mode still controls Shipping Repository/Provider behavior for the main system. In that mode, an explicitly non-mock current Feed can pass the independent Translation gates and be translated by the fixed DeepSeek Provider; the original Feed facts and T3B/T3C provider-free read/display semantics remain unchanged. T3D acceptance remains separately governed by its existing current-real-candidate and Real Mode requirements.
- Verification: Translation service/runtime/registry targeted tests passed `38/38`; `pnpm run typecheck`, `pnpm run lint` and `pnpm run build` passed. Full Vitest passed `700/701` tests across `62/63` files; the sole failure remains the pre-existing date-sensitive `server/providers/feed.test.ts:156` Shekou Event/HOT assertion. This task used only isolated Fake Provider/Fake SecretStore tests, made no migration/Secret/environment/database change and made `0` external DeepSeek calls. Neat Freak Closeout completed the Windows manual equivalent audit; the official Bash inventory script remains unavailable/pending and no cleanup was performed.

## V3 Translation T3B/T3C/T3D — Feed Read, UI and Acceptance Engineering + Formal Seal — 2026-09-03

- T3B is implemented at both `GET /api/shipping/feed` and `GET /api/shipping`. The API adds `FeedItemDisplay.displayTitle`, `displaySummary` and per-field `translation` state while retaining original `title`/`summary`. `TranslationRepository.findSuccessfulBatch()` reads bounded chunks of at most 100 five-part identities, selects current `deepseek/deepseek-v4-flash` success first, then deterministic historical success, and reports current-provider pending/failed states without selecting them. No Provider, SecretStore or write path is constructed by the Feed display mapper.
- T3C is implemented in the Feed page and Feed previews: successful current or historical translations are Chinese-first, “查看原文” exposes the original title/summary, and original/pending/unavailable content remains readable. Event/HOT cards continue to consume their original derived facts; ranking inputs are computed before Feed display enrichment.
- T3D acceptance engineering is implemented and formally sealed as a bounded executable runner with fixed `TRANSLATION_TEST_SOURCE_TEXT`, fixed DeepSeek endpoint/model contract, explicit settings/secret/budget/circuit/Real Mode gates and `maxExternalCalls=2`. Phase 1 calls `TranslationService.execute()` exactly once and validates response/usage arithmetic, literal placeholders, wrapper boundary, cost and `source_scope=translation_test|mixed`; Phase 1 blocking failures persist through the existing provider circuit, while transient failures remain non-blocking. Phase 2 selects one deterministic current eligible real Feed `title`/`summary` candidate, re-gates, claims durable work, executes once, and finalizes cache plus provider usage atomically. Retryable Phase 2 failures use the shared T3A `1m,2m,4m,8m,16m,32m,60m...` policy from the claimed retry count and failure completion time. It never runs ordinary `translation-sync`, processes backlog, retries or auto-falls back. Server acceptance and browser UI evidence remain separate; only the matching browser finalizer can promote `verified_live`. The current retained database preflight is disabled, monthlyBudget `0`, no DeepSeek secret/runtime evidence, so live verification is `pending` and external DeepSeek calls are `0`. No further T3 implementation is authorized by this seal.
- Verification coverage includes exact/historical/original selection, pending/failed fallback, source-change isolation, disabled-cache read, bounded batch query count, Feed eligibility, Chinese-first UI/original disclosure, safe pending status, T3D two-call counter, accepted/rejected diagnostic usage scopes, shared backoff parity and retry timing, Phase 1 circuit classification, Phase 1 failure stop, exact-cache/no-candidate stop, Phase 2 re-gate/source-change stop, success/failure persistence, restart readback and browser evidence separation. Fake Provider is used only in mocked runner tests and cannot produce Real Mode or Readiness evidence. Migration changes in this task: `none`; Secret changes: `none`; automatic Provider fallback: not implemented; Calendar/Event/HOT/Voyage/Port/Weather/AIS/Vessel translation: not implemented.
- Final verification: targeted T3D repair tests passed `53/53` tests across 3 files; Translation/T3A–T3D regression passed `190/190` tests across 11 files; full Vitest passed `685/686` tests across `60/61` files. The sole failure remains the pre-existing date-sensitive `server/providers/feed.test.ts:156` Shekou Event/HOT assertion; no Feed/Event/HOT code was changed for that failure. `pnpm typecheck`, `pnpm lint`, `pnpm build` and `git diff --check` passed. Nitro browser verification of `/feed` loaded 17 current Feed items, rendered original Feed text, showed no translation disclosure because the isolated current cache had no successful translation, and reported zero console errors. Official Neat Freak Bash inventory remains `pending/unavailable` on Windows; the manual Windows audit found no code/docs/secret blocker, but the temporary ignored `.data/shipping-hot-v3-browser.sqlite3` browser database is retained pending explicit cleanup confirmation.

## Historical V3 Translation T3A Review Repair checkpoint — 2026-09-03

- Per-field lease timestamps now use a fresh `claimAt` immediately before each transactional claim. Every lease is exactly `claimAt + 45s`, independent of the job start time; retry scheduling uses the Provider failure completion time, and the Provider timeout remains 20 seconds.
- Fixed diagnostic tests retain ordinary T2 behavior when the circuit is open. When the persisted DeepSeek Translation circuit is blocked, the fixed harmless test enters recovery diagnostic mode, bypasses any old successful `translation_test` cache, performs exactly one `TranslationService.execute()` Provider attempt under the shared Translation mutex, records `provider_usage` with `source_scope=translation_test`, and does not write `translation_cache`.
- Recovery diagnostic success or failure never clears the provider circuit or requeues Translation work. Budget and SecretStore gates remain effective; blocked plus exhausted budget or missing secret makes zero Provider calls. Fixed input and `TEST STAR` protection remain unchanged.
- At this historical T3A Review Repair checkpoint, T3B Feed Read, T3C UI and T3D DeepSeek Live Acceptance had not started; the current T3B/T3C/T3D state is recorded above. Neat Freak official closeout is `pending` because the Bash inventory script is unavailable in this Windows environment; the required Windows/manual audit found no blocker.
- Verification: T3A Review Repair targeted suite passed `121/121` tests across 7 files; full Vitest passed `633/634` tests across `57/58` files. The only failure remains the pre-existing date-sensitive `server/providers/feed.test.ts:156` Shekou Event/HOT assertion; no Feed/Event/HOT code was changed. Typecheck, lint, Vite/Nitro build and `git diff --check` passed. Migration = v12 unchanged in this repair; Secret changes = none; external DeepSeek calls = 0.

## V3 Translation T3A Runtime Foundation — 2026-09-02

- T3A is complete and stopped at the approved Runtime Foundation boundary. `translation_cache` migration 012 adds only `retry_count`, `next_retry_at`, `retryable`, `lease_until`, `last_error_code` and the durable work-state index; migration is additive/idempotent, was smoke-tested against a temporary legacy cache, and the retained `.data/shipping-hot-v3.sqlite3` was not modified.
- `TranslationRepository` is the only durable work-state owner. It provides transactional claim/lease ownership, exact-success exclusion, retry-due checks, atomic success/retry/non-retry finalization with per-call `provider_usage`, stale lease recovery as row-level `provider_attempt_unknown`, bounded explicit requeue, deterministic historical cache selection and restart persistence. `TranslationService.execute()` is execution-only; legacy `translate()` remains T1/T2 compatibility.
- `translation-sync` scans only eligible current FeedItem `title`/`summary`, orders deterministically, processes at most 5 fields per run at concurrency 1, applies disabled/provider/model/secret/monthly-budget gates before every call, uses the fixed server-side DeepSeek adapter with a 20-second timeout, and never writes translation text back into Feed/Event/HOT/Voyage/Port/Weather facts. Fake Provider is test-only and is never created by the Real registry.
- Permanent `auth_failed`, `provider_forbidden`, `entitlement_missing` and `provider_contract_changed` failures persist a provider-level circuit in `provider_runtime`; transient `rate_limited`, `provider_timeout` and `provider_unavailable` failures use bounded retry/backoff only. `provider_attempt_unknown` remains row-level and never opens a provider circuit. Clear and requeue are explicit operations; diagnostic fixed-input tests share the process-local Translation mutex and do not auto-unblock/requeue.
- T3A keeps Translation outside the REAL_OPERATIONAL hard gate. Feed ingestion/read, Event/HOT facts, source lineage, freshness, severity, ranking, dedupe and evidence remain independent. No Translation API/UI, Feed display DTO, arbitrary test API, usage dashboard, additional provider, automatic fallback, live call or `.env.local`/Secret change was added.
- Verification: This is the pre-repair T3A checkpoint: targeted tests passed `117/117`; full Vitest was `629/630` tests with the pre-existing isolated `server/providers/feed.test.ts` dated Shekou Event/HOT assertion failing; no Feed/Event/HOT code was changed. The 2026-09-03 Review Repair supersedes its lease/diagnostic implementation details. Neat Freak official closeout for the current repair is pending because Bash inventory is unavailable. Migration = v12 only; Secret changes = none; external DeepSeek calls = 0.

## V3 Translation T1 Foundation + Review Repair — 2026-09-02

- T1 implements only the no-network foundation for FeedItem `title` and `summary`: deterministic versioned `sourceHash`, SQLite-backed `TranslationRepository`, `TranslationService`, and a deterministic local `FakeTranslationProvider`.
- The Service owns hash identity using `translation-faithful-v1`, NFKC plus CRLF/LF normalization and deterministic BCP47 canonicalization. Provider-free display reads use `TranslationPreference` metadata for exact current provider/model success, then deterministic historical success; translation execution checks only the current Provider/model exact success, calls that Provider on a miss and persists a new row. Provider/model/entity identity is excluded from `sourceHash`; provider adapters return translated content only.
- Translation remains enrichment: no Feed original field, Event/HOT fact, Voyage/Port fact, source lineage, freshness, severity, ranking, dedupe or evidence is changed. Automatic Feed scope accepts only eligible current items and the `title`/`summary` fields.
- Fake Translation is test-only and is not registered in Background Runtime or V3 Readiness; it cannot be Real Mode or Readiness evidence. Content reads remain provider-free through the cache-only Service path.
- No migration changed (`migration = none`), no SecretStore/configuration change was made (`Secret changes = none`), and external Translation/AI Provider calls were `0`. T1 does not include real Providers, `translation-sync`, usage/cost accounting, Translation API/UI, Settings UI, Calendar/Event/HOT integration or automatic fallback.
- Targeted T1 tests passed `11/11`. Full Vitest passed `578/579` tests across `52/53` files; the single failure is the pre-existing date-sensitive `server/providers/feed.test.ts` Shekou Event/HOT assertion, unrelated to the Translation diff and retained without changing Feed/Event/HOT code. Node/App typecheck, full lint and Vite/Nitro build passed. T1 Review Repair remains locally verified with that unrelated full-suite baseline failure explicitly retained.

## V3 Translation T2 Real Provider Foundation — 2026-09-02

- T2 implements only the DeepSeek server-side Provider Foundation. `createDeepSeekTranslationProvider()` calls the official `POST https://api.deepseek.com/chat/completions` contract with fixed model `deepseek-v4-flash`, `thinking.type=disabled`, `stream=false`, faithful-translation instructions and strict response/usage validation; no SDK and no other real Translation Provider are included.
- The current official price snapshot is USD, not the earlier CNY planning snapshot: for `deepseek-v4-flash`, off-peak rates are `$0.007` cache-hit / `$0.22` cache-miss / `$0.66` output per 1M tokens, and peak rates are `$0.014` / `$0.44` / `$1.32`. Cost is labeled local estimate with pricing reference `deepseek-official-2026-09-02`; no FX conversion is invented. See the [official DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/) and [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) pages.
- Translation settings are JSON-backed in the existing `settings` row and default to `enabled=false`, `providerId=deepseek`, `model=deepseek-v4-flash`, `targetLanguage=zh-CN`, `monthlyBudget=0`; no migration was added. `FileSecretStore` maps only metadata/access to `DEEPSEEK_API_KEY`, `.env.local` was not modified, and secret values never enter responses/logs/cache.
- `GET /api/shipping/translation/status` is provider-free and returns redacted configuration, cache, usage, budget and last-error state. `POST /api/shipping/translation/test` accepts only an empty body, uses fixed harmless test text, gates disabled/provider/model/budget/secret state before a call, persists success/failure usage, and rejects arbitrary prompts/source text. There is no Settings UI, test API for arbitrary prompts, production Feed auto-translation, Calendar/Event/HOT integration or Translation runtime job.
- Placeholder protection preserves URLs, dates, times, numbers/coordinates, IMO/MMSI, voyage/port codes and explicit terms; Service hash identity remains based on the original source text and cache selection remains successful exact current provider/model first, then deterministic historical success for provider-free reads. Translation remains optional enrichment and cannot overwrite original Feed/Event/HOT/Voyage/Port facts or readiness evidence. Fake Provider remains test-only.
- Pre-repair T2 baseline was 54/54 targeted and 595/596 full-suite tests; the single failure remains the pre-existing date-sensitive `server/providers/feed.test.ts` Shekou Event/HOT assertion and no Feed/Event/HOT code was changed. T1 Neat Freak official Bash audit remains `pending` because Bash/script execution is unavailable on this Windows host; its manual equivalent found no code/docs/Git blocker, and the approved T2 implementation proceeded. DeepSeek live verification is `pending`; external DeepSeek Provider calls in this phase are `0`.

## V3 Translation T2 Review Repair — 2026-09-02

- The T2 Foundation is review-repaired without changing the `translation-faithful-v1` hash contract, provider/model identity (`deepseek` / `deepseek-v4-flash`) or the T3 stop boundary.
- Monthly translation budget usage now uses a SQLite aggregate over the complete UTC month (`SUM` for counts/characters/tokens/cost and `MAX(last_called_at)`), independent of the 500-row detail-list limit. Status uses bounded SQL aggregate/latest-row queries and no longer loads 5,000 usage rows into memory.
- DeepSeek success responses fail closed with `provider_contract_changed` unless `usage` is an object containing nonnegative safe integers for `prompt_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `completion_tokens` and `total_tokens`; prompt breakdown and total-token arithmetic must match the current official contract. Missing or malformed usage cannot persist a successful translation.
- The T2 fixed-test path persists `tokens_in=prompt_tokens`, `tokens_out=completion_tokens`, exact `estimated_cost`, USD and literal `source_scope=translation_test`; the T3A/T3D Feed path uses literal `feed`, and same-hour aggregate writes become informational `mixed` when scopes differ. New writes never place token-breakdown JSON in `source_scope`; historical JSON is best-effort decoded only for its real `sourceScope` value and no breakdown fields are exposed as persisted facts.
- DeepSeek prompt construction now serializes source and target values as JSON strings inside one user message. `</source>`, fake system instructions and wrapper-like source text remain data; request construction keeps `stream=false`, thinking disabled and no tools. Translation output rejects only explicit known wrappers such as `Translation:`, `Here is the translation:` and `翻译如下：`; placeholder and explicit `TEST STAR` protection remains deterministic.
- At the T2 Review Repair checkpoint, monthly budget remained a local estimated budget in USD. DeepSeek live verification was `pending`, external Provider calls were `0`, migration changes were `none`, `.env.local` and retained SQLite were not modified, and production Feed translation/runtime/UI/T3 remained deferred; T3A is recorded in the current section above.
- Review Repair verification: T2 repair targeted and T1/T2 regression tests passed `72/72`; full Vitest passed `613/614` tests across `55/56` files. The only failure is the same unrelated date-sensitive `server/providers/feed.test.ts` Shekou Event/HOT assertion. Typecheck, lint and Vite/Nitro build passed. Official Neat Freak Bash audit is `pending` because `bash` is unavailable; manual audit found no blocker.

## 1. One-Sentence Status

P0 Persistence, P1 Port/Mock Isolation, P2 Search/Identity/Runtime, P3 Feed lifecycle and P7 Final Real-data Seal are sealed; the VesselAPI Voyage Provider path, Port Intelligence, Open-Meteo, TMD/BMKG and DeepSeek Translation Runtime retain their accepted live boundaries. Voyage focus-port coverage, Calendar completeness, selected official-alert geography and public-source coverage remain explicit partial boundaries, not Mock fallback or fabricated facts. Translation is live optional enrichment limited to Feed title/summary display and does not enter the REAL_OPERATIONAL hard gate.

V3 Readiness remains profile-aware: it checks Node `24.15.0` / ABI `137`, pnpm `10.30.3`, better-sqlite3 `12.6.2`, schema/Port Directory and the exact approved Runtime Job set. Development Safe requires Mock/Off; Real Operational rejects Mock and reports capability coverage separately. The final multi-target AIS, AIS Area, HANSA Voyage and TMD/BMKG evidence are independent gates; none is inferred from credentials alone. P7-A through P7-G are complete; final controlled Real Mode Readiness is `ready=true / overall=degraded` with no failed hard checks.

## V3 Official Weather Alerts — Live Contract Gate and Runtime — 2026-09-01

- The official endpoint gate made three bounded index requests from the existing registry and one linked BMKG CAP detail request. JMA returned HTTP `200` with the official sea-warning container but no safely classified alert/explicit-empty result, so JMA remains `enabled=false/live_pending`. TMD returned HTTP `200` with its registered RSS/XML contract; BMKG returned HTTP `200` with its registered RSS/XML index and an official CAP detail with a recognized CAP root. No HTTP `200` was treated as sufficient without parser structure evidence.
- TMD and BMKG are now the only enabled public sources: `enabled=true/liveStatus=verified_live`. The registry creates independent `weather-alert-sync:<sourceId>` Jobs with `capability=weather_alerts`, provider IDs `tmd`/`bmkg`, and the new `SHIPPING_WEATHER_ALERT_INTERVAL_MINUTES` cadence (default `15`; invalid/non-positive values fall back to `15`). Experimental mode may include pending sources; Mock and Off register no official alert Jobs.
- Isolated Real acceptance used the Port Directory baseline to establish all 8 focus ports through `ShippingRepository` in a fresh temporary SQLite database. Only the two official alert Jobs ran. TMD produced `12` normalized official Feed items and BMKG produced `3`; both Jobs completed `success`, Runtime was `healthy`, and the latest trusted source timestamps were persisted separately from local `fetchedAt`.
- Feed persistence was read through SQLite and `ShippingRepository`, exposed through the Feed API, then read again after SQLite restart: `15` items remained from sources `tmd` and `bmkg`; Runtime rows and `sync_runs` also survived restart. The live payloads did not contain safely provable focus-port aliases, so `relatedPortIds` remained empty rather than being fabricated. Zero-Mock scan across all schema-discovered business tables was `total=0`.
- Weather Alert Readiness now aggregates all active public source Jobs. With historical success for both TMD and BMKG it reports `credential=not_required`, `runtime=healthy`, `freshness=fresh`, `liveVerification=verified_live`, `status=configured`; no active source, missing historical success or JMA-only evidence remains `coverage_pending`/`not_configured`. Voyage focus-port coverage remains pending and therefore prevents full Real Operational readiness; it does not by itself produce `overall=blocked`. With hard checks passing, coverage-pending capabilities keep `overall=degraded`; hard-check failures remain the condition that produces `overall=blocked`. The accepted Voyage Provider evidence is recorded separately below.
- Verification: official Weather Alert provider/runtime/registry/Readiness tests passed `84/84` in the targeted batch; `typecheck` and lint passed for the changed files. No schema or migration changed, the retained SQLite was not opened, and no `.env.local` or secret was modified.

## Historical V3 Real Data Activation Snapshot — 2026-08-29

- Controlled process-only `SHIPPING_DATA_MODE=real` smoke used existing server-side adapters and wrote to `.data/shipping-hot-v3.sqlite3`; it registered `ais-tracking`, `voyage-sync`, two source-level Feed jobs, `calendar-sync`, `port-sync` and `weather-sync`. At the historical 2026-08-29 checkpoint AISStream produced zero records because no eligible watched MMSI existed; the 2026-08-30 review-gap closure now records this as `skipped/no_eligible_ais_targets` without marking the Provider healthy. Voyage remained disabled because no real adapter/key is configured. No Mock row was written.
- The Loadstar and Shekou Feed sources were fetched independently; Calendarific persisted 259 events across CN, ID, MY, PH, TH and VN; Portcast persisted 8 Port Directory-aligned port rows; Open-Meteo persisted 7 weather-risk Feed rows. A failed source does not replace another source with Mock data, and Runtime records provider usage/health in SQLite.
- Built Nitro HTTP smoke with process-scoped Mock/Off configuration returned 200 for `/`, `/api/shipping/health`, `/api/shipping`, `/api/shipping/feed`, `/api/shipping/feed/history`, `/api/shipping/calendar`, `/api/shipping/runtime`, `/api/shipping/readiness`, `/api/shipping/search/ports` and `/api/shipping/search/vessels`. The separate Real Readiness HTTP check returned `REAL_OPERATIONAL`, `blocked`, with pnpm `skipped`/unverified and the exact disabled Voyage Job state. Legacy `/api/shipping` read persisted repositories only.

## V3 GFW Vessel Search + Canonical Identity — 2026-08-31

- `createGfwVesselSearchProvider()` uses the official server-side `GET /v3/vessels/search` contract with `datasets[0]=public-global-vessel-identity:latest`, a bounded limit and `Authorization: Bearer <GFW_API_TOKEN>`. `FileSecretStore` maps `gfw` to `GFW_API_TOKEN`; the existing environment-first/file-fallback rule is unchanged, and Mock Mode returns only the Mock provider even when real credentials are configured.
- Readiness review repair: `REAL_OPERATIONAL` now resolves Vessel Search credentials from the explicitly selected provider (`GFW_API_TOKEN` for `gfw`, `VESSELAPI_API_KEY` for `vesselapi`) without network calls or hard-coded live verification; an unset/unsupported provider remains conservatively `not_configured`.
- GFW `selfReportedInfo[].id` / `combinedSourcesInfo[].vesselId` are treated as provider identity; `registryInfo[].id` is never treated as the canonical GFW vessel id. Same-IMO records are grouped to `imo:<IMO>`, same-name different-IMO candidates remain separate, MMSI-only candidates use MMSI identity, and historical identities are retained in `vessel_metadata.data.identityHistory` without a migration.
- Latest identity selection is deterministic by transmission end date, then start date and stable tie-breakers. The live HANSA probe returned one canonical result from three historical identities: `imo:9155391`, current MMSI `538090733`, Call Sign `V7B3029`, Flag `MHL`, with historical MMSIs `636090756`, `770308484` and `538090733`. The live DONG FANG FU probe returned 16 canonical candidates, including separate IMO `9162423` and `4837047` candidates.
- Provider-aware cache keys isolate GFW, VesselAPI and Mock results; an empty VesselAPI cache did not block a subsequent GFW request. Watchlist/AIS target smoke used only the persisted current MMSI `538090733`; no AIS PositionReport was requested or claimed.
- Verification: targeted GFW/search/Readiness/watchlist/AIS/SecretStore tests passed `61/61`; typecheck, lint and build passed. Full suite reported `374/375` with only the existing date-sensitive `server/providers/feed.test.ts` failure; no Feed file was changed. No retained SQLite data was written, no token value was persisted or printed, and no migration was added for this work.

## Historical V3 AIS Live PositionReport Verification — 2026-08-29

- The existing SecretStore path found `AISSTREAM_API_KEY` configured from the server environment (`.env.local` loaded by `loadServerEnv`); only `maskedLast4=****dbcf` is recorded in `docs/live-verification.md`. The credential value was not logged, persisted or committed.
- The current `.data/shipping-hot-v3.sqlite3` watchlist contains no eligible canonical real watched vessel with a valid MMSI. Per the stop condition, no MMSI was guessed and no AISStream WebSocket was opened; the AIS Live Gate remains `coverage_pending` with `0` valid PositionReports, `ais_positions=0` and `ais_latest_positions=0` for this batch.
- P3A hardening now rejects malformed MMSI values, ignores PositionReports outside the subscribed watched MMSI set and rejects PositionReports without a trusted provider timestamp instead of using local `fetchedAt`. Existing Repository/API/UI boundaries remain unchanged: latest AIS reads are SQLite-only and the Vessel detail panel remains the minimal position/source/stale surface.
- Required non-live AIS regression coverage passed for valid normalization, wrong-MMSI isolation, missing trusted timestamp, Mock rejection, last-known failure preservation, bounded batching and runtime persistence. No Mock was used as live evidence.
- The direct Real zero-Mock gate against the retained local database reported `actualMockRows.total=16` from pre-existing Mock/Test rows in non-AIS tables; those user-local rows were not deleted. A fresh isolated Real activation smoke passed with `actualMockRows.total=0`, including both AIS tables.

## AIS Live Verification Review Gap Closure — 2026-08-30

- Empty or invalid watched targets now return Runtime `skipped` with `errorCode=no_eligible_ais_targets` and the explicit no-target message. The AIS Provider function is not called; first-run runtime health remains `never_succeeded`, `lastSuccessAt` remains absent, and `sync_runs` records `skipped`. A prior success retains its timestamp; no-target is not a Provider success.
- No-target usage keeps `provider_usage.request_count` as a capability sync invocation count only; `success_count` and `failure_count` do not increase. `records_count` remains normalized records read/written, not a network request count.
- AIS read state now combines position TTL freshness with the current Runtime provider health through `server/services/ais-position-read.ts`. A previous Real position after `ProviderError(provider_timeout)` remains available with `stale=false/sourceStatus=degraded/errorCode=provider_timeout` at +1 minute and `stale=true/sourceStatus=degraded/errorCode=provider_timeout` at +16 minutes.
- The API remains Repository/RuntimeRepository → SQLite-only and makes zero Provider calls. Vessel detail now uses the API's real `sourceStatus` and labels degraded/failed last-known data without exposing the technical error code to ordinary users.
- Review-gap tests cover no-target 0-call behavior, usage counters, healthy success, ProviderError root-code propagation, last-known TTL/health independence and API read isolation. Live AIS remains `coverage_pending`; no MMSI was guessed and no live WebSocket was opened.

## AIS Zero-Observation Runtime Semantics Repair — 2026-08-31

- An eligible watched AIS target whose Provider completes normally but returns no PositionReport now produces Runtime `skipped` with `errorCode=no_ais_position_observed` and message `No AIS PositionReport observed for eligible watched vessels`; it is neither `success` nor `failed`, and no position rows are written.
- The first zero-observation run keeps `provider_runtime.status=never_succeeded` with no success/source timestamps; `sync_runs` records `skipped`; `provider_usage` increments only `request_count`, leaving success/failure counters unchanged and `records_count=0`.
- After a prior real success, a zero-observation run keeps `provider_runtime.status=healthy`, `lastSuccessAt` and `lastSourceUpdatedAt`, while recording the current skipped error. Provider errors retain the existing `failed` path, and no-target runs remain distinct as `no_eligible_ais_targets`.
- Verification: AIS Provider/Runtime/Watchlist/position/persistence targeted tests passed `40/40`. A fresh Real HANSA probe using the production-default 2500ms window opened the socket and sent the subscription but observed `0` PositionReports; the Runtime result is now `skipped/no_ais_position_observed`, with `provider_runtime=never_succeeded`, no success/source timestamps, `provider_usage request=1/success=0/failure=0`, and both AIS tables at `0` rows. No extended probe was repeated.

## Historical V3 AIS Continuous Live Tracker Snapshot — 2026-08-31

- Real AISStream + enabled runtime starts one `AisLiveTracker` singleton with long-lived WebSocket batches; the bounded `ais-tracking` Job is omitted in this mode and remains available when streaming is explicitly disabled. Mock Mode never starts the Tracker.
- The Tracker reconciles eligible Watchlist current MMSIs every 30 seconds by default, avoids reconnecting for unchanged targets, uses deterministic deduplicated batches of up to 50, serializes all `AisPositionRepository.savePositions()` writes and exposes redacted status through `/api/shipping/runtime` and Readiness.
- Subscription confirmation is not a position or success: it preserves provider errors, timestamps and reconnect backoff, except that a newly eligible target may clear the `no_eligible_ais_targets` marker without claiming health. Runtime health becomes healthy only after a new PositionReport is persisted, becomes failed before first success or degraded after later failure, and uses bounded `1s/2s/5s/10s/30s` reconnects (`60s` minimum for rate limits; auth/contract errors are terminal). Only that persisted real observation clears the provider error and resets reconnect backoff. Continuous frames do not increment bounded `provider_usage` or `sync_runs`.
- Isolated final live acceptance: discovery raw `10`, confirmation `1`, PositionReport `9`, unique MMSIs `9`; selected `FU CHI`, IMO `9611644`, MMSI `414720000`, canonical `imo:9611644`. Formal Tracker target/socket/confirmation was `1/1/1`, but formal PositionReport was `0`; `ais_positions=0`, `ais_latest_positions=0`, `provider_runtime=never_succeeded`, and zero-Mock `actualMockRows.total=0`. Gate: `coverage_pending`, canonical reason `active_candidate_not_reobserved_on_continuous_stream`.
- No retained SQLite was opened or written; the fresh temporary database was removed. Restart/API position verification was not applicable because no formal position existed; provider-free latest-position isolation remains covered by tests.
- Verification: targeted continuous AIS/Runtime/Watchlist/Readiness/position tests passed `107/107`; typecheck, lint and build passed. Full suite passed `418/419`; the only failure remains the date-sensitive `server/providers/feed.test.ts` assertion and is pre-existing/unrelated. No Feed code/test was changed.

## V3 AIS Area Background Runtime + Live Acceptance — 2026-08-31

- The implementation adds a separate long-lived `aisstream-area` Provider and `ais-area-sync` Runtime Job (`capability=ais_area`) for watched Real ports. Registry and bootstrap create/own one provider instance when `SHIPPING_DATA_MODE=real` and `SHIPPING_AIS_AREA_PROVIDER=aisstream`; the default/fallback interval is `SHIPPING_AIS_AREA_INTERVAL_MINUTES=1`. Area never merges with the sealed Vessel Tracker socket or its `FiltersShipMMSI` semantics.
- Area reuses the AIS Vessel hardened binary decoder, protocol taxonomy and trusted PositionReport mapping. It accepts only valid 9-digit MMSI identity, matching `MetaData.MMSI`/`UserID`, valid coordinates and provider `MetaData.time_utc`; local `fetchedAt` remains local receipt time. Async Blob decoding is generation/config-snapshot guarded. `SubscriptionConfirmation` is counted as connection evidence only; reconnect backoff resets only after an assigned trusted PositionReport.
- The Job uses Port Directory canonical coordinates and the existing Repository/Watch mechanism for all eight formal ports, subscribes with eight small bboxes and `FilterMessageTypes=["PositionReport"]` without `FiltersShipMMSI`, and writes only bounded aggregate rows to `ais_port_metrics`. A port-level freshness gap is `coverage=stale`, `stale=true`, `sourceStatus=degraded` and has no provider `errorCode`; only an explicit canonical AISStream failure makes the Job fail and Runtime fail/degrade. No schema, migration, retained SQLite or raw observation table was changed.
- Formal isolated Real acceptance: credential was configured from the server environment; all 8/8 Port Directory ports were watched. Stats were `socketOpened=1`, `subscriptionsSent=1`, `subscriptionBboxCount=8`, `subscriptionConfirmations=1`, `positionReportsReceived=9`, `validPositionReports=9`, `assignedPortSamples=9`, `ambiguousSamples=0`, `sourceTimestampPresent=9`, `distinctMmsi=8`.
- Winner: Shekou (`port-shekou`, `CNSHK`) with `sampleSize=6`, `activeVesselCount=6`, `anchoredCount=0`, `mooredCount=1`, `lowSpeedCount=3`, `stationaryRatio=0.1666666667`, `ambiguousSampleCount=0`, `coverage=usable`, `trend=unknown`, trusted `sourceUpdatedAt=2026-08-31T14:32:12.983Z`, and `fetchedAt=2026-08-31T14:32:21.319Z`. Eight derived metrics were persisted with `source_type=derived` and `provenance.sourceId=aisstream-area`.
- Runtime persisted `healthy`, `lastSuccessAt=2026-08-31T14:32:21.335Z`, `lastSourceUpdatedAt=2026-08-31T14:32:12.983Z`, `consecutiveFailures=0`; the latest sync run was `success` with `recordsRead=7` and `recordsWritten=8`. Snapshot read returned 8 Area metrics with zero Provider stats delta; shutdown closed the socket; restart preserved 8 watched ports and 8 metrics; zero-Mock scan reported `actualMockRows.total=0`.
- AIS Area Live Gate: `verified_live`, canonical reason `real_ais_area_metric_persisted_and_restarted`. Readiness now aligns with that existing evidence and reports `provider=aisstream`, `credential=available`, `runtime=healthy`, `freshness=fresh`, `liveVerification=verified_live`, `status=configured` when the qualifying persisted metric and enabled Area Job are present. Voyage/ETA, Weather Alerts, Feed, UI, Event thresholds and HOT ranking were not touched.
- Verification: AIS Area/binary/trust/race tests, runtime Job, Registry/bootstrap, AIS Vessel regression and Readiness targets passed `221/221`; typecheck, lint and build passed. Full suite passed `461/462`; the existing date-sensitive `server/providers/feed.test.ts` assertion remains the only unrelated failure.

## V3 AIS Readiness `verified_live` Alignment — 2026-08-31

- Readiness now derives the Real Operational AIS `liveVerification` state from runtime evidence instead of a fixed `coverage_pending` default. The upgrade requires `SHIPPING_DATA_MODE=real`, provider `aisstream`, enabled continuous streaming, an available `AISSTREAM_API_KEY`, a running `AisLiveTracker`, healthy runtime evidence, `lastSuccessAt`, a parseable `lastSourceUpdatedAt` and fresh source evidence.
- A successful continuous AIS observation maps to the existing `status=configured`; no new status enum, migration or network probe was added. `runtime` and `freshness` remain independent dimensions, so historical verified evidence is retained when the current runtime is `degraded`/`failed` or the source timestamp is stale. Missing source evidence, invalid timestamps, no observation, disabled streaming, Mock mode and missing credentials remain conservative and do not claim `verified_live`.
- The final multi-target acceptance is the current AIS evidence: discovery raw `7`, confirmation `1`, PositionReport `6`, six GFW-resolved formal candidates, one confirmed continuous socket, and winner VALLIANZ PRESTIGE (IMO `9978846`, MMSI `572549220`). Its real PositionReport persisted through `ais_positions`/`ais_latest_positions`, Repository/API read-back, clean shutdown and SQLite restart; `actualMockRows.total=0`.
- AIS Live Gate: `verified_live`; canonical reason `multi_target_continuous_ais_position_persisted_and_restarted`. This does not upgrade Voyage/ETA or official weather-alert coverage; AIS Area uses its separate persisted-metric Readiness evidence below.
- Verification for this alignment: Readiness/Runtime/API/AIS targeted tests passed `110/110`; typecheck, lint and build passed. The full suite passed `431/432`; the only failure remains the pre-existing date-sensitive `server/providers/feed.test.ts` assertion, unrelated to this Readiness-only change. No AIS live probe was run in this implementation batch.

## V3 AIS Area Readiness Evidence Alignment — 2026-09-01

- `readV3Readiness()` reads existing Real `ais_port_metrics` rows through `ShippingRepository(db, "real").listAisPortMetrics()`; the Readiness path does not instantiate a Provider, open a WebSocket, write SQLite or add a schema/migration.
- Historical Area evidence qualifies only when `provenance.sourceId=aisstream-area`, `sampleSize` and `minimumSampleSize` are finite and positive with `sampleSize >= minimumSampleSize`, `coverage` is `usable` or `stale`, and `sourceUpdatedAt` is parseable. It never falls back to `fetchedAt` or `updatedAt`; insufficient, malformed and wrong-source metrics remain pending.
- With `SHIPPING_DATA_MODE=real`, `SHIPPING_AIS_AREA_PROVIDER=aisstream`, an available `AISSTREAM_API_KEY`, the enabled `ais-area-sync` Job and the persisted Shekou acceptance metric, Area Readiness is `runtime=healthy`, `freshness=fresh`, `liveVerification=verified_live`, `status=configured`. Degraded/failed runtime preserves historical verification; never-succeeded, not-registered and disabled runtime states remain `coverage_pending`; missing credentials remain `credential_missing`; Mock/Development Safe remains `safe_mock/not_verified`.
- Verification: the Readiness suite passes `52/52`; the existing Area Runtime/Provider/Repository and AIS Tracking regression targets pass. No live probe was run in this alignment batch.

## V3 Activation Review Gap Repair — 2026-08-29

- The Real activation smoke now inspects SQLite schema metadata and scans every non-system business table carrying `source_type` through the actual native SQLite database and existing lineage rules. The current discovered set is `ais_latest_positions`, `ais_port_metrics`, `ais_positions`, `calendar_events`, `events`, `feed_item_history`, `feed_items`, `ports`, `vessel_metadata`, `vessel_search_cache`, `vessels`, `voyage_eta_history` and `voyages`. It emits `actualMockRows.tables` and asserts `total === 0`; clean, JSON-mismatch, known-table and future-table regression tests cover pass and fail paths.
- Zero-Mock gate coverage is sealed for this review only; this does not claim `Real Operational Ready` while VesselAPI credentialed Voyage/ETA evidence and official weather-alert coverage remain pending. AIS PositionReport and Area evidence are separate live gates.
- Port, Weather, Feed, AIS, Voyage and Calendar Providers expose their actual `providerId`; Runtime Jobs pass that identity into `provider_runtime`, `sync_runs` and `provider_usage` rather than substituting a hard-coded label. `provider_usage.request_count` means capability sync invocation count, while `records_count` (schema v11) means normalized records read/written by that invocation; it is not an HTTP quota ledger.
- Provider failure codes remain root-cause values across Provider → Runtime Job → SyncResult → SQLite runtime/usage records and Readiness. Generic HTTP 403 is `provider_forbidden`; only explicit entitlement wording maps to `entitlement_missing`. The accepted HANSA ETA run is `VERIFIED_LIVE`; focus-port coverage is a separate `coverage_pending` state because `CNYPG` is outside the formal directory.

## V2 Plan Archive

V2.0–V2.5 development plan is archived as completed.

Archive file: `docs/archive/shipping-hot-v2-completion.md`

Remaining pending work: real data coverage / runtime follow-up.

## 2. Current Environment

- Active branch: `codex/shipping-hot-v3-real-data`; package version: `0.0.41`
- Git remotes: `origin=https://github.com/rallsix66/Shipping-HOT.git` and `upstream=https://github.com/ourongxing/newsnow.git`; `gh auth status` and `gh repo view` are currently verified, while `gh run list` returned no remote workflow runs (`no remote CI evidence`)
- Local run status: Vite development smoke returned 200 for `/`, `/feed` and `/api/shipping`; default `provider.feed=mock`, `provider.weather=mock` and `provider.weatherAlerts=off`, one non-weather Feed item and one Mock weather item were returned without external weather calls; current process-scoped Mock/Off production Nitro smoke returns 200 for `/`, `/api/shipping/health`, `/api/shipping/runtime`, `/api/shipping/readiness`, `/api/shipping/search/ports`, `/api/shipping/search/vessels` and `/api/shipping`, with no `#nitro/index` subroute error observed
- Deployment status: `out-of-scope`; repository contains optional Cloudflare/Vercel/Bun/Docker configuration, but no deployment was performed
- Database / external services: P0 uses fixed Node `24.15.0` / ABI `137`, `better-sqlite3@12.6.2`, db0 path `.data/shipping-hot-v3.sqlite3`, and passed native read/write plus process-A-write → close → process-B-read smoke. The current workspace inventory found no legacy `.data/db.sqlite3`; it is not the V3 runtime path. AISStream, Portcast public pages and Open-Meteo remain optional server-side sources.
- Mock fixture timestamps: generated relative to the runtime clock when a snapshot is created; deterministic fixed time is limited to `shared/shipping-engine.test.ts`
- V1 focus-port seed: all eight requested ports are present in the shared fixture and Repository seed path: Shekou, Yantian, Nansha, Laem Chabang, Port Klang, Manila, Jakarta and Ho Chi Minh City
 - Last verified surface: 2026-09-04 P7 Final Real-data Seal — controlled Real Mode activation, Readiness, SQLite/Repository/API, Event/HOT, restart, zero-Mock and browser routes were verified. Historical test and evidence details remain in their dated sections below. Neat Freak Closeout records the Windows manual equivalent; the official Bash inventory sub-step is `pending/unavailable` because Bash is unavailable on Windows.

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
| Shipping HOT API and local tables | `SEALED` / provider-free read contract verified | `server/api/shipping/**`, `server/database/shipping.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `shared/calendar.ts` | Provider → service → Repository path carries provenance, sourceUpdatedAt, fetchedAt and freshness; persisted Feed lifecycle columns are canonical on read; nullable Vessel status persistence has an idempotent old-schema rebuild; source-scoped Event identity and operational source filtering keep incompatible history out of current HOT; eight V1 focus-port seeds remain present |
| Shipping HOT V3 P0 Persistence | `SEALED` | `server/database/runtime.ts`, `server/database/migrations/001-p0-foundation.ts`, `server/database/migrations/002-watchlist-isolation.ts`, `server/database/shipping.ts`, `server/secrets/file-secret-store.ts`, `server/providers/contracts.ts` | Fixed Node 24.15.0 native SQLite, schema migration runner, App/DB bootstrap metadata, user-owned watchlists, Provider-owned upserts and memory fallback removal are accepted |
| Shipping HOT V3 P1A Port Directory Foundation | `SEALED` | `shared/port-directory.ts`, `server/database/migrations/003-p1a-port-directory.ts`, `server/database/port-directory.ts`, `server/providers/shipping.ts`, `server/providers/aisstream-area.ts`, `shared/ais-area.ts` | Eight-port SQLite-backed UN/LOCODE baseline, aliases, coordinates, Real Mode source filter and production coordinate lookup are accepted; no directory expansion is implied |
| Shipping HOT V3 P1B Mock Isolation | `SEALED` | `server/database/migrations/004-p1b-mock-isolation.ts`, `server/database/shipping.ts`, `server/providers/shipping.ts`, `server/providers/feed.ts`, `server/providers/calendar.ts`, `server/shipping-store.ts`, `shared/shipping.ts` | migration v4 adds `source_type` lineage; Real Mode Repository reads only `real/imported/derived`, rejects Mock/mixed evidence, does not select Mock providers or `MockScheduleProvider`; Test/Mock Mode remains available |
| Shipping HOT V3 P2A Search Foundation | `SEALED` / GFW `VERIFIED_LIVE` | `server/database/migrations/005-p2a-search-foundation.ts`, `shared/vessel-search.ts`, `server/database/vessel-search.ts`, `server/providers/vessel-search.ts`, `server/search/vessel.ts`, `server/search/port.ts`, `server/api/shipping/search/**`, `example.env.server` | GFW is the accepted Vessel Search/canonical identity provider path; VesselAPI Search remains optional. Provider-aware cache, identity history and Mock isolation remain explicit |
| Shipping HOT V3 P2B Identity Seal | `SEALED` / GFW canonical identity `VERIFIED_LIVE` | `server/search/vessel-watchlist.ts`, `server/search/vessel-watchlist.test.ts`, `server/database/vessel-search.ts`, `server/api/shipping/search/vessels/watch*.ts`, `src/components/shipping/pages.tsx`, `server/runtime/ais-tracking-job.ts`, `server/runtime/ais-tracking-job.test.ts` | Watchlist uses canonical identity and the persisted current valid MMSI; identity history and provider-aware cache isolation are retained |
| Shipping HOT V3 P2C Background Runtime Foundation | `SEALED` | `server/database/migrations/006-p2c-runtime-foundation.ts`, `server/runtime/background-runtime.ts`, `server/runtime/bootstrap.ts`, `server/runtime/registry.ts`, `server/database/runtime-jobs.ts`, `server/runtime/background-runtime.test.ts`, `server/api/shipping/runtime.get.ts`, `server/plugins/background-runtime.ts`, `scripts/p2c-runtime-sqlite-smoke.ts` | Per-job scheduling, no-overlap, failure isolation, persisted runtime health and exact profile-specific Job-set checks are accepted; Translation remains optional and excluded from the Readiness hard gate |
| Shipping HOT V3 P3A AIS Tracking Runtime Foundation | `SEALED` / continuous AIS PositionReport `VERIFIED_LIVE` (bounded fallback remains separate) | `server/database/migrations/007-p3a-ais-tracking.ts`, `server/database/ais-positions.ts`, `server/providers/ais/`, `server/runtime/ais-tracking-job.ts`, `server/runtime/ais-live-tracker.ts`, `server/runtime/registry.ts`, `server/services/ais-position-read.ts`, `server/api/shipping/vessels/[id]/position.get.ts`, `src/components/shipping/data.ts`, `src/components/shipping/pages.tsx`, `scripts/p3a-ais-sqlite-smoke.ts` | `ais_positions` preserves history and `ais_latest_positions` serves fast latest reads. AIS Runtime reads only `vessel_watchlist` entries with `ais_enabled=true` and valid MMSI, returns `skipped/no_eligible_ais_targets` without a Provider call when no target exists, rejects unknown/invalid positions, keeps last-known data on Provider failure, isolates Mock positions from Real Mode, persists `sync_runs`/`provider_runtime`, and exposes a minimal latest-position API/UI with independent `stale` and Runtime `sourceStatus` fields. AISStream now supports bounded and continuous PositionReport paths; the continuous Tracker persists valid real observations, reconnects within bounded policy, and exposes runtime evidence used by Readiness. No map or trajectory scope was added |
| Shipping HOT V3 P3A AIS Area Background Runtime | implemented / locally verified; dedicated Area Live Gate `verified_live`; Readiness aligned | `server/providers/aisstream-area.ts`, `server/providers/aisstream-area.test.ts`, `server/providers/ais/index.ts`, `server/runtime/ais-area-sync-job.ts`, `server/runtime/ais-area-sync-job.test.ts`, `server/runtime/registry.ts`, `server/runtime/bootstrap.ts`, `server/services/v3-readiness.ts`, `server/services/v3-readiness.test.ts`, `example.env.server` | `ais-area-sync` persists existing `ais_port_metrics` aggregates for watched Real Port Directory ports through a persistent `aisstream-area` session. Readiness reads that table read-only and promotes only a qualifying `aisstream-area` metric with positive sample/minimum thresholds and a parseable source timestamp; usable and stale metrics preserve historical verification, while insufficient, malformed or wrong-source metrics do not. It reuses the hardened binary/trusted timestamp parser, validates MMSI/metadata/coordinates, treats SubscriptionConfirmation as connection evidence only, preserves last-known failures, and keeps API/snapshot reads provider-free. No schema, migration or raw observation table was added; Area remains separate from Vessel Tracking |
| Shipping HOT V3 P3B Voyage / ETA Foundation + VesselAPI Adapter | engineering sealed; Provider `verified_live`; focus coverage `partial / coverage_pending` | `shared/voyage.ts`, `server/database/migrations/008-p3b-voyage-eta.ts`, `server/database/voyages.ts`, `server/providers/voyage/`, `server/runtime/voyage-sync-job.ts`, `server/runtime/registry.ts`, `server/services/v3-readiness.ts`, `server/api/shipping/vessels/[id]/voyage.get.ts`, `src/components/shipping/data.ts`, `src/components/shipping/pages.tsx` | `VoyageRecord` permits provider-unknown origin, voyage number, ETD and movement status; accepted HANSA evidence validates official ETA/Port Event identity and timestamps, persists one Voyage plus one append-only ETA history row, survives provider-free API/Repository reads and SQLite restart, and reports `actualMockRows.total=0`. Official `destination_port=CNYPG` is valid Provider observation but has no canonical focus-port mapping in the current eight-port directory; `originPortId=THLCH`; no new migration was added. Recurring VesselAPI episodes use Repository-owned candidate resolution, cross-destination ordering guards and JSON-only `episodeState` supersession. |
| Shipping HOT V3 P3 Feed Freshness + Runtime | `SEALED` | `server/database/migrations/009-p3-feed-freshness.ts`, `server/database/migrations/010-p3-feed-freshness-reclassification.ts`, `server/providers/feed.ts`, `server/runtime/feed-sync-job.ts`, `server/runtime/registry.ts`, `server/database/shipping.ts`, `server/api/shipping/feed.get.ts`, `server/api/shipping/feed/history.get.ts`, `shared/shipping-rules.ts`, `shared/shipping-engine.ts`, `scripts/p3-feed-freshness-sqlite-smoke.ts`, `scripts/v3-real-activation-smoke.ts` | 7/14-day policy, strict date quarantine, source-isolated Feed jobs, and the persisted current/history/quarantine lifecycle are accepted; P7 final full-system evidence is recorded above |
| Shipping HOT V3 Translation T3B/T3C/T3D + Post-T3 Settings | `SEALED + VERIFIED_LIVE` for approved Feed scope | `server/database/translation.ts`, `server/services/feed-translation-display.ts`, `server/services/translation-failure-policy.ts`, `server/services/translation-live-acceptance.ts`, `server/runtime/translation-sync-job.ts`, `server/api/shipping/feed.get.ts`, `server/api/shipping/index.get.ts`, `src/components/shipping/feed-display.tsx`, `src/components/shipping/pages.tsx`, `shared/shipping.ts` | Accepted live evidence covers DeepSeek connectivity/model/credentials, automatic Runtime success/cache/usage, placeholder recovery, controlled circuit recovery and cached Chinese Feed UI with original disclosure. Scope remains FeedItem title/summary only; Event/HOT Translation is out of scope and Translation is not a Readiness hard gate |
| Shipping HOT V3 Real Data Activation Runtime | `SEALED / VERIFIED_LIVE` source paths; P7 final acceptance complete | `server/runtime/calendar-sync-job.ts`, `server/runtime/port-sync-job.ts`, `server/runtime/weather-sync-job.ts`, `server/runtime/background-runtime.ts`, `server/database/runtime-jobs.ts`, `server/shipping-store.ts`, `server/api/shipping/**`, `server/services/real-data-gate.ts` | Calendarific, Portcast public pages, Open-Meteo and public Feed run through Background Runtime → SQLite → Repository → API; final controlled activation recorded Calendar 259 rows, Port 8 rows, weather 5 rows, Feed Loadstar 10 and Shekou 5, with `actualMockRows.total=0`; legacy `/api/shipping` is repository-only; no new Provider or secret; approved coverage gaps remain explicit |
| Shipping HOT V3 Readiness Gate | `SEALED / VERIFIED` | `server/services/v3-readiness.ts`, `server/api/shipping/readiness.get.ts`, `scripts/v3-readiness.ts`, `server/services/v3-readiness.test.ts`, `server/database/voyages.ts` | Two profiles, fixed toolchain/schema checks, exact profile-specific Runtime Job set, capability/runtime/credential/freshness state, Feed source aggregation and schema-discovered Mock isolation are implemented. Final Real Operational result is `ready=true / overall=degraded` with no failed hard checks; Voyage focus coverage remains `COVERAGE_PENDING`. Translation is ignored by the REAL_OPERATIONAL core scope |
| Shipping HOT UI/routes | `IMPLEMENTED / VERIFIED` | `src/routes/**`, `src/components/shipping/**`, `src/routes/__root.tsx` | `/`, `/vessels`, `/ports`, `/voyages`, `/events`, `/feed`, `/calendar`, `/settings` and detail routes; Feed is Chinese-first when cached translation exists with `查看原文`, Settings exposes fixed DeepSeek controls and redacted Secret metadata, Home HOT enriches Feed-kind display only, and root floating React Query/TanStack devtools were removed |
| Shipping HOT V2.0 Data Trust Foundation | sealed | `shared/shipping.ts`, `server/database/shipping.ts`, `server/providers/shipping.ts`, `server/shipping-store.ts`, `shared/shipping-engine.ts`, `src/components/shipping/format.ts`, `src/components/shipping/ui.tsx` | `sourceType`/`dataNature` provenance, independent freshness timestamps/status, deterministic legacy backfill, source-aware Event reconciliation/evidence and explicit Mock/Chinese UI labels |
| Shipping HOT V2.1 Port Intelligence | implemented / verified | `server/providers/shipping.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `src/components/shipping/pages.tsx` | Opt-in `PortcastPublicPageProvider`, eight public-page mappings, visible-field parser, 24-hour cache/fingerprint, `public`/`no_public_data` detail and source attribution; Mock remains default |
| Shipping HOT V2.2 Country Calendar | `IMPLEMENTED / COVERAGE_PENDING` | `shared/calendar.ts`, `server/providers/calendar.ts`, `server/database/shipping.ts`, `server/api/shipping/calendar/**`, `src/routes/calendar.tsx`, `src/components/shipping/pages.tsx` | Calendarific transport/persistence/API path is accepted; full current+next-year and official/manual completeness remain an explicit post-seal coverage boundary |
| Shipping HOT V2.3 Shipping Information Feed | `SEALED` / `VERIFIED_LIVE` source runtime | `server/providers/feed.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `shared/shipping-engine.ts`, `src/components/shipping/**` | Source-isolated public Feed runtime and persisted current/history/quarantine lifecycle are accepted; bounded source/geographic coverage remains an explicit post-seal boundary |
| Shipping HOT V2.4 Weather Intelligence | `IMPLEMENTED / VERIFIED_LIVE` for Open-Meteo; official alerts `PARTIAL / VERIFIED_LIVE` for TMD/BMKG, JMA pending | `server/providers/shipping.ts`, `server/providers/weather-alerts.ts`, `server/shipping-store.ts`, `shared/shipping.ts`, `src/components/shipping/app.tsx` | Open-Meteo 24-hour/72-hour/7-day windows and direction fields are implemented; model weather and JMA/TMD/BMKG official alerts are independently selected and composed with failure isolation; TMD/BMKG run through the verified source-level alert runtime, while JMA remains disabled/live-pending and alert geography remains bounded; Mock remains default |
| Shipping HOT V2.5 AIS / Port Derived Intelligence | implemented / locally verified; dedicated Area gate `verified_live` | `shared/ais-area.ts`, `server/providers/aisstream-area.ts`, `server/database/shipping.ts`, `server/shipping-store.ts`, `shared/shipping-engine.ts`, `src/components/shipping/pages.tsx` | Explicit `SHIPPING_AIS_AREA_PROVIDER=off|aisstream` area session, configured heuristic watched-port boxes, PositionReport-only bounded observations, reliable timestamp separation, five-minute bucket/gap-reset trend metrics, TTL prune + 5000 hard cap, separate `ais_port_metrics` aggregate persistence, finite automatic reconnect budget (default 4 attempts) and warning-only Event/HOT path; the earlier 60-second Shekou probe with 0 PositionReports is historical; the dedicated Area acceptance is `verified_live`; no Portcast field mutation or raw track table; Mock remains default |

## 5. Decision Status

### Current Active Decisions

- Retain NewsNow as the foundation until migration cost and risk are proven higher.
- Treat the current NewsNow code/config as the authority for current implementation facts.

### Approved and Implemented for V1

- AISStream Vessel and Open-Meteo Marine Weather adapters with server-side environment selection and fallback.

### Approved and Implemented for V2.0

- Data Trust Foundation: `sourceType`/`dataNature` provenance, `ProviderResult`-compatible freshness envelope, source/fetch/update timestamp separation, degraded status preservation, last-known failure behavior, Event evidence propagation and UI attribution labels.

### Accepted V3 P0 — 2026-08-20

- ADR-005 V3 Real-Data Boundaries is `Accepted`. P0 Persistence is implemented and verified on Node `24.15.0` / ABI `137`: `.data/shipping-hot-v3.sqlite3` is the configured local database, `schema_migrations` is authoritative for migrations, `bootstrap_completed_at` only records App/DB foundation, and `port_directory_status/version/imported_at` remains independent from bootstrap and is now `ready` after P1A baseline import.
- SQLite is the only Shipping HOT persistence truth. SQLite failure never creates a mutable memory replacement; Shipping HOT mutations return `503 persistence_unavailable` or `persistence_write_failed`.
- `vessel_watchlist` and `port_watchlist` own user state; Provider upserts update only Provider-owned columns with explicit conflict updates. `translation_cache` remains a placeholder, while `provider_usage`, `provider_runtime` and `sync_runs` now record lightweight Runtime outcomes and health. `ProviderConfig` is the only Provider configuration allowed in SQLite settings; API keys/`ProviderSecret` use server-only `SecretStore` and local `.data/provider-secrets.json`. Translation, real Voyage/ETA and official-alert adapters remain deferred; approved existing Feed/Calendar/Port/Weather Runtime jobs are covered by the controlled activation slice. P1A imported the initial UN/LOCODE baseline but did not implement an external snapshot importer.
- V3 migration lineage is documented as `source_type = real | mock | imported | derived`; Real Mode never reads `mock` records. P1A adds the separate `port_directory.source` filter and does not add the broader V3 migration importer. Existing P0 evidence covers a normal process-A write → close → process-B read; the abnormal-exit restart scenario remains an additional pending verification gate.

### Implemented V3 P1B Mock Isolation — 2026-08-21

- Migration v4 adds `source_type` to all Shipping operational tables: `vessels`, `ports`, `voyages`, `feed_items`, `events`, `calendar_events` and `ais_port_metrics`. Old rows are classified from Mock provenance/evidence; rows without reliable lineage are conservatively excluded from Real Mode.
- `ShippingRepository` applies the Real Mode allow-list (`real`, `imported`, `derived`) to every operational query and rejects Mock or mixed Mock-evidence writes. Test/Mock Mode retains the fixture seed and reads.
- Real Mode no longer defaults Vessel, Port, Weather, Feed, Calendar or Schedule to Mock. Missing real capability is `unavailable`/`misconfigured`; `MockScheduleProvider` is never an operational source. Mock last-known data is not used in Real Mode.
- Event and HOT boundaries reject Mock provenance or any Mock evidence, including mixed-evidence records. No AIS long connection, VesselAPI, Search/Watch or other new business function was started.
- Verification: `241/241` tests, typecheck, native SQLite process-A-write → close → process-B-read smoke (Node `24.15.0`, ABI `137`, schema v4), and full lint with only four pre-existing unrelated errors.

### Implemented V3 P2A Search Foundation — 2026-08-21

- Migration v5 adds `vessel_metadata` and `vessel_search_cache`. Metadata stores `name`, `imo`, `mmsi`, `callsign`, `type`, `flag`, `source` and `fetched_at`; the cache stores normalized query keys, result identities, Provider and 24-hour expiry. `source_type` is enforced so Real Mode never reads Mock search rows.
- Vessel Search Domain supports vessel name, IMO, MMSI and callsign. `VesselSearchProvider` and `VesselSearchService` are server-only; the service checks SQLite cache before calling a Provider and persists normalized results.
- VesselAPI is the first adapter but only for discovery/static metadata. Its primary contract is the official `filter.name`, `filter.imo`, `filter.mmsi`, `filter.callsign` query parameters and `{ vessels: [...] }` response with `name`, `imo`, `mmsi`, `call_sign`, `vessel_type` and `country`; legacy field/response aliases remain compatibility-only. It does not emit realtime position, open AIS or replace AISStream. `example.env.server` keeps `SHIPPING_DATA_MODE=mock` and `SHIPPING_VESSEL_SEARCH_PROVIDER=mock` as the safe defaults; only the commented Real Mode example selects `vesselapi`, which loads the key through `FileSecretStore`/`SecretStore` with `VESSELAPI_API_KEY` environment value taking precedence over `.data/provider-secrets.json`. Mock search capability remains test-mode only.
- Port Search is exposed through `PortSearchService` and `/api/shipping/search/ports`, backed by `port_directory` and supporting Chinese name, English name, UN/LOCODE and aliases. Vessel Search is exposed through `/api/shipping/search/vessels`; no UI direct-to-provider path exists.
- Verification: targeted VesselAPI adapter/config tests passed (4/4), including Mock Mode isolation with a FileSecretStore key; full `pnpm test --run` passed (250/250); `pnpm typecheck` passed; `pnpm build` passed; `pnpm lint` ran with four pre-existing unrelated errors and no new P2A lint errors. Real Mode + explicit `vesselapi` + SecretStore key was verified through the adapter configuration test; `live contract not verified` because no VesselAPI key is configured.

### Implemented V3 P2B Identity Seal — 2026-08-24

- Search-result Watchlist Service uses the existing user-owned `vessel_watchlist` relation and the existing P2A `vessel_metadata` rows; it does not add `isWatched` to Provider-owned `vessel_metadata` or `vessels`.
- Add/remove/list APIs are server-side at `/api/shipping/search/vessels/watch` and `/api/shipping/search/vessels/watchlist`; the Vessels page has a minimal search-result UI with `关注`、`已关注`、`取消关注` states.
- New metadata identity uses IMO first, then `source:providerRecordId`, then provisional MMSI/name. Existing metadata is resolved by exact IMO, source+providerRecordId, MMSI only when there is no conflicting identity, and a final source+normalized-name fallback only when the existing row has no IMO, MMSI or providerRecordId. Same-name rows with different strong identity remain separate; conflicting IMO/providerRecordId/MMSI matches return `identity_conflict` and transactionally leave prior rows unchanged. Search cache and Watchlist always use the resolved canonical id; Watchlist matches canonical id, IMO, source+providerRecordId and MMSI, using name only when both sides are truly provisional. MMSI is retained as the AIS lookup target; no-MMSI records remain watchable with `aisTrackingAvailable=false` and no fabricated MMSI.
- Verification: targeted identity/P2A/P2B tests passed (18/18); full `pnpm test --run` passed (259/259); `pnpm typecheck` and `pnpm build` passed; service-backed native restart smoke covered pure provisional-name watch → same-name provider/IMO/MMSI promotion for `DONG FANG FU` and kept one canonical entity/watch; full lint retains four pre-existing unrelated errors. P2C Background Runtime Foundation is recorded below; AIS Tracking Runtime remains pending and was not implemented.

### Sealed V3 P2C Background Runtime Foundation — 2026-08-24

- `BackgroundRuntime` is a process-level singleton with idempotent bootstrap/start, timer scheduling, `runNow()`, no-overlap protection, failure isolation and shutdown cleanup. P2C exposes the production registration boundary; P3A is the first business Job registered there.
- Migration 006 safely rebuilds the P0 `provider_runtime` table with composite identity `(provider_id, capability)` and preserves existing rows. `RuntimeRepository` reads and upserts by both fields, so one Provider can keep independent capability health, failure counts and restart cursors.
- `RuntimeRepository` writes `sync_runs` (`running` → `success`/`failed`/`skipped`) and maintains `provider_runtime` health (`healthy`, `degraded`, `failed`, `disabled`, `never_succeeded`) with schedule cursor, timestamps, error fields and consecutive failures. `runNow()` cancels the old timer and starts cadence from completion; a Job-returned `skipped` also persists its next schedule. Failed `start()`/bootstrap clears timers and the singleton. The status endpoint is `GET /api/shipping/runtime` and returns only local non-sensitive state.
- Existing `GET /api/shipping` request-triggered Provider execution is explicitly legacy/deferred. P2C adds no new request-triggered sync and does not claim that all Shipping HOT reads are already background-only.
- Verification: targeted/runtime/database tests passed (20/20); full P2C verification passed before P3A; native P0 and P2C process-A-write → close → process-B-read smoke passed; `git diff --check` passed; full lint retains only the four pre-existing unrelated errors.
- Historical P2C deferred-workstream note: Feed Background Runtime / Auto Sync and Calendar Auto Sync were pending at the P2C seal; the controlled activation slice below now implements the approved Feed/Calendar/Port/Weather Runtime jobs. Translation, real Voyage adapter/ETA capability and AIS observation coverage remain pending.

### Implemented V3 P3A AIS Tracking Runtime Foundation — 2026-08-24

- P3A AISStream adapter live contract 修复完成；本地测试覆盖 BoundingBoxes、50-MMSI 分批、协议错误安全拒绝和重复 position 写入统计。未声称已验证真实 AIS 数据。
- `AisTrackingProvider` is a server-only contract with `subscribe`, `unsubscribe` and bounded `getLatestPositions`. The AISStream adapter maps only valid watched-target PositionReport MMSI values, coordinates, speed, course, heading, navigation status and trusted source timestamp through a short-lived timeout-bounded read; it does not create a long-lived WebSocket service or use local `fetchedAt` as source time.
- Migration 007 adds append-only `ais_positions` history and `ais_latest_positions` keyed by canonical `vessel_id`. `AisPositionRepository` keeps latest reads fast, marks stale data by TTL, rejects invalid coordinates and Mock positions in Real Mode, and never creates a Vessel for unknown MMSI.
- `AisTrackingJob` uses `BackgroundRuntime` with `capability=ais_tracking`, reads only `vessel_watchlist(ais_enabled=true)` entries whose canonical metadata has a valid MMSI, and writes `sync_runs`/`provider_runtime`. Provider failure leaves old positions untouched; concurrent `runNow` calls are protected by the existing in-flight guard.
- `GET /api/shipping/vessels/:id/position` reads SQLite only. The Vessels list/detail UI shows Tracking Active or Unavailable (No MMSI), latest position, update time, source and stale state; no map or trajectory UI was added. `GET /api/shipping` remains legacy/deferred.
- `SHIPPING_AIS_PROVIDER=mock` is the safe default for Mock/Test Mode. Real Mode rejects Mock positions and uses the environment-first/FileSecretStore-fallback AISStream secret path.
- Verification at the historical P3A boundary: targeted tests, native restart smoke, typecheck and build passed. The later activation slice adds source-level Feed/Calendar/Port/Weather Runtime jobs; Voyage and Translation remain pending, and AIS observation coverage is still pending.

### AISStream Binary Frame Diagnostic + Parser Repair — 2026-08-31

- A direct Node `24.15.0` WebSocket probe against AISStream received four binary `Blob` frames: one `SubscriptionConfirmation` and three `PositionReport` messages. No API key or raw payload was recorded.
- `server/providers/ais/aisstream-provider.ts` now decodes UTF-8 JSON from strings, `ArrayBuffer`, `ArrayBufferView`/Node `Buffer` and `Blob`; unsupported or malformed data fails closed. `SubscriptionConfirmation` marks the subscription accepted but never becomes a position record, while protocol errors retain the existing ProviderError taxonomy.
- Post-repair Singapore discovery again received binary `Blob` frames with `SubscriptionConfirmation=1` and `PositionReport` messages (`10` in one run; `8` in the integrated run). The selected real candidate was `PSA SHURI CS08`, IMO `9951604`, current MMSI `563185100`, callsign `9V8666`, flag `SGP`, GFW identity `imo:9951604`.
- Three production-default AIS Tracking runs remained `skipped/no_ais_position_observed`; a separate 30-second same-target probe received one real PositionReport. The final live gate is `changes_required/runtime_sampling_window_too_short`, not `verified_live`; no retained SQLite database was opened or written.
- Verification: AISStream provider tests `14/14`, AIS Runtime/Watchlist target tests `33/33`, typecheck, lint and build passed. Full suite: `383/384`; the only failure is the existing date-sensitive Shekou Feed test in `server/providers/feed.test.ts`, unrelated to this parser repair.

### V3 AIS Runtime Sampling Window Repair + Live Acceptance — 2026-08-31

- AISStream now separates the connection and observation timers. `SHIPPING_AIS_CONNECTION_TIMEOUT_MS` defaults to `5000` ms and `SHIPPING_AIS_OBSERVATION_WINDOW_MS` defaults to `30000` ms; the deprecated `timeoutMs` option remains a compatibility alias. `SHIPPING_AIS_INTERVAL_MINUTES` remains the Runtime cadence and was not changed (`15` minutes / `900000` ms).
- The formal isolated Real probe used the GFW Provider and fresh canonical identity `PSA SHURI CS08` (`imo:9951604`), current MMSI `563185100`, callsign `9V8666`, flag `SGP`; historical MMSIs were `563185100`, `565282252` and `376000000`. One real watchlist target was created with AIS enabled.
- Two formal AIS Runtime executions each opened the AISStream subscription but returned `skipped/no_ais_position_observed`, with `recordsRead=0` and `recordsWritten=0`. `provider_usage` recorded `request_count=2`, `success_count=0`, `failure_count=0`, `records_count=0`; first-run Provider Runtime remained `never_succeeded` with no success/source timestamps.
- The acceptance used only a fresh temporary SQLite database; the retained `.data/shipping-hot-v3.sqlite3` was not opened or written. The isolated database had `ais_positions=0` and `ais_latest_positions=0`; Repository/API reads returned no position and made no Provider calls. After restart, metadata and watchlist remained present, but no position existed and no GFW/AIS re-call occurred. The schema-discovered zero-Mock scan reported `actualMockRows.total=0`.
- Final AIS acceptance remains `coverage_pending` with canonical reason `active_target_not_observed_in_runtime_window`. The earlier independent binary-frame observation was not used as formal Runtime persistence evidence, and the sampling window was not enlarged.
- Verification: AIS provider, factory/env, Runtime, Registry, database, position API and Watchlist targets passed `58/58`; typecheck, lint and build passed. Full suite: `392/393`; the only failure remains the existing date-sensitive Shekou Feed test in `server/providers/feed.test.ts`, unrelated to this AIS-only repair.

### Implemented V3 P3B Voyage / ETA Intelligence Foundation — 2026-08-24

- Migration 008 extends the existing canonical `voyages` table and adds append-only `voyage_eta_history`; it does not create a second Vessel table or replace the existing Port Directory.
- `VoyageProvider` returns unified `VoyageRecord` values with vessel identity, canonical Port Directory UN/LOCODE origin/destination, voyage number, minimal status, Provider ETA/ETD, source and timestamps. The Mock adapter maps `Shekou` to `CNSHK` and `Manila` to `PHMNL`; no commercial or real adapter is registered.
- `VoyageRepository` writes the latest record plus an append-only ETA/ETD history row, reads latest/active voyage, enforces Real Mode lineage and validates both port identities. `VoyageSyncJob` uses `BackgroundRuntime` capability `voyage_sync`, reads watched canonical vessels, and persists `sync_runs`/`provider_runtime`.
- `GET /api/shipping/vessels/:id/voyage` and the Vessel detail Voyage panel are Repository/SQLite reads; no API request invokes a Provider. No AIS ETA prediction, speed-based calculation, map, route visualization, Feed, Calendar or Translation work was added.
- Verification at the historical P3B boundary: Provider/Port mapping, history, Repository/API read boundary, Runtime success/failure, registry boundary and native restart smoke were covered; real Voyage adapter coverage remains pending. The later activation slice does not add a Voyage adapter.

### P3B Voyage dual-model consistency repair — 2026-08-25

- `shared/voyage-normalizer.ts` is the single conversion boundary from `VoyageRecord` to legacy Shipping `Voyage`; `ShippingRepository.listVoyages()` now reads normalized `baseline_*`, `latest_*` and `delay_minutes` columns first, then merges them into the JSON record without trusting stale JSON values.
- `VoyageRepository.saveVoyages()` freezes baseline ETA/ETD on first observation, updates latest ETA/ETD on later observations, persists the normalized delay in both SQLite columns and JSON, and retains append-only ETA history plus timestamp protection.
- Regression coverage confirms first ETA `2026-09-01`, second ETA `2026-09-03`, baseline preservation, `delayMinutes=2880`, normalized JSON/columns, and equality between `readLatestVoyage()` and `ShippingRepository.listVoyages()` for the same vessel. `pnpm smoke:p3b-voyage` also passed after the repair.
- Verification: full suite 321/321, Voyage/Shipping/API targeted tests 19/19, typecheck, lint, build and P3B native persistence smoke passed. Feed Freshness files and behavior were not changed.

### Implemented V3 P3 Feed Freshness — 2026-08-25 (Batch 1)

- Migration 009 adds Feed `effective_at`, `expires_at`, `current_until`, `visibility` and append-only `feed_item_history` without changing migrations 001–008; migration 010 reclassifies v9 rows and synchronizes Feed columns, JSON data and history observations. Repository current queries enforce the persisted current window; history queries filter source/text before the maximum 500-row limit; source disappearance archives current rows without deleting audit history.
- Feed policy is explicit: ordinary items use a 7-day current window, operational/major items use 14 days, official items honor explicit expiry within the 14-day cap, absent dates follow the unknown path, and non-empty invalid/future/expired publication, effective or expiry dates enter quarantine/history-only. Provider failures retain only same-source stale last-known items and cannot create fresh Event/HOT evidence.
- `GET /api/shipping/feed` reads current Feed from SQLite; `GET /api/shipping/feed/history?q=&sourceId=&limit=` reads append-only Feed history with query/source filtering before the limit. Feed Events carry expiry, resolve when the Feed item expires/disappears, and expired/stale/quarantined Feed Events are excluded from HOT.
- Verification at the historical Batch 1 boundary: targeted Feed/policy/Repository/Event tests 76/76, full suite 321/321, typecheck, lint, build, `smoke:p3-feed` native process-A-write → process-B-read current/history persistence, v9→v10 reclassification coverage, Mock/Off Readiness schema 10 smoke and `git diff --check` passed. Source-isolated Feed Runtime and the Readiness Job-set update are recorded in the current activation section above.

### Closeout Repair — 2026-08-24 (lint, doc sync, P3B guards)

- Lint: the four pre-existing errors were fixed style-only with no behavior change — import order in `server/api/shipping/settings.post.ts`, a trailing comma in `shared/updated-sources.ts`, and JSX one-expression-per-line formatting in `src/routes/__root.tsx`. `pnpm lint` is now all green.
- Docs: `AGENTS.md` (project status + V3 plan source-of-truth entry), `README.md` / `README.zh-CN.md` / `README.ja-JP.md` (pinned Node `24.15.0` / ABI `137` toolchain and Shipping HOT status summary), `docs/architecture.md` (all-green lint statement, 294/294 suite, P3B guard boundary) and the V3 plan homepage (P3B baseline + Node toolchain + closeout-repair note) now match the implemented/verified state.
- P3B write guards (no schema/API change): `VoyageRepository.saveVoyages()` accepts optional `{ requestedVesselIds }`; records whose `vesselId` is outside the requested watchlist are rejected and counted (`rejectedVesselIds`). A record whose `lastUpdatedAt` is older than the stored row is skipped (`staleSkipped`) before any voyage upsert or ETA history insert. `VoyageSyncJob` passes its requested watchlist ids to the repository.
- Verification: targeted P3B tests 20/20 including the two new repository tests (non-requested `vesselId` rejection leaves prior rows intact; older timestamp cannot overwrite latest voyage/history) and the new job test (Provider records for un-watched vessels are not persisted); full `pnpm test --run` 294/294; typecheck, build, all four native SQLite smokes (P0/P2C/P3A/P3B) and `git diff --check` passed.
- Pending after this repair: Feed Auto Sync, Calendar Auto Sync, Translation, real Voyage adapter coverage and live AIS observation. The 2026-08-25 workspace audit found only the current worktree; the historical publish/baseline worktree and legacy database paths are no longer present. Active ignored local artifacts (`.env.local`, `.data/shipping-hot-v3.sqlite3`, `dist/`) and user content (`prototypes/`, `screenshots/`) remain retained and are not deleted by Closeout.

### Voyage Runtime sourceUpdatedAt Repair — 2026-08-24

- `VoyageRepository.saveVoyages()` now reports `acceptedIds` (records that passed both the requested-`vesselId` guard and the stale-timestamp guard). `VoyageSyncJob` computes runtime `sourceUpdatedAt` only from those accepted records, so rejected foreign-vessel records and stale observations can no longer inflate `provider_runtime.last_source_updated_at`.
- `BackgroundRuntime` no longer converts an absent `result.sourceUpdatedAt` to `null` before `RuntimeRepository.updateProviderRuntime`; an undefined value keeps the previous persisted timestamp, matching the repository's own merge rule. This also benefits AIS Tracking runs that accept no new positions.
- Verification: targeted voyage/runtime tests 24/24 including two new job tests (mixed batch yields the accepted record's timestamp in run result and persisted runtime; a run accepting nothing returns `sourceUpdatedAt: undefined` while the runtime keeps the previous timestamp and stays healthy). Earlier closeout counts are superseded by the 2026-08-25 Readiness Review gate, whose final full suite is 313/313.

## V3 Readiness Gate — 2026-08-25 Readiness Review repair

- Readiness now requires an initialized, running Background Runtime whose Job set exactly matches the approved `ais-tracking/ais_tracking` and `voyage-sync/voyage_sync` pair. Undefined runtime, failed bootstrap, empty/missing/duplicate/invalid/disabled Jobs and a stopped Runtime fail the gate.
- Node `24.15.0`, ABI `137`, pnpm `10.30.3` and better-sqlite3 `12.6.2` checks are produced by the shared `readV3ToolchainChecks()` contract used by both `GET /api/shipping/readiness` and `pnpm smoke:v3-readiness`; CLI observes actual `pnpm --version` and actual installed better-sqlite3 package metadata/native load, while HTTP marks missing pnpm user-agent as `skipped` and strict Readiness remains `ready=false`.
- `pnpm smoke:v3-readiness` now bootstraps and stops the local Runtime around the check. The gate still does not add a Provider, read a secret value, make a network request, or begin Feed, Calendar or Translation work. Existing Real/paid Provider overrides intentionally fail the local gate.
- Targeted verification: Readiness Review tests 17/17 passed; full test 313/313, typecheck, lint, build, native restart smokes, Mock/Off Readiness CLI, production Nitro HTTP smoke and `git diff --check` passed. No external Provider request was made.

### Approved / V2.2 Locally Verified; Live Pending

- Country Calendar: TH/ID/MY/PH/VN contracts, server-only Calendarific integration with conditional attribution, composed official/manual/mock boundaries, source-scoped coverage, conflict evidence, national/local scope evidence, date/scope-aware normalization and deduplicated national Event/HOT reminders; Calendarific is verified_live, while official live sync is still pending.

### Approved / V2.3 Locally Verified; Live Pending

- Shipping Information Feed: opt-in The Loadstar/The Maritime Executive RSS and Shekou official HTML adapters, explicit parser-pending/deferred/failed-live registry states, independent source failure handling, unknown publication semantics, Chinese classification, canonical/title dedupe and Feed → Event → HOT convergence.

### Approved / V2.4 Locally Verified; Live Pending

- Weather Intelligence: one 7-day Open-Meteo request with local 24-hour/72-hour/7-day windows and wave/swell directions, 30-minute server TTL, per-port failure isolation and last-known stale semantics, plus source-specific JMA sea-warning HTML, TMD public RSS and BMKG RSS adapters. Model weather and official alerts are independently selected and composed; all three official sources remain `live_pending`; `public` enables only `verified_live` sources (currently none), while `experimental` is the explicit opt-in for pending adapters; model risk and official warning provenance remain separate.

### Approved / V2.5 Locally Verified; Live Pending

- AIS / Port Derived Intelligence: Watched AIS and Area AIS use separate Provider/session boundaries. `SHIPPING_AIS_AREA_PROVIDER=off` is the default rollback; `aisstream-area` subscribes only to small configured heuristic boxes for watched current-port identities and sends `FilterMessageTypes=["PositionReport"]` without `FiltersShipMMSI`. `sourceUpdatedAt` is copied only from a reliable AIS payload timestamp; `updatedAt` falls back to the latest local observation time only when no reliable source timestamp exists, and observation windows do not rewrite provenance. Metrics use five-minute bucket boundaries, do not increment within a bucket, reset on gaps/stale/insufficient/restart state, and use stationary-count plus ratio evidence so sample shrink cannot create a false rising trend. The session prunes observations at the 15-minute TTL and enforces a 5000-entry hard cap, while persisting only one bounded aggregate per port. Automatic reconnects use a finite budget: the initial connection is free, the default delay list permits four reconnect attempts, exhaustion stops background socket creation, a successful open resets the cycle, and a later explicit provider request starts a new cycle; `close()` cancels pending reconnects and clears retry state. Warning-only `ais_port_congestion_trend` still requires five distinct MMSIs and three consecutive rising buckets. A 60-second real Shekou Area probe opened one subscription but received 0 PositionReports, so Area remains `connection_verified / coverage_pending` and external observation is live pending.

## Real Provider Activation

Real Providers remain opt-in and require user-supplied configuration. Keys are never stored in this document.

| Area | Provider | Environment configuration |
|---|---|---|
| Vessel | AISStream | `SHIPPING_VESSEL_PROVIDER=aisstream` + `AISSTREAM_API_KEY` |
| Port | Portcast | `SHIPPING_PORT_PROVIDER=portcast` |
| Weather Model | Open-Meteo | `SHIPPING_WEATHER_PROVIDER=open-meteo` |
| Official Weather Alerts | TMD / BMKG verified; JMA pending | `SHIPPING_WEATHER_ALERT_PROVIDER=public` (only enabled/verified sources) or `experimental` (explicitly allows `live_pending`) |
| Feed | Public Feed | `SHIPPING_FEED_PROVIDER=public` |
| Calendar | Calendarific | `SHIPPING_CALENDAR_PROVIDER=calendarific` + `CALENDARIFIC_API_KEY` |
| AIS area | AISStream area PositionReport | `SHIPPING_AIS_AREA_PROVIDER=aisstream` + `AISSTREAM_API_KEY` (default `off`) |

Current TMD and BMKG are `enabled/liveStatus=verified_live`; JMA remains `disabled/live_pending`. `public` therefore runs only the two verified source Jobs, while `experimental` is the explicit pending-adapter opt-in.

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
- AIS area metrics use `aisstream-area` provenance and never become Portcast `congestionLevel`, `waitingHours` or waiting-vessel facts; area-derived trend Events are warning-only and require fresh usable watched-port evidence.
- `ais_port_metrics` stores only current/last-known aggregate JSON; raw AIS messages, tracks and unbounded history are not persisted. Disabling area removes historical metrics/Events from the current operational view without deleting audit rows.

### Provider activation semantics

- AISStream missing key → `aisstream / never_succeeded`, `AISSTREAM_API_KEY missing`, vessel data `[]`.
- Calendarific missing key → `calendarific`, unknown Calendarific coverage with `CALENDARIFIC_API_KEY missing`, no Mock Calendar events.
- Calendar source activation mapping is verified: Mock → `mock-calendar`; Calendarific with key → `calendarific` + `official-holiday-source` + `manual-holiday`; Calendarific without key → `calendarific` only; Official → `official-holiday-source` + `manual-holiday`; Manual → `manual-holiday`. These are provenance IDs, not composite provider option keys, and current Calendar/Event/HOT reads use the configured set.
- Open-Meteo first failure → no model data; only prior `open-meteo-marine` records may be retained stale/failed.
- Portcast first failure → static port identity only; dynamic fields are unknown. A later failure may retain only prior `portcast-public` dynamic fields.
- Public Feed failure → only last-known records from enabled public source IDs may be retained; `mock-port-notice` is excluded.

The requested Provider mode is shown independently from runtime `sourceStatus` (`healthy`, `degraded`, `failed`, `disabled`, `never_succeeded`).

## Calendarific Final Operational Semantics Seal — 2026-08-18

- National/public/federal/bank holiday labels normalize to `type=public_holiday`, `isPublicHoliday=true`, `scope=national`. Local/regional/state/provincial/subdivision labels remain Calendar facts but use `scope=subdivision` when Calendarific supplies region evidence, otherwise `scope=unknown`.
- The targeted five-country payload probe found actual `states[].iso` codes and `locations` text in MY, plus local-scope records in PH. No subdivision code is fabricated: a single supplied ISO is stored as `subdivisionCode`, multiple supplied ISOs are preserved in `subdivisionCodes`, and names/location text remain `scopeLabel` evidence.
- Local and unknown-scope Calendar facts remain visible in the Calendar repository/API, but `isCalendarOperationallyRelevant()` excludes them from national Calendar Event/HOT generation. `government_special` keeps its existing immediate-announcement behavior. National Calendar IDs remain stable; only scoped facts receive scope identity suffixes.
- Unknown Calendarific type labels normalize to `type=commercial`, `scope=unknown`, `businessImpact=low`, `recognized=false`; the fact remains Calendar-visible but is non-operational and cannot create a Calendar Event/HOT. The live unsupported labels were `Season` in TH/ID/MY/VN and `Weekend` plus `Season` in PH.
- 2026 targeted probe reconciliation: raw `201` − invalid date `0` − missing name `0` → `201` normalized candidates; scope-aware dedupe retained `201` unique facts (`TH=36`, `ID=31`, `MY=67`, `PH=37`, `VN=30`), comprising `98` national + `44` subdivision + `59` unknown, with `25` unsupported-type records and `98` operationally eligible records. All `201` provider facts merged successfully. The old `198` direct / `189` operational and `48` local/unknown counts are superseded measurements from the pre-scope key and must not be used as the current invariant. Repository JSON scope round-trip is covered by tests; native better-sqlite3 runtime remains pending.
- Legacy unscoped Calendarific facts are removed from the current `calendar_events` set only when the same country/date/name/type is represented by an incoming scoped subdivision/unknown fact. The linked historical ShippingEvent remains in the Event audit repository, is excluded from the current operational view, and is not marked resolved. Legacy unscoped national, Official and Manual facts remain unaffected.
- The current reminder window contains `3` Calendarific Calendar → ShippingEvent → HOT samples: PH `2026-08-21` Ninoy Aquino Day, ID `2026-08-25` Maulid Nabi Muhammad and MY `2026-08-25` The Prophet Muhammad's Birthday. All are `scope=national`; current subdivision, unknown-scope and unsupported reminder counts are `0`. The prior four-reminder sample cannot be reconstructed exactly from the stored aggregate evidence.
- The five countries remain `coverageStatus=partial`; this closeout does not claim complete national-calendar coverage. AISStream remains `connection_verified / pending_observation`, JMA/TMD/BMKG remain `live_pending`, and V2.5 local implementation is complete with external area observation pending.

## Calendar Sync Persisted Baseline Seal — 2026-08-19

- `syncCalendarEvents()` now calls `readStoredSnapshot()` after `initialize()` and uses that snapshot for existing Calendar facts, coverage, settings, entities, FeedItems and previous ShippingEvents.
- When Repository is available, persisted state wins. Legacy Calendarific local migration can therefore discover the persisted unscoped row after a process-like restart, execute `removedIds` deletion, persist the new scoped row, and retain the linked historical ShippingEvent without resolving it.
- Historical V2 behavior: `fallbackSnapshot` was the Repository-unavailable memory fallback and was not authoritative when persisted state existed. V3 P0 supersedes this path with an explicit unavailable status and no mutable memory replacement.
- Restart-style V2 tests remain historical evidence for legacy Calendar reconciliation; the current P1B native restart smoke verifies process-A write → close → process-B read through SQLite. The architecture's abnormal-exit variant remains pending. Real Mode no longer permits `mock-schedule` as an operational source.

## Calendar Sync Operational Source Isolation Seal — 2026-08-19

- Repository rows remain historical facts and are not deleted merely because Provider mode changes. Calendar sync filters Vessel, Port, Voyage and Feed inputs through the existing `OperationalSourceContext` before Event detection.
- The same context now checks Provider mode, active registry source IDs and P1B lineage/evidence: current real sources may produce current evidence, inactive Mock sources cannot, and `mock-schedule` is excluded in Real Mode.
- Persisted historical Mock Events remain in the audit repository, but are excluded from current reconciliation/HOT and are not re-upserted or falsely resolved.

### Local runtime smoke — 2026-08-18

- Default all-Mock request: `/api/shipping` returned HTTP 200 with Mock vessels/calendar/HOT present.
- AIS requested with an empty key and all other sources Mock: `/api/shipping` returned HTTP 200, `provider.vessel=aisstream`, `providerFreshness.vessel.sourceStatus=never_succeeded`, `vessels=[]`, and no `mock-vessel` Event/HOT.
- Calendarific requested with an empty key: `/api/shipping` and Calendar sync returned HTTP 200, five `calendarific / unknown / CALENDARIFIC_API_KEY missing` coverage rows, zero Calendar events and zero `mock-calendar` Event/HOT.
- Open-Meteo and Portcast forced-failure semantics remain covered by the no-network Provider tests; no new external Provider smoke was started in this closeout.

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
| Official Alerts | TMD | independent probe | failed parser | 0 | `live_pending` | HTTP 200 XML endpoint, payload had an RSS root while the registry still expected CAP |
| Official Alerts | BMKG | independent probe | partial | 6 | `live_pending` | HTTP 200 XML/RSS and 6 parsed items; registry remains disabled/live_pending |

No `live_pending` source was upgraded to `verified_live`; the live results above do not yet satisfy every registry upgrade criterion. Public mode therefore still activates no Official Alert source by default.

## Historical Live-Path Fix Status — 2026-08-18

The corrected public re-probe completed successfully and is kept separate from the historical 2026-08-17 probe. Portcast and Open-Meteo used direct public endpoints; Shekou used the corrected `/ywgg/` page; no proxy, mirror or credential was used.

| Area | Current contract / last evidence | Status |
|---|---|---|
| Portcast | HCM mapping is `https://www.portcast.io/port-congestion/ho-chi-minh`; source-age threshold is 14 days; missing source date is `source_update_time_unknown`; stale pages retain real Portcast values but cannot create Port Events/HOT. Corrected probe: 8/8 HTTP+parser, 7 `verified_live_fresh`, 1 `verified_live_stale` (Nansha, source date 2026-02-16); HCM 200, source date 2026-08-16, fresh. | verified_live_fresh / verified_live_stale |
| Open-Meteo | Corrected probe: 16 requests for 8 ports, 8/8 HTTP+parser; 6 risk FeedItems emitted, Port Klang/Jakarta below risk threshold; `updatedAt` is forecast valid time, `sourceUpdatedAt` undefined, `fetchedAt` is later local completion time; all emitted items contain h24/h72/d7. | verified_live |
| Shekou Official Feed | Corrected probe: `/ywgg/` HTTP 200, 5 parsed items, every canonical path is `/ywgg/`, zero `/gsxw/` items; latest page item has unknown publication time, so it does not create Event/HOT. | verified_live_parser |
| The Loadstar / Maritime Executive | Corrected probe: Loadstar HTTP/parser success with 10 items; Maritime Executive direct fetch failed (`fetch failed`) and provider returned 0 without Mock fallback. | Loadstar `verified_live`; Maritime `failed_live` |
| AISStream | The verified WebSocket session received no PositionReport within 120 seconds; no observation evidence was claimed. | `connection_verified / pending_observation` |
| Calendarific | Five-country HTTP/parser probe succeeded; all country coverage remains partial and no Mock Calendar source entered the requested real-mode view. | `verified_live / partial` |
| Official alerts | JMA/TMD/BMKG remain registry-disabled pending independent probes and full live criteria; TMD's public endpoint format was corrected from CAP to RSS without upgrading its live status. | `live_pending` |

Current implementation matrix: Portcast supports fresh / stale / failed / no-public states and re-evaluates source age on every read, including cache hits; Open-Meteo keeps model forecast evidence without fabricating a source update time and records completion-time `fetchedAt`; Shekou Feed is official operational notices only; AIS area remains explicit off by default and locally verified with a connection-only external probe that received no valid observation. Real Mode now has no Mock operational source; Schedule is unavailable until a real entitlement is added.

## Historical Credential-Gated Verification — 2026-08-18

This historical pass checked the credential-gated and public-source paths directly while credentials were absent. No secret value was printed, stored or written to documentation. Its Calendarific `pending_credentials` result is superseded by the later verified-live probe below; the AISStream no-observation result remains current.

| Area | Requested mode / source | Direct result | Current status | Decision |
|---|---|---|---|---|
| AISStream | `aisstream` | `AISSTREAM_API_KEY: missing`; no WebSocket request; no-data path returned `Error: AISSTREAM_API_KEY missing` and no Mock vessel | `pending_credentials` / `never_succeeded` | Keep requested real mode; do not fall back to Mock |
| Calendarific | `calendarific` | Historical no-key run: no external request; five-country result had zero events and `unknown` coverage | historical `pending_credentials` | Keep requested real mode; do not seed Mock Calendar events; superseded by the later verified-live probe |
| JMA | `https://www.jma.go.jp/bosai/seawarning/` | HTTP 200 `text/html`; current source-specific parser recognized the page and returned 0 alerts; no fabricated warning | `live_pending` | Valid empty observation, but no positive sample to verify timestamps/area/severity/expiry; remain disabled |
| TMD | `https://www.tmd.go.th/en/api/xml/CAP` | HTTP 200 `text/xml`; payload root is RSS; after the minimal registry correction from `cap` to `rss`, parser returned 7 items; port association is empty unless the alert text/area names a known port, and the RSS index does not provide verified expiry fields | `live_pending` | Keep disabled until full warning-field and lifecycle criteria are verified |
| BMKG | `https://www.bmkg.go.id/alerts/nowcast/en` | HTTP 200 `application/xml`; RSS parser returned 2 items; port association is empty unless the alert text/area names a known port, and no verified expiry field was present in the index response | `live_pending` | Keep disabled until full warning-field and lifecycle criteria are verified |
| Maritime Executive | `https://maritime-executive.com/rss` | DNS resolved A/AAAA records, but TCP 443 timed out and direct HTTPS fetch failed; no RSS/XML response was received | `failed_live` | Retain the source as disabled `failed_live`; it is excluded from active public fetch scheduling and does not affect Loadstar or Shekou |

The previous no-network all-real mode smoke requested `vessel=aisstream`, `port=portcast`, `weather=open-meteo`, `weatherAlerts=public`, `feed=public`, `calendar=calendarific`, with `schedule=mock`. After this closeout, active source IDs contain `aisstream`, `calendarific`, `portcast-public`, `open-meteo-marine`, `the-loadstar`, `shekou-official` and `mock-schedule`; `maritime-executive`, `mock-vessel`, `mock-port`, `mock-weather`, `mock-port-notice` and `mock-calendar` are absent. No official alert source is active in `public` mode because JMA/TMD/BMKG remain unverified.

No source was upgraded to `verified_live` in this pass. V2.2 remains `implemented / locally verified / live pending`; V2.3 remains live-verified for Loadstar + Shekou with Maritime Executive `failed_live`; V2.4 model weather remains live-verified while official alerts remain `live_pending`. V2.5 had not started at this historical checkpoint.

## Final Alert Lifecycle + Feed Timeout Closeout — 2026-08-18

- `warning_missing_from_current_index` now means lifecycle unknown: the item remains warning/critical history with official timestamps and provenance, but becomes `eventEligibility=false`, `hotReason=undefined`, `weather.alertState=unknown`, `stale=true` and `sourceStatus=degraded`; it cannot enter new Event/HOT output.
- Public Feed applies a 10-second timeout independently to each active source's fetch, response body and parser. One source timeout returns its own stale/failed last-known records without delaying successful Loadstar/Shekou results.
- Weather alert aliases now map `Chonburi`/`Chon Buri` to Laem Chabang and `Tanjung Priok`/`North Jakarta` to Jakarta; registry-wide default port association remains disabled.
- JMA strict validation no longer accepts `#contents table`; it requires the JMA `#seawarning-container`/warning structure or an explicit empty marker.
- Regression coverage is now 181/181. Mock Isolation, Portcast/Open-Meteo trust semantics, Schedule and the then-not-started V2.5 scope remained unchanged at this historical checkpoint.

## Final Trust Boundary Seal — 2026-08-18

- Direct FeedItem → HOT now requires `sourceStatus=healthy` and `stale=false` in addition to severity, publication-time and event-eligibility checks; stale/failed/degraded FeedItems cannot bypass Event/HOT freshness through the direct Feed path. Existing active Event → HOT behavior is unchanged.
- Public Feed retains a 10-second per-source deadline over fetch, response body and parser, and calls `AbortController.abort()` when the deadline expires so the underlying HTTP fetch receives cancellation. Timed-out sources keep only their own stale/failed last-known items; without previous data they return no placeholder item.
- Official Weather Alert port association is alert-evidence-only: `WeatherAlertSource` no longer exposes `relatedPortIds`, and parser logic ignores any runtime-injected provider-wide default. Matching uses alert title/summary/area, canonical port names/UNLOCODEs and the verified aliases only.
- Regression coverage is now 184/184. Mock Isolation, Portcast/Open-Meteo trust semantics, Schedule and the then-not-started V2.5 scope remained unchanged at this historical checkpoint.

## AISStream + Calendarific Live Verification — 2026-08-18

### Credentials

- AISSTREAM_API_KEY: present in local .env.local; value was never printed, persisted to docs, or included in a request log.
- CALENDARIFIC_API_KEY: present in local .env.local; value was never printed, persisted to docs, or included in a request log.
- .env.local is ignored and untracked; git diff, git status, and generated/API outputs contained no secret values.

### AISStream

- Watched targets: 2; valid watched MMSI: 2; subscription filter contained only those 2 MMSIs and PositionReport.
- Provider observation window: 120 seconds; provider returned AISStream request timed out; normalized PositionReports: 0; matched MMSIs: 0.
- Wire-level check: WebSocket opened=true for the full 120-second window; no explicit WebSocket error or server close was observed. The subscription was sent with the current MMSI filter, but no PositionReport arrived, so this is connection_verified / pending_observation, not verified_live.
- No real AIS Event/HOT sample was claimed. Existing AIS normalization, Mock-field isolation, same-source statusChangedAt continuity and Event/HOT rules remain covered by the local suite; the no-observation live run did not provide a new status transition sample.
- Current all-real API freshness is vessel=never_succeeded with no vessels, and no mock-vessel entered current Vessel/Event/HOT output.

### Calendarific

- Historical pre-scope count: TH 200 / 36, ID 200 / 31, MY 200 / 64, PH 200 / 37, VN 200 / 30; total 198 normalized events before operational composition. That count used a key without local scope and is superseded.
- All five responses were legal JSON and parser-successful. Each country had eventSourceStatus=healthy, coverageStatus=partial, sourceId=calendarific, and valid country/date fields. The API did not declare complete coverage, so no country was upgraded to complete.
- The scope closeout probe found actual `locations` and `states[].iso` evidence in local records. The normalizer now maps national/public/federal/bank labels to `public_holiday + national`, local labels to `subdivision`/`unknown`, and deduplicates by country/date/name/type/scope. Same-day same-name facts from different subdivisions remain separate. Regression tests cover exact duplicates, type-normalization collisions, date stability and subdivision-aware dedupe.
- The current CalendarEvent contract has no localName field, and the sampled Calendarific payloads did not provide a local-name field; no localName value was fabricated.
- The targeted current-year scope probe reconciled 201 raw → 201 normalized unique → 201 provider/merge facts (`MY=67`, local/unknown scope=48); `calendarSourceIds` remains source-accurate and mock-calendar remains excluded in Calendarific mode. The earlier 189 persisted/read-back result belongs to the pre-scope reconciliation and is not a current count. Repository scope JSON round-trip is covered; the native-persistence wording in this historical 2026-08-19 entry is superseded by the V3 P0 seal below.
- Current-year reminder window produced 3 Calendar → ShippingEvent → HOT samples, all fresh and provenance.sourceId=calendarific, all `scope=national`. The prior four-reminder sample cannot be reconstructed exactly; no national/local/unknown/unsupported breakdown is inferred for it. Native SQLite verification is recorded in the V3 P0 seal below.
- Final Calendarific status: verified_live with per-country partial coverage; it is not an assertion of complete national-calendar coverage.

### All-real requested-mode smoke

- Requested modes: aisstream, portcast, open-meteo, public alerts, public Feed, calendarific; Schedule remained Mock.
- /, /vessels, /ports, /voyages, /feed, /calendar, /events, /settings and /api/shipping returned HTTP 200.
- API provider modes matched the request. Portcast returned configured real data with current source_stale freshness for old public page dates; Open-Meteo and public Feed were healthy; public JMA/TMD/BMKG remained inactive/live_pending and were not requested; Calendarific attribution was present.
- Across the current snapshot there were no mock-vessel, mock-port, mock-weather, mock-port-notice or mock-calendar records. mock-schedule remained the only Mock source.

- Regression coverage after the Calendarific final operational-semantics closeout: recorded after the full verification gate below.

## Official Alert Trust + Feed Failure Isolation Closeout — 2026-08-18

- TMD/BMKG no longer receive registry-wide default `relatedPortIds`; known port association is derived only from explicit alert title/summary/area text.
- A warning disappearing from a TMD/BMKG/JMA result is not treated as official resolution unless the retained item contains a reliable expiry timestamp that has passed. Otherwise it remains visible as stale/degraded with `warning_missing_from_current_index`, so it cannot create fresh Event/HOT evidence or be falsely marked expired.
- JMA strict empty-result validation requires a JMA-specific structure (`#seawarning-container` or `.jma-information-list`) or an explicit empty marker; a generic `<main>` or ordinary `#contents table` no longer qualifies.
- Maritime Executive remains retained as `failed_live` but is disabled and excluded from the active Public Feed source set, preventing known TCP/HTTPS failure from delaying Loadstar/Shekou.
- Regression coverage increased the local suite to 178/178. No Mock Isolation, Portcast trust, Open-Meteo trust, Schedule or the then-not-started V2.5 scope was changed at this historical checkpoint.

## 6. Known Inconsistencies

| Source of truth | Conflicting surface | Impact | Action |
|---|---|---|---|
| NewsNow foundation and Shipping HOT implementation coexist | Legacy NewsNow routes and Source modules remain | A reader could mistake retained legacy capability for the new core | Keep legacy paths; Shipping HOT is the local product surface |
| Native `better-sqlite3` build | Fixed Node 24.15.0 / ABI 137 prebuilt is installed and loaded | Native read/write and process restart persistence smoke passed | Preserve the fixed Node 24 toolchain |
| `nitro.config.ts` selects SQLite connector | P0 explicitly sets `.data/shipping-hot-v3.sqlite3` | Side-by-side V3 path is known and verified by the native smoke | Do not reuse the prior `.data/db.sqlite3` without a new migration decision |
| Remote CI evidence is absent | `gh run list --repo rallsix66/Shipping-HOT` returned no workflow runs | GitHub-side test/build status cannot be claimed from this checkout | Report local verification separately; do not infer remote CI success |

## 7. Current Risks

| Priority | Risk | Evidence | Recommended action |
|---|---|---|---|
| P1 | External Provider runtime access is environment-dependent | AISStream needs a server-side key; Open-Meteo access is external; both have offline adapter tests | Keep Mock as the default; explicit real modes show no-data until fresh evidence is available |
| P1 | Legacy NewsNow Source failures use a different contract | `server/api/s/index.ts`, `shared/types.ts` | Keep legacy path; Shipping HOT DTOs use freshness/sourceStatus/error fields |
| P2 | OAuth/cloud deployment dependencies may be unnecessary locally | `server/api/oauth/**`, `nitro.config.ts`, Docker files | Dependency analysis before removal |
| P2 | Native addon/toolchain must remain pinned | `package.json` engines and `.nvmrc` pin Node `24.15.0`; official ABI 137 prebuilt is verified | Keep Node/pnpm/native versions aligned during future dependency updates |

## 8. Current Work and Blockers

- Current status: `V3 — FINAL SEALED`. P0–P3 foundations and P7-A through P7-G are complete; GFW Search/canonical identity, continuous AIS PositionReport, AIS Area, Portcast public-page, Open-Meteo, TMD/BMKG Weather Alerts, VesselAPI Voyage Provider path and DeepSeek Translation Runtime retain their accepted live boundaries. Feed lifecycle reads use the persisted SQLite projection; Translation remains optional Feed title/summary enrichment, with placeholder reliability and mode decoupling sealed. Voyage focus-port coverage, Calendar completeness, selected weather-alert geography and public-source coverage remain explicit partial boundaries, while final Event/HOT, full-system Real Mode, UI, restart and zero-Mock acceptance passed.
- The dated entries below are historical closeout records and do not override the current status above.
- 2026-08-14 frontend redesign round (completed): all seven pages plus navigation rebuilt with the aurora glass/bento design system — `src/components/shipping/aurora.tsx` (CSS gradient-blob background + grid/noise/vignette), `src/components/shipping/ui.tsx` (Reveal, SpotlightCard, AnimatedNumber, Segmented, Marquee, ProviderChip, StatusDot, EmptyState), rewritten `app.tsx` (floating glass nav with layoutId active pill, route transitions, dark-first theme toggle, restyled badges/StatCard/VoyageCard/EventCard/FeedCard) and `pages.tsx` (bento hero dashboard, segmented filters, congestion gauges, staggered reveals). Data flow, API calls and routes are unchanged; no new dependencies. A follow-up smoothness pass removed per-frame GPU hotspots (blob `filter: blur(90px)`, dark-mode `mix-blend-mode: screen`, per-card `backdrop-filter`) in favor of pre-feathered gradients and opaque frosted fills; only the sticky nav keeps a reduced backdrop blur. An adversarial review round then fixed: watch/save busy-state reset via try/finally, `MotionConfig reducedMotion="user"` for JS animations, route-transition remount removal (hero-only entrance), dark-mode secondary-text contrast tier bump, settings save error state machine, `freshness=unknown` status label, mobile nav active-pill scrollIntoView, anti-FOUC theme script in `index.html`, react-refresh warnings eliminated by splitting `format.ts`/`data.ts`, and a `test/ui-smoke.test.ts` renderToString guard (86/86 tests). Verification: `pnpm typecheck` passed, eslint on changed files 0 errors / 0 warnings, full test suite passed (86/86), `pnpm build` passed.
- 2026-08-15 frontend console-layout round (completed, locally verified): user-approved plan A (指挥台化) implemented — `app.tsx` left collapsible sidebar (localStorage memory) + global status topbar (活跃 HOT / 最后刷新 / 数据源混合度) + mobile bottom tab; `pages.tsx` dashboard HOT-first with stat strip, vessels/ports (inline congestion gauge)/voyages (delay column) as dense tables, feed (filter panel + source counts) and events (status × severity combined filters) as timelines, vessel/port/voyage details as two columns with related events/weather/voyages, calendar as left filter panel + 3-column cards; `globals.css` gained the console layout system and dropped the legacy glass-nav/hero-sheen/spotlight/detail-grid styles; `ui.tsx` no longer exports unused SpotlightCard/SectionHeading; `format.ts` added voyage status labels; brand logo background changed to sky blue `#0ea5e9` (`public/shipping-hot-icon.svg` and sidebar glow); standalone comparison prototypes live under `prototypes/` (offline HTML, outside the build). Data flow, API calls, routes, database and dependencies are unchanged. The current tree passes `pnpm typecheck`, targeted eslint and `pnpm test --run` after this closeout batch; `pnpm build` also passed (client + PWA + Nitro, `shared/updated-sources.ts` unchanged). Neat Freak skill instructions were loaded; its Bash-only inventory script remains pending because Bash is unavailable in this Windows environment, while the required manual equivalent audit found no secrets/database artifacts. The `.baseline-typecheck-fdf3191/` and matching temporary baseline worktree named at that historical checkpoint are absent from the 2026-08-25 inventory; `prototypes/` remains user/other-agent content.
- 2026-08-15 sidebar rail follow-up (completed, verified): fixed the collapsed-sidebar header overflow (the collapse button was clipped half behind the logo) by moving the expand control to the sidebar footer and centering the logo / nav icons / provider dots in the 76px rail; the same fix is mirrored in `prototypes/`. The obsolete `.baseline-typecheck-fdf3191/` checkout metadata and matching temporary baseline worktree were reported as cleanup candidates at that historical checkpoint; the 2026-08-25 inventory found neither, and no current cleanup action was required. Verification: typecheck passed, eslint on changed file 0/0, tests 136/136, build passed.
- 2026-08-17 Mock Isolation Final Fix (completed, locally verified; live pending): requested real modes no longer switch to Mock when AISStream or Calendarific configuration is missing; Store fallback reads are source-filtered for Vessel, Port, Weather, Calendar and Feed; Open-Meteo first failure excludes `mock-weather`; Portcast outputs only public dynamic fields and leaves missing fields unknown; Portcast first failure retains static identity only; public Feed excludes `mock-port-notice`; the top Provider summary includes official weather alerts and all-Mock detection includes Calendar. Added Provider, Store-boundary, Event Engine and UI-format tests. Verification: 146/146 tests, typecheck, targeted eslint, build and runtime matrix passed; live external calls remain pending.
- 2026-08-17 Shipping HOT Final Mock Isolation — AIS + Event Boundary (completed, locally verified; live pending): AIS now receives identity-only Watch Targets plus same-source AIS last-known observations; successful PositionReports emit only AIS-proven fields, same-source `statusChangedAt` continuity, identity-only/degraded results for missing MMSI or missed first observations, and source-aware Vessel merges. `status_changed_at` is nullable with an idempotent old-schema rebuild. Source-scoped Event identities let Mock/AIS histories coexist; current operational Event/HOT reads use Provider mode plus active registry source IDs, while SQLite retains incompatible historical Events and source switching does not resolve them. Empty real-mode seed snapshots therefore contain no Mock active Events/HOT. Verification: 161/161 tests passed; final typecheck, targeted lint, build, no-network runtime smoke, SQLite migration smoke and Neat Freak Closeout are recorded below; native SQLite and live external calls remain pending.
- 2026-08-17 Shipping HOT Calendar Operational Source ID Final Fix (completed, locally verified; live pending): Calendar configuration now returns actual provenance `calendarSourceIds` instead of composition option keys; Calendarific with a key activates `calendarific` + `official-holiday-source` + `manual-holiday`, missing-key Calendarific activates only `calendarific`, Official activates Official + Manual, and Manual activates Manual. Store Calendar reads and Calendar → Event → HOT operational filtering use the configured IDs, so retained incompatible Calendar history cannot surface in the current view. Verification: 165/165 tests, typecheck, targeted lint, build, offline provider/context/Store smoke, `git diff --check` and documentation closeout passed; full lint retains the four pre-existing errors, native SQLite and live external calls remain pending.
- 2026-08-18 Real Provider Trust Closeout (completed, corrected public re-probe verified): Portcast cache hits re-evaluate source age without refetching or changing the last real `fetchedAt`; Open-Meteo records each port's `fetchedAt` after both responses and JSON parsing; Shekou `/ywgg/` was re-probed with 5 `/ywgg/` items and zero `/gsxw/` leakage. Corrected public results: Portcast 8/8 (7 fresh, Nansha stale), Open-Meteo 8/8, Loadstar 10, Maritime Executive failed, Shekou parser verified. The local suite is 173/173.
- 2026-08-18 Historical Credential-Gated Verification (superseded for Calendarific): direct JMA/TMD/BMKG probes recorded HTTP/parser/timestamp/area/severity evidence; TMD's public endpoint was corrected from registry `cap` to `rss` and its regression fixture passed, while all three official sources remain `live_pending`; Maritime Executive DNS resolved but TCP 443 timed out and remains `failed_live`; the historical AISStream and Calendarific no-key results were `pending_credentials`. The later Calendarific probe upgraded Calendarific to `verified_live / partial`; AISStream remains `connection_verified / pending_observation`. The preceding local suite was 174/174; V2.5 was not started at that historical checkpoint.
- 2026-08-18 Official Alert Trust + Feed Failure Isolation Closeout: TMD/BMKG associations are text-derived only; warning disappearance without reliable expiry preserves stale/degraded last-known evidence; JMA generic `<main>` no longer counts as a valid empty structure; Maritime Executive is disabled as `failed_live` and excluded from active public scheduling. Current suite: 178/178; front-end dirty lane remains user-owned and untouched.
- 2026-08-18 Final Alert Lifecycle + Feed Timeout Closeout: missing-index warnings are lifecycle-unknown and excluded from Event/HOT eligibility; active Public Feed sources have independent 10-second fetch/body/parser timeouts; Chonburi/Chon Buri and Tanjung Priok/North Jakarta aliases map to canonical focus ports; JMA requires its sea-warning mount or explicit empty marker. Current suite: 181/181.
- 2026-08-18 AISStream + Calendarific Live Verification (pre-scope baseline): AISStream WebSocket opened for a 120-second watched-MMSI subscription but received no PositionReport, so status is connection_verified / pending_observation; Calendarific TH/ID/MY/PH/VN each returned HTTP 200 and valid JSON, normalized 198 direct events with partial coverage, and the old operational sync read back 189 Calendarific events and produced 4 reminder Event/HOT samples. Calendarific is verified_live; no Mock source entered the all-real operational view; suite was 186/186. The later scope-aware reconciliation supersedes the Calendar counts, while the AIS observation status remains current.
  - Historical blockers at this 2026-08-19 checkpoint included the Node 24 native ABI mismatch and a production subroute package-import issue; V3 P0 and the later production Readiness smoke have since resolved those local blockers. Current deferred gates are AISStream `connection_verified / pending_observation`, official-alert criteria, partial Calendarific coverage, live AIS observation and real Voyage adapter coverage. GitHub CLI authentication and repository metadata are currently verified; `gh run list` returned no workflow runs (`no remote CI evidence`).
- Verification at this historical checkpoint retained the prior lint findings; the current 2026-08-25 `pnpm lint` is all green.
- V2 status: `V2.0 sealed`; `V2.1 implemented`; `V2.2 implemented / locally verified / live pending`; `V2.3 implemented / locally verified / live pending`; `V2.4 implemented / locally verified / live pending`; `V2.5 implemented / locally verified / live pending`. Live external Provider calls remain optional; explicit Mock mode remains the default and real modes do not fall back to it.
- Neat Freak Closeout at this historical checkpoint: manual equivalent completed against the loaded skill (rules, Markdown surfaces, stale claims, secrets, local database, residue and Git/worktree state); the official Bash inventory script was pending/unavailable because Bash was not installed. The then-reported cleanup candidates are superseded by the 2026-08-25 workspace matrix; no current cleanup action was performed.
- 2026-08-19 V2.5 Phase 1 Closeout: separate Watched/Area AIS boundaries, explicit-off area mode, heuristic watched-port boxes, PositionReport-only subscription without `FiltersShipMMSI`, 15-minute observation TTL, latest-per-MMSI aggregate, `ais_port_metrics` aggregate-only persistence, source-scoped Event/HOT filtering, warning-only three-window rising trend and independent UI labels are implemented. No real Area AIS live smoke was started. Runtime no-network smoke passed for default Mock, AIS no-key and Calendarific no-key; forced Open-Meteo/Portcast failure semantics passed in provider fixtures. Targeted lint passed; full lint has only the four pre-existing errors above.
- 2026-08-19 V2.5 Final Trust Seal: `V2.5 Trust Boundary=SEALED` for local semantics. Timestamp trust now keeps reliable AIS `sourceUpdatedAt` separate from local `fetchedAt`, with `updatedAt` and observationWindow fallback semantics explicit; trend uses five-minute buckets, same-bucket no-increment, stationary-count rules, gap/stale/insufficient/restart reset and three real rising buckets for Event/HOT; observations are pruned at TTL and bounded by a 5000-entry hard cap; Area disabled status is correct for provider-disabled/off/missing-key cases; 227/227 tests pass at that checkpoint. The 60-second Shekou Area probe opened the socket, sent one bbox subscription and received 0 PositionReports (0 valid/assigned/distinct MMSI/source timestamps), so `AISStream Area=connection_verified / coverage_pending` and overall V2.5 remains `implemented / locally verified / live pending`; no `verified_live` claim.
- 2026-08-19 V2.5 Final Reconnect Lifecycle Seal: Area automatic reconnects now have a finite budget. The initial socket is not counted; the default four configured delays allow at most four automatic reconnect sockets, exhaustion stops background retries, a successful reconnect resets the budget, a later explicit `getPortMetrics()` starts a fresh cycle, and `close()` cancels pending retry timers and resets lifecycle state. The Area live evidence remains unchanged at `connection_verified / coverage_pending`; no live probe was rerun.

## Historical Local Real Provider Activation — 2026-08-19

- Local configuration: `.env.local` is present, ignored by Git and persisted for daily startup. `AISSTREAM_API_KEY` and `CALENDARIFIC_API_KEY` are present; their values are not stored in documentation or source. The shared loader now loads `.env.local` first and `.env.server` as the fallback, so the server-side `process.env` receives the local Real Mode configuration with the documented precedence.
- Actual `/api/shipping` provider modes at that historical checkpoint: `vessel=aisstream`, `port=portcast`, `weather=open-meteo`, `feed=public`, `calendar=calendarific`, `aisArea=aisstream`, `weatherAlerts=public`, `schedule=mock`; P1B subsequently removes Mock Schedule from Real Mode.
- API evidence: `vessels=0` with AIS `never_succeeded`/no observation and no Mock vessel; `ports=8` with `portcast-public` on all ports (7 healthy, Nansha stale/degraded); Open-Meteo has 7 healthy model items with `h24/h72/d7` windows and Port Klang currently has no item; Feed has 10 `the-loadstar` items and 5 `shekou-official` notices; Calendarific sync has 201 events for TH/ID/MY/PH/VN = 36/31/67/37/30 with partial coverage; AIS Area retains 2 same-source metrics but both are `never_succeeded`, `no_observation`, sample 0.
- Historical operational Mock counts at that checkpoint: `mock-vessel=0`, `mock-port=0`, `mock-weather=0`, `mock-port-notice=0`, `mock-calendar=0`, `mock-schedule=2`. P1B now excludes all of these from Real Mode current reads.
- Official alerts remain `public` with no verified active source; JMA/TMD/BMKG were not moved to `experimental`. No 60–120 second Area live probe was rerun; prior Area evidence remains `connection_verified / coverage_pending`.
- UI verification: `/`, `/vessels`, `/ports`, `/ports/port-shekou`, `/voyages`, `/feed`, `/calendar`, `/events` and `/settings` were inspected. Real source labels render for AISStream, Portcast, Open-Meteo, Public Feed and Calendarific; unknown AIS/Area values remain empty/unknown; only Schedule shows Mock. The Feed/Events “模拟数据” filter counters are 0, not Mock records. Settings now explicitly shows Calendarific and `public · 无已验证来源` for official alerts.
- Historical Runtime note from 2026-08-19: the installed binary was Node 22 ABI (`127`). V3 P0 subsequently replaced it with the official Node 24 ABI `137` prebuilt; current native and restart persistence evidence is recorded below.
- Verification: Real Mode server restart and API/UI smoke completed; final local code gates are recorded below. This activation is local runtime evidence only; it does not upgrade AIS observation or official-alert live status.

## Real Mode Startup Seal — 2026-08-19

- Shared startup contract is now `process env > .env.local > .env.server > code defaults`. `scripts/load-env.ts` loads `.env.local` first and fills missing values from `.env.server` with `override=false`; `pnpm dev` and `pnpm start` both use it.
- `pnpm dev` was restarted on port 5173 and `/api/shipping` returned the Real modes `aisstream/portcast/open-meteo/public/calendarific/aisArea`, with `schedule=mock`, 8 Portcast ports, 7 Open-Meteo items, 22 total Feed/Weather items and no incompatible Mock source.
- Historical `pnpm start` note from 2026-08-19: that process used the then-pending native persistence baseline. The current V3 P0 runtime path is `.data/shipping-hot-v3.sqlite3`; no secret value is present in the production bundle.
- `example.env.server` now contains complete safe Mock/Off Shipping HOT defaults plus a commented Real Mode example. README.md, README.zh-CN.md and README.ja-JP.md document `.env.server`/`.env.local` responsibilities, precedence, Git ignore rules and the shared `pnpm dev`/`pnpm start` contract. No Provider business logic or default product safety was changed.
- Startup seal verification: env precedence tests passed, full suite is `235/235`, typecheck and build passed, targeted lint passed, full lint retains the four pre-existing errors, and `git diff --check` passed.

## V3 P0 Persistence Closeout — 2026-08-20

- ADR-005 is `Accepted`; this entry records the completed P0 batch. The fixed toolchain is Node `24.15.0`, pnpm `10.30.3`, `better-sqlite3@12.6.2` official `node-v137-win32-x64` prebuilt, and db0 local path `.data/shipping-hot-v3.sqlite3`.
- P0 implemented `schema_migrations`, `app_metadata`, independent `port_directory_status/version/imported_at`, ownership-separated `vessel_watchlist`/`port_watchlist`, explicit Provider-column conflict updates, placeholder `translation_cache`/`provider_usage`/`provider_runtime`/`sync_runs` schemas, interface/contracts, server-only FileSecretStore and redacted ProviderConfig metadata. P0 did not implement Provider Runtime/Usage business, Port Directory import, VesselAPI, AIS long connection, Feed, Calendar, Voyage or Translation adapters; the Port Directory import is recorded in the P1A closeout below.
- Persistence failure behavior is explicit: Shipping HOT does not create or read from a mutable memory replacement; GET exposes an unavailable status with empty state, while Shipping HOT mutations return HTTP 503 semantics. User watch state survives Provider upserts because it is stored independently.
- Verification: `pnpm typecheck` passed; targeted P0 tests passed; full `pnpm test --run` passed `235/235`; `pnpm build` passed; `pnpm run smoke:p0-native` passed a real process-A write → close → process-B read; direct native SQLite read/write passed under Node 24 ABI 137. The abnormal-exit restart test required by the revised architecture remains pending because this review is documentation-only. Full `pnpm lint` has exactly four pre-existing errors outside this batch.
- Neat Freak Closeout is complete for this implementation batch via the real skill instructions and manual Windows-equivalent audit. The official Bash inventory sub-step is `pending/unavailable` because Bash is not installed; cleanup candidates remain retained pending explicit confirmation.

## V3 P1A Real Port Directory Closeout — 2026-08-20

- Migration v3 creates `port_directory` with `unlocode`, `name_en`, `name_zh`, `country_code`, latitude/longitude, timezone, aliases, `source`, `verified_at` and `is_active`; it imports Shekou, Yantian, Nansha, Laem Chabang, Port Klang, Manila, Jakarta and Ho Chi Minh with `source=unlocode` and sets the independent directory status to `ready`.
- `PortDirectoryRepository` implements search, UN/LOCODE lookup, coordinate lookup and alias lookup. Real Mode excludes `source=mock`; Mock rows remain available for tests/mock mode.
- Open-Meteo and AIS Area production providers use SQLite-backed directory coordinate lookup. `shipping-fixtures.ts` remains test/mock data and is not used for production coordinates.
- Verification: `pnpm typecheck` passed; full `pnpm test --run` passed `239/239`; `pnpm build` passed; `pnpm run smoke:p0-native` passed migration-aware process-A write → close → process-B read with Node `24.15.0` / ABI `137` and 8 active directory rows. Full lint retains exactly four pre-existing errors outside this batch.
- Scope stop: no Port Search UI/API, no AIS long-connection changes, no VesselAPI, no P1B Mock Isolation runtime work, no P2 Search & Watch or later Provider functionality.

## V3 P1B Mock Isolation Closeout — 2026-08-21

- Migration v4 adds `source_type` lineage to `vessels`, `ports`, `voyages`, `feed_items`, `events`, `calendar_events` and `ais_port_metrics`. The enum is `real | mock | imported | derived`; old Mock/unknown rows are excluded from Real Mode current reads and Mock fixture rows carry `source_type=mock`.
- `ShippingRepository` filters every requested operational entity in Real Mode to `real/imported/derived` and rejects Mock or mixed Mock-evidence writes. Test/Mock Mode preserves Mock seed/read behavior.
- Real Mode does not select Mock Vessel/Port/Weather/Feed/Calendar providers and never selects `MockScheduleProvider`; missing real capability is explicit unavailable/misconfigured, with no Mock last-known fallback. Event/HOT uses the same Mock provenance/evidence gate.
- Scope stop: no AIS long connection, VesselAPI, Search/Watch, Translation Adapter, Provider Runtime/Usage business or other new business functionality was started.
- Verification: `pnpm typecheck` passed; `pnpm test --run` passed `241/241`; `pnpm build` passed; `pnpm run smoke:p0-native` passed real native SQLite process-A write → close → process-B read on Node `24.15.0` / ABI `137`; full lint retains exactly four pre-existing unrelated errors. Neat Freak Closeout is complete via the loaded skill and manual Windows-equivalent audit; Bash inventory remains pending/unavailable.

## V3 P2A Search Foundation Closeout — 2026-08-21

- Migration v5 creates `vessel_metadata` for static Vessel discovery identity and `vessel_search_cache` for normalized 24-hour query results. Both persist `source_type`; Real Mode excludes Mock metadata/cache rows.
- `shared/vessel-search.ts` provides name/IMO/MMSI/callsign query normalization and new-entity identity rules. `VesselMetadataRepository` resolves existing canonical identity before metadata/cache writes, and `VesselSearchProvider`/`VesselSearchService` keep search behind a server-side boundary and check SQLite cache before calling the Provider.
- VesselAPI is implemented as the first discovery/static metadata adapter only. The official response fields `name`, `imo`, `mmsi`, `call_sign`, `vessel_type` and `country` are the primary mapping path to the normalized metadata contract; legacy aliases are compatibility-only. It does not map realtime position, open AIS or act as an AIS substitute. Mock search remains isolated to Mock/Test Mode.
- Port Search uses `PortSearchService` over the existing SQLite `port_directory` and supports Chinese/English names, UN/LOCODE and aliases. Search APIs are server-side; no UI direct Provider call or Watchlist workflow was added.
- Verification: corrected targeted VesselAPI adapter/config tests passed (3/3); full `pnpm test --run` passed (249/249); `pnpm typecheck`, `pnpm build` and native SQLite restart smoke passed; full lint retains exactly four pre-existing unrelated errors. `live contract not verified` because no key is configured. Neat Freak Closeout for this correction is complete via the loaded skill and manual Windows-equivalent audit; Bash inventory remains pending/unavailable.

## V3 Architecture Scope Review — 2026-08-20

- Documentation-only review narrowed P0 to SQLite startup, migration runner, schema/bootstrap state, Repository persistence, user-owned persistence and memory-fallback removal.
- The migration strategy now defines `source_type = real | mock | imported | derived`; Real Mode never reads `mock`. This review changed the migration contract only; no importer/schema wiring was added. SQLite settings may contain only non-secret `ProviderConfig`; API keys/`ProviderSecret` remain in server-only `SecretStore` and local `.data/provider-secrets.json`.
- AIS WebSocket, VesselAPI, Translation Adapter, complete Provider Runtime behavior and complete Provider Usage accounting remain deferred; P0 keeps only approved interfaces/contracts and placeholder schemas. No implementation was started in this review.
- The required abnormal-exit persistence test is documented but remains `pending`; no code or test was changed in this review.

## V3 Real Voyage / ETA — VesselAPI Live Verification Seal — 2026-09-01

### Engineering and accepted live evidence

- VesselAPI Voyage/ETA engineering is `SEALED`. Real Mode selects `vesselapi` only with `SHIPPING_VOYAGE_PROVIDER=vesselapi`; Mock Mode force-selects Mock Voyage even if that value is wrong, and direct factory selection fails closed.
- Accepted historical live evidence for HANSA BREITENBURG used local `vesselId=imo:9155391`, IMO `9155391` and MMSI `538090733`. VesselAPI ETA returned HTTP `200` with identity validation passed, official `destination_port=CNYPG`, ETA `2026-08-31T21:00:00Z` and trusted provider timestamp `2026-08-29T16:07:07Z`. The optional Port Event returned HTTP `200` with a Departure at `THLCH`, producing `originPortId=THLCH`.
- The production path `VesselAPI Provider → factory → Voyage Runtime → VoyageRepository → SQLite` completed with `recordsRead=1`, `recordsWritten=1`, `voyages=1`, `voyage_eta_history=1`, `newEpisodes=1`, `provider_runtime=healthy` and `sync_run=success`. The persisted episode is `vesselapi:imo:9155391:destination:CNYPG:episode:20260829T160707000Z`, `episodeState=current`; `voyageNumber=undefined`, `status=unknown`, `etd=undefined`, baseline/latest ETA are both `2026-08-31T21:00:00.000Z` and `delayMinutes=0`.
- Voyage API and `ShippingRepository` reads were provider-free; SQLite restart, Repository read-back and ETA-history/API read-back passed with zero Provider calls during reads/restart. The isolated evidence reported `actualMockRows.total=0`.

### Final readiness semantics

- `VesselAPI Provider Live Verification=VERIFIED_LIVE`; identity trust, ETA contract, official destination observation, optional Port Event enrichment, persistence, ETA history, Runtime, provider health, sync success, provider-free API reads, restart persistence and Zero-Mock evidence are all recorded above.
- Focus-port coverage is separate. The formal directory remains `CNSHK`, `CNYTN`, `CNNSA`, `THLCH`, `MYPKG`, `PHMNL`, `IDJKT` and `VNSGN`; `CNYPG` is outside it, so `canonical destinationPortId=undefined`, `focusPortCoverageObserved=false`, and Voyage operational status is `coverage_pending` with reason `vesselapi_focus_port_coverage_pending`. This does not invalidate Provider `verified_live`.
- IRIS MIKO (`IMO=9327566`, `MMSI=548156600`) returned VesselAPI ETA HTTP `200` with matching identity but no official `destination_port`; the Provider emitted no Voyage observation and Runtime returned `skipped/no_voyage_eta_observed`. PPA Manila pre-screen information is not official VesselAPI destination evidence.
- Deterministic repairs sealed after the live run remain referenced: PortDirectory binding `8fc97c0227c66acf7c7f0aab78edcb48d2e5213a`, Provider/focus split `720beff0b3d52892baecd1cfc0151c7b7df2bf9a`, and stable Episode anchor evidence `bf7df46b7095d51a37e316fcaddda2260663dfa4`.
- No new migration was added: migration 008 already allows affected Voyage columns to be nullable. The API remains provider-free. This seal records prior accepted evidence; it does not perform a new live request.

## 9. Post-V3 Boundary

P7-A through P7-G are complete. Post-V3 enhancements require separate approval.

The final seal keeps Voyage focus-port coverage, Calendar completeness, JMA/geographic alert coverage, Commercial Schedule entitlement and bounded public-source coverage explicit. Translation is live optional Feed title/summary enrichment outside the Real Operational hard gate; Event/HOT Translation remains out of scope.

## 10. Knowledge Closeout Surface

| Fact surface | State | Evidence / limitation | Action |
|---|---|---|---|
| Code | verified-current | No business code changed in this review; the current implementation was checked for schema v12, persisted Feed lifecycle reads, Real Evidence/zero-Mock discovery, Translation boundaries, Settings UI and Home Feed-HOT display ordering | Treat code/config as authority for current implementation |
| Runtime | verified-current with explicit coverage boundaries | Final P7 evidence covers GFW, continuous AIS, AIS Area, Portcast, Open-Meteo, TMD/BMKG, VesselAPI Voyage Provider path and the provider-free Real Mode Runtime/API/UI boundaries; Voyage focus-port, Calendar, alert geography and public-source coverage remain bounded/partial | Keep coverage gaps separate from hard blockers; post-V3 changes require separate approval |
| Documentation | changed-and-verified | The P7 final seal updates status, architecture, V3 plan, Provider Matrix and live verification; dated checkpoint sections remain historical and are not rewritten | Use the final seal sections as authority; preserve historical evidence |
| Rules | verified-current | Root `AGENTS.md` defines docs-only guardrails, verification rules, architecture-change workflow and mandatory Closeout; no project `CLAUDE.md` or override was found | Use `AGENTS.md` as the project entry point |
| Memory | not-applicable | No project memory store or user-authorized memory write was identified | No memory files changed |
| Workspace | verified-current; cleanup candidate retained | Active ignored `.env.local`, retained `.data/shipping-hot-v3.sqlite3`, `dist/`, user `prototypes/`/`screenshots/` and the temporary `.data/shipping-hot-v3-browser.sqlite3` remain untouched; no deletion was performed. Official Bash inventory is unavailable on Windows, so the required manual equivalent audit is used | Keep active/user artifacts; seek explicit confirmation before deleting the browser verification copy |

## 11. Shipping HOT V2 Planning and Implementation Status

- V2 plan created: `docs/plans/shipping-hot-v2.md`.
- V2 plan reviewed and corrected on 2026-08-14.
- V2 plan wording follow-up: `sourceStatus` includes `degraded`; data-model references use `sourceType/dataNature`; V2.2 UI explicitly includes Calendarific Attribution; V2.2/V2.3/V2.4/V2.5 local closeout evidence and live caveats are reflected in code and docs.
- V2.0 implementation authorization: explicitly granted for the Data Trust Foundation; implemented without external Provider expansion, database schema/migration changes or dependency changes.
- V2.0 implementation: `sourceType` = `official | third_party | user | mock`; `dataNature` = `observed | reported | forecast | modelled | derived | estimated | planned`; `sourceStatus` retains `healthy | degraded | failed | disabled | never_succeeded`; timestamp roles remain separate as `updatedAt`, `sourceUpdatedAt`, `fetchedAt` and `detectedAt` where applicable.
- V2.0 evidence path: Provider → Domain → Repository JSON → API → Event evidence → HOT/UI; Mock is explicitly labeled “模拟数据”; AISStream and Open-Meteo are shown with Chinese source type/data nature labels.
- V2.0 scope guard at its historical checkpoint: no Calendarific implementation, no new providers, no `calendar_events` table, no database migration, no new dependency and no major NewsNow/Event/UI rewrite. These restrictions were phase-scoped; the explicitly approved V2.2 batch now adds the minimal calendar table and provider boundary.
- Fixed NewsNow updated-source metadata generation side effect: normal `dev`/`build`/`presource` no longer rewrites `shared/updated-sources.ts`; explicit `--updated-sources` generation is required.
- Historical V2 closeout: official `audit-inventory.sh` execution was pending because Bash was unavailable; the current 2026-08-25 Neat Freak matrix is authoritative for workspace residue and cleanup state.
- Final local V2 state with explicit live caveat: `V2.0 sealed`; `V2.1 implemented`; `V2.2 implemented / locally verified / live pending`; `V2.3 implemented / locally verified / live pending`; `V2.4 implemented / locally verified / live pending`; `V2.5 implemented / locally verified / live pending`.
