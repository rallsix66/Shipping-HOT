# R2 observation LOGONSERVER minimal fix (2026-10-21, offline)

Ruling: dots, Slack ts 1792554503.258689.

- Change: `scripts/r2-intel-observe-environment.ts` adds lowercase `logonserver` only to the win32 `windowsInjected` set. It is not in the `observationEnvironment` copy list. No other whitelist was widened. All existing rejection conditions are unchanged. After validation it is deleted case-insensitively by its actual key, with the other injected keys.
- Guarantee: the key is not visible in the business phase after isolation ("隔离后业务阶段不可见"). It does not mean "never received". Node v24.15.0 / libuv 1.51.0 `required_vars` (deps/uv/src/win/process.c L48-L59) re-add it from the parent even when an explicit env is passed.
- Tests: `scripts/r2-intel-observe-logonserver.test.ts` covers:
  - LOGONSERVER and LogonServer each alone are accepted and then absent; HOME/USERPROFILE equal the isolated home.
  - Case duplicates are rejected.
  - Non-win32 rejects the key.
  - With the key present, unknown key / fake credential / NODE_OPTIONS / proxy / expected-value mismatch are still rejected.
  - The actual two-level CLI runs under an independent parent process, with a synthetic marker and with the key absent. Exit is 2, http_budget, 0 requests.
  - stdout, stderr, manifest, result and events contain no marker or real value. The key NAME appears only in the audit list `environmentIsolation.discardedWindowsKeys`.
- `before-fix.log`: unfixed code. Exit 1, 4 failed: the 2 lone-key tests, the marker CLI case, and the existing actual-CLI test. The absent CLI case passed.
- `after-fix.log`: exit 0, 45/45. Here the leak assertion excludes only the `discardedWindowsKeys` name list; the before-fix run used the stricter assertion.
- Logs are redacted: marker → `<marker>`, user profile path → `<USERPROFILE>`. The shared process.env was not mutated. No live network was used.
- The 2026-10-19 observation evidence dirs had their user profile path redacted as `<USERPROFILE>` in this commit only. Their recorded file hashes describe 10-19 sources, not this fix.
