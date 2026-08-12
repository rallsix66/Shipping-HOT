# ADR-002: Local-first Single-user Architecture

- Date: 2026-08-11
- Status: proposed
- Decision owners: User
- Supersedes: None
- Superseded by: None

## Context

Shipping HOT is intended for one person on Windows, accessed through localhost. Cloud deployment, account registration, OAuth, payment, multi-user sync, Redis, Kafka and microservices are outside the stated product boundary.

## Decision

Propose one repository, one modular monolith, one local database, local settings and progressive enhancement. External Providers are optional adapters. Core pages and deterministic event rules must work without AI keys and without a real Provider.

## Reasons

- Matches the stated use and operating environment.
- Keeps failure and backup scope understandable.
- Avoids adding distributed-system complexity without a user need.

## Alternatives Considered

### Option A — Cloud-first multi-user platform

- Benefits: online access and collaboration.
- Costs: auth, hosting, RLS, backups, payments and operational burden.
- Why not chosen: outside the product boundary.

### Option B — Local-first modular monolith

- Benefits: low dependency count and easy offline/localhost operation.
- Costs: no built-in multi-user synchronization.
- Why chosen: matches the target user and constraints.

## Consequences

### Positive

- SQLite/db0 remains the default persistence boundary.
- Mock Providers are a valid development and test path.
- Core behavior does not depend on AI or cloud credentials.

### Negative / Trade-offs

- Remote access and collaboration are intentionally deferred.
- Local data backup/restore must be documented before real data accumulation.

## Migration and Compatibility

- Existing data: keep NewsNow cache/user data during transition.
- Existing interfaces: do not remove OAuth/cloud adapters in this proposal.
- Rollout sequence: confirm boundary, then add local domain data incrementally.
- Compatibility period: retain optional deployment paths until dependency analysis.

## Rollback

- Trigger: local runtime cannot support an approved feature without distributed services.
- Steps: stop the affected phase and document the new architecture change request.
- Data restoration: no migration or destructive cleanup is authorized here.

## Verification

- Run local startup, storage initialization, and deterministic tests in an authorized implementation phase.
- Verify core pages work with no AI key and no real Provider.

## Related Documents

- `docs/architecture.md`
- `docs/status.md`
- `docs/plans/shipping-hot-v1.md`

