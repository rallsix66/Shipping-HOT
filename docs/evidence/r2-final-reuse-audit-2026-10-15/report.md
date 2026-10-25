# R2-6 最终复用审计 — 2026-10-15

> 交付更新（2026-10-21）：已普通推送到 `codex/shipping-hot-r2`。Maersk/商务部/日期切片 `3f8971e3`，门禁 `1b68adcd`。观察工具 + BMKG(ID-W02) 切片 `c9af8c55`，门禁 `5e665216`，包含 LOGONSERVER 仅 win32 隔离前认可。worker 启动竞态 `160c67a9`，门禁 `00e97518`。以上均经 dots 限定复审通过。下文“未提交/uncommitted/待父审”是当时的口径。正预算实网观察、24h、R3 仍未运行、未授权；S7、R2 均未通过。

> 2026-10-19 parent-review clarification: R2-6 received limited PASS at `aea56e72ec11fa76986deccc5c3a9797584ab157` for reuse/dedupe architecture (product `954c831f27eff4fd4382a0ea68be3894de053759`). This is not full implementation of every row in the 52-row map and not overall R2 PASS. Older "pending" review/cursor language below describes the historical cutoff and is superseded; a cursor/validator decision is not a new R2-6 gate. The launcher and Windows environment repair have since received limited offline parent acceptance (uncommitted). Current work is the [2026-10-20 offline R2 closeout](../r2-closeout-offline-2026-10-20/report.md); live collection and R2-8 remain NOT_RUN.

执行起点`0321584ffbbb2f99c1f8ecd64c680b78d0affcc6`，唯一当前产品代码`954c831f27eff4fd4382a0ea68be3894de053759`。**本轮仅文档静态审计，产品门禁NOT_RUN，既有1338/3与九命令门禁仅引用历史证据，没有重跑。** 材料读取已获主会话限定审查通过、无新增P2：[认可范围](material-read-acceptance.json)。它只读已存intel精确版本，当前无业务消费者；Feed正文桥接/R3输入未实施；source为当前来源配置，不是完整历史配置快照。至此不为未来R3继续加接口。

## 统一结论

本地R2-6静态审计结果 **PASS**（建议主审确认；正式独立验收pending），限定为没有第二套任务调度、预算表或通用RSS解析器。**R2整体仍BLOCKED**：R2-4只有25/39（64.10%，至少32，差7），R2-5只有24/34（70.59%，尚余10），历史数值有限诊断3/5单列；GUI/手工交互未验、真实24h未跑。该局部建议不把§5.3全表、所有Provider、所有XML处理或后续R3–R5写成已实现，也不新增/收窄原验收标准。原条款复核和剩余动作见[验收与决定](acceptance-and-next-actions.md)，24h只读提案见[两源最小试跑](pilot-24h-proposal.md)。

## §5.3逐项映射

固定上游`44578fa11da55f2e863900752653e0c221f6cf70`从已有本地clone读取，无新软件/业务上游请求。下表由[机器矩阵](reuse-matrix.json)生成；每个已实现目标均附当前文件hash，实际测试文件与历史干净SHA门禁相连。未来项不借用无关测试作通过；上游路径未解析到固定文件时如实记录，不猜路径。分类“原工程等价”仅指实际复用职责，不宣称整份上游语义完全相同。

