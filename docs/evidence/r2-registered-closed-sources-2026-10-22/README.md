# R2：来源候选默认关闭注册（CN-T02 / TH-C01 / PH-C01 / CN-P01 / TH-C02 / VN-P03 / VN-T01 / ID-T01 / XX-K03 / ID-T02 / VN-D01 / XX-K02 / XX-K01 / CN-T01 / MY-C01 / MY-T01 / PH-M01 / XX-M01 / XX-M03）与 collect-job 默认接线（2026-10-22）

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

## 第五切片：VN-D01（dots 1792661910.864189）

- 在新 worktree `D:\try one\Shipping HOT\.tmp\worktrees\r2-compat`（detached，起点 51e5968）完成；依赖按锁文件离线安装（`pnpm install --frozen-lockfile --offline` exit 0，但 prepare 阶段 simple-git-hooks 的 hook setup 报错：worktree 内 `.git` 是文件，无法创建 `.git\hooks`；共享 hooks 未改），门禁前核实解析到该 worktree 自己的 node_modules。
- `REGISTERED_CLOSED_CANDIDATE_IDS` 扩为十一个，新增 VN-D01（复用候选对象，enabled:false、persistence:disallowed）；解析器、安全规则、生产白名单、资格计数未改，未重新请求原页。
- `vn-disaster-index.test.ts` 的 `card`/`page`/`synthetic` 三行逐字移到 `server/intel/sources/__fixtures__/vn-disaster-synthetic.ts`（去掉新增 `export ` 后块文本 SHA-256 一致：`7f2b13e8…7bfb`，eslint 后去尾空白复核 `5af5a3c9…29dd1`）；原测试改为 import，title 属性、同锚点尾部日期、未知时区/null 发布时间断言与全部负例不变。
- registry.test 覆盖扩至十一源；d 副本经 Runtime→隔离 SQLite 只请求配置 HTTPS 入口，2 条 metadata_only，标题取完整 title 属性，publishedAt=null。
- 仍区分配置注册/运行接线与迁移预置 42 行目录行；普通应用启动不自动注册。R2-4 28/39、R2-5 25/34 不变，未接通 live。

## 第六切片：XX-K02（dots 1792662529.753349、1792662635.586629）

- `REGISTERED_CLOSED_CANDIDATE_IDS` 扩为十二个，新增 XX-K02（`kind: json_list`，复用候选对象，enabled:false、persistence:disallowed）；沿用已有 json_list adapter 与 `script#__NEXT_DATA__`、`props.pageProps.pinArticle` + `props.pageProps.articles` 配置，解析器与安全合同未改。
- 无专用样本，新建 `server/intel/sources/__fixtures__/one-newsroom-synthetic.ts`：明确标记为按现有配置形状编写的合成 fixture，不是保存的 ONE 原页，也不是通用 `#payload`/`page.pin` 样本；内含一个不应执行的脚本。
- registry.test d：副本经 Runtime→隔离 SQLite 只请求 `https://www.one-line.com/en/newsroom`，写入 3 条 metadata_only；`releaseDate` 保留秒精度原串（`2026-10-05T11:31:17` 等），precision=second、timezone=missing、publishedAt=null。脚本不执行、冲突与越界链接拒绝沿用 `json-list-html.test.ts` / `json-list-collect.test.ts` 已有断言。生产选择拒绝 XX-K02。
- 仍区分配置注册/运行接线与迁移预置 42 行目录行；R2-4 28/39、R2-5 25/34 不变，未接通 live。

## 第七切片：XX-K01（dots 1792663523.596789）

