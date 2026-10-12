# R2 架构映射与交接计划（只读分析，2026-10-12）

依据：dots ts 1791790695.728109 / 1791790821.307749（2026-10-12 15:47 UTC+8）。**本文件只是文档，没有写任何 R2 产品代码**；没有发起付费调用、没有使用凭据、没有启动 24 小时真实运行、没有改生产开关、没有合并或改分支策略。

对照基线：分支 `codex/shipping-hot-r1-5`，HEAD `d45a7ab0ba42f87d26dfd6d686b0edf8e80a9f6e`；计划 `docs/plans/shipping-hot-risk-intelligence-2026-09-29.md`（§5.2/§5.3、R2 验收、§6/§7）；ADR-007、ADR-008。代码事实来自本次逐个阅读的文件，行号以该 HEAD 为准。

## 修订记录
- 2026-10-12 16:01 UTC+8 按 dots ts 1791791688.152539 修订：安全抓取改为复用 `server/services/article-fetch-security.ts`；R2-3（paid_receipt 等）归回 R2；授权口径更正；正文版本补充可读旧正文保留与读取测试；迁移 021 起已获认可；RSS 保留 feed.ts；分支方案 B 获准为后续例外（本轮未建分支）。

## 0. 用户决定（影响 R2 的前提）
2026-10-12 15:31 UTC+8 用户原话：「历史回放就这样吧，要那么多历史也没用，我要的还是之后的自动抓取的信息。」
- 停止历史样本采集，不再新增历史来源。
- Nalgae 1/10 保留为**未完成验证（用户延后）**，不阻塞 R2；R1.5-4 **不标 PASS**。
- R1.5 其他缺口另列于 `docs/status.md`（PAGASA 正样本、E-R04/E-R06 窗口、XX-E03 实现只放行 PH）。

## 1. 复用点与缺口
| 能力 | 现有实现（事实） | 对 R2 的结论 | 缺口 |
|---|---|---|---|
| 调度 | `server/runtime/background-runtime.ts`：`RuntimeJob{id,providerId,capability,intervalMs,enabled,usageAlreadyRecorded,run}`；`inFlight` 防重入（返回 `skipped/job_running`）；`runtime_stopped`；注册在 `registry.ts`/`bootstrap.ts`，插件 `server/plugins/background-runtime.ts` | **唯一调度器**。intel 采集注册为 `RuntimeJob`（每类或每批信源一个 job），**不建第二套调度/队列** | 失败后下次时间仍为固定 `intervalMs`（`consecutiveFailures+1`，但没有指数退避）→ 退避要在 intel 层按 `consecutive_failures` 计算 `next_sync_at`，或给 RuntimeJob 加可选 `nextDelayMs`（小改，需测试） |
| 运行记录/健康 | 表 `sync_runs`（migration 001）与 `provider_runtime`（006 重建，含 `status/last_success_at/last_failure_at/next_sync_at/consecutive_failures/error_code/data_count`）；`RuntimeRepository`、`PROVIDER_CIRCUIT_BLOCK_CODES` | job 级记录直接复用；每信源一行的明细放 `intel_fetch_run`（计划表），健康聚合写 `intel_source` | 现有 `SyncResult` 只有 `success/failed/skipped`，**没有“成功但为空”**；intel 需在 `intel_fetch_run.status` 区分 `ok_items / ok_empty / failed / not_modified` |
| 用量/预算 | `provider_usage`（001 + 011 `records_count`）、`recordProviderUsageInTransaction`；翻译预算门 `translation_budget_zero` / `translation_budget_exhausted`（`server/services/translation-settings.ts:122-123`） | 免费抓取只记 `provider_usage`，**不建第二张预算表**；`paid_receipt`、零预算零调用、发出后超时与重启幂等属于 **R2-3，在 R2 内完成**（离线代码和测试），预算判定复用现有预算门 | 预算门目前绑定翻译设置，需要抽成通用判定（R2-3 切片内做）；真实付费调用和凭据另需授权 |
| RSS/XML 解析 | `server/providers/feed.ts`：`fast-xml-parser` `parseFeedRss`、cheerio `parseFeedHtml`、`canonicalizeFeedUrl`、`dedupeFeedItems`、10s 超时 | **保留 feed.ts 为唯一解析器**（dots 已定）。对照固定版本 AIHOT@44578fa 的 `rss.ts`，只补缺失的 Atom/RDF；intel 与现有 feed 同步统一调用 feed.ts，**不复制 rss.ts** | Atom/RDF 支持；调用点统一 |
| 抓取 | 正文抓取已有 `server/services/article-fetch-security.ts`：逐跳检查协议/主机/DNS，拒绝 IPv4/IPv6 私网，连接固定到已验证地址，有字节与跳转上限，拒绝 HTTPS 降级。`feed.ts` 列表抓取仍是 `fetcher(url,{signal})` + `response.text()`，没走这层 | **复用 article-fetch-security 并保持全部防护**，不另造更弱的 helper；AIHOT `http-fetch.ts` 只借 UA 配置等不重复的部分 | Feed 列表抓取统一接入该安全层；按信源 CA 扩展（只对该信源生效）；编码探测扩展（见 §4） |
| 正文抽取 | `server/providers/article-extractor.ts`（cheerio，`ARTICLE_EXTRACTOR_VERSION = "article-extractor-v1"`，按来源 policy） | 按 §5.3-B 与 AIHOT `extract.ts` **合并**为一个抽取器（Readability 主流程，保留现有安全检查），不另建 | 依赖 `@mozilla/readability`、`linkedom` 尚未安装（本轮不装） |
| 正文版本 | migration 013：`feed_articles`、`article_versions(UNIQUE(feed_item_id, content_hash))`、`article_blocks`（按版本存可读的结构化正文块） | 照 013：每个版本不只存哈希和提取器版本，**同时存可读内容**（见 §2.1） | intel 用自有版本表与块表，结构照 013 |
| 信源目录 | `docs/intel-source-catalog.md`（ADR-008 唯一种子）；现有 `shippingFeedSources` 是代码内数组 | `intel_source` 由目录生成，`shippingFeedSources` 暂不迁移 | 目录→种子的加载器与白名单校验需新写 |
| 迁移编号 | 已有 001–020；**015–020 实际属于 R1.5**（运营/天气/日历/政策） | intel 迁移从 **021** 起追加（dots 已认可），只增不改 | — |

