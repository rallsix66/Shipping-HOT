# 三源 RSS 有界原字节取证与字段回放 — 2026-10-15

本批有限验收 **PASS，待父会话独立审查**；整体 R2 未通过。没有产品代码修改。执行起点、本地及远端核对均为 `8027aeeda436faff8eb6ac3c0f0f0dd8d763f9be`；产品代码仍为已认可的 `bebe1441465adfcabb9daf93cb2a8656ec1fc796`。PR8 为 draft，base 保持 `codex/shipping-hot-r1-5@2939762da884aa9ae04f16e8d8bcccdeb5f148e5`。

先检查旧 [batch-results](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json)：三源均 `rawStructureFixtureRetained=false`，旧 10/6/10 只是派生记录。对本仓库及 ignored `.tmp` 做[文件盘点](local-raw-inventory.json)，排除依赖、构建、Git、缓存、保留数据库和符号链接；未找到旧响应哈希对应的完整文件，也未找到可归属三源的 XML。没有用派生记录合成原文。于是按本轮明确授权各做一次系统 DNS 校验和安全 GET。

| 来源 | DNS 公网结果 | 精确目录 GET / 完整字节 | 实际入库 / 版本 | 原始 item pubDate 时区 | 重复新增 / 修订 | query-only 重开差异 |
| --- | --- | --- | --- | --- | --- | --- |
| MY-C01 马来西亚海关 | 103.245.91.224 | 200 / 7619 | 10 / 10 | +0800 | 0 / 0 | 0 |
| MY-T01 马来西亚财政部 | 163.53.154.2 | 200 / 6185 | 6 / 6 | +0800 | 0 / 0 | 0 |
| PH-M01 PortCalls | 173.231.251.20 | 200 / 10179 | 10 / 10 | +0000 | 0 / 0 | 0 |

精确 URL 与目录及旧配置逐项相等，见 [manifest](manifest.json)。实网时间 **2026-10-15T04:10:40.625Z–04:10:43.168Z**；[DNS ledger](dns-ledger.json) 3 次，[request ledger](request-ledger.json) 3 次 transport 调用且 3 个完整响应，均 `application/rss+xml; charset=utf-8`，无编码冲突。复用 `secureFetchArticle/defaultTransport`，固定已经校验的公网地址、正常 TLS 验证、512 KiB/10s/并发1、batch60s；redirect/retry/detail/pagination 均 0。没有源 CA 注入、系统网络设置修改或绕过安全检查；此批来源请求预算已用尽。

完整原字节只在 ignored `.tmp/r2-three-rss-2026-10-15-private/{ID}.response.bin`。远端仅保留计数、日期、标题/链接摘要哈希和[响应哈希](capture-summary.json)，不保存原 XML、文章标题/摘要/正文、Cookie 或完整响应头。原始字节分别为：

- MY-C01：`a53ae6ded69ef3a0a64bd64c8824d69392592e00a6f87a97425ea82636c4858f`
- MY-T01：`576ea0c1878c50591cd326fe07d27aafe9c6ba7f402df0ae1adc3b42a448a0c0`
- PH-M01：`d8a6a4d1c9f9247404777d9ba0434ab611cc5fd5a3e4872ed1c4e32714d33a9a`

[回放过程](replay-procedure.test.ts.txt)先验证完整字节长度/hash及既有安全解码，再从原 XML DOM 检查每项完整标题、原链接、pubDate 字面量。此 DOM 检查仅用于独立证据比对；业务解析仍只调用既有 `parseFeedEntries`，收藏仍只调用现有 `collectIntelSource`。各源使用隔离、disabled、`persistence=disallowed` 的证据配置，没有新增生产候选或 registry 项。

26 项均是秒精度且带明确 offset；逐字段比对原日期→UTC，与 parser、SQLite item 的 `published_at`、version 的 `source_published_at/source_updated_at` 一致。三源都没有独立 `updated`，现有 `sourceUpdatedAt` 回退到 pubDate；这不证明独立更新时间。未知时区没有补造，本样本未知时区条数为 0。RSS 既有 `date_evidence` 列仍为 null；原始时区/字面量在私有 XML、私有完整字段审计及远端日期字段审计中保留，**没有新增业务存储合同或迁移**。

隔离库实际写入 **26 items / 26 versions / 26 title blocks**，内容范围均 `metadata_only`。同字节重复执行 `itemsNew=0/itemsRevised=0`，只有预期 `lastSeenAt` 推进；其余 item 字段、全部 version 不变。关闭写连接后用原生 readonly 连接重开并设 `PRAGMA query_only=ON`，全量 item/version/block 快照相等，完整标题/URL/源时间字段 0 差异，重开前后库文件 hash 不变。离线回放有 TCP/global fetch tripwire，均 0 尝试；真实 DNS/HTTP 为 0。usage 行不变只是辅助检查，无外呼结论同时依赖注入字节 transport 与网络守卫。[回放汇总](replay-summary.json) / [MY-C01 日期审计](MY-C01-field-audit.json) / [MY-T01 日期审计](MY-T01-field-audit.json) / [PH-M01 日期审计](PH-M01-field-audit.json)。

当前唯一矩阵只更新这三项；其他 **38 项内容逐项相同**，见 [delta](matrix-delta.json)。三源原已计可用性，不新增 R2-4 分子：仍 **21/39**、至少32、差11。R2-5 从 **13/34→16/34**，16 PASS / 4 FAIL / 1 PARTIAL / 13 NOT_RUN，差18。数值有限历史诊断仍独立 **3/5**，不并入资讯字段分子。Northport 冲突、VN-P01 缺日期、MY-L01 缺详情 href、两个旧未跟随重定向、NMC FAIL、Westports STALE、XX-W02 和 VNSGN 的已记录限制保留。

仅证据执行：采集 harness 1 项、离线回放 3 项测试均 raw exit 0，原始 stdout/stderr、命令、过程在本目录。不是新的产品门禁：install、typecheck、产品 lint、全量 Vitest、build、S7 本轮均 **NOT_RUN**，已有 `bebe144` 干净 SHA 门禁只按其原范围继承。文档/证据检查和 Markdown lint 单独记在 [validation](validation.json)。没有 UI 改动，旧 GUI/S7 未验证项仍 pending；无真实 LLM/付费、生产开启、24h、迁移、凭据改动、merge/deploy/force-push。

下一项建议：父会话先审本批；随后可以有界离线盘点 XX-M01 / XX-M03 既有完整材料和字段缺口。若仍缺原字节，来源 GET 必须另行批准。这里不是新实网或扩大生产选择范围的授权。
