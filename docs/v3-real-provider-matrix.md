# V3 Real Data Provider Matrix

> Audit date: 2026-08-29
> Scope: local source, configuration, controlled Real Mode runtime smoke and built Nitro HTTP evidence only. No new secret, provider SDK, paid account or deployment activation was added.
> Status vocabulary: `not_started`, `adapter_ready`, `credential_missing`, `entitlement_missing`, `connection_verified`, `coverage_pending`, `verified_live`, `failed`.

## Reading this matrix

These columns are intentionally separate:

- **配置** describes what the local environment requests. It is not proof that Real Mode is active.
- **Secret** reports only whether a credential is present and where the server-side loader can obtain it; secret values are never recorded here.
- **真实请求** requires an actual request against the named provider. Fixtures, parser tests and Mock responses do not count.
- **状态** is the current conservative status. A configured adapter remains `coverage_pending` until its required live evidence exists.

The current `.env.local` does not define `SHIPPING_DATA_MODE`. The application therefore defaults to `mock` unless a caller explicitly sets `SHIPPING_DATA_MODE=real`. A process-only controlled smoke did set Real Mode and produced the evidence recorded in `docs/live-verification.md`; the safe default and local files were not changed. `SHIPPING_VESSEL_PROVIDER=aisstream` is accepted as the existing AIS tracking provider setting, with explicit `SHIPPING_AIS_PROVIDER` taking precedence when present.

## Capability matrix

| Capability | Current Provider / effective mode | Real Provider | Adapter | API key required | Secret configured | Real request verified | Fee / quota | Current status | Evidence / gate |
|---|---|---|---|---|---|---|---|---|---|
| Vessel Search | `mock` by default; `SHIPPING_VESSEL_SEARCH_PROVIDER` is not set | VesselAPI | Yes: server-side `createVesselApiSearchProvider()` | Yes: `VESSELAPI_API_KEY` | No (`credential_missing`) | No | Account plan and quota not verified; may be paid | `credential_missing` | Search mapping and cache are locally tested; no live VesselAPI search was made in this inventory. |
| Vessel Identity | Mock search identity when default mode is used | VesselAPI identity fields + existing canonical resolver | Resolver ready; no separate live identity adapter | Inherited from VesselAPI Search | No | No | Inherited from VesselAPI Search | `credential_missing` | Canonical identity/promotion is implemented, but live identity evidence cannot exist without a real search result. |
| AIS Position | `mock` by default; controlled Real Mode selected AISStream from `SHIPPING_VESSEL_PROVIDER=aisstream` | AISStream | Yes: bounded PositionReport adapter and tracking Job | Yes: `AISSTREAM_API_KEY` | Yes, server-side only | Runtime Job succeeded with 0 records; no eligible watched MMSI/PositionReport | Account limits not verified in this audit | `coverage_pending` | `connection_verified / pending_observation`; `verified_live` requires a PositionReport persisted to SQLite. |
| AIS Area / Port Traffic | `aisstream` requested; Real Mode still not active by default | AISStream area subscription | Yes: area session, Port Directory lookup and bounded aggregation | Yes: `AISSTREAM_API_KEY` | Yes, server-side only | No usable area observation recorded | Account limits not verified | `coverage_pending` | Previous probe reached connection without an observation; watched-vessel and area-AIS boundaries remain separate. |
| Port Intelligence | `portcast` requested in `.env.local` | Portcast public pages | Yes: public-page parser for the eight Port Directory ports | No provider key for the public-page path | Not applicable | Controlled Runtime smoke persisted 8 Port Directory-aligned rows; built `/api/shipping` read them | Public-page availability and robots/legal basis remain operational caveats; no quota claim | `verified_live` | Live page evidence and persisted/API rows are recorded; no Mock enrichment was used. |
| Weather | `open-meteo` requested in `.env.local` | Open-Meteo Marine + Forecast | Yes: server-side marine/forecast adapter | No | Not applicable | Controlled Runtime smoke persisted 7 real weather-risk Feed rows; `/api/shipping/feed` exposed wind/gust/window fields | Public endpoint limits not verified | `verified_live` | Model forecast data is real and persisted; official weather-alert coverage remains separate and pending. |
| Weather Alerts | `public` requested, but registered JMA/TMD/BMKG sources are disabled/live-pending | Country-specific official sources | Parser boundary exists; no enabled verified-live source | No | Not applicable | No | Source-specific public availability; no quota claim | `coverage_pending` | China, Thailand, Malaysia, Philippines, Indonesia and Vietnam coverage is not complete; expired alerts must not enter HOT. |
| Voyage / ETA | `mock` provider in default runtime; controlled Real Mode keeps the Job disabled because no real adapter/key is configured | VesselAPI ETA and optional Port Events, subject to account entitlement | No real ETA adapter; Mock adapter only | Yes: `VESSELAPI_API_KEY` | No (`credential_missing`) | No probe; no entitlement claim | Endpoint entitlement and plan/quota unknown | `credential_missing` | Gap is recorded in `docs/voyage-provider-gap.md`; no ETA/Port Events implementation or origin guess was added. |
| Feed / Shipping News | Public Feed adapter; active sources are Loadstar and Shekou official; Maritime Executive is disabled after recorded connectivity failure | The Loadstar, Maritime Executive, official port notices | Yes: RSS/HTML parser, freshness boundary and source-level Runtime jobs | No for listed public sources | Not applicable | Controlled Runtime smoke fetched Loadstar (10) and Shekou (5); built current/history API read real persisted rows | Public source limits/cadence pending | `verified_live` | Each source runs independently; source failure preserves only same-source last-known data and never triggers Mock fallback. |
| Calendar / Holidays | `calendarific` requested in `.env.local`; app data mode defaults to Mock unless explicitly set to `real` | Calendarific v2 plus separately tracked official/manual sources | Yes: Calendarific v2 adapter, country/year normalization and `calendar-sync` Job | Yes: `CALENDARIFIC_API_KEY` | Yes, server-side only | Controlled Runtime smoke persisted 259 Calendarific events across CN and five overseas countries; built Calendar API read them | Free/paid account quota and official/manual completeness must be confirmed from the account/sources | `coverage_pending` | Transport/parser/cache path is live; coverage remains explicitly partial and official/manual sources are not claimed verified. |

