# Four approved index checks — 2026-10-13

Code baseline `01ea950ab023255fdb7e9efe1f2799d9320c260e`. User approved the current-subscription four-domain addition and one index request per source at 08:03:50 UTC, then confirmed manual save at 08:22:26 UTC. Repository was clean before preparation. The old six-source evidence remains separate.

The current subscription/profile and extension association were unchanged. The extension script was backed up before appending four exact domains with deduplication, retaining the prior six. Generated configuration after user save contains all ten expected domains, fake-ip blacklist semantics and TUN enabled. No global extension, route, DNS server or project TLS/SSRF change. The tool could not perform normal native UI reload; the user completed that step. Four system DNS lookups at 08:23:32.511–08:23:34.035 UTC returned public addresses accepted by the existing classifier. `dns-observation.json` is an explicit transcription of actual tool output, not a second DNS query or original raw log.

The exact catalog URLs in `manifest.json` were fetched serially once, 08:25:10.410–08:25:14.812 UTC (4.402 seconds). A durable reservation was written before each Node transport call; all four reservations completed with HTTP 200. Sent/transport attempts4, unsent0, unknown0. Each source retained 512 KiB pre-decode /10s and total120s boundaries. No redirect, retry, detail request, login, credentials, paid/LLM call or scheduling.

| ID | Response bytes | Fetch | Current collector | Original fixture |
| --- | ---: | --- | --- | --- |
| XX-M01 Loadstar | 20055 | HTTP200 | 10 complete title/link/time items in memory SQLite | Not retained |
| XX-M03 Splash247 | 19299 | HTTP200 | 10 complete title/link/time items in memory SQLite | Not retained |
| MY-P03 Northport | 73037 | HTTP200 | NOT_RUN: no source-specific configuration | Not retained |
| TH-C01 Thai Customs | 123625 | HTTP200 | NOT_RUN: no source-specific configuration | Not retained |

RSS decoding selected UTF-8 from HTTP without conflict. Northport selected default UTF-8; Thai Customs selected HTTP UTF-8. These observed selections do not establish broader encoding compatibility. Raw response byte counts and SHA-256 are recorded, but no raw body is retained for these sources. Metadata derivative hashes bind the saved files. Loadstar's existing policy permits a link/limited Feed excerpt and disallows full article fetch/persistence; this batch fetched its catalog RSS index only and persisted filtered metadata. No full-text reuse permission was established for the other sources, and sanitization alone does not supply permission. Original-structure evidence count0; parsed-source count2. Metadata cannot reproduce XML/HTML structure, encoding declarations or raw date grammar; no rebuilt RSS fixture is used.

Northport in-memory observation found107 anchors, no table/row/time elements, and numeric text candidates including `6-10-2026` and `15-09-2026`. These were not associated with items and cannot be promoted to publication dates. The current date parser supports configured slash DMY, not this observed dash DMY. Thai Customs had230 anchors, one table/101 rows and no time elements; the observation found no numeric date matching its limited regex. This does not prove the page has no dates or establish Buddhist-calendar syntax. Both require source-specific selectors, date basis and applicable precision/timezone rules; no configuration or parser change was made.

## Qualification matrix recommendation

Reachability and parsing are scoped to the captured response. Normalized timestamps without retained originals provide partial date traceability, not raw grammar replay. Day-current timestamps are evidence of recent entries, not proof of sustained timely coverage or port impact. No directory OK promotion or final denominator exemption follows.

| Source | Reachable | Parse | Date traceability | Information timeliness | Original structure replay |
| --- | --- | --- | --- | --- | --- |
| MY-P02 Westports (prior batch) | Observed200 | 3 complete | Normalized only | Latest2025-08-01: stale for current news | Missing |
| PH-M01 PortCalls (prior) | Observed200 | 10 complete | Normalized only | Latest2026-10-13; sustained timeliness pending | Missing |
| MY-C01 Customs MY (prior) | Observed200 | 10 complete | Normalized only | Latest2026-10-08; older/non-core items require business screening | Missing |
| MY-T01 MOF MY (prior) | Observed200 | 6 complete | Normalized only | Latest2026-10-07; source-specific criteria pending | Missing |
| TH-W01 TMD (prior) | Observed200 | 10 complete | Original XML replay | Latest2026-10-12; alert validity/port applicability separate | One original10-item replay |
| ID-W01 BMKG (prior) | Observed200 | 13 complete | Normalized only | Latest2026-10-13; alert validity/port applicability separate | Missing |
| XX-M01 Loadstar (this batch) | Observed200 | 10 complete | Normalized only | Latest2026-10-13T08:23:45Z; sustained timeliness pending | Missing |
| XX-M03 Splash247 (this batch) | Observed200 | 10 complete | Normalized only | Latest2026-10-13T08:23:05Z; sustained timeliness pending | Missing |
| MY-P03 Northport (this batch) | Observed200 | NOT_RUN | Unassociated date candidates only | Pending | Missing |
| TH-C01 Thai Customs (this batch) | Observed200 | NOT_RUN | Pending source rule | Pending | Missing |

## Checks and limits

Offline one-shot guards2/2 passed before live; live batch-boundary1/1 exit0; result accounting/hash checks exit0. Live test success verifies batch accounting, not full source qualification. Actual Neat Freak closeout and inventory recorded separately. No product edits, retained database operation, full product gate rerun, source state/denominator change, merge or deployment. The 41-source inventory and unresolved final article denominator remain unchanged; R2 remains incomplete. No new batch is authorized by these results.
