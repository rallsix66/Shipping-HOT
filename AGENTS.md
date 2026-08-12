# Project Instructions

## Project

- Current codebase: NewsNow, being evaluated as the foundation for the proposed local Shipping HOT tool.
- Shipping HOT remains `proposal`; do not describe it as implemented or verified.

## Commands

- Install: `pnpm install`
- Run: `pnpm dev`
- Test: `pnpm test`
- Lint / Build: `pnpm lint` / `pnpm build`

## Source of Truth

- Architecture foundation: `docs/architecture.md`
- Implementation status: `docs/status.md`
- Decisions: `docs/adr/`
- Shipping HOT proposal: `docs/plans/shipping-hot-v1.md`

## Guardrails

- Preserve the existing Vite + React + Nitro + db0 modular monolith unless an approved architecture change says otherwise.
- Keep Information Feed and Operational Data separate; providers must not leak vendor formats into Domain or UI.
- Do not make UI components call external APIs or SQLite directly.
- Do not add real shipping APIs, ORM migrations, or Shipping HOT business code while the proposal is unconfirmed.

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