- `REGISTERED_CLOSED_CANDIDATE_IDS` 扩为十三个，新增 XX-K01（web_list，复用候选对象，enabled:false、persistence:disallowed）；解析器、安全合同、`MAERSK_HEADER_LIMIT` 未改，不新增或传播例外。
- `maersk-mofcom.test.ts` 的 `maerskHtml` 原样移到 `server/intel/sources/__fixtures__/maersk-news-synthetic.ts`（SHA-256 `e88fd89abeeb6438e1719237d6569d902daeba88e80e0b48709dd18178920f6a` 与 12369ac 原串一致），原测试输入与断言不变。
- registry.test d：副本经 Runtime→隔离 SQLite 只请求 `https://www.maersk.com/news`，写入 2 条 metadata_only；transport 选项精确为 maxHeaderSize 32768、maxBytes 524288、timeoutMs 10000、无 caPem；其他来源 transport 不带 maxHeaderSize。生产选择拒绝 XX-K01。
- 保留回归：错误 sourceId/URL/预算 DNS 前拒绝、重定向不继承例外（`maersk-mofcom.test.ts`）；默认 16 KiB、20 KiB 仅精确 opt-in 通过、40 KiB 拒绝（`article-fetch-header-limit.test.ts`）。CN-T01 未混入，MY-P03 不注册；R2-4 28/39、R2-5 25/34 不变，未接通 live。

> 措辞说明：本文件所列均为“默认关闭注册”（enabled=false、persistence=disallowed、仅 metadata），不是资格声明；各源资格以矩阵为准，CN-T01 为 R2-4 OK / R2-5 PARTIAL（7/8）。注册不补足缺失身份，不改变 28/39、25/34；生产自动抓取未启用。

## 第八切片：CN-T01（dots 1792664101.141579、1792664168.380759）

- `REGISTERED_CLOSED_CANDIDATE_IDS` 扩为十四个，新增 CN-T01（web_list，复用候选对象，enabled:false、persistence:disallowed）；registry 注释由 “Qualified candidates” 改为默认关闭注册、非资格声明。解析器、安全合同、HTTP 策略未改；不加 sourceHeaderLimit/maxHeaderSize，不共享 Maersk 例外。
- `mofcomHtml` 原样移到 `server/intel/sources/__fixtures__/mofcom-policy-synthetic.ts`（SHA-256 `1b141f217fda8cb31c08272a883143ab47a0c3ae1f06db2a61a6bd43b1528100` 与 198e688 原串一致），原测试输入与断言不变。
- registry.test d：副本经 Runtime→隔离 SQLite 只请求 `https://www.mofcom.gov.cn/zcfb/index.html`，只入库两条合成 HTTPS 政策；原始 HTTP policy 身份与 HTTP 解读链接继续排除，不改写协议、不请求详情；日期 precision=day、timezone=missing、publishedAt=null；transport 不带 maxHeaderSize。生产单独/混合选择（`CN-T01`、`ID-W01,CN-T01`）均拒绝。
- CN-T01 仍为 R2-4 OK / R2-5 PARTIAL（7/8），不升级资格；R2-4 28/39、R2-5 25/34 不变，未接通 live。MY-P03 不注册。

## 第九切片：MY-C01 RSS 默认关闭接线（dots 1792664710.276179）

- 纠正：MY-C01/MY-T01/PH-M01 “补原 XML 回放”为过时待办，已由 `docs/evidence/r2-three-rss-2026-10-15/report.md` 完成 26 条回放、矩阵 OK/PASS；本切片未重找原件、未重跑历史回放、未由派生记录补造 XML。
- 只读核对：此前仅有 evidence-only 配置 `bounded:MY-C01`（`MY-C01-isolated-config.json`，标明非生产/非候选），无其他产品配置；URL、host、kind=rss、persistence=disallowed 与目录 `docs/intel-source-catalog.md` 一致，无合同冲突。
- 新增 `server/intel/sources/rss-candidates.ts`：正式 ID `intel:my-c01`（与 `intel:<catalog>` 命名一致且唯一，不复用 `bounded:` 取证 ID），`https://www.customs.gov.my/ms/arkib/pengumuman?format=feed&type=rss`、host `www.customs.gov.my`、既有 Feed content-types（`sources.ts` 仅把 `FEED_CONTENT_TYPES` 改为 export，值不变），enabled:false、persistence:disallowed；沿用既有 Feed parser，无 header/CA/HTTP 例外，解析器/许可/网络安全未改。registry 按 catalogId 复用该对象，默认关闭注册共十五个。
- 新编 synthetic RSS `server/intel/sources/__fixtures__/my-customs-rss-synthetic.ts`（明确标注，非私有原 XML、非派生记录）。registry.test d：Runtime→隔离 SQLite 只请求配置 URL，2 条 metadata_only（description 不入库），既有 Feed 语义下显式 +0800 pubDate 换算 publishedAt；正式 ID 入库、无 `bounded:` 行；生产选择拒绝 `MY-C01`、`TH-W01,MY-C01`、`intel:my-c01`、`bounded:MY-C01`。
- 本次仅补默认关闭接线，不新增资格分子、不宣称 live；生产白名单仍仅 TH-W01/ID-W01、应用启动仍显式空 seeds，生产自动抓取未启用。R2-4 28/39、R2-5 25/34 不变。MY-T01/PH-M01 留后续。

