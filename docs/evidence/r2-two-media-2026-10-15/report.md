# Loadstar / Splash 两源 RSS 完整原字节回放 — 2026-10-15

本批有限验收 **PASS，待父会话审查**；整体R2未通过。前轮 `183385403520d6bf52b028909e0d42ae6b0a59a0` 三源结果已获限定认可（16/34、21/39）；本轮本地/远端/PR8起点也是该HEAD。产品代码仍为 `bebe1441465adfcabb9daf93cb2a8656ec1fc796`，没有产品改动。草稿PR8/base `codex/shipping-hot-r1-5@2939762da884aa9ae04f16e8d8bcccdeb5f148e5` 保持。

先检查 [旧四源证据](../r2-four-index-2026-10-13/batch-results.json)，XX-M01/XX-M03均 `rawStructureFixtureRetained=false`，各10条只是派生记录。本地[有界盘点](local-raw-inventory.json)（含ignored `.tmp`，排除依赖/构建/.git/保留数据库/符号链接）未找到旧wire hash匹配文件，也没有两源可复用XML；没有合成XML。

| 来源 / 精确目录产品 | UTC实网开始 | GET / 完整字节 | 实际记录/版本 | 原item pubDate | 重复新增/修订 | query-only重开差异 |
| --- | --- | --- | --- | --- | --- | --- |
| XX-M01 https://theloadstar.com/feed/ | 2026-10-15T04:25:58.202Z | 200 / 20417 | 10 / 10 | 秒精度 +0000 | 0 / 0 | 0 |
| XX-M03 https://splash247.com/feed/ | 2026-10-15T04:25:58.867Z | 200 / 18929 | 10 / 10 | 秒精度 +0000 | 0 / 0 | 0 |

至04:26:00.120Z两源完整响应保存。总 **2系统DNS / 2 GET / 2完整响应**；[manifest](manifest.json)、[DNS ledger](dns-ledger.json)、[request ledger](request-ledger.json)绑定精确目录URL、执行HEAD和调用时点。全部公网，正常TLS，复用安全入口/固定地址transport；512KiB/10s/并发1，redirect/retry/detail/pagination均0，无Clash/系统网络设置、CA注入或安全绕过。此轮请求预算已用尽。

完整XML仅保存在 ignored `.tmp/r2-two-media-2026-10-15-private/{ID}.response.bin`，业务许可维持 `disallowed` / `metadata_only`，生产registry未增加来源。远端只保存必要日期/计数/hash及过程，无标题/链接明文、摘要/正文或完整响应头。wire SHA256：

- XX-M01：`295d274b904d6d0badea109dc22f74b0caaefc2bbe3f6fcdc38145e4d878bd7a`
- XX-M03：`969e258cf2ab584fcf8e616c5afe27126dd95d2506206e7f83c67ffdbd1e1bab`

[回放](replay-procedure.test.ts.txt)复用上批相同流程：先验证原字节/hash和安全解码，直接从保存XML DOM审计完整title/link/pubDate（仅证据检查，非新业务解析器），业务继续调用既有Feed parser和collector。隔离SQLite共20items/versions/title blocks，只保存metadata；source `enabled=false`。每项原文pubDate有明确+0000，未知时区条数0；原文没有独立updated，既有sourceUpdatedAt回退pubDate，不伪称独立修订时间。既有RSS `date_evidence`仍null，原字面量/offset保留在私有原件和最小日期审计，没有扩存储合同或迁移。

同字节重复均0新增/修订，只有预期lastSeenAt推进，其他item/全部version字段不变。写连接关闭后用readonly native连接、`PRAGMA query_only=ON`重开，item/version/block全量快照与原完整title/URL/日期一致，20条0差异，库文件前后hash不变。离线注入transport及TCP/global fetch守卫均0真实尝试，usage不变仅作辅助证据。[回放汇总](replay-summary.json) / [Loadstar日期审计](XX-M01-field-audit.json) / [Splash日期审计](XX-M03-field-audit.json)。

本批采集harness 1项、离线回放2项raw exit0。无源码缺陷/更改，**本轮install/typecheck/产品lint/全量Vitest/build/S7均NOT_RUN**，没有重复全门禁或冒称干净代码新验证。Markdown lint与[文档/证据校验](validation.json)单列。原stdout/stderr的精确UTF8内容及hash在 [original outputs](original-command-outputs.json)，`.log`只规范化展示尾部空行。Vitest既有unimport同名提示、固定字面量capture wrapper的DEP0190保留。

仅两个来源条目改变，其他39项逐项相同：[delta](matrix-delta.json)。R2-5 **16/34→18/34**（18PASS/4FAIL/1PARTIAL/11NOT_RUN，差16），R2-4仍 **21/39**（需至少32，差11）；数值有限历史诊断3/5单列。来源资格不等于生产开启或持续可用。整体R2、24h、旧GUI/S7未通过；无迁移、生产、真实LLM/付费、merge/deploy/force-push。

同时完成[18项非OK来源的只读下一步边界](availability-frontier.md)：已有完整失败材料保留、不重跑结论；可优先离线推进MY-W01字段/身份提案，但其当前artifact未证明等同wire原字节，且精确产品URL/无id链接/未知时区仍需合同审查。没有仅凭已有材料可直接升OK的候选。[材料审计](saved-gap-material-audit.json)没有来源请求或失败探针重跑。