依赖现状（package.json）：已有 `fast-xml-parser ^5.4.1`、`cheerio ^1.2.0`、`better-sqlite3`；计划需要的 `zod`、`@mozilla/readability`、`linkedom`、`undici`、`p-limit` 是否全部引入待第一切片决定，**本轮未安装**。

## 2. 第一个切片：零网络、零 LLM 的存档夹具闭环
流程：目录（夹具子集）→ 受控适配器（只读本地存档文件，fetcher 注入）→ 去重 / 正文版本 → SQLite → 信源运行结果。

**新增迁移（只增）**
- `021-intel-source-and-runs.ts`：`intel_source`（id、catalog_id、kind、url、enabled、status、consecutive_failures、next_sync_at、last_ok_at、last_error_code）；`intel_fetch_run`（id、source_id、started_at、finished_at、status ∈ ok_items/ok_empty/not_modified/failed、items_seen、items_new、items_revised、error_code、http_status）。
- `022-intel-item.ts`：`intel_item`（id、source_id、canonical_url、title、published_at、first_seen_at、last_seen_at、current_version_id，UNIQUE(source_id, canonical_url)）；`intel_item_version`（id、item_id、content_hash、fetched_at、extractor_version、completeness_status、access_policy、redistribution_policy，UNIQUE(item_id, content_hash)）；`intel_item_block`（version_id、block_key、block_order、block_type、text、metadata，UNIQUE(version_id, block_order)）。
- `paid_receipt` 不在第一切片，在 R2-3 切片（仍属 R2）追加迁移。

### 2.1 旧版本正文的可读保留（许可范围内）
- 每个版本保存**可读内容**而不只是哈希：按来源的 `access_policy` / `redistribution_policy`（沿用 article 现有 policy）决定保存什么——允许保存全文的，存全部结构化正文块；只允许摘要的，存标题、摘要和元数据块；不允许保存的（persistence disallowed），只存标题、链接、时间和哈希，并在版本上标明 `completeness_status = metadata_only`。
- 新版本**不覆盖、不删除**旧版本的块；`current_version_id` 只是指针。
- 读取接口：按 item 列出全部版本（时间倒序），按版本 id 读取其块；GET 不触发抓取。

旧版本读取测试：
1. 正文修订后，旧版本的块仍能按版本 id 原样读出（逐块文本相同）。
2. 版本列表包含新旧两版，`current_version_id` 指向新版。
3. 摘要级来源只保存摘要块，读取旧版本得到摘要而不是全文；`metadata_only` 来源读旧版本只有元数据，不报错。
4. 源失败或变空后，旧版本仍可读。
5. 重复抓取相同内容不产生新版本，旧版本数量不变。

**新增或修改的文件（计划）**
- `server/intel/sources/catalog-loader.ts`（目录 → `intel_source`，白名单校验）
- `server/intel/sources/fixture-adapter.ts`（只读 `server/intel/__fixtures__/`，零网络）
- `server/providers/feed.ts`（补 Atom/RDF；唯一解析器）
- `server/intel/collect.ts`（去重、版本、退避计算、写运行记录）
- `server/database/intel.ts`（仓储）
- `server/runtime/intel-collect-job.ts` + 在 `registry.ts` 注册，**默认 enabled=false**
- `server/database/migrations/021-*.ts`、`022-*.ts`、`index.ts` 登记
- 测试：`server/intel/__tests__/collect.fixture.test.ts`

