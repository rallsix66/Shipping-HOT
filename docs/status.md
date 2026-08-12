# Project Status — Shipping HOT / NewsNow Foundation

> Snapshot date: 2026-08-12
> Evidence scope: local code / configuration / Git metadata; runtime and dependency execution not verified
> Source of truth for: current implementation and verification state

## 1. One-Sentence Status

The baseline was a clean checkout of NewsNow; the current workspace adds only the proposal/architecture documents and `AGENTS.md`, and no Shipping HOT business code has been implemented.

## 2. Current Environment

- Active branch: `main`; package version: `0.0.41`
- Git remotes: `origin=https://github.com/rallsix66/Shipping-HOT.git` and `upstream=https://github.com/ourongxing/newsnow.git`; GitHub CLI API authentication is still invalid, so account metadata was not API-verified
- Local run status: `pending`; `node_modules/` is absent and no install/run was authorized
- Deployment status: `out-of-scope`; repository contains optional Cloudflare/Vercel/Bun/Docker configuration, but no deployment was performed
- Database / external services: db0 is configured; local Node uses `better-sqlite3`; exact runtime DB file location is `pending`
- Last verified surface: source tree, package/config files, Git metadata, API/source/UI files; no runtime surface

## 3. Current Architecture Summary

- Tech stack: React 19, Vite 7, TypeScript, TanStack Router, React Query, Jotai, Nitro, db0, better-sqlite3, Vitest, Vite PWA
- Main modules: `src/` UI/router/state, `server/api/` handlers, `server/sources/` fetchers, `server/database/` cache/user tables, `shared/` types/metadata, `scripts/` generated metadata
- Data source of truth: Source definitions in `shared/pre-sources.ts`; generated metadata in `shared/sources.json`; cache/user data in db0 tables; browser focus/order in localStorage
- Authentication / authorization: optional GitHub OAuth and JWT middleware; not required for local-only proposal
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
| Vessel/Port/Voyage/Event | proposal | `docs/plans/shipping-hot-v1.md` | No code or schema |
| Shipping HOT UI/routes | proposal | `docs/plans/shipping-hot-v1.md` | Current routes remain `/` and `/c/$column` |

## 5. Decision Status

### Current Active Decisions

- Retain NewsNow as the foundation until migration cost and risk are proven higher.
- Treat the current NewsNow code/config as the authority for current implementation facts.

### Approved but Not Fully Implemented

- None. No Shipping HOT target has been approved.

### Proposals

- Local-first single-user Shipping HOT architecture.
- Separate Information Feed from Operational Data through Event/HOT convergence.
- Vessel/Port/Voyage/Event/Settings model and isolated Provider interfaces.

### Deprecated / Rejected

- None recorded. Do not infer deletion approval from the proposal's `REMOVE` section.

## 6. Known Inconsistencies

| Source of truth | Conflicting surface | Impact | Action |
|---|---|---|---|
| Current code is NewsNow | Proposed Shipping HOT documents | A reader could mistake proposal for implementation | Proposal is explicitly marked and kept in `docs/plans/` |
| `package.json` uses `pnpm` scripts | No `node_modules/` in checkout | Commands cannot currently be runtime-verified | Mark runtime `pending`; do not install in this task |
| `nitro.config.ts` selects SQLite connector | No explicit local DB path in repo | Exact DB file location is unknown | Mark pending until authorized runtime verification |
| GitHub API auth is invalid | `gh auth status` / `gh repo view` fail with 401 | Account visibility and repo metadata cannot be verified through `gh` | Keep API verification pending; local `origin` remains evidence of configured remote |

## 7. Current Risks

| Priority | Risk | Evidence | Recommended action |
|---|---|---|---|
| P1 | Shipping HOT proposal could be implemented before approval | Proposal docs only; no approved target | Wait for explicit architecture confirmation |
| P1 | External Source/provider failures lack a universal freshness contract | `server/api/s/index.ts`, `shared/types.ts` | Design before implementation; do not claim current support |
| P2 | OAuth/cloud deployment dependencies may be unnecessary locally | `server/api/oauth/**`, `nitro.config.ts`, Docker files | Dependency analysis before removal |
| P2 | Runtime/build not verified | `node_modules/` absent | Run authorized checks later |

## 8. Current Work and Blockers

- Active work: architecture/documentation reconciliation only.
- Blockers: user approval is required before Shipping HOT business implementation; GitHub CLI API re-authentication is still needed for account-level operations.
- Pending verification: local runtime, build, tests, actual db0 file path, deployment/live state.

## 9. Recommended Next Action

User reviews `docs/architecture.md` and `docs/plans/shipping-hot-v1.md`; no implementation should begin until the architecture is explicitly confirmed.

## 10. Knowledge Closeout Surface

| Fact surface | State | Evidence / limitation | Action |
|---|---|---|---|
| Code | verified-current | Current `main` tree, package/config, server, shared and UI files inspected; runtime behavior not included | Treat code/config as authority for current implementation |
| Runtime | pending | No `node_modules/`; no install, server, build or live probe performed | Verify only in a separately authorized task |
| Documentation | changed-and-verified | `docs/architecture.md`, `docs/status.md`, ADRs and proposal were reconciled; links are relative existing paths | Keep current status/proposal split |
| Rules | changed-and-verified | Root `AGENTS.md` defines project guardrails, verification rules, architecture-change workflow, and mandatory task Closeout; no project `CLAUDE.md` or override; global Codex `AGENTS.md` is empty | Use `AGENTS.md` as the project entry point |
| Memory | not-applicable | No project memory store or user-authorized memory write was identified | No memory files changed |
| Workspace | changed-and-verified | `git status` reports a clean working tree; no business files changed | Preserve the clean workspace; no cleanup performed |
