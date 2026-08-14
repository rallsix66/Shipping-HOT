# ADR-004: Shipping HOT V1 Real Provider Adapters

- Date: 2026-08-13
- Status: accepted and implemented for V1 only
- Decision owners: User
- Supersedes: the real-provider deferral statements for V1 in ADR-001/002/003

## Context

Shipping HOT V1 needs one real Vessel source and one real Weather source while retaining the sealed local Mock core. The user explicitly approved Phase 5–7 and limited the change to AISStream Vessel, Open-Meteo Marine Weather, fallback behavior, runtime verification and documentation.

## Decision

- Use AISStream as the optional real Vessel adapter.
- Use Open-Meteo Marine API plus the existing Open-Meteo Forecast API as the optional real Weather adapter.
- Keep provider-specific payloads inside `server/providers/shipping.ts`.
- Continue sending normalized `Vessel[]` and `FeedItem[]` through `shipping-store.ts`, the existing merge rules, Repository, Event Engine and HOT query.
- Keep Mock Providers as the default when the environment does not select a real Provider or required AIS key is absent.
- Keep all keys server-side in environment variables; never persist or return them.
- Keep Port and Schedule as Mock in V1. Do not add a Port congestion Provider.

## Runtime modes

- Vessel: `SHIPPING_VESSEL_PROVIDER=aisstream` plus `AISSTREAM_API_KEY` selects AISStream; otherwise Mock is selected.
- Weather: `SHIPPING_WEATHER_PROVIDER=open-meteo` selects Open-Meteo; otherwise Mock is selected.
- Provider failures preserve last-known data through the existing `providerResult()` boundary and mark returned entities stale/failed.
- No-key, disabled and no-watched-MMSI paths do not fabricate fresh real-time data.

## Scope limits

This decision does not approve V2 features, AIS history, global vessel data, multiple real Providers, Port commercial APIs, maps, notifications, AI, deployment, schema migrations or new dependencies.

## Verification

Offline tests cover normalization, malformed/error payloads, no-key fallback, disabled behavior, watched-MMSI filtering, stale handling, weather thresholds, related ports, timestamps and normalized Real → Event flow. Runtime/API smoke and SQLite restart persistence remain pending until the local native runtime can execute them.
