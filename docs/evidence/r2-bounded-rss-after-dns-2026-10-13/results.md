# After-DNS bounded index batch — 2026-10-13

Baseline code `208be3567ff06101c6e3bb52c23e781c06ddcae5`. Human approval was verified by the parent for one renewed six-source index batch after the DNS correction. This run used the exact six catalog URLs in the acceptance mapping, serially from 2026-10-13T07:00:27.722Z to 07:00:40.908Z. The prior DNS-blocked batch is separate and unchanged.

| Source | HTTP transport attempts | Response | Collector title/link/time |
| --- | ---: | --- | ---: |
| MY-P02 | 1 | 200 | 3/3 |
| PH-M01 | 1 | 200 | 10/10 |
| MY-C01 | 1 | 200 | 10/10 |
| MY-T01 | 1 | 200 | 6/6 |
| TH-W01 | 1 | 200 | 10/10 |
| ID-W01 | 1 | 200 | 13/13 |

The existing secure fetch and pinned Node transport returned all six responses within the 512 KiB per-response and 10-second per-source limits; the whole run took 13.186 seconds against a 120-second cap. There were six transport attempts, with no redirect, retry, detail request, credentials, paid call, LLM, or scheduling. Each response went through the current collector into an isolated in-memory SQLite database. The four proposed new candidates parsed 29 complete items; TMD/BMKG parsed 23 baseline items. This is one live snapshot, not continuing collection or a source reliability claim.

Original response byte lengths and SHA-256 values are in `batch-results.json`; the request journal was written before each transport call. All journal reservations finished with response 200, so no source is unknown or eligible for a repeat under this approval. The transport counter measures calls to the Node transport, not server logs. The guard tests passed 2/2 before the batch, the single batch-boundary test passed, and later offline replay/evidence tests passed 3/3. The latter replayed the retained TMD bytes through the collector with no socket access and verified 10 complete records and the original-byte hash.

The TMD XML was retained byte-for-byte only after its in-document public-domain notice and a sensitive-content scan. Its raw SHA-256 is `d88a2f41868ab82631714e427a39998cc17ece4079a40d5d34fe95a576b8b325`. The Git index blob was checked against this hash and staged without the local line-ending filter, which otherwise changed its bytes. The other five responses have no verified reuse permission for original full XML and were not retained; their `*-metadata.json` files contain filtered title, link, and timestamp derivatives. The `metadataSha256` fields bind each derivative, but these files cannot reproduce original XML structure, encoding declarations, or date syntax. No reconstructed RSS is treated as an original fixture. Original-structure fixtures retained: 1. Actual successful parsed new candidate sources: 4. These counts answer different questions.

The 41-source automatic inventory is unchanged and neither new coverage denominator nor final article denominator is approved. No directory source was marked OK; R2-4/R2-5 whole-stage acceptance remains pending. This batch did not run a 24-hour check, add product code, change a network setting, or make a production activation decision.

Evidence: `preflight.json`, `launch.json`, `request-ledger.json`, `batch-results.json`, `batch.log`, six metadata derivatives, one TMD original XML, `offline-check.log`, and saved probe source text. The source capture used UTF-8 logs with raw exit. The preceding full product gate is not re-claimed for this docs/evidence-only run.
