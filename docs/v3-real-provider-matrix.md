# V3 Real Data Provider Matrix

> Audit date: 2026-08-29
> Scope: local source, configuration and recorded runtime evidence only. No new secret, provider SDK, paid account or external activation was added by this inventory.
> Status vocabulary: `not_started`, `adapter_ready`, `credential_missing`, `entitlement_missing`, `connection_verified`, `coverage_pending`, `verified_live`, `failed`.

## Reading this matrix

These columns are intentionally separate:

- **配置** describes what the local environment requests. It is not proof that Real Mode is active.
- **Secret** reports only whether a credential is present and where the server-side loader can obtain it; secret values are never recorded here.
- **真实请求** requires an actual request against the named provider. Fixtures, parser tests and Mock responses do not count.
- **状态** is the current conservative status. A configured adapter remains `coverage_pending` until its required live evidence exists.

The current `.env.local` does not define `SHIPPING_DATA_MODE`. The application therefore defaults to `mock` unless a caller explicitly sets `SHIPPING_DATA_MODE=real`. The environment also requests AISStream, Portcast, Open-Meteo, public alerts, public Feed and Calendarific, but those requests do not by themselves activate a Real operational surface.

## Capability matrix

| Capability | Current Provider / effective mode | Real Provider | Adapter | API key required | Secret configured | Real request verified | Fee / quota | Current status | Evidence / gate |
|---|---|---|---|---|---|---|---|---|---|
| Vessel Search | `mock` by default; `SHIPPING_VESSEL_SEARCH_PROVIDER` is not set | VesselAPI | Yes: server-side `createVesselApiSearchProvider()` | Yes: `VESSELAPI_API_KEY` | No (`credential_missing`) | No | Account plan and quota not verified; may be paid | `credential_missing` | Search mapping and cache are locally tested; no live VesselAPI search was made in this inventory. |
| Vessel Identity | Mock search identity when default mode is used | VesselAPI identity fields + existing canonical resolver | Resolver ready; no separate live identity adapter | Inherited from VesselAPI Search | No | No | Inherited from VesselAPI Search | `credential_missing` | Canonical identity/promotion is implemented, but live identity evidence cannot exist without a real search result. |
| AIS Position | `mock` by default; `.env.local` requests `aisstream` | AISStream | Yes: bounded PositionReport adapter and tracking Job | Yes: `AISSTREAM_API_KEY` | Yes, server-side only | Transport was previously observed; no PositionReport in the recorded probe | Account limits not verified in this audit | `coverage_pending` | Existing evidence is `connection_verified / pending_observation`; `verified_live` requires a PositionReport persisted to SQLite. |
| AIS Area / Port Traffic | `aisstream` requested; Real Mode still not active by default | AISStream area subscription | Yes: area session, Port Directory lookup and bounded aggregation | Yes: `AISSTREAM_API_KEY` | Yes, server-side only | No usable area observation recorded | Account limits not verified | `coverage_pending` | Previous probe reached connection without an observation; watched-vessel and area-AIS boundaries remain separate. |
| Port Intelligence | `portcast` requested in `.env.local` | Portcast public pages | Yes: public-page parser for the eight Port Directory ports | No provider key for the public-page path | Not applicable | Parser/fixture and local failure paths only | Public-page availability and robots/legal basis pending; no quota claim | `coverage_pending` | A stable live page and at least two real port observations are still required; no Mock enrichment is allowed. |
| Weather | `open-meteo` requested in `.env.local` | Open-Meteo Marine + Forecast | Yes: server-side marine/forecast adapter | No | Not applicable | No current activation probe recorded in this inventory | Public endpoint limits not verified | `coverage_pending` | Must verify Shekou plus one overseas port and preserve last-known data on failure. |
| Weather Alerts | `public` requested, but registered JMA/TMD/BMKG sources are disabled/live-pending | Country-specific official sources | Parser boundary exists; no enabled verified-live source | No | Not applicable | No | Source-specific public availability; no quota claim | `coverage_pending` | China, Thailand, Malaysia, Philippines, Indonesia and Vietnam coverage is not complete; expired alerts must not enter HOT. |
| Voyage / ETA | `mock` provider in default runtime; no real Voyage adapter | VesselAPI ETA and optional Port Events, subject to account entitlement | No real ETA adapter; Mock adapter only | Yes: `VESSELAPI_API_KEY` | No | No | Endpoint entitlement and plan/quota unknown | `not_started` | Must run an entitlement probe before implementing; if ETA/Port Events are unavailable, write a gap record and stop this submodule. No origin may be guessed. |
| Feed / Shipping News | Public Feed adapter; active sources are Loadstar and Shekou official; Maritime Executive is disabled after recorded connectivity failure | The Loadstar, Maritime Executive, official port notices | Yes: RSS/HTML parser and freshness boundary; Batch 2 Runtime not registered | No for listed public sources | Not applicable | No current live verification in this inventory | Public source limits/cadence pending | `coverage_pending` | Must verify URL/RSS/page availability before enabling a source. One source failure must not fail other sources or trigger Mock fallback. |
| Calendar / Holidays | `calendarific` requested in `.env.local`; app data mode defaults to Mock unless explicitly set to `real` | Calendarific v2 plus separately tracked official/manual sources | Yes: Calendarific v2 adapter and country/year normalization | Yes: `CALENDARIFIC_API_KEY` | Yes, server-side only | Yes for TH/ID/MY/PH/VN in prior recorded probe; CN not verified | Free/paid account quota must be confirmed from the account | `coverage_pending` | Prior response was valid with partial coverage. Real operational status requires CN plus an overseas country and cached Runtime evidence. |

## Non-provider foundations

- Port identity is owned by the SQLite-backed UNECE UN/LOCODE Port Directory. Providers must resolve `Shekou`, `SHEKOU`, `CNSHK` and aliases to `CNSHK`; they must not create a second port identity.
- Real Mode accepts only `real`, `imported` and `derived` lineage. `mock` records cannot be promoted into Real operational current data.
- Secrets remain server-only through `FileSecretStore`, with environment precedence over `.data/provider-secrets.json`. This document contains no secret value or masked suffix.
- The existing AIS and Voyage Runtime Jobs are the only registered production Jobs at the start of this activation. Feed and Calendar Jobs are not yet registered.

## Activation blockers and next probes

1. Set `SHIPPING_DATA_MODE=real` only in the process/environment intended for a controlled probe; do not change the safe default or commit local secrets.
2. Probe VesselAPI search and ETA/Port Events entitlement separately. A successful search does not imply ETA or Port Events entitlement.
3. Verify the currently registered public Feed URLs and source parser contracts. Keep failed or unverified sources disabled.
4. Verify Open-Meteo for Shekou and one overseas port, and preserve last-known SQLite data on failure.
5. Verify Calendarific for CN and one overseas country, then add Calendar Background Runtime only after the provider result and cache path are proven.
6. Run each live gate independently and record the request, result, SQLite row and API surface in `docs/live-verification.md`; do not use `verified_live` for connection-only or fixture-only evidence.
