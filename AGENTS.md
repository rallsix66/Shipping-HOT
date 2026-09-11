# Project Instructions

## Project

- Current codebase: NewsNow foundation with a local Shipping HOT implementation and explicit V3 Readiness gate on the fixed Node `24.15.0` / ABI `137` toolchain (`better-sqlite3@12.6.2`, schema v12, `.data/shipping-hot-v3.sqlite3`). Real activation uses an actual schema-discovered zero-Mock SQL/Repository scan over every Shipping HOT business table carrying `source_type`; `provider_usage.request_count` is a capability sync invocation count and `records_count` is persisted normalized-record count. Translation T3A Runtime Foundation, T3B Feed Read, T3C Feed UI and the repaired, formally sealed T3D executable acceptance runner are implemented and locally verified where stated in `docs/status.md`; the post-T3 Translation Settings UI and redacted DeepSeek Secret API are also implemented. Accepted DeepSeek Provider/automatic Translation Runtime evidence is `VERIFIED_LIVE` for optional FeedItem `title`/`summary` enrichment; it remains outside the REAL_OPERATIONAL hard-readiness gate and is not re-verified by a docs-only closeout.
- Shipping HOT Mock, approved V1 real-provider flows, V2.2–V2.5 local flows, accepted V3 phases P0 Persistence, P1A Port Directory Foundation, P1B Mock Isolation, P2A Search Foundation, P2B Identity Seal, P2C Background Runtime Foundation, P3A AIS Tracking Runtime Foundation, P3B Voyage / ETA Foundation, P3 Feed Freshness Batch 1, the controlled Feed/Calendar/Port/Weather Runtime activation slice, Translation T1 Foundation, the approved Translation T2 DeepSeek Provider Foundation plus its Review Repair, Translation T3A Runtime Foundation, T3B Feed Read, T3C Feed UI and formally sealed T3D executable acceptance runner are implemented and locally verified where stated in `docs/status.md`. GFW is the current verified Real Vessel Search/canonical identity provider; VesselAPI Search is optional and AISStream is reserved for AIS tracking. The accepted final controlled Real Mode evidence reports `ready=true / overall=degraded` with no failed hard checks, not full capability coverage: Voyage focus-port coverage remains `coverage_pending`, Calendar completeness remains partial, JMA remains disabled/live-pending, and public Port/Weather/Feed coverage is source-bounded. Commercial Schedule remains unavailable without approved entitlement; broader Translation remains out of scope pending separate approval.
- The verified historical business-code baseline is `main` at `e34115870804c0ef0040a568968c9ecce81af786` (`feat: expand Thailand annual calendar references`); the current `main` documentation-sync head at round start was `6f0a22cb271c4504237798f806d6695ee49bdd08`. The five-country annual reference calendar and the Thailand 23-item expansion are committed. Current product state and verification authority is `docs/status.md`; subsequent documentation-only edits may remain uncommitted and have no predeclared commit SHA. Thailand's SOC annual body and human double-review remain pending, so the reference calendar is not nationwide-complete coverage. Retain the untracked diagnostic artifacts and the existing `pages.tsx` line-ending-only worktree state. Historical P7 remains `codex/shipping-hot-v3-real-data@ed2c8448699971328b23247508a7b91fb537ab6b`; never rewrite that seal as full capability coverage.

## Current Round — Standalone & Content Completion (S0–S8)

- This round continues the existing draft branch `codex/shipping-hot-standalone-first-pass` (head `4b5ff00a01aae9e8298ad088261440d2218e668b` at round start) and draft PR #1. The sole active plan is `docs/plans/shipping-hot-standalone-content-2026-09-10.md` (S0–S8). The archived historical plan is `docs/archive/shipping-hot-v3-real-data.md`.
- Approved scope: keep the Vite + React + Nitro + db0 / SQLite modular monolith; remove unrelated NewsNow product identity and business; verify real data and eight-port coverage; complete the five-country annual reference calendar with official evidence; add safe original-article extraction, versioning and source traceability; extend translation to the full article body with bilingual reading and budget controls; research (and, only with access, integrate) approved carrier commercial schedules.
- Not authorized by this round: final merge, release, switching the user's live service, operating the retained database or volume, new paid services/accounts/budgets, new out-of-contract Providers, widening ports/public network, clearing databases, deleting secrets, force-pushing, or cleaning user residue.
- Each stage passes only after implementation, local tests, the full local gate, stage-specific acceptance, independent review and a real Neat Freak closeout. A stage may proceed to the next only when it is `PASS`; `FAIL` is fixed, `BLOCKED` continues only unrelated work, and `NOT_RUN` never counts as pass.

## Commands

- Install: `pnpm install --frozen-lockfile`
- Run (dev): `pnpm dev`
- Build: `pnpm build` (generates `dist/.nitro/types`, required before typecheck on a clean checkout)
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Test: `pnpm exec vitest run -c vitest.config.ts` (create `.tmp/` first; the native restart test writes under it)
- Stage/final local gate: the full command sequence in the active plan section 4.3 G.

## Source of Truth

