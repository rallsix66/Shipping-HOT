# R2：CN-T02 / TH-C01 / PH-C01 / CN-P01 默认关闭注册与 collect-job 默认接线（2026-10-22）

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
