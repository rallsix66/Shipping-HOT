# Voyage / ETA Provider Status

> Updated: 2026-09-01

## Final status

The VesselAPI Voyage/ETA adapter is implemented behind the existing server-side `VoyageProvider` boundary and is selected only with `SHIPPING_DATA_MODE=real` and `SHIPPING_VOYAGE_PROVIDER=vesselapi`. Mock Mode force-selects the Mock Voyage provider even if the Voyage provider environment value is wrong, and direct factory selection fails closed.

- Engineering: `SEALED`
- Credential: `AVAILABLE` through the server-side SecretStore path; no secret value is recorded here
- Real VesselAPI ETA: `OBSERVED`
- Provider capability: `VERIFIED_LIVE`
- Focus-port destination coverage: `PENDING` / `PARTIAL`
- Voyage operational status: `coverage_pending`
- Canonical reason: `vesselapi_focus_port_coverage_pending`

## Accepted HANSA live evidence

The accepted historical live run used HANSA BREITENBURG with local `vesselId=imo:9155391`, IMO `9155391` and MMSI `538090733`.

- VesselAPI ETA returned HTTP `200`; identity validation passed.
- Official `destination_port=CNYPG`; official ETA was `2026-08-31T21:00:00Z` and its trusted provider timestamp was `2026-08-29T16:07:07Z`.
- The optional Port Event returned HTTP `200` with `Departure` at `THLCH`, yielding `originPortId=THLCH`.
- The production path `VesselAPI Provider → factory → Voyage Runtime → VoyageRepository → SQLite` completed with `recordsRead=1`, `recordsWritten=1`, `voyages=1`, `voyage_eta_history=1`, `newEpisodes=1`, `provider_runtime=healthy` and `sync_run=success`.
- Persisted episode: `vesselapi:imo:9155391:destination:CNYPG:episode:20260829T160707000Z`, `episodeState=current`; `voyageNumber=undefined`, `status=unknown`, `etd=undefined`; baseline/latest ETA were both `2026-08-31T21:00:00.000Z`; `delayMinutes=0`.
- Voyage API read, `ShippingRepository` read, SQLite restart, restart Repository read, restart ETA-history read and restart API read all passed with zero Provider calls during reads/restart. The isolated evidence reported `actualMockRows.total=0`.

## Focus-port boundary

`CNYPG` is a valid official VesselAPI destination observation, but it is outside the current formal Port Directory of `CNSHK`, `CNYTN`, `CNNSA`, `THLCH`, `MYPKG`, `PHMNL`, `IDJKT` and `VNSGN`. Therefore `canonical destinationPortId=undefined` and `focusPortCoverageObserved=false`. This mapping gap keeps operational status at `coverage_pending`; it does not invalidate the Provider `VERIFIED_LIVE` result.

IRIS MIKO (`IMO=9327566`, `MMSI=548156600`) is recorded only as a boundary case: VesselAPI ETA returned HTTP `200` and identity matched, but `official destination_port` was missing. The Provider emitted no Voyage observation and Runtime returned `skipped/no_voyage_eta_observed`. PPA Manila pre-screen information is not official VesselAPI destination evidence and cannot be promoted to a Voyage destination.

## Contract and persistence boundary

VesselAPI ETA is an AIS/crew-reported observation, not a commercial schedule. The adapter prefers IMO and falls back to legal MMSI, validates ETA and Port Event identity against the requested vessel, and treats Port Event as optional enrichment. Official `destination_port` is required for a usable Provider observation; canonical `destinationPortId` is a separate product focus-port mapping. ETA `timestamp` owns Voyage freshness and trusted source time; Port Event timestamps never replace it. Unknown origin, commercial voyage number, ETD and inferred movement status remain absent/`unknown`.

The Provider emits a candidate episode from the local vessel ID, normalized official destination key and trusted ETA timestamp. `VoyageRepository` owns recurring episode resolution, stale/equal ordering guards, `episodeState=current|superseded`, baseline/latest ETA and append-only `voyage_eta_history`; no new schema was needed. The API remains Repository/SQLite-only and never calls a Provider during reads.

The deterministic repairs accepted after the live run remain part of this sealed boundary:

- PortDirectory instance-method binding: `8fc97c0227c66acf7c7f0aab78edcb48d2e5213a`
- Provider live verification versus focus-port coverage split: `720beff0b3d52892baecd1cfc0151c7b7df2bf9a`
- Stable Episode anchor validation against the first trusted ETA history: `bf7df46b7095d51a37e316fcaddda2260663dfa4`

This document records previously accepted evidence. It does not perform a new live request, open the retained SQLite database, expose secrets or add Mock data.