**测试清单**
1. 幂等：同一夹具跑两次，`intel_item` 不增加，第二次 `items_new=0`。
2. 失败与空的区分：解析错误/HTTP 失败 → `failed`；合法但零条目 → `ok_empty`，不累加失败次数。
3. 旧数据保留：源失败或变空时，已有 `intel_item` 不删除、不清空。
4. 内容修订：同 URL 正文变化 → 新增一个版本，旧版本可读内容保留（测试见 §2.1）；相同哈希不新增。
5. 退避：连续失败 n 次 → `next_sync_at` 按上限内的指数增长；一次成功后清零。
6. 重启重入保护：并发两次触发同一 job → 第二次 `skipped/job_running`（复用 BackgroundRuntime 的 inFlight）；模拟进程中断留下的 `running` 运行记录在重启时标为 `failed`（`interrupted`），不会重复写入。
7. GET 路径不触发 provider（ADR-007）。

**不做**：R3 政策抽取、事件合并、任何 LLM 调用、任何真实网络请求。

## 3. R2 验收 → 切片映射
| 验收 | 切片 |
|---|---|
| R2-1 解析单测（RSS/Atom/RDF、web_list 日期写法、json_list、编码、URL 规范化、修订、白名单） | S1 夹具闭环覆盖 RSS、修订、白名单、URL 规范化；S2 补 Atom/RDF、web_list、json_list；编码见 §4 |
| R2-2 SSRF / 跳转 / 按信源 CA | S3：Feed 接入 article-fetch-security + 按信源 CA 扩展（离线夹具测试，属已批准计划） |
| R2-3 回执幂等、零预算零调用、发出后超时、重启幂等 | R2-3 切片：离线代码和测试（属已批准计划）；真实付费调用/凭据另需授权 |
| R2-4 实际环境重新核查目录（P1 ≥80% OK） | 单列，**未安排** |
| R2-5 离线夹具回放（P1 100% 标题/链接/时间） | S2：录制 P1 夹具后离线跑 |
| R2-6 无重复机制 | 每个切片审查时逐项确认：一个调度器、一个预算表、一个 RSS 解析器 |
| R2-7 人工录入 | S4：纯手动表单（R3 前不接模型） |
| R2-8 受控真实 24h | 单列，需用户单独确认 |
| R2-X 无头浏览器评估 | 只做统计评估，不实现 |

## 4. 单列项与授权口径
1. **SSRF / 跳转 / 按信源 CA**：复用 `article-fetch-security.ts` 的逐跳检查、私网拒绝、固定已验证地址、字节/跳转上限、HTTPS 降级拒绝；缺口只是 Feed 统一接入和按信源 CA 扩展（CA 只对配置它的信源生效，测试证明其他信源不受影响）。离线夹具测试属已批准计划，无需另行许可。
2. **R2-3 付费幂等、零预算零调用**：`paid_receipt` + `BEGIN IMMEDIATE`；发出后超时 → 重启后不重复付费；预算 0 或未配置 → 调用次数为 0。离线代码和测试属已批准计划；**真实付费调用和凭据另需授权**。
3. **P1 信源实际核验**（R2-4）：**未安排**。
4. **编码兼容**：GBK、TIS-620、windows-1258；现有 `response.text()` 按 UTF-8 解码，需要按 header / meta / XML 声明探测后解码；夹具保存原始字节。离线夹具测试无需另行许可。
5. **真实 24 小时运行**（R2-8）：需用户单独确认，结果写 `docs/live-verification.md`。

## 5. main / PR7 依赖与交接建议（待 dots 确认）
事实：`origin/main` = `b9281749c81aa1f8bca6473a029b04876afe8d64`（Merge PR #6）；`merge-base(origin/main, HEAD)` = origin/main；HEAD 领先 81、落后 0，是 main 的线性后代。PR7 未合并。

计划 §6 要求“每个阶段从 `main` 另开分支和 PR，以 merge commit 方式合并”。如果现在直接从 main 开 R2 分支，会缺少 R1/R1.5 已验收的功能和迁移 015–020，R2 的 021 迁移也会对不上。

**dots 决定（ts 1791791688.152539）**：采用方案 B，作为“不合并条件下的阶段衔接例外”记录——本轮修复审查通过后，允许从**已审查的 PR7 head** 建立临时 R2 堆叠分支，PR 的 base 先设为 R1.5 分支。合并仍未获用户授权，不执行方案 A，不强推。**本轮没有创建 R2 分支，也没有写产品代码。**

通过后的首切片范围：单一 Runtime、离线 fetcher、幂等/可读版本/运行结果/退避/重启，默认关闭，零外网、零 LLM。
