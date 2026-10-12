# R2 架构映射与交接计划（只读分析，2026-10-12）

依据：dots ts 1791790695.728109 / 1791790821.307749（2026-10-12 15:47 UTC+8）。**本文件只是文档，没有写任何 R2 产品代码**；没有发起付费调用、没有使用凭据、没有启动 24 小时真实运行、没有改生产开关、没有合并或改分支策略。

对照基线：分支 `codex/shipping-hot-r1-5`，HEAD `d45a7ab0ba42f87d26dfd6d686b0edf8e80a9f6e`；计划 `docs/plans/shipping-hot-risk-intelligence-2026-09-29.md`（§5.2/§5.3、R2 验收、§6/§7）；ADR-007、ADR-008。代码事实来自本次逐个阅读的文件，行号以该 HEAD 为准。

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
| 用量/预算 | `provider_usage`（001 + 011 `records_count`）、`recordProviderUsageInTransaction`；翻译预算门 `translation_budget_zero` / `translation_budget_exhausted`（`server/services/translation-settings.ts:122-123`） | R2 免费抓取只记 `provider_usage`（请求/失败/条数），**不建第二张预算表**；付费部分在 R3 用 `paid_receipt` + 现有预算门的同一判定函数 | 预算门目前绑定翻译设置，需要抽成通用 `assertBudget(scope)`（R3 前做，R2 不需要） |
| RSS/XML 解析 | `server/providers/feed.ts`：`fast-xml-parser` `parseFeedRss`、cheerio `parseFeedHtml`、`canonicalizeFeedUrl`、`dedupeFeedItems`、10s 超时 | **只能留一个 RSS 解析器**（R2-6）。建议：把 AIHOT `rss.ts` 的 RSS/Atom/RDF 能力合并进同一个解析模块，`feed.ts` 改为调用它；不并行存在两份 | 现有只覆盖 RSS 形态，Atom/RDF 需补；**需要 dots 决定**：以 feed.ts 为底扩展，还是以 AIHOT rss.ts 为底替换 feed.ts 的解析（§5.3 写的是复制） |
| 抓取 | `feed.ts` 里 `fetcher(url,{signal})` + `response.text()`；没有私网拦截、没有手工跳转检查、没有按信源 CA | 按 §5.3 引入单一 `server/intel/lib/http-fetch.ts`，现有 feed/article 抓取以后也走它 | SSRF、跳转、按信源 CA、字节上限、编码探测全部缺失（见 §4 单列） |
| 正文抽取 | `server/providers/article-extractor.ts`（cheerio，`ARTICLE_EXTRACTOR_VERSION = "article-extractor-v1"`，按来源 policy） | 按 §5.3-B 与 AIHOT `extract.ts` **合并**为一个抽取器（Readability 主流程，保留现有安全检查），不另建 | 依赖 `@mozilla/readability`、`linkedom` 尚未安装（本轮不装） |
| 正文版本 | migration 013：`feed_articles`、`article_versions(UNIQUE(feed_item_id, content_hash))`、`article_blocks` | intel 条目的正文版本**复用同一套表思路**：`intel_item` 记 `content_hash`，修订生成新版本、旧版本保留 | 013 以 `feed_item_id` 为键；intel 用独立键还是写入 feed_items 需定（建议 intel_item 自有版本表，结构照抄 013） |
| 信源目录 | `docs/intel-source-catalog.md`（ADR-008 唯一种子）；现有 `shippingFeedSources` 是代码内数组 | `intel_source` 由目录生成，`shippingFeedSources` 暂不迁移 | 目录→种子的加载器与白名单校验需新写 |
| 迁移编号 | 已有 001–020（015–020 已被 R1/R1.5 占用） | ADR-007 写“intel 迁移从 015+ 起、只增不改”；**实际下一号为 021** | 建议在 ADR-007 加注“实际从 021 起”（本轮未改 ADR，待 dots 确认） |

依赖现状（package.json）：已有 `fast-xml-parser ^5.4.1`、`cheerio ^1.2.0`、`better-sqlite3`；计划需要的 `zod`、`@mozilla/readability`、`linkedom`、`undici`、`p-limit` 是否全部引入待第一切片决定，**本轮未安装**。

## 2. 第一个切片：零网络、零 LLM 的存档夹具闭环
流程：目录（夹具子集）→ 受控适配器（只读本地存档文件，fetcher 注入）→ 去重 / 正文版本 → SQLite → 信源运行结果。

**新增迁移（只增）**
- `021-intel-source-and-runs.ts`：`intel_source`（id、catalog_id、kind、url、enabled、status、consecutive_failures、next_sync_at、last_ok_at、last_error_code）；`intel_fetch_run`（id、source_id、started_at、finished_at、status ∈ ok_items/ok_empty/not_modified/failed、items_seen、items_new、items_revised、error_code、http_status）。
- `022-intel-item.ts`：`intel_item`（id、source_id、canonical_url、title、published_at、first_seen_at、last_seen_at、current_version_id，UNIQUE(source_id, canonical_url)）；`intel_item_version`（id、item_id、content_hash、fetched_at、extractor_version，UNIQUE(item_id, content_hash)）。
- `paid_receipt` **不在第一切片**（R3 / 付费前再加）。

