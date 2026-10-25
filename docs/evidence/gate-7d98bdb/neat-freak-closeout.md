# R2-2 application source CA closeout - 2026-10-13

Tested code SHA `7d98bdb99caf9fdaf15c833ef91f457bee05a2cd`, clean before gates. Implementation `3038651aa92b70f4d8045559501418e5e686c685`; final commit only relocates the public certificate fixture so Base64 does not collide with the existing business-code retirement scan. The failed 3038651 gate is retained unchanged. No scanner exception or rule change.

## Result and evidence

- Optional sourceCa is a request-scoped source ID/exact hostname/public CA PEM binding. Validate and snapshot before async work; reselect per hop. Matching HTTPS host receives the CA; other allowed hosts/default sources retain Node default/system trust. Explicit missing/bad fields, wrong source/host/unknown config fail before DNS. No global CA registry or file/secret/schema store.
- Default HTTPS transport explicitly uses rejectUnauthorized=true; normal hostname verification/SNI, pinned public DNS, private-address checks, HTTPS downgrade prevention, redirects/timeouts/byte caps remain. TLS errors have no weak-trust fallback. Intel collector and existing Feed list definitions can pass the optional config; no real definition does so.
- Six new CA cases in the existing offline Node request fixture verify A vs B (even same host), exact redirect scope, mutation snapshot, rejected outside/private/downgraded redirect, missing/bad config, TLS/config failure retaining old intel versions and Feed last-known data, and byte limit. Node request is mocked; there are no sockets. Test X509 CA parses and its self-signature verifies. This is not a real TLS handshake or current source entitlement result.
- Local gate PASS: Node boundary 16/16; Feed/security/etc 77/77; intel 137/137; JSON 49/49; web-list 42/42; paid/translation 114/114; full suite 107 files / 999 passed / 3 skipped. Install/build/typecheck/lint and P0/P2C/P3 isolated smoke exit 0. Full command/SHA/stdout/stderr/raw exit logs in this directory, Node 24.15.0.
- No retained DB was opened for migration, schema remains 27. Business-provider offline evidence is the mock Node boundary and injected public lookup, not unchanged inventory/counters. Package install and GitHub transport are separate from business-source live access.

## Actual Neat Freak fact matrix

Applied the actual installed neat-freak v3.0.0 skill and verification reference already loaded in this conversation. Ran the bundled read-only Git Bash inventory, exit 0; it is not a security audit.

| Surface | State | Action/evidence |
| --- | --- | --- |
| Code | verified-current | Reviewed binding validation/snapshot/per-hop selection, source plumbing, native options and six regression cases; full gate. |
| Runtime | pending live | Offline tests/isolated smoke only; no real CA/source or system trust changes. |
| Docs | changed-and-verified | Existing architecture/status and CA slice contract describe the actual support and limits; JSON P2 parent closure recorded without claiming independent rerun. |
| Rules/ADR | verified-current for scope | R2-2 plan authorizes this slice. No framework/schema/provider/auth/deployment change or new ADR required; single main-only workflow, draft stacked PR8 preserved. |
| Memory | out-of-scope | No memory writes. |
| Workspace | verified-current for reviewed scope | Only reviewed files staged. Fixture PEM is public CERTIFICATE only; disposable generation key remains ignored under .tmp, never staged. Existing residues/databases and all failed logs retained; no cleanup. |

Code/docs diff check excluding raw logs PASS. Raw build logs retain tool-emitted trailing spaces. Existing auto-import/bundle/Browserslist/loader warnings and three Windows symlink skips remain. Secret scan exit 1 means no match in recorded scope, not full security approval. No stale TODO introduced; source-specific CA support does not imply all independent weather/provider fetchers use this entry point.

Parent review NOT_RUN/pending. R2 overall incomplete. Live TLS/current source activation, system root installation, browser warning bypass, registry/GET activation, paid/R3/merge/deploy are NOT_RUN/out-of-scope. No branch CI runs is not CI PASS. Review artifacts preserved.
