# DNS-only diagnostic — 2026-10-13

Baseline `7905d5dbb7b377767913a17d9e49762ea507e037`. No source HTTP retry, product change, network setting change, alternate DNS server, hardcoded-IP request, proxy workaround or TLS/SSRF exception.

## What is established

The earlier batch log saved `blocked_address` and zero transport calls but **did not save resolved addresses or the specific matched range**. Its result cannot be retrospectively assigned an exact IP. The current diagnosis therefore queried each same approved host once with `node:dns/promises.lookup(host,{all:true})`: system OS getaddrinfo/default resolver, no override. DNS timestamps below are later observations, not fields backfilled into the earlier batch.

| Source / hostname | Current returned IPv4 | DNS observation UTC | Classification |
| --- | --- | --- | --- |
| MY-P02 / www.westportsholdings.com | 198.18.1.44 | 2026-10-13T04:18:13.153Z–.161Z | denied special range |
| PH-M01 / portcalls.com | 198.18.1.45 | 2026-10-13T04:18:13.161Z–.163Z | denied special range |
| MY-C01 / www.customs.gov.my | 198.18.1.46 | 2026-10-13T04:18:13.163Z–.164Z | denied special range |
| MY-T01 / www.mof.gov.my | 198.18.1.47 | 2026-10-13T04:18:13.164Z–.165Z | denied special range |
| TH-W01 / www.tmd.go.th | 198.18.1.48 | 2026-10-13T04:18:13.165Z–.166Z | denied special range |
| ID-W01 / www.bmkg.go.id | 198.18.1.49 | 2026-10-13T04:18:13.166Z | denied special range |

All six answers hit `server/services/article-fetch-security.ts`'s explicit IPv4 interval **198.18.0.0 through 198.19.255.255**. That range is separate from the implementation's RFC1918 private intervals. Inclusive numeric comparison `value >= start && value <= end` is used; secureFetch rejects when `addresses.find(isBlockedAddress)` succeeds. Any blocked member of a mixed DNS response rejects the fetch. IPv4-mapped IPv6 is normalized and checked against the same IPv4 denylist. Other denied classes include loopback, link-local, private/CGNAT, documentation, multicast and several transition/special IPv6 patterns; this diagnosis is not a comprehensive address-policy audit.

Temporary offline assertions cover lower/upper boundaries, both 198.18 and198.19, adjacent198.17/198.20 candidates, dotted/hex IPv4-mapped forms and a known public candidate. They pass; no numeric boundary or mapped-form error was found for the observed addresses. This establishes correct enforcement of **the existing stated policy**, not permission to allow this range or proof that an IP is an actual public origin server.

## Necessary local configuration observations

Read-only OS snapshot at2026-10-13T04:19:07.9378536Z, full sanitized fields in network-config-categories.json:

- One `Up`, non-hardware adapter whose description contains a tunnel/VPN marker; one disconnected tunnel/VPN-marked adapter also exists. Names/MACs/complete descriptions were not recorded.
- At least one configured DNS server falls in198.18/15. Other interfaces also have DNS server settings, but routing priority/effective resolver ownership was not established.
- WinINET ProxyEnable=false; a stored loopback proxy endpoint category remains. AutoConfigURL absent. This does **not** prove an active HTTP proxy or rule out TUN/DNS interception.
- HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY absent in the diagnostic process. No values or unrelated environment variables were output.
- Windows hosts file has no uncommented exact overrides for the six hosts. No other hosts entries were output.

No process command lines, application credentials, profile contents, raw proxy URLs or environment secrets were enumerated. No network adapter/client was stopped or reconfigured.

## Evidence-based interpretation

| Hypothesis | State | Reason |
| --- | --- | --- |
| Local system resolver path supplies non-public/special addresses for public source names | verified-current | Six system getaddrinfo results and explicit code match. |
| IP classifier miscomputes the observed range or mapped forms | not found for tested scope | Exact deny interval and offline boundary/mapped assertions agree. |
| Proxy/TUN synthesizes fake-IP answers | plausible inference, not confirmed mode/component | Sequential198.18.1.44–49 answers, active tunnel-marked interface and special-range DNS setting are consistent; no fake-IP mode setting or component provenance read. |
| Tool-only DNS virtualization versus Windows client/interceptor ownership | unknown | System getaddrinfo was used, but this does not independently identify which component supplies its results. |
| Real upstream sites return private origin addresses or are unavailable | unverified | No authoritative DNS comparison or HTTP request performed; these are special-range answers, not evidence of an origin's RFC1918 address. |

## Minimal recovery proposal; no actions taken

Keep address/TLS/SSRF policy unchanged. First have the user or network maintainer identify the active resolver/TUN client and inspect its DNS mode or host exclusion setting without sharing secrets. If it is using synthetic-IP mapping, the user may choose to restore a system-resolution path returning independently verifiable real public origin IPs for the approved hosts using that client's supported settings. No prescribed setting is claimed applicable until ownership/mode is confirmed; do not stop the proxy or change DNS automatically.

User decisions needed: whether to authorize narrowly scoped read-only identification of that specific client/mode; who may make an environment change if needed; and a new DNS/HTTP validation batch after any approved change. Changing resolver service, DNS servers, network exit or routing, disabling TUN, hardcoding origin IPs, or allowing198.18/15 is outside this round. Do not launch a second source batch merely because the first sent HTTP0. All R2 source success/fixture counts and the unresolved final denominator remain unchanged.

Saved DNS-only and classifier logs/probes are reproducible evidence, not permission to rerun DNS/HTTP. Diagnostics and offline tests pass their checks; source data acquisition stays BLOCKED. No full product gate was rerun for read-only diagnosis.