## Non-provider foundations

- Port identity is owned by the SQLite-backed UNECE UN/LOCODE Port Directory. Providers must resolve `Shekou`, `SHEKOU`, `CNSHK` and aliases to `CNSHK`; they must not create a second port identity.
- Real Mode accepts only `real`, `imported` and `derived` lineage. `mock` records cannot be promoted into Real operational current data.
- Secrets remain server-only through `FileSecretStore`, with environment precedence over `.data/provider-secrets.json`. This document contains no secret value or masked suffix.
- The controlled Real Mode registry contains `ais-tracking`, disabled `voyage-sync`, one Feed Job per active public source, `calendar-sync`, `port-sync` and `weather-sync`. Mock/Test Mode retains the exact Mock/Off Job set; Readiness validates the set for the selected profile.

## Activation blockers and next probes

1. Keep `SHIPPING_DATA_MODE=real` process-scoped for controlled operation; do not change the safe default or commit local secrets.
2. Probe VesselAPI search and ETA/Port Events entitlement separately only after credentials are supplied and separately approved. A successful search does not imply ETA or Port Events entitlement.
3. Keep Maritime Executive and all official weather-alert sources disabled until their real contract/coverage evidence is available.
4. Keep AIS at `coverage_pending` until an eligible watched MMSI yields a PositionReport persisted to SQLite.
5. Run each future live gate independently and record request, result, SQLite row and API surface in `docs/live-verification.md`; do not use `verified_live` for connection-only or fixture-only evidence.