- Current active plan (S0–S8): `docs/plans/shipping-hot-standalone-content-2026-09-10.md`
- Architecture foundation and approved boundaries: `docs/architecture.md`
- Implementation status and this round's acceptance records: `docs/status.md`
- Decisions: `docs/adr/`
- Archived V3 Real Data plan (historical evidence only): `docs/archive/shipping-hot-v3-real-data.md`
- Shipping HOT V1/V2 plans (history): `docs/plans/shipping-hot-v1.md`, `docs/plans/shipping-hot-v2.md`

## Guardrails

- The annual reference calendar uses bundled `server/data/annual-calendar/` JSON through its own provider-free GET service. It must not write operational Calendar, invoke Providers, or affect Runtime/Event/HOT/readiness. Show country-specific incompleteness and applicability. Candidate docs are review evidence, not runtime inputs; the larger calendar migration proposal remains paused.

- Preserve the existing Vite + React + Nitro + db0 modular monolith unless an approved architecture change says otherwise.
- Keep Information Feed and Operational Data separate; providers must not leak vendor formats into Domain or UI.
- Do not make UI components call external APIs or SQLite directly.
- Do not add additional real shipping APIs, paid services, provider SDKs, or ORM migrations without a new architecture decision; AISStream and Open-Meteo Marine are the approved V1 adapters.
- Translation T3A is the approved exception for the additive v12 `translation_cache` work-state migration and fixed server-side DeepSeek Runtime boundary. T3B Feed Read, T3C Feed UI and formally sealed T3D executable acceptance are provider-free at read time and optional enrichment; T3D is capped at one diagnostic plus one current Feed field call, accepts `translation_test` or same-hour aggregate `mixed` diagnostic usage, shares the Translation retry/backoff and circuit policy with T3A, separates server evidence from browser evidence, and keeps live verification pending until the real settings/evidence permit it. The post-T3 Settings product layer may expose only the fixed DeepSeek settings, redacted Secret metadata/management and existing fixed test gate; it must not reopen T3 core semantics. Do not add another migration/provider/secret, automatic fallback, or broader entity translation without separate approval.
- Keep Mock Providers, fixtures, deterministic Domain rules, and local fallback behavior independent from real API credentials.
- Calendar cache-only Runtime skips return `calendar_cache_fresh` without `sourceUpdatedAt` and preserve existing Provider runtime evidence; partial or actual Calendar syncs still determine their own `success`/`failed` result.
- Calendar active/readable provenance sources are not automatically cache-required sources. Placeholder official/manual providers declare no cache requirement; once an official/manual dataset is explicitly configured, its provenance source remains required even when the current query returns no events, and missing/stale/failed coverage prevents a full cache skip.
- Calendar `recordsRead`/`recordsWritten` count only the current sync's normalized records; retained cross-year snapshots and other cached countries do not inflate the count, while `provider_usage.request_count` remains the capability sync invocation count.

## Git and CI

- Work on the existing draft branch and PR #1. Do not push `main`, force-push, or squash away the per-stage commits. Stage commits must contain only reviewed files, never `.env.*`, secrets, retained DBs, third-party restricted full text, debug logs or temp screenshots.
- Stage-branch pushes, PR updates and draft-PR changes must produce **zero** CI runs during this round. The single `.github/workflows/shipping-hot-checks.yml` triggers only on `push` to `main`; the old `docker.yml`/`release.yml` auto-triggers are retired. Do not use `[skip ci]` as the policy and do not pre-push "to see what happens".
- Local verification is mandatory at every stage because CI is silent. Only the final merge to `main` triggers the one final check run. Do not merge any stage into `main`, and do not re-run CI after a docs-only "CI passed" commit (record post-merge CI evidence in PR #1 instead).

## Confirm Before

- Database schema or migration changes, deleting NewsNow capabilities, changing auth/deployment, adding secrets, or introducing a new framework.
- Any new Provider, paid service/budget, port-scope expansion, final merge/release or live-service switch. The standalone S0–S8 implementation itself is authorized by the active plan; a stage does not need separate per-stage confirmation.

## Verification

- Read `docs/status.md` before claiming current behavior.
- Run the relevant typecheck, lint, test, and build checks when dependencies are installed.
- Keep unverified runtime claims marked `pending`.

## Task Closeout Rule

Every Implementation Task must complete Closeout before it is reported complete:

```text
Implementation
→ Verification
→ typecheck
→ lint
→ test
→ build
→ Neat Freak / 洁癖 Closeout
→ Status Update
→ Completion Report
```

- Run the real Neat Freak Skill available in the active environment; do not invent a substitute workflow.
- If the real Neat Freak / 洁癖 Skill cannot be located, loaded, or executed, mark Closeout as `pending`. Do not silently skip it, replace it with an invented equivalent workflow, or report the Implementation Task as fully complete until the missing Closeout is explicitly reported.
- Closeout must check code vs `docs/status.md`, proposal vs implemented/verified state, architecture accuracy, roadmap/state/ADR needs, stale TODOs, duplicate/conflicting docs, temporary files, secrets/local databases, and `git status`.
- If a check cannot run, mark it `pending` and state why; never write `verified` without evidence.
- Architecture-changing tasks must follow `Architect → Architecture Approval → Implementation → Verification → Neat Freak Closeout`; ordinary bug/style/page changes do not repeat Architect unless their boundaries change.
- Do not delete cleanup candidates during Closeout without explicit user confirmation after the full report.
