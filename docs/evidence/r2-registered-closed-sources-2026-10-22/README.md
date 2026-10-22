# R2：已合格 HTML 候选默认关闭注册（CN-T02 / TH-C01 / PH-C01 / CN-P01 / TH-C02 / VN-P03 / VN-T01 / ID-T01 / XX-K03 / ID-T02）与 collect-job 默认接线（2026-10-22）

dots 放行：Slack C0C8BC001NY ts 1792657970.271849、1792658044.563019。基线 `a26defa`。

## 改动

- 新增 `server/intel/sources/registry.ts`，导出 `registeredIntelSources`：原 TH-W01、ID-W01（对象原样复用，enabled:true 不变）加 `htmlIndexCandidates` 中按 catalogId 复用的 CN-T02、TH-C01（同一对象，enabled:false、persistence:disallowed）。模块加载时断言新增项关闭、id 与 catalogId 唯一。
- `server/runtime/intel-collect-job.ts`：`createIntelCollectJob` 未传 seeds 时默认值由 `intelSourceSeeds` 改为 `registeredIntelSources`；仍用 `??`，显式 `[]` 不回落。

## 范围（准确区分）

- 这是 **collect-job factory 的默认注册接入**（配置注册/运行接线）：不传 seeds 调用 `createIntelCollectJob` 时，构造本身不写库；只有该 job 实际执行且配置了 fetch 时，才把新增源以 enabled=0 upsert 进 `intel_source`；禁用行不进 `listDueSources`，不发请求。
- **普通应用启动不会自动注册四源**：`server/runtime/registry.ts` 仍显式传 `seeds: options.intel?.seeds ?? []`；生产 `intel-production.ts` 白名单仍写死 `["TH-W01","ID-W01"]` 且只从 `intelSourceSeeds` 取；migration 028、manual*、intel-observation 入口未改。
- 现有同 ID 行若为 enabled=1，默认 upsert 会改回 enabled=0（已测）。

## 测试（`server/intel/sources/registry.test.ts`，隔离内存 SQLite、fake lookup/transport、Socket.connect 拦截、零真实网络）

- 注册表：原两源同对象且 enabled，新两源与候选同对象且关闭，id/catalogId 唯一，数组冻结。
- a) 默认 job 经 BackgroundRuntime：新两源 enabled=0、无 fetch_run、不在 due，lookup/transport 未见其 URL/host（只请求原两源，fake 503）。
- b) 生产选择仍只出 TH-W01/ID-W01；CN-T02、TH-C01 及其与原源组合均抛 `intel_source_selection_invalid`；未启用时为显式 `seeds: []`。
- c) 显式 `seeds: []`：零新增注册行，迁移预置行不变（id/enabled/updated_at），新增源不存在，零 fetch_run、零请求。
- d) 仅测试专用副本（`structuredClone` + 展开，enabled:true）经 `getDefaultRuntimeJobs`→BackgroundRuntime→隔离 SQLite：合成 HTML 各写入 2 条，版本 `metadata_only`、只有 title 块。persistence 合同未放宽：disallowed 不阻止元数据写入，只限制为 metadata-only。
- e) 同 ID 行预置 enabled=1，默认 upsert 后为 0，不进 due、不请求、无条目。
- 每个用例后断言共享候选对象与原种子 JSON 未变、CN/TH 仍 enabled:false，且无外部 TCP 尝试。

## 对验收的影响

不提高资格计数：R2-4 仍 28/39，R2-5 仍 25/34。未接通 live，未启用调度，未请求外网，未改解析器。

## 第二切片：PH-C01 / CN-P01（dots 1792659213.305219）

