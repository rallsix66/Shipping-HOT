# ADR-004: Shipping HOT V1 Real Provider Adapters

- Date: 2026-08-13
- Status: accepted and implemented for V1 only
- Decision owners: User
- Supersedes: the real-provider deferral statements for V1 in ADR-001/002/003

## Context

Shipping HOT V1 needs one real Vessel source and one real Weather source while retaining the sealed local Mock core. The user explicitly approved the limited change to AISStream Vessel, Open-Meteo Marine Weather, fallback behavior, runtime verification and documentation.

## Decision

- Use AISStream as the optional real Vessel adapter.
- Use Open-Meteo Marine API plus the existing Open-Meteo Forecast API as the optional real Weather adapter.
- Keep provider-specific payloads inside `server/providers/shipping.ts`.
- Continue sending normalized `Vessel[]` and `FeedItem[]` through `shipping-store.ts`, the existing merge rules, Repository, Event Engine and HOT query.
- Keep Mock Providers as the default only when the environment does not select a real Provider. If a real mode is explicitly selected but its required key is absent, retain that requested mode and return no data/`never_succeeded`; never silently switch to Mock.
- Keep all keys server-side in environment variables; never persist or return them.
- Keep Port and Schedule as Mock in V1. Do not add a Port congestion Provider.

## Runtime modes

- Vessel: `SHIPPING_VESSEL_PROVIDER=aisstream` selects AISStream mode; with no `AISSTREAM_API_KEY`, the mode remains `aisstream` and returns no data/`never_succeeded`. When AISStream is not requested, Mock is selected.
- Weather: `SHIPPING_WEATHER_PROVIDER=open-meteo` selects Open-Meteo; otherwise Mock is selected.
- Provider failures preserve only same-provider last-known data through the existing `providerResult()` boundary and mark returned entities stale/failed; with no same-provider history, they return no data.
- No-key, disabled and no-watched-MMSI paths do not fabricate fresh real-time data.
- AIS input is split into `VesselWatchTarget` identity/control records and an optional same-source AIS last-known observation list. Mock Vessel dynamic fields are never passed into the AIS adapter.
- AIS normalization retains only target identity plus fields proven by the current PositionReport; `statusChangedAt` is derived from the first continuously observed timestamp of the current navigation state and is not a guaranteed real-world transition timestamp.
- Historical Events remain in SQLite across mode changes, but current Event/HOT input accepts only Events whose provenance `sourceId` is compatible with the active Provider mode. A Provider switch is not evidence that an old Event resolved.

## Scope limits

This decision does not approve V2 features, AIS history, global vessel data, multiple real Providers, Port commercial APIs, maps, notifications, AI, deployment, schema migrations or new dependencies.

## Verification

Offline tests cover normalization, malformed/error payloads, requested-mode/no-data behavior when a key is absent, disabled behavior, watched-MMSI filtering, AIS watch-target/observation isolation, same-source status duration, cross-source merge protection, stale handling, weather thresholds, related ports, deterministic timestamps, weather-feed isolation, Provider-mode Event/HOT filtering and normalized Real to Event flow. Runtime/API smoke and SQLite restart persistence were verified on Node 22.23.2; Node 24.15.0 remains incompatible with the bundled native module and uses the documented fallback.
