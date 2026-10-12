# R2 首切片：离线采集闭环（2026-10-12）

依据：dots ts 1791792371.640129（2026-10-12 16:06 UTC+8）批准。分支 `codex/shipping-hot-r2`，从 `2939762da884aa9ae04f16e8d8bcccdeb5f148e5` 创建，草稿 PR 的 base 是 `codex/shipping-hot-r1-5`（临时堆叠开发例外；PR7 未合并，不强推，以后改 base 另行安排）。映射文档见 `r2-architecture-mapping-2026-10-12.md`。
> 映射文档里“HEAD 领先 main 81、落后 0”是 2026-10-12 15:47 时 `d45a7ab` 的**旧快照**，不代表新分支的实时状态。

## 1. 范围
只做这一条闭环：目录种子 → 注入的离线 fetcher → 现有安全抓取 → feed.ts 统一解析 → 去重 / 许可范围内的正文版本 → SQLite → 每源运行结果与健康状态。
**没有做**：R3 抽取、自动政策入库、事件合并、任何 LLM、任何真实网络、任何凭据、付费调用、GET 接口、registry 接线、生产开关。

## 2. 复用与归属
| 能力 | 归属（唯一实现） | 本切片的改动 |
|---|---|---|
| 调度 | `server/runtime/background-runtime.ts` | 无改动。新 job `intel-collect` 是普通 `RuntimeJob`，**默认 enabled=false**，没有加进 `registry.ts` |
| 安全抓取 | `server/services/article-fetch-security.ts` `secureFetchArticle` | 无改动。逐跳协议/主机/DNS、私网拒绝、固定已验证地址、字节/跳转上限、HTTPS 降级拒绝全部保留；离线 fetcher 通过它已有的 `lookup`/`transport` 注入点接入 |
| RSS / Atom / RDF 解析 | `server/providers/feed.ts` | 抽出 `readFeedDocument`，`parseFeedRss`（现有 Feed）和新 `parseFeedEntries`（intel）共用；补齐对照 AIHOT@44578fa `rss.ts` 发现的实际缺口：RDF 根、Atom 多 link 取 `rel=alternate`、`dc:date`、`content:encoded`。**没有复制 rss.ts** |
| 运行记录 | job 级：`sync_runs` / `provider_runtime`（现有）；源级：`intel_fetch_run`（021） | |
| 用量 / 预算 | `provider_usage` 由 BackgroundRuntime 的通用 job 计数记录；没有新预算表 | 首切片没有付费调用。**`paid_receipt`、零预算零调用、发出后超时、重启幂等仍在 R2-3 验收内**，后续切片做 |
| 正文版本 | `intel_item_version` + `intel_item_block`（022，结构照 013） | |

RSS/Atom/RDF 测试表（`server/providers/feed-formats.test.ts`）：
| 格式 | 根节点 | 链接 | 时间 | 正文 |
|---|---|---|---|---|
| RSS 2.0 | `rss/channel/item` | `link` / `guid` | `pubDate` | `content:encoded` → `description` |
| Atom | `feed/entry` | `link[rel=alternate]`（或第一个） | `published` / `updated` | `content` → `summary` |
| RDF (RSS 1.0) | `rdf:RDF/item`（与 channel 同级） | `link` | `dc:date` | `content:encoded` → `description` |

## 3. 迁移
- `021-intel-source-runs`：`intel_source`（含 status never_run/ok/ok_empty/failing、consecutive_failures、next_sync_at）；`intel_fetch_run`（running/ok_items/ok_empty/failed），**部分唯一索引保证同一信源最多一个 running**。
- `022-intel-items`：`intel_item`（UNIQUE(source_id, canonical_url)）、`intel_item_version`（UNIQUE(item_id, content_hash)，`content_scope` = full_text / excerpt / metadata_only）、`intel_item_block`。
- 只增不改；015–020 属于 R1.5。现有 4 个测试文件里写死的 `schemaVersion toBe(20)` 改为 22（只改期望值）。

## 4. 许可范围
由信源的 `persistence` 决定保存什么，每个版本都存可读块，不只存哈希：
- `full` → `full_text`：标题块 + 全文段落块（每块 ≤ 2000 字）。TH-W01 TMD CAP（feed 自声明 public domain）。
- `excerpt_only` → `excerpt`：标题块 + ≤ 280 字摘录块。ID-W01 BMKG（目录注明需署名并限流，许可未审前只留摘录）。
- `disallowed` → `metadata_only`：只有标题块；链接、时间在 item 上。
内容哈希按原文（标题 + 正文）计算，三种范围都能识别修订。

## 5. 夹具
真实存档，来自已批准目录信源，零网络读取：`server/providers/__fixtures__/tmd-cap-2026-10-10/index.xml`（TH-W01）、`server/providers/__fixtures__/bmkg-cap-2026-10-10/index.xml`（ID-W01）。Atom/RDF 格式测试用最小合成样本（仅解析单测）。测试同时校验每个种子的目录 ID 和 URL 与 `docs/intel-source-catalog.md` 一致（ADR-008）。

