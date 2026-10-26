# CN-T01 #8 官方 HTTPS 详情单次探针与离线 8/8 证据（2026-10-26）

对应 dots ts `1792983062.325659` Part B；用户已批准。本机隔离目录 `.tmp/cn-t01-item8-https-20261026`，与 day20 observe（run-id `day20-20261026a` / worker PID 82336 / r2-compat）独立账本，未二次启动、未删锁、未触 day19。

## 单次 HTTPS 探针（唯一批准 URL）

- URL：`https://www.mofcom.gov.cn/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html`
- 物理 HTTP：**1**；系统 DNS：1；重定向：**0**；重试：**0**
- 超时 10s / 上限 512KiB / 严格公网 TLS；未请求 HTTP 原件、未重拉列表、未扩详情/PDF
- 结果：**HTTP 200**，22473 字节，`wireSha256=f73324f611d39e885fae695961f7dcbafd958a1619104e95704d49fca816e392`，hops=0
- DNS 地址公网未拦截：`60.163.129.136`、`180.163.117.53`（对比 2026-10-20 列表探针曾落 Clash fake-IP `198.18.0.5` 被拒）

原始元数据：[result.json](result.json) / [launch.json](launch.json) / [preflight.json](preflight.json)。响应正文仅存 `.tmp`，**不入 git**。

## 与既有 HTTP 身份的关系（200 ≠ 等价）

对照 `independent-fields.json` 中 index=15 原 HTTP 行：

| 字段 | HTTP 列表身份 | HTTPS 详情证据 |
| --- | --- | --- |
| host/path | `www.mofcom.gov.cn/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html` | 同 host/path，仅 scheme 为 https |
| 标题 | 商务部 科技部公告2026年第48号 …临时登记管理 | `<title>` **精确一致** |
| 编号 | 2026年第48号 | 页内公告用语/目录用语/临时登记管理均在 |
| 源日 | 2026-10-16 | 页内出现 2026-10-16（另有页面当日戳 2026-10-26，不覆盖源日） |

裁决：`EQUIVALENT_FOR_IDENTITY_FIELDS`（见 [equivalence.json](equivalence.json)）。**先记录 HTTP↔HTTPS 关系**；**不**静默改写产品身份，**不**抬资格计数。

此前 offline proposed-mapping 未决项「该详情 URL 无传输等价证明」由本探针补齐。

## 证据-only 离线 8/8（产品代码未改）

复用已保存列表原件（`response-after-save-20261020.bin`，20318B，sha256 `ab5e3780…515d340f`）：

1. **产品基线** `fromHtml(原件)` → **7**（绝对 `http://` 政策仍被现有 `allowed()` 排除）
2. **证据-only**：仅在私有 HTML 副本把该精确 HTTP href 换成同 host/path HTTPS twin（解读链接仍在 `/zcjd/`，继续排除）→ `fromHtml` **8**
3. collector → 再跑 → 隔离 native SQLite 只读重开：`itemsSeen=8/8`，二次 `itemsNew=0` 幂等，重开 8 条

见 [offline-8of8.json](offline-8of8.json)。**未改** `web-list.ts` / seed / matrix；注册态仍为 7/8 PARTIAL，直至 dots 裁定是否接受「同 allowUrlPrefixes 下 HTTP→HTTPS 升级」。

## 计数冻结（交 dots 裁定）

| 项 | 值 |
| --- | --- |
| R2-4 | **32/39** |
| R2-5 | **25/34** |
| numeric | **3/5** |
| overallR2Pass | **false** |
| CN-T01 | 仍 PARTIAL，待裁定 |

## 变更与非变更

- 本轮落地：本证据目录元数据；隔离 `.tmp` 探针/离线账本
- **无**产品代码 diff；**无** originals/secrets 入 git；**无** main R2 / mapping 改写；**无** merge/deploy/force；**未** Slack / 未联系 Guyang；**未**打扰 day20 observe

## Qualification note (dots 1792984344.944339)

The evidence-only HTML-copy href-mutation 8/8 above is **experimental / NON_QUALIFYING**. Product qualification uses the minimal `metadataLinkRule=mofcom_art_http_https_twin` path in [../r2-cn-t01-http-https-alias-20261026/report.md](../r2-cn-t01-http-https-alias-20261026/report.md) (original HTTP canonical identity; HTTPS alias only; not blanket upgrade).