## 第十切片：MY-T01 / PH-M01 RSS 默认关闭接线（dots 1792665219.519459）

- 开工核对 `docs/evidence/r2-three-rss-2026-10-15/MY-T01-isolated-config.json`、`PH-M01-isolated-config.json` 与目录：URL、host、kind=rss、五项内容类型、3600000、disallowed 一致，无冲突。
- `rss-candidates.ts` 新增 `intel:my-t01`（`https://www.mof.gov.my/portal/ms/berita/siaran-media?format=feed&type=rss`，host `www.mof.gov.my`）与 `intel:ph-m01`（`https://portcalls.com/feed/`，保留尾斜杠，host `portcalls.com`，不加 www）；enabled:false、persistence:disallowed，无 CA/header/HTTP 例外，沿用既有 Feed parser。默认关闭注册共十七个。
- 新 fixture `my-mof-rss-synthetic.ts`（+0800）、`portcalls-rss-synthetic.ts`（+0000）明示 synthetic，带 description。registry.test 的“非 MY-C01 即 publishedAt=null”改为明确 RSS 分支：三源逐条核对 UTC publishedAt；RSS 保持 dateEvidence=null（区别于 HTML/JSON 日期证据）；fixture 无 `<updated>`，sourceUpdatedAt 为 parser 回退到 pubDate 的值，不是独立更新时间；title-only，description 不入库。
- 生产单独及混合选择（含 `intel:`、`bounded:` 形式）均拒绝；生产白名单、应用显式空 seeds 未改，生产自动抓取未启用。不新增资格分子，R2-4 28/39、R2-5 25/34 不变，未接通 live。

## 第十一切片：XX-M01 / XX-M03 RSS 默认关闭接线（dots 1792665925.725299）

- 开工核对 `docs/evidence/r2-two-media-2026-10-15/XX-M01-isolated-config.json`、`XX-M03-isolated-config.json`：URL、host、rss、五项内容类型、3600000、disallowed 一致，无冲突。另注：既有 Feed provider `server/providers/feed.ts` 的 `the-loadstar`（同 URL，enabled，shipping feed 链路）是另一条已上线产品链路，本切片未改；`intel:xx-m01` 为 intel 链路的独立关闭候选，不复用、不替代该 feed 源 ID。
- `rss-candidates.ts` 新增 `intel:xx-m01`（`https://theloadstar.com/feed/`，host `theloadstar.com`）、`intel:xx-m03`（`https://splash247.com/feed/`，host `splash247.com`），不加 www、保留尾斜杠；enabled:false、persistence:disallowed，无 CA/header/HTTP 例外；parser/security/生产允许集合未改。默认关闭注册共十九个。
- 新 fixture `loadstar-rss-synthetic.ts`、`splash247-rss-synthetic.ts` 明示 synthetic，带 description，pubDate 显式 +0000，无独立 updated。RSS 分支扩为五源：逐条 UTC、dateEvidence=null、sourceUpdatedAt=pubDate 回退值、title-only。生产拒绝含 `the-loadstar`、`intel:`、`bounded:` 形式。原 XML 回放已于 10/15 完成，未重做。R2-4 28/39、R2-5 25/34 不变，未接通 live。
