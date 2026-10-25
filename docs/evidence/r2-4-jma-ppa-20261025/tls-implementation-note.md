# PPA TLS diagnostic vs article-fetch-security transport

Round: dots-1792918191 (packaging: 1792919016)
Baseline: `978a7e4ff7df4e8e57cfa4fdabdca5b8bf02c2a2`
Branch: `codex/shipping-hot-r2-4-gapfill-20261025`

## One-line conclusion

**两次均报告严格验证，但有效信任来源及等价性未核实**；两端均 `rejectUnauthorized=true` 且复用同一 DNS 公网地址门控；**API 表面不同**（diag = 原始 `node:tls.connect` 无 HTTP；产品失败路径 = `node:https.request` via `defaultTransport` / `secureFetchArticle`）。

## PPA diagnostic actual stack (this round)

| Item | Value |
| --- | --- |
| Library | Node built-in `node:tls` (`tls.connect`) |
| Runtime | Node `v24.15.0` / modules ABI `137` / OpenSSL `3.5.5` (worktree toolchain) |
| Default trust source | 未配置请求级 CA，有效信任来源未核实 (`ca` option not passed; `caInstalledOrImported=false`; `trustStoreChanged=false`; `sourceCaConfigured=false`; bundled-Mozilla inference not proven by that absence alone) |
| Verification | `rejectUnauthorized: true`, `minVersion: "TLSv1.2"`, no ignore-error callback, no alternate client |
| DNS gate | Reuses `isBlockedAddress` from `server/services/article-fetch-security.ts` |
| HTTP | Not sent (`httpSent: false`) |
| Target | `www.ppa.com.ph:443`, SNI=`www.ppa.com.ph`, connected `115.84.233.11` |
| Result | `STRICT_TLS_OK`; leaf CN=`*.ppa.com.ph`; Issuer=Sectigo Public Server Authentication CA OV R36; valid 2026-05-14 → 2026-11-28 |

Script evidence: `.tmp/r2-4-jma-ppa-20261025/run-forensics.mjs` `tlsDiagOnce` (gitignored local forensics helper; not product code).

## Original failure path (PH-P01 product entries)

| Item | Value |
| --- | --- |
| Library | Node built-in `node:https` (`https.request`) inside `defaultTransport` |
| Entry | `secureFetchArticle` in `server/services/article-fetch-security.ts` |
| Trust | No SourceCaConfig.certificatePem supplied on product path; PPA captures did not configure SourceCa; effective trust source not independently verified beyond rejectUnauthorized=true |
| Verification | `rejectUnauthorized: true` (optional request-scoped `ca:` only when validated SourceCa present) |
| DNS gate | Same `isBlockedAddress` + `validatedLookup` |
| HTTP | Full GET after TLS; `maxBytes` default 512 KiB |
| Prior result | Both product URLs stopped at TLS with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / message hinting `--use-system-ca`; no HTTP status/body |

Evidence (prior gapfill round, not re-fetched): `.tmp/r2-4-gapfill-20261025/PH-P01-helpdesk-capture.json`, `PH-P01-port-news-capture.json`.

## Same points

1. Strict verification on (`rejectUnauthorized: true`); verification was not disabled.
2. When no SourceCa PEM is attached, no request-level ca is passed; effective trust source is not independently verified from that fact alone.
3. Same public-address DNS classification helper (`isBlockedAddress`).
4. Same host `www.ppa.com.ph` resolved to public `115.84.233.11` in both rounds' ledgers.
5. No CA import / trust-store mutation / SourceCaConfig in either the successful diag or the failing product captures.

## Different points

1. **API**: diag uses raw `tls.connect({ host: ip, servername, ... })`; product uses `https.request(url, { lookup: validatedLookup(addresses), rejectUnauthorized: true, ... })` then sends HTTP.
2. **HTTP**: diag never sends an HTTP request; product failure happened on HTTPS product paths (`/content/ppa-helpdesk-advisory`, `/ppa-port-news`).
3. **minVersion**: diag sets `TLSv1.2` explicitly; product transport relies on Node defaults (no explicit `minVersion` in `defaultTransport`).
4. **Purpose / acceptance**: diag is host-identity evidence only; it does **not** substitute for product-entry revalidation and must **not** auto-flip PH-P01 or import CA.
5. **Observable outcome differed** under the same machine/toolchain class: diag `STRICT_TLS_OK` (Sectigo 2026 leaf) vs earlier product `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Cause is not re-probed this packaging turn (zero new TLS). Remaining blocker stays: compare host/path/chain presentation before any trust change; do not re-fetch the two PPA product entries until separately approved.

## Counts / blockers retained

- R2-4 **29/39**, R2-5 **25/34** (unchanged)
- XX-W02 not raised (specifications URL still unverified)
- PH-P01 product entries remain BLOCKED

---

## Correction addendum (dots 1792919758 / 1792919667)

Applied without new network. Corrects over-precise trust-store wording in this note:

1. **Trust source:** absence of a request-level `ca` option does **not** by itself prove the process used Node's bundled Mozilla CA store or the same trust store as an older process. Correct statement: **未配置请求级 CA，有效信任来源未核实**. Only restate a more precise trust source when independently logged.
2. **SourceCaConfig field name:** the config field is **`certificatePem`**, not `caPem`. `ArticleTransportOptions.caPem` is a transport-level option that `secureFetchArticle` may populate from `sourceCa.certificatePem` when a validated SourceCa is present.
3. **map.html prior failure vs null fields:** ledger error `body_too_large` with `httpStatus`/`bytes`/`wireSha256` null is expected because `defaultTransport` rejects mid-stream before `resolve`; summary nulls are the same event, not a second outcome.
4. Product revalidation of the two PPA entries under `secureFetchArticle` in dots 1792919758 still returned `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; prior `STRICT_TLS_OK` diag remains host-identity evidence only.