- `REGISTERED_CLOSED_CANDIDATE_IDS` 扩为 CN-T02、TH-C01、PH-C01、CN-P01；新两源同样按 catalogId 复用候选对象，enabled:false、persistence:disallowed，未改解析器、许可、生产白名单，未重新请求原页。
- registry.test 的注册表、a、b、d、e 及共享对象未修改断言覆盖四个新增源；d 复用 `PH_SYNTHETIC`、`GD_SYNTHETIC`（各 2 条 metadata_only）。
- 区分两件事：上面是“配置注册/运行接线”；`initShippingTables` 迁移本身预置的 42 行目录行（含 TH-W01/ID-W01，不含这四个新增源）是数据库已有目录行，与本注册集是不同概念，不代表此前完全无注册，也不由本切片改变。
- R2-4 28/39、R2-5 25/34 不变；未接通 live。

## 第三切片：TH-C02 / VN-P03 / VN-T01 / ID-T01（dots 1792659856.878179、1792659922.734899）

- `REGISTERED_CLOSED_CANDIDATE_IDS` 扩为八个，新四源同样复用候选对象，enabled:false、persistence:disallowed；解析器、许可、生产白名单、资格计数未改，未重新请求原页。
- 测试复用整理：`thai-document-index.test.ts` 的 `markup()`（三个参数及默认值不变）逐字移到 `server/intel/sources/__fixtures__/thai-document-synthetic.ts`；`post-clash-index.test.ts` 的 `fixtures`（键顺序 VN-P03、VN-T01、ID-T01 不变，原测试 `cases[2]` 仍是 ID-T01）逐字移到 `post-clash-synthetic.ts`。原测试改为 import，输入与断言不变。逐字比对（去掉新增 `export ` 后的块文本 SHA-256）：markup `d7b3b6cd…7d8a`（641 B）、fixtures `6df6b1a9…ae92`（1681 B），前后一致，记录于 `D:\diag-logs\slice3-fixture-verbatim-2026-10-22.json`（本机日志，未入库）。
- registry.test 的注册表、a、b、c、d、e 与共享对象未修改断言覆盖八个新增源；d 另断言条目与版本日期证据的 publishedAt 均为 null：TH-C02 文档日期、ID-T01 制定日期保持原角色，不升级为发布时间。
- 仍区分“配置注册/运行接线”与迁移预置的 42 行目录行；upsert 只在 job 实际执行且有 fetch 时发生；普通应用启动不自动注册。R2-4 28/39、R2-5 25/34 不变，未接通 live。

## 第四切片：XX-K03 / ID-T02（dots 1792660394.720859、1792660460.596279）

- `REGISTERED_CLOSED_CANDIDATE_IDS` 扩为十个，新增 XX-K03、ID-T02，仍复用候选对象，enabled:false、persistence:disallowed。未新设 HTTP、重定向或许可例外；解析器、安全规则、样本、生产白名单、资格计数未改。
- 只读边界核对（以代码字面值为准）：XX-K03 入口 `https://www.sitc.com/en/list.asp?classid=44`；`metadataLinkRule: "sitc_show"` 只在 `web-list.ts` 的条目链接 `allowed()` 中生效，仅允许该来源、metadata-only 下精确 `www.sitc.com/en/show.asp?id=<digits>` 形状作为元数据身份，不进入抓取策略（`sourcePolicy` 无 allowHttp）。ID-T02 入口 `https://jdih.kemenkeu.go.id/`（HTTPS 根路径）；原有 root 307→/home 的保存形状测试仍在 `id-mof-index.test.ts`，本切片不改入口、不新增跳转许可。Runtime 路径与直接调用同为 `collectIntelSource`→既有安全抓取检查。
- registry.test 覆盖：注册表、a、b、c、e 与共享对象未修改扩至十源；d 副本经 Runtime→隔离 SQLite，fake transport 只收到配置字面值 HTTPS 入口（根路径直接 200，无跳转），XX-K03 2 条、ID-T02 3 条均 metadata_only、publishedAt=null，XX-K03 条目身份为原 HTTP show.asp 链接但没有任何 HTTP 请求。复用 `SITC_SYNTHETIC`、`JDIH_MOF_SYNTHETIC`。
- 仍区分配置注册/运行接线与迁移预置 42 行目录行；普通应用启动不自动注册。R2-4 28/39、R2-5 25/34 不变，未接通 live。MY-P03 不注册；XX-K01/CN-T01 未纳入。