| 分组/项 | 上游 | 实际分类 | 当前代码/阶段 | 实际范围与限制 |
| --- | --- | --- | --- | --- |
| A-01 | `BE/lib/url.ts` | 原工程等价 | `server/providers/feed.ts`、`server/services/source-policy.ts` | 复用canonicalizeFeedUrl/域名许可与原实体身份；未整体复制上游URL工具，不引入跨源全局identity。 |
| A-02 | `BE/lib/text.ts` | 原工程等价 | `server/providers/feed.ts`、`shared/article.ts` | 既有stripMarkup/归一化/截断及block文本合同，非上游所有文本工具逐函数等价。 |
| A-03 | `BE/lib/ids.ts` | 原工程等价 | `server/database/intel.ts`、`server/services/article-content-hash.ts`、`server/intel/llm/receipts.ts` | node:crypto UUID/hash和实体独立hash；receipts stableJson注明上游来源。没有复制整份ids库或改旧identity。 |
| A-04 | `BE/lib/http-fetch.ts` | 原工程等价 | `server/services/article-fetch-security.ts`、`server/services/response-decoding.ts` | 既有Node http/https安全传输、固定DNS地址、重定向/大小/超时/分源CA；不是字面guardedFetch或全项目所有Provider只用此函数的宣称。 |
| A-05 | `BE/content/sanitize.ts` | 原工程等价 | `server/providers/article-extractor.ts`、`server/intel/content-license.ts`、`src/components/shipping/pages.tsx` | 当前持久化/显示结构化纯文本blocks，沿用移除非正文和安全链接；未复制上游白名单HTML/图片签名/Markdown导出合同，不称完整sanitize.ts已移植。 |
| A-06 | `BE/sources/types.ts` | 原工程等价 | `server/intel/sources.ts`、`server/database/intel.ts` | 现有IntelSourceSeed/Record/Entry类型边界；没有第二套Vendor Domain类型。 |
| A-07 | `BE/sources/config-keys.ts` | 直接适配 | `server/intel/sources/config-keys.ts` | MIT改编头；只实现获批HTML/JSON配置子集，未知/未支持键拒绝，删X/MP/Jina等。 |
| A-08 | `BE/sources/rss.ts` | 原工程等价 | `server/providers/feed.ts`、`server/intel/collect.ts` | 唯一通用RSS/Atom/RDF parseFeedEntries；collector复用，未创建intel/sources/rss.ts。上游RSS条件请求验证器未移植，见差异。 |
| A-09 | `BE/sources/web-list.ts` | 直接适配 | `server/intel/sources/web-list.ts` | MIT改编fromHtml selector/seen/allowed流；日期显式/unknown，限制500节点，冲突fail-closed；无Jina/MiMo/Markdown/分页/详情。 |
| A-10 | `BE/sources/json-list.ts` | 直接适配 | `server/intel/sources/json-list.ts` | MIT改编路径/模板/条目映射；显式惰性application/json，不执行脚本；至多4组/500记录；无凭据/隐含API/分页。 |
| A-11 | `BE/providers/llm.ts` | 阶段未实施 | R3 | 通用chatJson、服务商/步骤绑定业务消费者未实施；既有DeepSeek翻译Provider不冒充R3通用模型层。 |
| A-12 | `BE/providers/receipts.ts` | 直接适配 | `server/intel/llm/receipts.ts`、`server/services/paid-budget.ts` | MIT原结构适配SQLite BEGIN IMMEDIATE、SecretStore和provider_usage；unknown不自动重发，actual/estimate分开；当前只有离线测试调用。 |
| A-13 | `BE/providers/embeddings.ts` | 阶段未实施 | R3/R4 | 百炼向量/向量持久与模型绑定未实施；未用占位函数冒充。 |
| A-14 | `BE/editorial/prompts.ts` | 阶段未实施 | R3 | 提示词加载和版本hash未实施。 |
| A-15 | `BE/events/merge.ts` | 阶段未实施 | R4 | 风险情报事件合并helper未实施；旧Event列表不等于R4合并。 |
| A-16 | `BE/events/relate.ts` | 阶段未实施 | R4 | 情报关联判断未实施。 |
| B-01 | `BE/content/materials.ts` | 原工程等价 | `server/database/intel.ts`、`server/database/article.ts`、`server/intel/manual.ts`、`server/intel/material-read.ts` | 既有身份/不可变版本/去重/A→B→A/审计优先；补内部精确版本只读接口已获限定认可。无业务消费者；Feed桥接/R3输入未实现；source是当前配置而非完整历史配置快照。 |
| B-02 | `BE/content/extract.ts` | 直接适配 | `server/providers/article-extractor.ts` | MIT Readability流程并入唯一extractor；显式容器优先，缺失失败；保留blocks/许可/版本，200字符通用确认；不含Jina/X/第二抓取器。 |
| B-03 | `BE/sources/collect.ts` | 参考 | `server/intel/collect.ts`、`server/intel/adaptive.ts`、`server/runtime/intel-collect-job.ts` | collector沿现有Repository/安全fetch组织；adaptIntervals公式局部直接改编有MIT头。过滤/上限/去重/水位/退避与7天自适应已有；上游完整cursor/RSS validator、noise/backfill配置未全移植，不能概称整份collect已复制。 |
| B-04 | `BE/editorial/models.ts` | 阶段未实施 | R3 | llm_step_binding业务读取未实施。 |
| B-05 | `BE/editorial/analyze.ts` | 阶段未实施 | R3 | pipeline/预筛/抽取/严重度消费者未实施；材料读接口未接分析。 |
| B-06 | `BE/events/group.ts` | 阶段未实施 | R4 | 精确键召回/向量/批量判断/second opinion/人工优先分组未实施。 |
| B-07 | `BE/events/digest.ts` | 阶段未实施 | R4 | 情报事件防抖重算/影响卡片未实施。 |
| B-08 | `BE/reports/compose.ts` | 阶段未实施 | R5 | 国家日报/持续事件编排未实施；demo国家卡片不作替代。 |
| B-09 | `scripts/eval-selection.ts` | 阶段未实施 | R3 | 未建立intel-eval/标注评测消费者；不为文件名建空脚本。 |
| C-01 | `IND/prompts/safety.md` | 阶段未实施 | R3–R5 | 计划直接复用的通用提示词，当前风险intel提示词层未实施。 |
| C-02 | `IND/prompts/rules-anti-hallucination.md` | 阶段未实施 | R3–R5 | 计划直接复用的通用提示词，当前风险intel提示词层未实施。 |
| C-03 | `IND/prompts/rules-self-contained-title.md` | 阶段未实施 | R3–R5 | 计划直接复用的通用提示词，当前风险intel提示词层未实施。 |
| C-04 | `IND/prompts/rules-answer-first-summary.md` | 阶段未实施 | R3–R5 | 计划直接复用的通用提示词，当前风险intel提示词层未实施。 |
| C-05 | `IND/prompts/group-method.md` | 阶段未实施 | R4/R5 | 计划保留骨架替换航运例子；当前未实施。 |
| C-06 | `IND/prompts/group-batch.md` | 阶段未实施 | R4/R5 | 计划保留骨架替换航运例子；当前未实施。 |
| C-07 | `IND/prompts/group-pair.md` | 阶段未实施 | R4/R5 | 计划保留骨架替换航运例子；当前未实施。 |
| C-08 | `IND/prompts/group-definitions.md` | 阶段未实施 | R4/R5 | 计划保留骨架替换航运例子；当前未实施。 |
| C-09 | `IND/prompts/story-digest.md` | 阶段未实施 | R4/R5 | 计划保留骨架替换航运例子；当前未实施。 |
| C-10 | `IND/prompts/report-daily-lead.md` | 阶段未实施 | R4/R5 | 计划保留骨架替换航运例子；当前未实施。 |
| C-11 | `IND/prompts/prefilter.md` | 阶段未实施 | R3 | 计划按§4.1/4.2适配，当前未实施。 |
| C-12 | `IND/prompts/selection-score.md` | 阶段未实施 | R3 | 计划按§4.1/4.2适配，当前未实施。 |
| C-13 | `IND/prompts/structure.md` | 阶段未实施 | R3 | 计划按§4.1/4.2适配，当前未实施。 |
| C-14 | `IND/prompts/rules-domain.md` | 阶段未实施 | R3–R5 | 行业配置/规则/金标格式未作为R3数据与消费者实施。 |
| C-15 | `IND/taxonomy.ts` | 阶段未实施 | R3–R5 | 行业配置/规则/金标格式未作为R3数据与消费者实施。 |
| C-16 | `IND/selection.ts` | 阶段未实施 | R3–R5 | 行业配置/规则/金标格式未作为R3数据与消费者实施。 |
| C-17 | `IND/site.ts` | 阶段未实施 | R3–R5 | 行业配置/规则/金标格式未作为R3数据与消费者实施。 |
| C-18 | `IND/gold.example.jsonl` | 阶段未实施 | R3–R5 | 行业配置/规则/金标格式未作为R3数据与消费者实施。 |
| D-01 | `BE/jobs/* + apps/worker/src/schedules.ts` | 原工程等价 | `server/runtime/background-runtime.ts`、`server/runtime/bootstrap.ts`、`server/runtime/registry.ts`、`server/runtime/intel-ownership.ts` | 已有单Runtime，job/executor/DB唯一运行和文件lease；错过周期/退避等复用当前Runtime，不引入pg-boss/第二task表。R4合并串行任务尚未实施。 |
| D-02 | `BE/admin/sources.ts + apps/web` | 阶段未实施 | `server/intel/manual-checklist.ts`、`server/utils/intel-read.ts` | 仅已有只读/手工子集；试抓预览、乐观锁、完整配置管理未移植，未来需单独范围，不称整个上游后台已替换。 |
| D-03 | `BE/events/hot.ts` | 阶段未实施 | R4 | 计划只参考独立来源去重概念；风险聚合/排序未实施，旧HOT和demo不充当R4。 |
| E-01 | `BE/sources/x.ts` | 阶段未实施（明确不复用） | 明确排除 | 原计划明确不复用，不是待补的R2任务；不使用AIHOT名称/logo。 |
| E-02 | `BE/sources/mp.ts` | 阶段未实施（明确不复用） | 明确排除 | 原计划明确不复用，不是待补的R2任务；不使用AIHOT名称/logo。 |
| E-03 | `BE/providers/jina.ts` | 阶段未实施（明确不复用） | 明确排除 | 原计划明确不复用，不是待补的R2任务；不使用AIHOT名称/logo。 |
| E-04 | `BE/providers/socialdata.ts` | 阶段未实施（明确不复用） | 明确排除 | 原计划明确不复用，不是待补的R2任务；不使用AIHOT名称/logo。 |
| E-05 | `apps/web` | 阶段未实施（明确不复用） | 明确排除 | 原计划明确不复用，不是待补的R2任务；不使用AIHOT名称/logo。 |
| E-06 | `AI行业模型排行/Codex监控专用模块` | 阶段未实施（明确不复用） | 明确排除 | 原计划明确不复用，不是待补的R2任务；不使用AIHOT名称/logo。 |

