# R2 现有 Feed 统一安全抓取（2026-10-12）

依据：dots 2026-10-12 17:16（ts 1791796610.701459）。分支 codex/shipping-hot-r2（PR #8）。R2 整体仍未完成。

## 1. 改动
- `server/providers/feed.ts` 的 `createPublicFeedProvider` 不再使用 `globalThis.fetch`，也不再接受 `fetcher` 选项。现在的唯一入口是 `secureFetchArticle`（`server/services/article-fetch-security.ts`），保留原有的全部防护：每一跳都重新校验 URL 和协议、校验精确主机、校验 DNS（所有 IPv4/IPv6 结果）；连接固定到已校验的地址；阻断私网和特殊地址；阻断 HTTPS→HTTP 降级；限制重定向次数和响应大小；校验 Content-Type。
- 测试注入点是 `fetch?: { lookup, transport }`，生产代码不传，就用真实 DNS 和固定地址的 transport；没有普通 fetch 的回退。
- 列表抓取策略 `feedListFetchPolicy(source)`：
  - 只允许列表 URL 自身的主机（theloadstar.com、www.portshekou.com），没有放宽；跳到其他主机，包括子域名或加 www，都会失败。
  - 只允许 HTTPS。
  - rss 格式只接受 application/rss+xml、atom+xml、rdf+xml、application/xml、text/xml；html 格式只接受 text/html。
  - 响应上限是 `FEED_FETCH_MAX_BYTES` = 2 MiB（原来的 Feed 抓取没有上限；文章页面是 512 KiB）。
- 解析仍然只走 feed.ts（parseFeedRss / parseFeedHtml）。没有第二套抓取器，也没有第二个调度器；调度仍然是 registry 里每个来源一个 feed-sync job，挂在 BackgroundRuntime 上。
- article-fetch-security 只做了增量修改，文章行为不变：
  - 新增可选的 `accept`，默认值还是文章原来的 HTML 值；Feed 按允许的类型传入。
  - `signal` 现在会传给 transport 和 Node 的 request，超时后能真正中止请求（之前这个字段声明了但没有使用）。
  - http_error 带上 status，所以 Feed 的 HTTP 失败分类（401/403/429/503/504）保持不变。
- 超时和失败回退的语义不变：外层仍是 `withFeedSourceTimeout`（默认 10 秒，provider_timeout，错误信息不变）。失败时把 last-known 条目标为 stale/failed 并保留；`throwOnSourceFailureWithoutLastKnown` 不变。安全阻断映射为 provider_unavailable，错误信息里带阻断码；Content-Type 不符映射为 provider_contract_changed。
- 默认开关和白名单都没有改动。

## 2. 调用点核查（非测试代码）

已覆盖，走 secureFetchArticle：
- `server/runtime/registry.ts` 的 feedJobs，每个来源一个 `createPublicFeedProvider({ sources: [source] })`，由 BackgroundRuntime 调度。这是实际的 Feed 同步路径。
- `server/providers/shipping.ts` 的 `configureProviders` → `configureFeedProviders` → `createPublicFeedProvider()`（仅当 SHIPPING_FEED_PROVIDER=public 时）。
- `server/intel/collect.ts`（R2 首切片）原本就走这个入口。
- `server/runtime/article-fetch-job.ts` 的文章正文抓取原本就走这个入口。

不经网络：MockFeedProvider、createUnavailableFeedProvider。

未覆盖（不属于“现有 Feed 列表”，各自有抓取器，本片没有改动）：
- 官方天气预警（`server/providers/weather-alerts.ts`：TMD/BMKG CAP、JMA、NMC、NCHMF、MetMalaysia）。它们也会产出 FeedItem，但用的是自己的 fetcher（CAP 正文有 redirect:"error" 等规则）。
- Open-Meteo 天气、JMA 热带气旋、日历、DeepSeek 翻译。
- `scripts/r1-5-*-live.ts` 实网脚本（天气或预警，plain fetch，只有手动执行时才会运行）。
- e2e 和验收脚本里的 fetch 只访问本地服务。

## 3. 测试（离线，注入 lookup/transport）
- `server/providers/feed.test.ts`：原有 6 项 provider 测试改成走注入的 transport。新增 9 项：正常响应、私网（IPv4 和 IPv6 混合）、跳转到私网（下一跳重新解析后阻断）、非白名单（其他主机、www、子域名）、HTTPS 降级、响应超限、超时、Content-Type 不符，以及一项源码检查（feed.ts 里没有 globalThis.fetch 或 fetcher）。
- `server/runtime/feed-sync-job.test.ts`：新增 1 项。私网阻断和 DNS 失败时，同步失败不会清空已有 Feed（条目保留为 current、stale/failed，transport 一次都没有被调用）。

## 4. 未覆盖项和风险
- 没有用实网验证（本片不运行上游抓取）。真实站点如果跳到 www 或其他主机，或返回列表之外的 Content-Type，会表现为该来源失败并保留 last-known，不会放宽规则；需要以后另行授权的实网探测来确认。
- 不在本片：来源专属 CA、三种编码、web_list/json_list。
- 天气预警等非 Feed 抓取器仍然各自实现，未统一。
- 之前的缺口照旧：历史回放 1/10、PAGASA、促销缺口，以及 R2-3 的限制（遗留 unknown 的保守预留、实际费用对账和真实调用方仍未完成）。