**新增或修改的文件（计划）**
- `server/intel/sources/catalog-loader.ts`（目录 → `intel_source`，白名单校验）
- `server/intel/sources/fixture-adapter.ts`（只读 `server/intel/__fixtures__/`，零网络）
- `server/intel/sources/rss.ts` 或与 `server/providers/feed.ts` 合并后的单一解析模块（见 §1 待决）
- `server/intel/collect.ts`（去重、版本、退避计算、写运行记录）
- `server/database/intel.ts`（仓储）
- `server/runtime/intel-collect-job.ts` + 在 `registry.ts` 注册，**默认 enabled=false**
- `server/database/migrations/021-*.ts`、`022-*.ts`、`index.ts` 登记
- 测试：`server/intel/__tests__/collect.fixture.test.ts`

**测试清单**
1. 幂等：同一夹具跑两次，`intel_item` 不增加，第二次 `items_new=0`。
2. 失败与空的区分：解析错误/HTTP 失败 → `failed`；合法但零条目 → `ok_empty`，不累加失败次数。
3. 旧数据保留：源失败或变空时，已有 `intel_item` 不删除、不清空。
4. 内容修订：同 URL 正文变化 → 新增一个版本，旧版本保留；相同哈希不新增。
5. 退避：连续失败 n 次 → `next_sync_at` 按上限内的指数增长；一次成功后清零。
6. 重启重入保护：并发两次触发同一 job → 第二次 `skipped/job_running`（复用 BackgroundRuntime 的 inFlight）；模拟进程中断留下的 `running` 运行记录在重启时标为 `failed`（`interrupted`），不会重复写入。
7. GET 路径不触发 provider（ADR-007）。

**不做**：R3 政策抽取、事件合并、任何 LLM 调用、任何真实网络请求。

## 3. R2 验收 → 切片映射
| 验收 | 切片 |
|---|---|
| R2-1 解析单测（RSS/Atom/RDF、web_list 日期写法、json_list、编码、URL 规范化、修订、白名单） | S1 夹具闭环覆盖 RSS、修订、白名单、URL 规范化；S2 补 Atom/RDF、web_list、json_list；编码见 §4 |
| R2-2 SSRF / 跳转 / 按信源 CA | S3 http-fetch（单列，见 §4） |
| R2-3 回执幂等、零预算零调用 | 付费切片（单列，见 §4，未授权） |
| R2-4 实际环境重新核查目录（P1 ≥80% OK） | 单列，需真实网络，未授权 |
| R2-5 离线夹具回放（P1 100% 标题/链接/时间） | S2：录制 P1 夹具后离线跑 |
| R2-6 无重复机制 | 每个切片审查时逐项确认：一个调度器、一个预算表、一个 RSS 解析器 |
| R2-7 人工录入 | S4：纯手动表单（R3 前不接模型） |
| R2-8 受控真实 24h | 单列，需用户授权 |
| R2-X 无头浏览器评估 | 只做统计评估，不实现 |

## 4. 单列的风险项（本轮均未开始）
1. **SSRF / 跳转 / 按信源 CA**：解析后的 IP 检查私网、回环、链路本地、IPv6 ULA；`redirect: "manual"` 逐跳重新检查；CA 只对配置了它的信源生效（测试证明其他信源不受影响）。需要 `undici` 的 dispatcher。
2. **付费幂等、零预算零调用**：`paid_receipt` + `BEGIN IMMEDIATE`；请求已发出后超时 → 重启后不重复付费；预算 0 或未配置 → 调用次数为 0。**付费调用和凭据未授权。**
3. **P1 信源实际核验**（R2-4）：需要真实网络，结果写回目录。未授权、未开始。
4. **编码兼容**：GBK、TIS-620、windows-1258；现有 `response.text()` 按 UTF-8 解码，需要按 header / meta / XML 声明探测后用 `TextDecoder` 或 iconv 解码；夹具必须保存原始字节。
5. **真实 24 小时运行**（R2-8）：需要用户授权，结果写 `docs/live-verification.md`。未授权、未开始。

## 5. main / PR7 依赖与交接建议（待 dots 确认）
事实：`origin/main` = `b9281749c81aa1f8bca6473a029b04876afe8d64`（Merge PR #6）；`merge-base(origin/main, HEAD)` = origin/main；HEAD 领先 81、落后 0，是 main 的线性后代。PR7 未合并。

计划 §6 要求“每个阶段从 `main` 另开分支和 PR，以 merge commit 方式合并”。如果现在直接从 main 开 R2 分支，会缺少 R1/R1.5 已验收的功能和迁移 015–020，R2 的 021 迁移也会对不上。

建议（不丢已验收功能，供 dots 确认；**本轮不合并、不 force-push、不改分支策略**）：
- **方案 A（推荐，符合 §6）**：用户批准后 PR7 以 merge commit 合入 main（线性后代，无冲突），R2 再从新的 main 开分支 `codex/shipping-hot-r2`。
- **方案 B（PR7 暂不能合时）**：R2 分支从 PR7 的 HEAD 开，PR 的 base 先指向 PR7 分支；PR7 合入后把 base 改回 main（不需要改写历史）。缺点是偏离 §6，需要 dots 明确同意。
