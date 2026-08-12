# ADR-001: Use NewsNow as the Shipping HOT Foundation

- Date: 2026-08-11
- Status: accepted for the local Mock implementation; real Provider expansion remains deferred
- Decision owners: User
- Supersedes: None
- Superseded by: None

## Context

NewsNow already provides a React/Vite/Nitro modular monolith, Source metadata, fetch helpers, cache, db0/SQLite integration, UI cards, routing, PWA and tests. Shipping HOT is a local single-user tool and does not justify a framework migration based on current evidence.

## Decision

Retain NewsNow as the implementation foundation and adapt existing Source, cache, UI and routing boundaries incrementally. The local Mock implementation is approved within this boundary; real Provider expansion remains deferred.

## Reasons

- Existing code is present and structurally coherent.
- The target is a small local tool, so migration cost would be disproportionate without evidence.
- Existing deployment and auth paths may have dependencies that must be analyzed before removal.

## Alternatives Considered

### Option A — Rewrite with Next.js/Prisma/Supabase

- Benefits: new project conventions.
- Costs: migration, data/runtime risk, new dependencies and loss of existing working paths.
- Why not chosen: no code evidence proves the retained implementation cost is higher.

### Option B — Retain and minimally adapt NewsNow

- Benefits: smallest change surface and preserves existing Source/cache/UI assets.
- Costs: requires careful separation of structured shipping data from `NewsItem`.
- Why chosen: best fit for a local single-user brownfield project.

## Consequences

### Positive

- Lower migration risk and fewer dependencies.
- Existing OAuth, Cloudflare, Docker and non-shipping Sources can remain until dependency analysis.

### Negative / Trade-offs

- The codebase will contain transitional NewsNow capabilities while Shipping HOT is introduced.
- New Domain/Provider boundaries must be added without bypassing current Source abstractions.

## Migration and Compatibility

- Existing data: preserve `cache` and `user` until dependency analysis.
- Existing interfaces: preserve `/api/s`, SourceGetter and current routes while Shipping HOT runs beside them.
- Rollout sequence: local Mock implementation first; real Provider expansion requires a separate decision.
- Compatibility period: until all current NewsNow consumers are mapped.

## Rollback

- Trigger: migration cost or dependency impact exceeds the approved boundary.
- Steps: stop at the phase boundary and retain current NewsNow paths.
- Data restoration: no data migration is authorized by this proposal.

## Verification

- Compare the retained implementation cost with any proposed migration cost and risk.
- Keep current tests/build checks passing after any future approved change.

## Related Documents

- `docs/architecture.md`
- `docs/status.md`
- `docs/plans/shipping-hot-v1.md`