## 机制归属与不能混同的差异

- 通用RSS/Atom/RDF只有feed.ts的parseFeedEntries，intel复用；没有intel/sources/rss.ts。专用CAP/天气XML解析是不同Domain转换，旧Feed专用HTML列表和intel通用HTML mapper并存，不被本审计冒称为“全项目只有一个解析器”。Feed与intel存储身份不同，已存数据也不自动互通。
- 调度只有BackgroundRuntime，生产构造在bootstrap；intel-collect是其中一个job。executor/唯一在途run/文件ownership均为防重与生命周期，不是另一队列；receipt deadline的setTimeout是单次付费超时，不是信源调度器。lease只在stop/drain/end后释放，不按年龄/PID清理。
- paid-budget是共享月度决策，translation-settings及receipts复用；provider_usage为provider+capability月窗统计，paid_receipt/attempt是幂等和在途预留，不是第二预算表。当前无通用paidRequest业务消费者；通用模型绑定/全业务接入仍R3，旧固定DeepSeek翻译边界保留。估算闸门不承诺真实账单硬上限，actual与estimated分列。
- collector有host/path/结构/重复冲突过滤、RSS100/HTML和JSON500上限、lastOkAt等成功水位、失败不推进成功证据、15min→24h指数退避及已认可7天产出自适应。**未全移植**上游独立cursor对象、RSS ETag/Last-Modified条件GET/validator，以及noise/category/rewrite/initial-backfill配置全体；unsupported配置拒绝。现有水位/去重覆盖部分游标职责，不能据此声称与上游所有cursor/cache行为全等价。原§5.3“保留游标”的当前范围须由主审裁定：认可已批准单页快照合同的对应关系，或另行批准具体最小补充；本轮不自动豁免、不建新字段/迁移，也不复制整套collector。
- sanitize.ts的上游HTML白名单/媒体签名合同未整搬；现有产品按blocks纯文本/安全href显示，不持久化或渲染上游raw HTML。Readability在唯一extractor内，显式容器优先；只对允许正文的已有路径工作，不证明所有来源正文已进入intel。
- MIT与改编头保留，直接改编6个实际文件见[机械盘点](mechanical-audit.json)；web/JSON/receipts测试存在当地重表达及边界反例，Readability无专用上游测试可搬。不是声称完整上游测试集已全部移植。

## 本轮终点

来源配置、许可、计数、Runtime开关与任何产品代码均不改；业务DNS/GET、新真实记录、LLM/付费0。完整原件、失败、旧clone和隔离库保留。审计/状态正常推送PR8后，**停止新实现与新信源请求，等待主会话审查和用户下一阶段决定**。无24h启动、生产切换、merge/deploy。
