# MY-W01 MetMalaysia limited integration (2026-10-10, dots review 16:05 UTC+8)

Code: `eab30a7` (integration) + `b946bcd` (received-at label on all feed lists; display harness). Gates on clean `b946bcd`: `docs/evidence/gate-b946bcd/`.
The shelved draft (`.tmp/my-w01-shelved/`) was reviewed against the bounds and NOT reused as-is: it assumed +08:00, computed `active`, dropped "No Advisory" and labelled severity "info". Its earlier probe is not acceptance evidence.

## Bounds -> implementation
1. Entry pinned to `https://api.data.gov.my/weather/warning/` (https, host, exact path, no query); `redirect: "error"` plus `redirected`/final-URL re-check; local rate limit 15 s per source (official 4 req/min); one request per run; no key. Config `enabled:false / liveStatus:"experimental"`: runs only under the existing `SHIPPING_WEATHER_ALERT_PROVIDER=experimental` switch (`public` does not run it).
2. Raw `issued`/`valid_from`/`valid_to` strings and full texts kept in `weather.alertRaw` with `sourceUrl` + `fetchedAt`; no timezone assumed, nothing converted; `alertState:"unknown"`, `validityStatus:"unknown"`, `timezoneStatus:"unconfirmed"`, `eventEligibility:false`; no `effectiveAt/expiresAt`. `publishedAt` = first received time, flagged `timeBasis:"received_at"` and shown as "首次接收". Summary: "已接收 MetMalaysia 官方预警记录，有效性待确认……".
3. `officialSeverity:"not_provided"` (UI "官方级别：未提供"; FeedItem.severity is the mandatory lowest display priority only). `metmalaysia: "MY"` = issuing country only. No region -> `relatedPortIds: []`, no `alertRegion`, no WR-O01/O02 (texts naming Klang/Selangor still give zero association).
4. "No Advisory" kept as its own record, worded as tropical-cyclone-only for its stated area; never clears others. Empty array = success with 0 records (meaning unknown; prior records only marked `warning_missing_from_current_index`, never expired). Fetch/contract failure = failed, never "no warnings".
5. Dedup identity = issued + title_en + valid_from + valid_to; rows 1–2 of the sample are distinct.
6. Existing Feed display channel (`/feed`, `WeatherChips`), no place-name extraction, no new source beyond MY-W01. Fixture tests: `server/providers/metmalaysia-warning.test.ts` (14).

## Real run (isolated, `.tmp/metmalaysia-live-eab30a7`, clean `eab30a7`)
- 2026-10-10 16:30:40 UTC+8, 1 request, HTTP 200, not redirected, 7754 bytes (`raw/warning-2026-10-10T0830Z.json`).
- Classification `received_official_warning_records_validity_pending`: **received 4, unknown validity 4**, event-eligible 0, with port 0, No Advisory 1; Klang panel alerts 0 / impacts 0 / rule hits 0. `live-evidence.json`.

## Display verification (`display-evidence.json`, PASS 14/14, HEAD `b946bcd` clean)
- Service: production build `dist/output/server` (Nitro) on the isolated DB, Runtime disabled, `SHIPPING_WEATHER_ALERT_PROVIDER` unset, no provider secrets.
- API: `GET /api/shipping/feed` (4 records, raw fields, unknown validity, no port) and `GET /api/shipping`; GET 前后：Runtime 关闭、预警开关未设，所检查的 feed/provider_usage 计数及指纹未变（feed_items / provider_usage 计数及 id+长度指纹）；runtimeRows=-1 表示该表不可用（未检查 runtime 表）。这不证明没有网络或 LLM 调用。
- Browser: system Chrome headless over CDP, `/feed`: summary wording, 预警状态：未知 / 有效性待确认 / 时区未确认 / 官方级别：未提供, raw issued/valid_from/valid_to, source + 抓取时间, 首次接收, No Advisory scope text, 4 raw blocks; no "生效" claim.
- Not covered: port pages (no association by design), Runtime scheduler under the experimental switch (covered by service-layer sync-job tests only).

Eight-port weather live not rerun (unchanged).
