# Project Instructions

## Project

- Current codebase: NewsNow foundation with a local Shipping HOT implementation and explicit V3 Readiness gate on the fixed Node `24.15.0` / ABI `137` toolchain (`better-sqlite3@12.6.2`, schema v11, `.data/shipping-hot-v3.sqlite3`). Real activation uses an actual schema-discovered zero-Mock SQL/Repository scan over every Shipping HOT business table carrying `source_type`; `provider_usage.request_count` is a capability sync invocation count and `records_count` is persisted normalized-record count.
- Shipping HOT Mock, approved V1 real-provider flows, V2.2–V2.5 local flows, accepted V3 phases P0 Persistence, P1A Port Directory Foundation, P1B Mock Isolation, P2A Search Foundation, P2B Identity Seal, P2C Background Runtime Foundation, P3A AIS Tracking Runtime Foundation, P3B Voyage / ETA Foundation, P3 Feed Freshness Batch 1, the controlled Feed/Calendar/Port/Weather Runtime activation slice and Translation T1 Foundation are implemented and locally verified where stated in `docs/status.md`. Real Operational Readiness remains blocked by missing real Voyage/ETA capability, pending AIS observation and pending official weather-alert coverage; real Translation Providers and later business stages remain deferred until separately approved.

## Commands

- Install: `pnpm install`
- Run: `pnpm dev`
- Test: `pnpm test`
- Lint / Build: `pnpm lint` / `pnpm build`

## Source of Truth

- Architecture foundation and approved V1 Provider boundary: `docs/architecture.md`
- Implementation status: `docs/status.md`
- Decisions: `docs/adr/`
- Shipping HOT V1 roadmap and Provider status: `docs/plans/shipping-hot-v1.md`
- Shipping HOT V2 implementation boundaries and closeout state: `docs/plans/shipping-hot-v2.md`
- Shipping HOT V3 Real Data plan and phase state (P0–P3B): `docs/plans/shipping-hot-v3-real-data.md`

## Guardrails

- Preserve the existing Vite + React + Nitro + db0 modular monolith unless an approved architecture change says otherwise.
- Keep Information Feed and Operational Data separate; providers must not leak vendor formats into Domain or UI.
- Do not make UI components call external APIs or SQLite directly.
- Do not add additional real shipping APIs, paid services, provider SDKs, or ORM migrations without a new architecture decision; AISStream and Open-Meteo Marine are the approved V1 adapters.
- Keep Mock Providers, fixtures, deterministic Domain rules, and local fallback behavior independent from real API credentials.

## Confirm Before

- Database schema or migration changes, deleting NewsNow capabilities, changing auth/deployment, adding secrets, or introducing a new framework.
- Any implementation after the user explicitly confirms: `架构确认，开始执行 Phase 1`.

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
