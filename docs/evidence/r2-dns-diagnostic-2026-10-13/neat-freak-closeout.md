# DNS-only diagnosis closeout - 2026-10-13

Baseline `7905d5dbb7b377767913a17d9e49762ea507e037`. Read-only diagnosis authorized separately; no source HTTP request, alternate resolver, product/network-setting change or bypass. Applied actual installed neat-freak v3.0.0 and verification reference already loaded; its own inventory script exit0. No cleanup.

| Surface | State | Evidence/action |
| --- | --- | --- |
| Code | verified-current for observed-address scope | Explicit198.18.0.0..198.19.255.255 interval, inclusive arithmetic and mapped-address logic match six observed replies; boundary/adjacent/mapped offline assertions pass. Not a full address-policy audit. |
| Runtime | current DNS observed; source HTTP remains BLOCKED | Six system getaddrinfo API calls, one per approved hostname;198.18.1.44..49, zeroHTTP, no resolver override. Later timestamps do not backfill previous batch IPs. |
| Docs | changed-and-verified | Evidence separates local returned special addresses, policy enforcement, plausible synthetic-IP/TUN inference and unknown component/mode versus tool/OS ownership; no upstream availability claim. |
| Rules/architecture/roadmap | verified-current; recovery pending decision | Existing SSRF/TLS/address rules unchanged; no source URL/state/threshold change or new acceptance exemption. Final R2 article denominator unchanged/unset; acquisition/fixture success counts unchanged. |
| Memory | out-of-scope | No memory edits. |
| Workspace | verified-current for evidence scope | Only diagnostic logs/JSON/probe text/docs; no full process command-line listing, environment secret/raw proxy URL/profile content, retained DB or key output. Earlier artifacts and temporary probes retained. |

Actual checks: DNS-only+temporary range assertions2/2 exit0; existing isBlockedAddress unit1 passed/9 filtered skips, exit0 (skips are test-name filtering, not platform failure); evidence-check exit0; docs diff-check exit0; installed skill inventory exit0. Windows category snapshot command exit0. UTF-8 baseline-SHA/command/stdout/stderr/raw exits preserved; snapshot keeps only necessary setting names and value categories, with execution command trace in task history. No mechanical whole product gate for read-only diagnosis.

Confirmed: active tunnel/VPN-marked interface category, configured special-range DNS server, no six-host hosts overrides, diagnostic proxy env keys absent; WinINET ProxyEnable false with a stored loopback endpoint category. None alone confirms fake-IP mode, actual DNS-service ownership, origin addresses or global network behavior. Recovery is a proposal only; user must decide specific client identification/mode inspection and any later approved environment adjustment/revalidation. No stop-TUN/change-DNS/hardcoded-IP/allow-range/TLS bypass/second source batch was performed.

Parent diagnostic review pending; R2 incomplete. Existing auto-import/Git/line-ending warnings remain. No new security audit or cleaned-state claim; evidence retained without deletion.
