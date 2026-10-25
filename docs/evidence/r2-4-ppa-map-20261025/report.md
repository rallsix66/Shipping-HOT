# R2-4 PPA product revalidate + JMA map/specs (dots 1792919758)

Also covers corrections from dots 1792919667. Baseline `d5042321`. Branch `codex/shipping-hot-r2-4-gapfill-20261025`.

## Budget

- HTTP used **5/10** (stopped with unused budget; no retries; no redirects).
- No TLS diagnostic this round.
- No system-CA / SourceCa / trust-store change.

## PPA (PH-P01, two entries = one source)

| Entry | Result |
| --- | --- |
| helpdesk-advisory | BLOCKED `UNABLE_TO_VERIFY_LEAF_SIGNATURE` |
| ppa-port-news | BLOCKED `UNABLE_TO_VERIFY_LEAF_SIGNATURE` |

Via `secureFetchArticle`/`defaultTransport`. Exact errors retained; no retry; no extra TLS probe. TLS-success-or-200-shell does **not** qualify. Counts unchanged.

## JMA map.html + specifications

- Prior 512KiB `body_too_large` (null status/bytes) **retained** and not rewritten as this success.
- New GET `map.html` with temporary `maxBytes=2097152` only: **200**, 861490 bytes, sha256 `71c57265064a4d54cc1ff957f3582059ff772403f1430b759333d053852c12e4`.
- Exact specs path from **inline** script literals: `typhoon/data/` + TCID + `/specifications.json` (no guessed script names; 0 external script GETs).
- Fetched specifications for verified TC2637/TC2636 only; forecast originals **reused offline** (0 forecast/targetTc refetch).

| Product | Status | bytes | sha256 prefix |
| --- | --- | --- | --- |
| TC2637/specifications.json | 200 | 4042 | 4559062942c8c65d... |
| TC2636/specifications.json | 200 | 1790 | b6110f8e5eb5d6b8... |

## Replay

- Forecast offline replay OK; identity list check OK.
- Specs structural replay OK; title typhoonNumber/name/issueUTC **cross-check match** forecast for both TCs.
- forecast/specifications kept separate; executor does **not** raise XX-W02 whole-row OK.

## Corrections (1792919667)

- Trust: **未配置请求级 CA，有效信任来源未核实** (do not infer bundled Mozilla solely from absent request-level ca).
- `SourceCaConfig` field is **`certificatePem`** (not `caPem`; transport may derive `ca` from it).
- map `body_too_large` with null status/bytes aligned: mid-stream reject before `resolve`.

## Counts kept

- R2-4 **29/39**, R2-5 **25/34** (executor will not change; any XX-W02 upgrade is for dots ruling).
