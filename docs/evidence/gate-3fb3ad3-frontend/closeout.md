# Demo-source console / manual policy frontend — 2026-10-14

Code: `3fb3ad3dd0d6435c7d36376c579de238b6ecfa3c` (initial implementation `766689069961b73581dc7677fe6e3023778d192b`, then cached-error priority fix). Draft PR8 remains stacked on `codex/shipping-hot-r1-5`; no merge/release.

## Implemented scope

Selected reference `.tmp/demo/shipping-hot-demo.html`, 83297 bytes, SHA256 `23d6efbb343182eba93caa74a4b1ca1657bab25f414fb873d9c448efe98b51b7`; reference unchanged. Reused actual palette variables, 210px sidebar, mobile wrapping navigation, policy filter tabs, policy rows/status chips and two-column list/detail structure. Adapted to React with local font fallbacks and no external font dependency. This is source adaptation, not a verified pixel match.

Existing seven routes remain reachable. Demo's country overview, independent weather and merged risk events have disabled, explained entries. Existing home/feed/events/settings remain reachable separately. Source explanation is an informational disclosure, not a source-management UI. No hardcoded demo risk counts, fake original links, AI advice, forecast or policy records were imported into product code.

Policy list uses existing query keys/filters/GET APIs; current-filter statistics are labelled as such. Detail preserves fixture flags, original URLs/text, unknown timezones, effective-date rules, version-specific evidence and future/unknown replacement semantics. Native buttons replace click-only table rows. Entry/revision/export/repeal reuse existing endpoints. Opening a revision captures its target independently of list selection. Read failures override cached presentations; loading/error/empty/unknown remain distinguishable. R3 AI impact/extraction/matching is explicitly unopened. No backend, schema, dependency, timezone, source configuration, budget, secret, Provider or Runtime changes.

## Existing API mapping (no new backend)

| UI action | Existing endpoint | Boundary |
|---|---|---|
| List, filters, current-filter counts | GET `/api/shipping/policies` | Repository read; current-filter total only |
| Detail/version/relationship | GET `/api/shipping/policies/:id` | Existing local-day clock, fixture flags and versions |
| Create | POST `/api/shipping/policies` | Existing validation/manual entry |
| Revise | POST `/api/shipping/policies/:id/revise` | Existing append-only version logic |
| Repeal | POST `/api/shipping/policies/:id/repeal` | Existing validation, no replacement invented |
| Export | GET `/api/shipping/policies/export` | Same query filters, CSV |

Automatic acquisition and intel GET integration are not implemented by this frontend slice. R2 qualification/coverage/real-page replay/24h gaps and R1.5 limitations remain unchanged.

## Verification

- Exact code SHA in a fresh local clone with full `pnpm install --frozen-lockfile` (scripts enabled, no old/copied native modules): install/build/typecheck/lint all raw exit0.
- Targeted UI render + existing policy Repository tests:28/28. Full Vitest:115 files /1090 passed /3 existing Windows skips;3 isolated native/Runtime/Feed smokes exit0. Commands, cwd, full SHA, timestamps, separate stdout/stderr and raw exits are preserved here.
- `source-proof.json`: clone's normalized tracked diff exit0; generated routeTree status can show LF/CRLF only. Primary repo `dist` was never rebuilt, to preserve4477.
- `preview-http.json`:32/32 loopback HTTP checks on final built server. Explicit synthetic policy fixtures created/revised through existing APIs in an isolated DB; filters, empty query, versions, future replacement,404,CSV, seven SPA routes and JS/CSS resources checked. No DOM click or visual assertions. Provider usage/paid receipts/sync-run counts unchanged across the read probes; these counts alone are not proof of zero external egress.
- Final preview `http://127.0.0.1:4482/policies`, PID30024, isolated cwd `.tmp/policy-preview-3fb3ad3`, fixed test clock2026-10-14T00:00Z disclosed by policy API. Minimal OS env only; no project env/secret file; Runtime/translation/providers disabled. Synthetic S7/sample policy data, not a live feed. No automatic browser navigation. Existing4477 PID50980 remains running with its original build.
- First7666890 full Vitest failed1 test because the fresh clone lacked the `.tmp` prerequisite stated in AGENTS. Failure logs retained in `gate-7666890-frontend`; after adding `.tmp`, full1090/3skip and3smokes passed in `gate-7666890-frontend-resume`. Final3fb3ad3 ran all commands successfully with prerequisite present. No tests or thresholds were weakened.
- Browser/pixel comparison/mobile400px/keyboard live interaction/S7: **NOT_RUN / pending**. Automatic approval rejected newly generated custom CDP helper; it was not executed. Official inventory had no browsers and `iab` was unavailable. No alternative automation bypass attempted. Parent/user explicitly permitted source adaptation and non-browser checks to continue.
- Retained database and SecretStore file hashes unchanged; only isolated test/preview copies written. No source GET, paid call or credential configuration requested. No claimed egress capture.

## Actual Neat Freak closeout

Real skill loaded: `C:/Users/Administrator/.codex/skills/neat-freak/SKILL.md` v3.0.0, verification reference read; actual Bash inventory ran raw exit0 (`neat-inventory.log`, initial7666890 checkpoint). Inventory enumerates files and rules; it is not a security audit.

| Fact surface | State | Evidence/action |
|---|---|---|
| Code | changed-and-verified within non-browser scope | Exact SHA gate; frontend-only changes; shared policy rules unchanged |
| Runtime | pending full UI acceptance | HTTP32pass; independent preview; browser/S7NOT_RUN |
| Docs | changed-and-verified | status entry, architecture frontend contract, README retired capabilities and AGENTS seven-route correction |
| Rules | changed-and-verified | AGENTS route description corrected; no authorization/CI/secret boundary changed |
| Memory | out-of-scope / generated-read-only | No memory writes or unrelated history edits |
| Workspace | pending cleanup, preserved | Two test clones,4481 intermediate and4482 final isolated previews, drivers/logs; no deletion or service replacement |

React Best Practices skill applied: stable query keys, no UI external API/SQLite calls, native focusable controls and labels, derived active selection from current results, independent revision target, escaped React text, pure rendering components. No new UI library/provider/dependency. Actual keyboard and visual assessment remain pending.

Known warnings retained: Vite500kB chunk warning, old Browserslist data, unimport duplicate-name warnings, Windows Git ignore permission/CRLF notices. No dependency update or scope expansion to silence them. Historical third-party archive secrets were not inspected/printed/used/cleaned; cannot claim full workspace security audit. New evidence key-pattern scan only, separately recorded.

Temporary cleanup candidates: unused rejected `.tmp/demo-visual.mjs`; gate/preview helper scripts; old4481 preview PID7056 and its isolated build/DB; final preview/test clones remain needed for review. Everything preserved for user/parent review; cleanup requires explicit confirmation after this report.

Conclusion: implementation and non-browser checks delivered for review; **full UI acceptance remains pending**, not R5 PASS or R2 completion. Parent review pending. No merge/deploy/force-push/production activation.
