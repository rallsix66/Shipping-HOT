# Voyage / ETA Provider Status

> Updated: 2026-09-01

The real VesselAPI Voyage/ETA adapter is implemented behind the existing server-side `VoyageProvider` boundary. It is selected only with `SHIPPING_DATA_MODE=real` and `SHIPPING_VOYAGE_PROVIDER=vesselapi`; Mock Mode continues to use the Mock Voyage provider and Real Mode never falls back to it.

Current local state:

- Adapter: `implemented`
- Credential: `credential_missing` (`VESSELAPI_API_KEY` was checked through the existing `FileSecretStore`/server environment loader; no key value is recorded here)
- Live gate: `coverage_pending`
- Live VesselAPI request: not made because the credential is absent

The adapter uses `https://api.vesselapi.com/v1`, queries ETA by IMO first and legal MMSI otherwise, and optionally reads the latest Port Event. ETA source timestamps and explicit Departure event timestamps are retained. `destination_port` and a Departure event port are accepted only after exact/alias resolution through the existing Port Directory. Unknown origin, commercial `voyageNumber`, ETD and inferred status remain absent/`unknown`; no local fetch time is used as provider evidence.

VesselAPI ETA is an AIS/crew-reported observation, not a commercial schedule. A missing ETA or 404 produces a skipped/no-observation Runtime result; provider errors remain typed as `auth_failed`, `entitlement_missing` only for explicit feature-entitlement evidence, `provider_forbidden`, `rate_limited`, `provider_timeout`, `provider_unavailable` or `provider_contract_changed`. Existing Repository guards, append-only `voyage_eta_history`, Real lineage filtering and provider-free API reads remain in force.

No new migration was added. Migration 008 already makes the origin, destination, voyage number and ETA/ETD columns nullable. No retained SQLite database, secret, raw Provider payload or Mock row was modified by this milestone.
