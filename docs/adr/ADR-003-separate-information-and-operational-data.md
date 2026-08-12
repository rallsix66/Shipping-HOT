# ADR-003: Separate Information Feed from Operational Shipping Data

- Date: 2026-08-11
- Status: proposed
- Decision owners: User
- Supersedes: None
- Superseded by: None

## Context

NewsNow models articles and ranked items as `NewsItem[]`. Shipping HOT additionally needs current vessel position, ETA, navigation status, port congestion, waiting time, voyages and delay. These values have different identity, freshness and update semantics.

## Decision

Propose two explicit data worlds:

- Information Feed: normalized FeedItems from News Sources.
- Operational Data: Vessel, Port, Voyage and Provider Snapshots.

Use Event as the evidence-bearing convergence layer. HOT is a query/aggregation view over Events and relevant FeedItems, not a second copy of every source record.

## Reasons

- Prevents structured state from being forced into article fields.
- Keeps provider-specific formats outside Domain and UI.
- Makes delay and freshness deterministic and testable.

## Alternatives Considered

### Option A — Store every value as `NewsItem`

- Benefits: minimal immediate type changes.
- Costs: loses identity, state transitions, freshness and relational meaning.
- Why not chosen: cannot express Vessel/Port/Voyage semantics safely.

### Option B — Build two completely independent systems

- Benefits: separate models are simple in isolation.
- Costs: duplicate caches, UI aggregation and error handling; no unified HOT view.
- Why not chosen: Event/HOT convergence provides the needed relationship with less duplication.

## Consequences

### Positive

- Provider adapters can normalize before Domain rules run.
- Event evidence can link a FeedItem to Vessel/Port/Voyage state.
- First version can avoid a full Port Call model and infinite AIS history.

### Negative / Trade-offs

- Requires explicit DTOs and relation identifiers.
- HOT query logic must handle both persisted events and current freshness.

## Migration and Compatibility

- Existing data: keep current `NewsItem` and cache contract for Information Feed.
- Existing interfaces: add structured interfaces beside SourceGetter rather than changing every News Source.
- Rollout sequence: types → Mock Provider → deterministic Event rules → real Provider.
- Compatibility period: existing NewsNow pages remain functional while Shipping HOT is introduced.

## Rollback

- Trigger: structured model creates unacceptable coupling or data migration risk.
- Steps: disable new Provider/Event paths and keep existing Source/cache UI.
- Data restoration: no destructive migration is authorized by this proposal.

## Verification

- Test normalized snapshots, state comparison, delay, freshness, provider failure and Event links with fixtures.
- Verify UI distinguishes latest, stale, failed and unavailable data.

## Related Documents

- `docs/architecture.md`
- `docs/status.md`
- `docs/plans/shipping-hot-v1.md`