## 6. 测试（`server/intel/collect.test.ts`）
1. 迁移 021/022：隔离内存库到 v22，重复初始化幂等。
2. 重复获取：第二次 itemsNew=0、itemsRevised=0，item/version/block 行数不变。
3. 正文修订：只有被改的那条生成新版本；旧版本块逐块原样可读；版本列表新→旧。
4. 全文 / 摘录 / 仅元数据三种范围的块类型与长度。
5. 成功空结果（ok_empty，失败计数 0）≠ 失败（HTTP 500 → failing，计数 1）；非 XML → parse_failed。
6. 失败保留旧数据：超时后 item 与旧版本块不变，信源状态 failing、last_error_code 可见、last_ok_at 保留。
7. 指数退避：15 / 30 / 60 分钟，封顶 24 小时；成功后清零并回到正常间隔。
8. 安全防护保留：私网地址 → blocked_address 且未调用 transport；非白名单主机 → host_not_allowed 且未做 DNS；HTTPS→HTTP 跳转 → https_downgrade。
9. 默认关闭、没有离线 fetcher 时不做任何事（零网络）。
10. 重启：旧进程留下的 running 记录在新 job 首次运行时被关为 failed/interrupted；同一信源已有 running 时第二次采集 skipped，不发请求。
11. 经 BackgroundRuntime 运行：同一 job 并发第二次 → `job_running`，只发一次请求。
12. 种子与目录一致。

## 7. 未覆盖（明确留给后续切片 / 另行授权）
- R2-3：`paid_receipt` + `BEGIN IMMEDIATE`、零预算零调用、发出后超时、重启不重复付费（离线代码与测试属已批准计划，下一切片）；真实付费与凭据另授权。
- R2-2 余项：Feed 现有同步任务接入 article-fetch-security（本切片只有 intel 走它）；按信源 CA 扩展。
- R2-1 余项：web_list、json_list、佛历与 `dd/mm/yyyy` 日期；GBK / TIS-620 / windows-1258 编码（`defaultTransport` 目前按 UTF-8 解码）；304 / ETag 条件请求。
- R2-4 P1 目录实网核验：未安排。R2-5 P1 全量夹具回放：只有 2 个源。R2-7 人工录入：未做。R2-8 24 小时实网：需用户单独确认。
- job 未接入 `registry.ts`，没有真实 fetcher，没有 GET 接口。
- 其他未关闭事项照旧：历史回放 Nalgae 1/10 为未完成验证（用户延后，不阻塞 R2，不再补样）；PAGASA 正样本；E-R04/E-R06 促销窗口。

## 8. P2 返修（dots 2026-10-12 16:34，ts 1791793201.331149）

1. **A→B→A 回滚**：`writeEntry` 命中历史 hash 但非当前版本时，恢复 `current_version_id` 与当前元数据（title/published_at/last_seen_at），不复制正文（版本内容不可变），并在 `intel_item_current_change` 记录 `restored_version`；新版本记录 `new_version`。返回 outcome：created/unchanged/revised/restored。
2. **写入失败**：beginRun / 单条 writeEntry（`store_failed`）/ finalize（`finalize_failed`）异常均被捕获。存储仍可用：本 run 记为 failed、源进入退避、已提交条目保留（每条独立 BEGIN IMMEDIATE），其他源继续；连失败都记录不了：返回 `storage_unavailable`，job 返回 failed `intel_storage_unavailable`，不假装完成。
3. **第二个 job 实例**：迁移 023 新增 `intel_executor` 与 `intel_fetch_run.executor_id`。每次运行仅回收**已确认结束**的 executor 的 running run（`recoverRunsOfEndedExecutors`）；崩溃遗留只能通过显式独占启动步骤 `recoverIntelRunsAtExclusiveStartup` 回收。绝不按时长判死；活跃实例的 run 由唯一 running 索引阻挡。
4. 测试：`server/intel/collect.test.ts` 18 项（新增回滚、单条写失败+后续源继续+可重试、storage_unavailable、DB 级在途保护、双实例负向、重启遗留经独占启动回收、已结束 executor 回收）。schema 版本期望 22→23。
5. 仍未完成：registry 接线、GET 端点；job 默认关闭、零网络、零 LLM；paid_receipt 切片未开始。

## 9. 第二轮 P2 返修（dots 2026-10-12 16:44，ts 1791794650.429139）

1. **成功收尾原子化**：新增 `finishRunSuccess` / `finishRunFailure`，run 结果与来源状态在同一 BEGIN IMMEDIATE 事务内提交。来源成功状态写入一次性失败时整体回滚，run 仍为 running，随后在同一事务内收尾为 failed（`finalize_failed`）+ 退避；已提交条目保留。若失败状态也无法保存，返回 `storage_unavailable`，数据库中不留下"成功"。
2. **executor 生命周期护栏**：`end()` 在活动运行期间拒绝（`intel_executor_busy`），不写 ended_at；结束后 `run()` 返回 failed `intel_executor_ended`，不开 run。同一实例并发 run 返回 skipped `job_running`。显式独占启动恢复的调用前提保留，未引入通用进程锁框架。
3. 测试：collect.test.ts 22 项（新增：一次性来源成功写失败一致性、失败状态也无法保存时 storage_unavailable、暂停 fetch→尝试 end→第二实例触发、end 后再 run）。
4. 仍未完成：registry 接线、GET 端点；默认关闭、零网络、零 LLM；paid_receipt 暂缓。
