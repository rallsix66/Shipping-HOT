# Windows observation-worker environment repair — 2026-10-19

Uncommitted local P2 repair on `codex/shipping-hot-r2`, baseline HEAD `40629587e22d8932df105962ec214530e4054414`. This repairs the actual CLI startup defect found after the earlier39-test offline candidate. Parent acceptance remains pending; no commit/push, service change or real-source observation is included.

## Defect and minimal change

The first correctly quoted real `observe:intel --execute` zero-budget attempt exited1 with `observation_child_environment_invalid`, before manifest/SQLite/bootstrap. An import-only diagnostic showed six keys already present before application imports on this Windows Node child: `HOMEDRIVE`, `HOMEPATH`, `SYSTEMDRIVE`, `USERDOMAIN`, `USERNAME`, `USERPROFILE`. The old validator rejected these OS/runtime additions, so its existing rejection tests and direct-library tests did not establish a usable CLI positive path. Original evidence remains at `.tmp/intel-observation-20261019/zero-cli-positive-2cc724eb-aaf9-4f86-901d-64a684137bc2/`.

Production delta is limited to a builtin-only environment helper, launch options and worker import/configuration order. Tests add the system-key positive,25 untrusted-setting negatives, launch flags/config checks and an actual execute positive. No Runtime/collector/network-budget/storage/schema/Provider/security-fetch implementation was changed by this repair.

- The launcher still does not inherit these six user/profile keys. The worker accepts only that exact finite Windows set in addition to the prior fixed environment, then discards their values. It does not use an injected path, expand it, copy its files or publish its value.
- Before application/Provider imports or Git metadata reads, a fresh empty `<run>/.home` is created inside the already canonical-checked direct-child run directory. Controlled child-only HOME and USERPROFILE point there. Incoming HOME remains forbidden. Existing `.home`/DB/manifest/run artifacts are refused, so this does not create a resume/reset path.
- Unknown variables, credentials/KEY/TOKEN/SECRET, proxies, Node options/path/CA flags, DB overrides, XDG/AppData/Git/npm configuration overrides remain rejected before home creation. The worker independently compares fixed source/enable flags.
- Node is launched with `--no-global-search-paths`; the worker checks the flag and actual module.globalPaths=[] so cached user-home module search cannot survive rebinding home. `os.homedir()` must equal the private home.
- `TSX_TSCONFIG_PATH` is generated as the exact candidate workspace's `tsconfig.json`, never inherited; the worker checks it exactly. Local get-tsconfig inspection confirmed this is the same project entry previously discovered from the run cwd (compilerOptions={}); pinning it removes ambient discovery without introducing the Node-specific compiler settings.
- Application imports are dynamic and occur after these checks. This also removes the old static import of options/application modules before environment validation.
- Home isolation exposed an existing dependency on user-global Git safe.directory configuration on this machine. The worker's two metadata reads now disable system/global Git configuration and use a missing `.home/.gitconfig` path. Exact canonical workspace trust is supplied only to those readonly commands via `git -c safe.directory=<root>`; no wildcard, global config or repository config write occurs. Repository-local configuration remains applicable.

## Actual CLI positive

Executed in the isolated candidate clone `.tmp/intel-observation-clean-20261019`:

```powershell
pnpm observe:intel --execute --run-id env-fixed-config-c1094551-9538-4d7e-b5ab-25e6f131aa00 --sources 'TH-W01,ID-W01' --duration-ms 10000 --max-http-requests 0
```

Raw exit **2**, the implementation's expected `http_budget` termination; the shell/lifecycle warning for exit2 is retained, not rewritten as exit0. Real parent CLI → sanitized child → environment isolation → one-job Runtime/bootstrap/lease → automatic budget stop → drain/end/release → readonly SQLite reopen/result all completed.

The actual result has reservations0, DNS0, HTTP0, `readOnlyReopen=true`, `ownershipReleased=true`, no remaining lock, no source run/item/Provider usage or paid/translation state, and no SecretStore file. Manifest processCwd equals the new run directory. It records all six discarded key names, an empty private home, moduleGlobalPaths=[], homedirMatches=true and the exact candidate tsconfig. Ledger contains only start and finished, with no DNS/HTTP event. This is a zero-network CLI acceptance, not a real-source collection. The worker's pre-existing `evidenceMode=live` label identifies its production wiring; it does not turn zero calls into live source evidence or24h acceptance.

Original stdout/stderr, exact command/cwd/UTC/exit, manifest/result hashes and19 acceptance conditions are preserved in `.tmp/intel-observation-env-repair-20261019/actual-cli-*`. [Machine summary](summary.json) binds current source fingerprints to the candidate clone and logs. [Original result copy](actual-cli-result.json) is byte-identical to the run result.

## Configuration-search boundary

The business worker no longer uses the real profile's default config/module search. The local `FileSecretStore` still resolves only its own cwd/.data; no retained store is copied or paid job registered. External CA/proxy/Node config variables are not inherited, and existing secure transport/TLS policy is unchanged.

This does not turn a local Node process into an OS filesystem sandbox. Trusted repository code and candidate tsconfig/local dependencies still run; explicit absolute-file reads in future code would require their own review. The caller's normal pnpm/Node invocation and OS system runtime/trust behavior are not globally reconfigured. Manually constructing an arbitrary Node command with preloads outside this launcher is not protected by an application validator that runs later. No claim is made about every unrelated process or whole-machine packet egress.

## Verification and retained failures

Related67 tests pass, including the actual CLI positive. A fresh actual invocation separate from Vitest also passes the19 conditions. Frozen verification uses `--offline` in the previously clean-installed candidate; no dependency/network change. Necessary build/typecheck/lint/full-suite results are in summary.json.

Retained failures include: the original environment P2, the initial PowerShell comma quoting rejection, the repair's first isolated-home Git ownership failure, initial test typing errors, offline install's sandbox-store/no-TTY rejection, and the first full suite's new subprocess test default5s timeout under concurrency. That last test alone now has20s test allowance with the existing15s child-process bound and unchanged10s observation window/zero budget/semantic assertions. No global timeout or product timing gate was relaxed.

R2-6 limited PASS remains inherited. R2 remains BLOCKED; public25/39, information24/34, historical numeric3/5 unchanged. Real source calls/real captures/paid/LLM/GUI/S7/24h remain NOT_RUN. [Real Neat Freak closeout](closeout.md).
