# ADR-006: Retire Vessel Search, AIS Tracking, and Voyage/ETA Capabilities

- Date: 2026-10-09
- Status: **Accepted (user sign-off 2026-10-09)**
- Decision owners: User
- Supersedes in intent: retained V3 vessel/AIS/voyage boundaries in ADR-004/ADR-005 for **new work** only; historical evidence and sealed P7 facts stay archived, not rewritten
- Implements in: `docs/plans/shipping-hot-risk-intelligence-2026-09-29.md` §6 R1

## Context

The product direction (2026-09-29 / 09-30) stops investment in vessel discovery, watchlists, AIS position streaming, voyage episodes and ETA presentation. The forwarder continues to book space and supply a vessel name; Shipping HOT shifts to **risk intelligence**: eight-port operational reference, weather and official alerts, calendars (annual reference plus operational promo/policy layers), policy library, and an LLM-backed intel pipeline. Vessel-centric UI and Providers remain in the codebase today and conflict with the new scope.

## Decision

1. **R1 will remove** (not merely hide) server Providers and Runtime jobs for AISStream, VesselAPI vessel search, GFW vessel identity, and voyage sync; API routes under `/api/shipping/vessels/**`, `/api/shipping/search/vessels*`, watchlist mutations; client routes `/vessels`, `/voyages` and related pages; registry entries and environment variables that exist only for those capabilities.
2. **Data is archived, not dropped**: R1 adds an idempotent SQLite migration that renames vessel/voyage/watch-related tables with a `_retired_` prefix (exact table list fixed in the R1 migration PR). User rows in retained databases stay recoverable.
3. **Recovery contract**: Before R1 code deletion on `main`, tag `pre-r1-vessel-removal`. Maintain `docs/archive/vessel-capability-recovery.md` (created in R1) listing removed paths, archived tables, env vars, external accounts (AISStream, VesselAPI, GFW), and how impact cards may reference ports by UN/LOCODE without vessel identity.
4. **S7 harness**: Remove vessel/voyage browser steps in R1; other flows remain the regression baseline.
5. **Commercial schedule** stays `DEFERRED / NOT_REQUIRED_FOR_CURRENT_SCOPE`; this ADR does not reopen S6.

## Consequences

- Readiness, HOT, and Feed semantics that referenced vessel entities must not assume AIS/voyage data after R1.
- Real-mode credentials for GFW/VesselAPI/AISStream become unused; secrets may remain on disk until the user deletes them—R1 must not auto-delete secrets.
- R0 does **not** execute deletion; it only records the authorized boundary for R1.

## Out of scope

- PostgreSQL, new frameworks, or port-count expansion beyond the existing eight ports.
- Re-implementing ETA or carrier schedules under another name.
