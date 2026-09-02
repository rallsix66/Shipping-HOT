# Shipping-HOT Translation T3 Architecture / Production Feed Integration Proposal

> status: draft
> proposal date: 2026-09-02
> base branch: codex/shipping-hot-v3-real-data
> base SHA: 8490868ea707db37a8799142dcea1edb03b0f1b4
> scope: architecture proposal only; no T3 implementation is authorized by this document

## 0. Review boundary

本文件是 Translation T3 的架构候选方案，不是实施批准。它只覆盖 Feed 自动中文化的生产设计，不改变当前 active plan pointer，不宣称 T3 已开始。

本轮明确不做：

- 不修改 server/*、shared/*、src/* 或 package.json
- 不创建或修改 migration
- 不新增 Secret、环境变量、Provider SDK 或 Provider
- 不执行 DeepSeek live call、Feed live sync、AIS/Voyage/Weather probe
- 不注册 translation-sync
- 不修改 Feed DTO、Feed UI、Event/HOT 或 Readiness implementation

当前结论先行：

1. Feed ingestion 与 Translation 必须是两个独立的 Background Runtime workstream。
2. 不引入 Redis、BullMQ、RabbitMQ、Kafka 或其他外部 queue；优先使用 SQLite 中的 translation_cache 作为 durable work state。
3. 现有 schema v11 足够支持 cache read、batch read 和基础状态展示，但不足以安全承载生产级逐条 retry、next retry、retryability 与 crash-safe pending lease。
4. 因此，完整 T3A 进入实施前需要单独批准一个最小 additive migration；本轮只列 proposal，不实施。
5. Feed API 保持 title / summary 的原文语义，新增 API/display-only 的 displayTitle、displaySummary 和翻译状态。原始事实不写回 Feed 业务表。
6. Feed GET 只读 SQLite；任何 cache hit、historical fallback 或原文 fallback 都是 provider-free。
7. DeepSeek live verification 必须先于 production translation enabled；engineering complete 与 verified_live 分开记录。

## 1. Current implementation audit

### 1.1 Translation boundary already present

当前 T1/T2 实际代码已经提供以下基础：

- server/services/translation-service.ts
  - Service 统一生成 translation-faithful-v1 的 SHA-256 sourceHash。
  - sourceHash 只包含 contractVersion、entityType、fieldName、规范化语言和 NFKC/CRLF 规范化后的 sourceText。
  - entityId、provider、model、时间和随机值不进入 hash。
  - feedTranslationSources() 只产生 Feed 的 title、summary 两个字段，并复用 isFeedItemTranslationEligible()。
  - provider-free read 选择当前 provider/model 的成功缓存，再选择同 hash/target 的 deterministic historical success；pending/failed 不作为译文。
  - execution path 只检查 current provider/model exact success，miss 才允许调用 Provider。
  - 原文、placeholder、显式保护词和 Provider wrapper 均在 Service 边界处理。
- server/database/translation.ts
  - translation_cache 是当前 Translation single source of truth。
  - exact lookup 和 historical lookup 均限定 status='succeeded'，并按确定性顺序取一行。
  - Repository 本身不调用 Provider。
  - 当前没有 feed batch lookup、candidate claim、retry metadata 或 lease API。
- server/providers/translation/deepseek-provider.ts
  - 只有 server-side DeepSeek adapter，fixed endpoint/model，20 秒 timeout，thinking.type=disabled、stream=false、无 tools。
  - usage contract 缺失/非法时 fail closed 为 provider_contract_changed。
  - 当前 live verification 仍为 pending。
- server/providers/translation/fake-provider.ts
  - 仅供测试使用。
  - 不得进入 Real Mode、Readiness 或 production Runtime registry。
- server/services/translation-settings.ts
  - settings 存在现有 settings.data JSON，默认 disabled、DeepSeek、deepseek-v4-flash、zh-CN、USD monthly budget 0。
  - 月度估算通过 RuntimeRepository.aggregateProviderUsage()，不受 detail list limit 影响。
  - status read 是 provider-free。
- server/services/translation-test-service.ts
  - 只允许 fixed harmless test input。
  - 会在 server-side SecretStore / settings / budget gate 后调用；不接受 arbitrary sourceText 或 prompt。

### 1.2 Feed ingestion and fact ownership

- server/runtime/feed-sync-job.ts 为每个 Feed source 创建独立 job。
- 当前顺序是：
  1. Feed Provider fetch；
  2. archive same-source items no longer retained；
  3. ShippingRepository.upsertFeedItem() 保存原始 FeedItem；
  4. 读取当前数据并刷新 Event。
- server/database/shipping.ts 的 feed_items.title / summary 是原始字段，data 也保存原始 normalized FeedItem。
- applyFeedFreshnessPolicy() 已把 unknown/invalid/future/expired Feed 分到 quarantine/history/current 生命周期；当前 Feed 查询还会检查 current_until。
- shared/shipping-engine.ts 从原始 FeedItem 生成 Event。
- shared/shipping-rules.ts 从原始 FeedItem 生成 HOT、做 freshness、severity、relevance 和 dedupe 相关判断。
- server/providers/feed.ts 在入库前以原文做分类、source-level parse 和 dedupe。
- Feed disappeared/expired 时已有 cache 不删除；未来 Translation Runtime 只扫描 current Feed，不处理 history-only backlog。

### 1.3 Current Runtime

server/runtime/background-runtime.ts 当前提供：

- RuntimeJob：id、providerId、capability、intervalMs、enabled、run；
- 每 job 一个 timer；
- 同一 job 的 inFlight 防重；
- provider_runtime 的 status、last success/failure、nextSyncAt、consecutiveFailures 持久化；
- sync_runs 的 job-level run history；
- provider_usage 的 provider/capability/hour 聚合。

server/runtime/registry.ts 当前注册 AIS、Voyage、Feed、Calendar、Port、Weather 和 Weather Alert jobs，没有 Translation job。server/runtime/bootstrap.ts 启动时以 persisted nextSyncAt 安排任务；没有 persisted row 时使用 interval 之后的首次调度，因此不会自动把全部历史 Feed 立即送入 Provider。

需要特别修复的 runtime accounting 边界：

- 当前 generic BackgroundRuntime.recordUsage() 默认把一次 job execution 当成一次 Provider request。
- Translation job 一次 run 可能处理多个 field，也可能全部为 cache miss / no call。
- 因此 T3A 必须增加“每个真实 Provider call 单独记录，且 job-level generic usage 不重复记录”的能力；否则 app cache hit 会错误增加 provider_usage.request_count。

### 1.4 Current API and UI consumers

当前：

- server/api/shipping/feed.get.ts 返回 { view: "current", feedItems }，当前是原始 FeedItem，代码路径不调用 Provider。
- server/api/shipping/index.get.ts 返回包含 feedItems、events、hot 的 legacy aggregate；getShippingSnapshot() 读取 SQLite 并重新计算 Event，但没有调用 Translation Provider。
- src/components/shipping/data.ts 的 useShipping() 消费 /shipping。
- src/components/shipping/pages.tsx 的 FeedPage 当前渲染 item.title / item.summary；首页、港口详情、船舶详情和航次详情也会读取 FeedItem title。
- Event 页面、HOT 卡片和首页 HOT 使用的是 Event/HotItem 的 title / summary，这些必须继续来自原始事实。

主要 consumer 分类：

| Consumer | 当前字段 | 性质 | T3 行为 |
| --- | --- | --- | --- |
| Feed Provider parse/classify/dedupe | FeedItem.title/summary | business/domain input | 永远使用原文 |
| Feed Repository persistence/history search | title/summary/data | fact persistence | 永远保存原文 |
| Event detection/evidence | FeedItem.title/summary | business fact | 不 join translation |
| HOT ranking/output | Event/Feed raw title/summary | business/read model | 不 join translation |
| GET /api/shipping/feed | FeedItem | API | 增加 display-only 字段，保留原字段语义 |
| GET /api/shipping | ShippingSnapshot | legacy aggregate API | 同样可在 API boundary 增加 display-only Feed view |
| FeedPage/home/detail Feed cards | title/summary | UI | T3C 使用 display 字段，原文 toggle |
| Event/HOT UI | Event/HotItem title/summary | UI of operational facts | 不显示 Feed translation DTO，不修改语义 |

## 2. T3 business scope

### 2.1 Production goal

唯一 production goal 是 Feed 自动中文化：

    eligible current FeedItem
        -> title / summary candidate
        -> bounded Translation Runtime
        -> DeepSeek
        -> translation_cache
        -> provider-free Feed API read
        -> Chinese-first Feed UI with original text available

只处理：

- current FeedItem；
- FeedItem title；
- FeedItem summary；
- fixed target language from Translation settings, initially zh-CN；
- current provider/model exact cache and same-hash historical fallback。

### 2.2 Explicit non-scope

本 T3 proposal 不包含：

- Calendar、Event、HOT、Voyage、Port、Weather、Vessel、AIS 翻译；
- 翻译 Event/HOT semantics、severity、ranking、dedupe、freshness、lineage、evidence；
- 覆盖 feed_items.title / summary 或新增 title_zh / summary_zh 业务列；
- DeepSeek 以外的 Provider、自动 Provider fallback、custom OpenAI-compatible；
- 浏览器直连 DeepSeek、arbitrary prompt、user-controlled system prompt、tool call、model reasoning；
- Redis、BullMQ、RabbitMQ、Kafka 或 external queue；
- 完整 Settings UI、Secret UI；
- public arbitrary translation/test endpoint；
- translation-cache garbage collection；
- immediate translate-all historical backlog；
- usage/cost 账单真相、官方余额、FX 转换；
- 将 Translation healthy/verified_live 纳入 REAL_OPERATIONAL hard readiness gate；
- DeepSeek live verification 本身；
- T3A/T3B/T3C/T3D 的实现。

## 3. Candidate generation decision

### 3.1 Option A: Feed write hook

Feed sync 在每次 upsertFeedItem() 后生成 candidate，或者创建 pending cache row。

优点：

- 新 Feed 到达后较快进入候选；
- 可避免一次全量扫描。

缺点：

- candidate enqueue 与 Feed ingestion 的写入时序、失败隔离更复杂；
- 若 enqueue 被 await，cache 写失败可能扩大 ingestion failure surface；
- 若 fire-and-forget，生命周期、重启和错误可见性不清楚；
- 每个 Feed source job 都要携带 Translation coupling；
- Feed update 与 Translation scan 并发时仍需要 sourceHash recheck。

### 3.2 Option B: Translation Runtime scan

Feed sync 只完成原始 Feed persistence；独立 translation-sync 周期扫描 current Feed，调用 canonical feedTranslationSources()，再按 exact cache/retry state 选择工作。

优点：

- Feed ingestion 完全不依赖 Translation；
- 可以自然发现已有 current Feed、重启后的 backlog 和未完成 state；
- candidate discovery 是可重复、可审计的 read operation；
- 不需要 external queue；
- provider/model 切换时可重新扫描并产生新版本；
- sourceHash 保证 Feed 更新不会复用旧内容译文。

缺点：

- 新 Feed 最长等待一个 scan interval；
- 每轮需要读取 current Feed 并做 cache lookup；
- 需要稳定的 batch scan 与 claim 设计。

### 3.3 Final selection

选择 Option B：Translation Runtime 周期扫描。Feed sync 成功提交原始 Feed 后，候选在下一次 scan 中可发现；不把任何 Translation work await 到 Feed Provider fetch/normalization/persistence transaction 中。

若未来需要更低延迟，可增加“Feed write 后只发内部 invalidation hint”，但 hint 不能成为 durable queue，也不能替代 periodic scan/restart recovery；这不属于第一版 T3。

## 4. Candidate scanner contract

### 4.1 Source of candidates

扫描器只读取：

    ShippingRepository.listFeedItems({ now, view: "current" })
        -> isFeedItemTranslationEligible(item, now)
        -> feedTranslationSources(item, targetLanguage, sourceLanguage, now)

必须复用现有 T1 contract，不复制第二套 eligibility rules。若实现前发现直接调用 helper 不能覆盖某种 malformed timestamp，先修复该 canonical helper 并补测试，不在 scanner 中重新实现日期规则。

### 4.2 Eligibility

每个 candidate 是：

    entityType = "feed_item"
    entityId   = FeedItem.id
    fieldName  = "title" | "summary"
    sourceHash = Service-generated hash
    target     = canonical target language
    provider   = configured DeepSeek
    model      = configured allowed model

必须排除：

- visibility 非 current；
- currentUntil 已过期；
- history-only 或 quarantine；
- effective/publication/expiry 不满足 canonical freshness policy；
- future 或 invalid date；
- 空白 title/summary；
- sourceStatus/stale 使 Feed 不再满足 translation eligibility；
- 当前 provider/model + exact sourceHash + targetLanguage 已有 succeeded cache；
- failed 且 retryable=false；
- failed 且 next_retry_at > now；
- pending 且 lease 尚未失效；
- provider/model/settings gate 不允许当前执行。

历史成功译文只用于展示 fallback，不会抑制 current provider/model 的 candidate。如果 provider/model 变化，旧成功保留，新的 exact row 仍可生成。

### 4.3 Source change and entity identity

Feed 同一 entityId 的 title/summary 改变后，规范化 sourceText 改变，sourceHash 改变，形成新的 translation_cache identity。旧 hash 的成功译文不能匹配新 hash；不会因为 entityId 相同而显示旧内容的译文。

Feed disappearance/expiry/history transition 后不再产生新 candidate；已有 cache 保留为历史，不在 T3 做 GC。

### 4.4 Ordering and bounded scan

第一版不设计复杂 priority score。排序固定为：

1. current 且通过 canonical eligibility；
2. Feed 已有的最新发布时间优先；发布时间未知的项目置后；
3. 稳定 tie-break 为 effectiveAt、fetchedAt、id；
4. 每个 item 先 title，再 summary。

第一版目标是 100 个 current FeedItem / 最多 200 个 fields。扫描可读取这一 bounded operational window；若实际数据超过窗口，必须使用稳定 cursor/分页保证下一轮继续，不得每轮只看前 N 条而永久饿死尾部。

## 5. Queue and durable work state

### 5.1 No external queue

不引入外部 queue。单 VPS、single process、SQLite 的第一版使用：

- translation_cache：每个 entity/field/sourceHash/target/provider/model 的 durable work/result row；
- status：pending/succeeded/failed；
- provider_runtime：DeepSeek translation job 的 job-level schedule/health；
- sync_runs：每轮 job execution audit；
- provider_usage：每次真实 DeepSeek request 的 hourly aggregate usage。

pending 可以作为 work state，但必须配合 durable lease；只有 status/pending + updated_at 而没有逐条 retry/lease metadata 时，不足以安全实现 T3A。

### 5.2 Cache key and claim

逻辑 key 保持 T1：

    entityType + entityId + fieldName + sourceHash
        + targetLanguage + provider + model

claim 必须在 SQLite transaction 中完成，并在调用 Provider 前重新检查：

- Feed item 仍是 current/eligible；
- sourceHash 仍相同；
- current provider/model exact success 仍不存在；
- settings/secret/budget/retry gate 仍通过；
- pending lease 未被其他 worker 占用。

Provider call 结束后只更新这个 key 的 row。若 Feed 同时更新，旧 call 最多产生一个旧 sourceHash cache row；新 Feed sourceHash 不会读到它。实现仍应在 call 前 recheck，降低无效成本。

### 5.3 Current schema v11 assessment

现有 schema v11：

| Table | 已有能力 | T3 可用性 |
| --- | --- | --- |
| feed_items | 原始 title/summary、visibility/current_until、freshness、lineage | 可读 current candidate |
| feed_item_history | Feed historical observations | T3 排除，不作为 candidate |
| translation_cache | unique cache key、status、error_message、created/updated | cache read 可用；durable retry/lease 不足 |
| provider_runtime | provider/capability job health 与 nextSyncAt | job-level status 可用 |
| sync_runs | job run audit | run-level audit 可用，不表示 field-level retry |
| provider_usage | provider/capability/hour aggregate | total budget/accounting 可用；source 分项不精确 |
| settings | JSON-backed Translation settings | enabled/provider/model/budget 可用 |

结论：T3B provider-free batch read 可以使用 v11；T3C UI 也不需要 schema 变化；完整 T3A 的 crash-safe retry/lease 不能仅凭 v11 可靠实现。

## 6. Migration blocker and minimum proposal

### 6.1 Why migration is required

当前 translation_cache 没有：

- 每个 field 的 retry_count；
- next_retry_at；
- retryable；
- lease_until 或等价 pending lease；
- 结构化的最后 error_code。

现有 provider_runtime.consecutive_failures 是 provider/capability/job 粒度，不能表达单个 Feed field 的 backoff。现有 sync_runs 没有 candidate key，provider_usage 是小时聚合，不能表达 work item retry state。把这些信息塞进 error_message 或 source_scope 会损坏数据边界，不接受。

### 6.2 Minimal additive migration proposal (not implemented)

若人工批准，建议对 translation_cache 只做 additive columns：

| Column | Type/default | Purpose |
| --- | --- | --- |
| retry_count | INTEGER NOT NULL DEFAULT 0 | 已完成的 retryable failure 次数/attempt counter |
| next_retry_at | TEXT NULL | backoff 到期时间；non-retryable 为 NULL |
| retryable | INTEGER NOT NULL DEFAULT 0 | 当前 failed row 是否允许自动 retry |
| lease_until | TEXT NULL | pending lease expiry；用于 stale recovery |
| last_error_code | TEXT NULL | 结构化 ProviderFailureCode / recovery code |

建议增加一个覆盖 candidate scan 的 index，例如：

    (entity_type, target_language, provider, model, status, next_retry_at, lease_until)

实际 index order 需在实现时依据 SQLite query plan 复核；不新增 queue table。

Backfill：

- 所有现有 rows 的 retry_count=0；
- next_retry_at=NULL；
- retryable=0；
- lease_until=NULL；
- last_error_code=NULL；
- 旧历史 failure 因没有可信 error code，默认不自动重试，避免无审计的外部调用。

### 6.3 Migration rollback/risk

当前 migration runner 只有 forward migrations，SQLite 旧版本兼容与 rollback 不能假设可安全 DROP COLUMN。因此：

- migration 前必须备份/校验目标 v11 DB；
- deployment rollback 采用 feature disable + 保留 additive columns，不做 destructive down migration；
- 若 migration 尚未发布，可撤回 migration 文件；
- 若已发布后必须物理回滚，需另一个经批准的 table rebuild/backup restore 方案；
- 本 round 不创建 migration、不改 schema_version、不触碰 retained .data/shipping-hot-v3.sqlite3。

### 6.4 Architecture review repair: durable work-state ownership and controlled recovery

本节是对 T3 draft 的强制边界修复，优先级高于后文任何未明确 owner 的简写。它不改变 T3 的 scope、schema blocker、provider boundary 或 plan status；只把 T3A 实施前必须批准的生命周期 ownership、原子性、崩溃恢复和 provider recovery contract 定义清楚。

#### 6.4.1 Single durable work-state owner

T3A production translation work state 只有一个 durable owner：Translation Runtime 与 TranslationRepository 的组合。Runtime 负责 orchestration，Repository 负责 translation_cache 的事务性读写；任何其他层都不得独立创建、claim、lease、retry、finalize 或 requeue 同一个 translation work item。

| Responsibility | 唯一 owner | 明确不负责 |
| --- | --- | --- |
| current Feed candidate discovery、eligibility、bounded batch | Translation Runtime | 不调用 Provider，不写 Feed 原始事实 |
| claim、pending、lease、retry_count、next_retry_at、last_error_code | Translation Runtime + TranslationRepository | 不由 TranslationService 或 generic BackgroundRuntime 各自维护一份 |
| Provider request preparation、sourceHash、placeholder/protected-term 处理、response validation、original fallback | TranslationService | 不 claim、不 lease、不写 cache、不决定 retry/circuit |
| succeeded/failed finalization、stale lease recovery、controlled requeue | TranslationRepository，由 Runtime 调用 | 不由 Provider 或 Feed repository 直接 upsert |
| provider-level circuit state | Translation Runtime + existing provider_runtime repository API | 不由单个 cache row 伪装成 provider circuit |
| per-call provider usage 与 cache finalization 的提交边界 | T3A Runtime orchestration transaction | 不由 generic “one job = one request” fallback 代记 |

T3A 必须引入 execution-only primitive，建议签名为：

    TranslationService.execute(input): Promise<TranslationExecutionResult>

execute() 只负责：canonical language/source normalization、versioned sourceHash、protected text preparation、调用已注入的 TranslationProvider、result/wrapper/usage contract validation、protected text restoration，并返回成功或结构化失败结果。execute() 不得执行 save、claim、lease、retry classification、provider block、provider usage persistence 或最终 status 写入。

现有 TranslationService.translate() 可以保留为 T1/T2 兼容 convenience orchestration，因为现有 T1/T2 tests 与 fixed translation test service 仍使用它；但 production translation-sync 不得复用 translate() 作为 durable lifecycle owner。T3A 应让 Runtime 调用 execute()，再显式调用下列 Repository lifecycle API。这样可以避免一条 Service 同时拥有 domain execution 和 durable work-state 的双重事实源。

#### 6.4.2 Atomic lifecycle API

T3A 的 Repository API 必须表达完整生命周期，而不是让 Runtime 拼接通用 save() 字段。建议最小 API 如下；精确 TypeScript DTO 名称可在 T3A 实施时按项目命名规范调整，但语义不得缩减：

    claimTranslationWork({
      entityType, entityId, fieldName, sourceText, sourceLanguage,
      targetLanguage, provider, model, sourceHash, now, leaseUntil
    }): ClaimResult | null

    completeTranslationSuccess({
      identity, translatedText, translatedAt, providerUsage, now
    }): void

    completeRetryableFailure({
      identity, errorCode, errorMessage, nextRetryAt, providerUsage, now
    }): void

    completeNonRetryableFailure({
      identity, errorCode, errorMessage, providerUsage, now
    }): void

    recoverStaleLease({ identity, now, reason }): void

    requeueTranslationFailures({
      provider, model, sourceHash?, errorCodes, limit, reason, now
    }): RequeueResult

claimTranslationWork() 必须在一个 SQLite transaction 中完成最终 eligibility check、current provider/model exact succeeded check、未过期 retry state check、provider circuit/budget gate 的 durable 输入确认，以及 pending row + lease 的 claim。返回 null 表示没有可 claim work；并发或重启下不得产生两个有效 lease。claim 前后的 sourceHash 必须相同，sourceText 只能来自当前 Feed read，不接受 browser arbitrary sourceText。

completeTranslationSuccess()、completeRetryableFailure() 和 completeNonRetryableFailure() 都必须是按一个 translation cache identity 的单次原子 finalize。一次 finalize 要同时写入该状态需要的全部字段：translated_text/translated_at、status、retry metadata、lease、last_error_code/error_message、preferred 以及 updated_at；不允许先写 status 再由另一条非原子 update 补字段。成功必须清空 lease、retryable、nextRetryAt 与错误字段；retryable failure 必须递增 retry_count、设置 nextRetryAt、清空 lease；non-retryable failure 必须清空 lease/nextRetryAt 并明确 retryable=false。

T3A 不应使用现有 generic save() 作为 production lifecycle finalize，因为它没有 claim/lease/retry intent。若为 T1/T2 兼容保留 save()，它不得抹掉未来 work metadata；但所有 T3A production transitions 必须走上述专用 API。

Provider call 已发生时，cache finalization 与这一真实 call 的 provider_usage patch 必须在同一个 SQLite transaction boundary 内提交，或在一次由 Runtime orchestration 持有的 BEGIN/COMMIT unit-of-work 内完成。这样不能消除外部网络与 SQLite 无法组成分布式事务的 exactly-once 限制，但可以避免“cache 已 succeeded、usage 没写”或“usage 已写、cache 仍 pending”的本地半状态。generic BackgroundRuntime 的 job-level fallback 不得再为同一真实 call 重复增加 request_count。

#### 6.4.3 Crash windows and conservative recovery

T3A 必须明确接受外部 Provider 与 SQLite 无法组成分布式事务，因此不宣称 exactly-once external billing：

| Crash window | Durable observation after restart | Required action |
| --- | --- | --- |
| A. claim 已提交，Provider call 尚未发出 | pending + lease | lease 到期后 recoverStaleLease，写 provider_attempt_unknown/non-retryable；不自动重试 |
| B. request 已发出但 response 丢失/进程 crash | pending + lease | 与 A 相同；不能假设 request 未到达，避免潜在重复计费 |
| C. response 已收到，finalize transaction 尚未提交 | pending + lease | 与 A 相同；success response 不足以作为 durable success 证据 |
| D. finalize + usage transaction 已提交，随后进程 crash | succeeded 或明确 failed | restart 读取 durable 终态；不得重复 call；retryable failed 仅按 nextRetryAt 重新 candidate |

provider_attempt_unknown 只封锁当前 row，表示该次外部请求是否到达未知；它不是 provider-level circuit code。只有经人工/code review 的 controlled requeue 才能让该 row 再次进入 candidate。

#### 6.4.4 Controlled requeue contract

requeueTranslationFailures() 是 server-side internal operation，不是 public endpoint，不接受任意 entityId/sourceText/errorMessage，也不触发 Provider。它必须：

- 使用显式 provider、model、可选 sourceHash、允许的 errorCodes 和 bounded limit；limit 第一版不得超过 100；
- 只选择当前仍存在、仍 eligible、sourceHash 仍匹配且 status=failed 的 row；source 已变化的 row 不得复活旧译文；
- 在一个 Repository transaction 内把选中 rows 置为 retryable=true、retry_count 按约定归零或保留审计计数、nextRetryAt=now、lease=null，并保存 redacted reason；
- 返回 selected/requeued/skipped counts，供 run audit 使用；不扩大到未选中的历史 row；
- auth_failed、provider_forbidden、entitlement_missing 只能在配置/权限修复后、fixed harmless translation test 成功并得到 operator approval 后 requeue；
- provider_contract_changed 必须先完成 Provider contract review、代码/adapter review、targeted tests 与人工批准；
- provider_attempt_unknown 必须逐 row 经过 operator/code review；若 Feed 已过期或 sourceHash 已变化则保持不可重试，不得为了清 backlog 强行 requeue；
- 不允许 interval 自动 requeue non-retryable rows，不提供 arbitrary public requeue API。

#### 6.4.5 Provider circuit block/unblock path

T3A 使用现有 provider_runtime 的 provider + capability/job identity 保存 Translation provider-level block，不新增 circuit table。本第一版用现有 status 与 error_code 的约定表达 block：status=failed 或 degraded，error_code 为明确的 blocking ProviderFailureCode；blocked run 必须保留该 code，不得被普通 skipped run 清掉。若 T3A 证明现有 provider_runtime update 不能稳定保留这两个字段，必须在实施前停止并提出 additive schema/contract blocker，不能静默改用 cache row 代替 circuit。

以下错误触发 provider-level block：

- auth_failed；
- provider_forbidden；
- entitlement_missing；
- provider_contract_changed。

以下错误不触发永久 provider-level block：rate_limited、provider_timeout、provider_unavailable。它们只让当前 run 停止，并由各 row 的 retryable failure/backoff 控制下一次 candidate；Runtime 可以记录 degraded/consecutiveFailures，但不能把暂时网络错误误标成需要人工解锁的永久 circuit。

provider_attempt_unknown 只阻断当前 translation cache row，不触发 provider-level block。这样一个 crash/未知请求不会把健康 Provider 的其他 eligible rows 一并永久冻结。

Runtime 的每轮顺序必须是：

    provider circuit allowed
      -> settings/provider/model allowed
      -> budget and secret gate
      -> current Feed candidate scan
      -> transactional claim
      -> final exact/source/eligibility and budget recheck
      -> TranslationService.execute()
      -> atomic cache finalize + per-call usage

当 circuit 已 blocked：translation-sync 只能写 redacted skipped/run status，不能 claim 新 row、不能执行 execute()、不能调用 DeepSeek；重启后仍保持 blocked。block operation 必须保存 provider/capability、blocking code、时间和 redacted reason；同一 run 首次命中上述 blocking error 后停止后续 Provider calls。

unblock 必须是显式 server-side operation，例如：

    clearTranslationProviderBlock({ provider, capability, reason })

它只清理/恢复 provider_runtime 的 block 状态，不自动发请求、不自动 requeue row。配置类 block 的恢复顺序是：修复 server-only secret/account/config -> fixed harmless translation test 成功 -> clear block -> 对选定 config-error rows 做 bounded controlled requeue -> 等待正常 interval。provider_contract_changed 的恢复顺序还必须包括官方 contract review、adapter 修复、targeted tests 和人工批准。provider_attempt_unknown 的恢复顺序是逐 row review -> 仅对仍 eligible 的 row controlled requeue；它不需要也不允许通过 clear provider circuit 解锁。

block/unblock、requeue、stale recovery 都必须进入可审计的 Runtime/sync run evidence；不能把 operator reason、secret、prompt 或完整 Provider response 写入 cache、provider_runtime、provider_usage 或普通 Feed DTO。

#### 6.4.6 Review repair scope lock

上述 owner/API/circuit 是 T3A 的 architecture contract，不是本轮实现。它不授权新增 migration，不改变现有 schema v11，不创建 translation-sync，不扩展 Feed API/UI，不把 Translation 加入 Real Readiness，也不改变 Event/HOT/Voyage/Port/Weather/source lineage/freshness/severity/ranking/dedupe/evidence 的原始事实边界。

## 7. Runtime state machine

以下状态机必须由第 6.4 节定义的 Translation Runtime + TranslationRepository 唯一持有；TranslationService.execute() 只返回 execution result，不直接改变这些 durable states。

第一版建议状态如下：

    NO CACHE
       |
       v
    CANDIDATE
       |
       | claim transaction + final eligibility/budget gate
       v
    PENDING (lease_until = now + lease)
       |
       v
    PROVIDER CALL
       |
       +-- success ------------------------------> SUCCEEDED
       |
       +-- rate_limited / timeout / unavailable
       |       |
       |       v
       |    FAILED(retryable=true, retry_count++)
       |       |
       |       +-- now < next_retry_at --> WAIT_BACKOFF
       |       |
       |       +-- now >= next_retry_at -> CANDIDATE
       |
       +-- auth_failed / forbidden / entitlement_missing
       |       |
       |       v
       |    FAILED(retryable=false / blocked until config or operator review
       |
       +-- provider_contract_changed
       |       |
       |       v
       |    FAILED(retryable=false, provider job circuit blocked
       |    until contract review; no automatic retry
       |
       +-- process crash while pending
               |
               v
            stale lease recovery
               |
               v
            FAILED(provider_attempt_unknown, retryable=false
            operator/code review required before requeue

Gate failure before Provider call does not enter PROVIDER CALL and must produce zero external calls:

    disabled / provider-not-allowed / model-not-allowed
    budget-zero / budget-exhausted
    secret-missing
    non-due retry state
        -> SKIPPED / backlog remains discoverable

### 7.1 Pending lease choice

现有 DeepSeek timeout 是 20 秒。第一版建议：

- lease duration = 45 秒（2 × 20 秒 + small safety margin）；
- pending lease 未过期：不重复 claim；
- pending lease 过期：在重启/下一次 scan 中恢复，不让 row 永远卡 pending；
- 由于 crash 后无法知道外部 request 是否已经到达，恢复动作默认写成 provider_attempt_unknown、failed、retryable=false，不自动重复产生可能重复计费的 request；
- 需要继续处理时，必须经过受控 operator/code review requeue，不开放 arbitrary endpoint。

如果未来 Provider 提供并被验证的 idempotency contract，可另行审查是否把 stale pending 改为自动 retry；T3 第一版不假设该能力。

## 8. Retry policy

### 8.1 Retryable codes

自动 retry 只允许：

- rate_limited；
- provider_timeout；
- provider_unavailable。

第一版在一次 run 遇到这些 Provider failure 后停止当前 run 的后续 Provider calls，保存 retry state，避免连续 hammering；下次由 next_retry_at 决定。

### 8.2 Non-retryable/config-dependent codes

以下默认不自动 retry：

- auth_failed；
- provider_forbidden；
- entitlement_missing；
- provider_contract_changed；
- provider_attempt_unknown（stale pending recovery）。

配置修复、provider/model 变化或 sourceHash 变化可以形成新的 candidate。对于同一 hash/provider/model 的旧 non-retryable row，必须使用受控 requeue；第一版不提供 public manual endpoint。

其中 auth_failed、provider_forbidden、entitlement_missing、provider_contract_changed 还会触发 provider_runtime 的 Translation provider-level block；provider_attempt_unknown 只阻断当前 row。clearTranslationProviderBlock 与 requeueTranslationFailures 必须遵循第 6.4 节的显式 server-side recovery sequence，不得由 interval 自动调用。

### 8.3 Backoff

使用确定性 exponential backoff：

    1m, 2m, 4m, 8m, 16m, 32m, 60m, 60m...

最大 60 分钟。第一版不加 random jitter，因为部署模型是 single process、translation concurrency=1，且需要可审计、可测试的确定性时间；若未来支持多个 Runtime process，再单独增加 bounded jitter 或 distributed reservation。

### 8.4 provider_contract_changed final behavior

一旦 DeepSeek response/usage contract 改变或缺失：

1. 已发生的 external request 仍记为 request_count += 1；
2. cache row 写 failed、last_error_code=provider_contract_changed、retryable=false；
3. estimated_cost=0，因为没有可信 usage 不能推算实际外部成本；
4. 当前 translation job 立即停止本轮后续 calls；
5. provider-level runtime 进入 blocked/degraded/failed 可观测状态；
6. 同 provider/model contract 在人工 review 前不再自动调用；
7. 不得通过普通 interval 无限重试，也不得自动切换其他 Provider。

## 9. Translation Runtime job design

### 9.1 Job identity and scheduling

建议 job：

    id: translation-sync
    providerId: deepseek
    capability: translation
    interval: 60 seconds

不是每次启动立即 run。遵循现有 Background Runtime 的 nextSyncAt：新 job 首次在 60 秒后执行；重启时若已有过去的 persisted nextSyncAt，只执行 bounded batch。

### 9.2 Batch and concurrency

第一版最终参数：

- scan interval：60s；
- max work per run：5 fields；
- batch size：5 fields；
- Provider concurrency：1；
- per-request timeout：20s，沿用现有 DeepSeek Provider；
- 一个 translation-sync job 不允许重入；
- single process translation executor lock 也必须覆盖 fixed translation test，防止 test endpoint 与 Runtime 并发绕过预算 gate。

5 fields/run 是成本和失败半径优先的保守值；不会一次把 100 items × 2 fields 转成 200 并发请求。若单次 provider request 平均接近 timeout，runtime scheduler 仍以完成后 + 60s 再次安排，batch 会自然受限。

### 9.3 Startup/restart

- 不扫描 history Feed；
- 不启动 translate-all backlog；
- 只扫描 current eligible；
- 每轮最多 5 fields；
- persisted pending lease 过期则按 stale recovery 处理；
- persisted failed retryable 仅在 next_retry_at <= now 时重新 candidate；
- persisted non-retryable 不自动 retry；
- persisted provider runtime contract block 在 review/requeue 前只返回 blocked/skipped，不发 DeepSeek request。

### 9.4 Provider and mode gating

Runtime registry 不得创建 Fake Provider。建议：

- 仅在 Real Mode 且配置请求为允许的 DeepSeek provider/model 时注册 production translation job；
- Mock Mode 不调用任何 Translation Provider；可显示 disabled/off，但 Fake 不能作为 runtime evidence；
- Translation settings disabled、budget zero、budget exhausted、secret missing 时，job 可以保持可观测但 run 必须是 no-call skipped；
- 不得因缺少 secret 自动切换 Fake 或其他 Provider；
- 不得因 DeepSeek failure 自动切换第二 Provider。

### 9.5 Per-call budget gate

每一次 production call 前按顺序检查：

    provider_runtime Translation circuit is not blocked
    settings.enabled
    providerId == deepseek
    model == deepseek-v4-flash
    monthlyBudget > 0
    current UTC-month estimated spend < monthlyBudget
    SecretStore has DeepSeek secret
    candidate retry state is due
    final exact cache miss
    Feed still current and sourceHash unchanged

全部通过后才允许 Provider call。任何 gate 失败均为 0 external calls。

其中 provider circuit 必须在 candidate claim 之前检查，并在 claim transaction 与真实 call 之间再次确认；blocked 状态下不得 claim 新 row。一次真实 call 的 cache finalization 与 provider_usage 由同一 Runtime transaction boundary 提交；TranslationService.execute() 不承担该提交。

### 9.6 Budget concurrency

第一版 concurrency=1。除此之外必须使用 process-local translation executor mutex，把 Runtime 与 fixed test call 串行化；单 worker 才能保证“检查 spend → call → persist usage”不会被同进程另一个翻译请求插入。

如果部署未来变为多进程/多实例，T3 设计不能直接扩展；必须另做 SQLite budget reservation/lease ADR 后才允许 >1 concurrency。

### 9.7 Usage accounting boundary

必须区分：

- App translation cache hit：已有 succeeded cache，0 DeepSeek call，0 provider_usage.request_count；
- DeepSeek prompt cache hit：DeepSeek request 已发生，request_count += 1，按 returned hit/miss token usage 估算更低 input cost；
- 两者不能共用 cacheHitCount 语义。

T3A 应扩展 Runtime result/usage contract，使 TranslationRuntimeService 能逐真实 call 写 provider_usage，并让 generic BackgroundRuntime 跳过重复的“一次 job=一次 request”记录。成功/失败都记录 request；cache hit 不写 request usage。

## 10. Cost, source scope and unknown cost

### 10.1 Currency and budget meaning

monthlyBudget 固定解释为：

    local estimated USD monthly spend ceiling

不是 CNY、account balance 或 official billing total。UI/Status 将来显示“本地估算”，不伪造 DeepSeek 账户余额。T3 不做 FX conversion。

### 10.2 Cost calculation

成功且 usage contract 完整时：

- prompt_cache_hit_tokens 用 DeepSeek cache-hit rate；
- prompt_cache_miss_tokens 用 DeepSeek cache-miss rate；
- completion_tokens 用 output rate；
- total_tokens 用于一致性审计，不重复计费；
- 保存 currency=USD 和固定 pricing reference。

Provider call failure 且 usage 可信时，可按明确 usage 规则计算；usage 缺失/非法时 estimated cost 必须为 0 并标注 unknown-cost failure。

### 10.3 Unknown-cost contract failure

provider_contract_changed 不能隐瞒已发生的 request，也不能把未知成本当作 0 次请求：

- request count：+1；
- failure count：+1；
- estimated cost：0，因为 unknowable；
- error code：provider_contract_changed；
- 自动 retry：禁止；
- 当前 run：停止；
- provider job：blocked until review。

这是本地可审计统计，不是官方账单修正。

### 10.4 source_scope

继续使用现有 provider_usage provider/capability/hour 聚合做 budget total，但不把 source_scope 当精确 cost-by-source ledger。

T3 新写入：

- fixed test：literal translation_test；
- production Feed：literal feed。

同一个小时如果先写 test 后写 feed，或反之，source_scope 应合并为：

- 单一 scope：保留该 literal；
- 不同 scope：mixed；
- 已经是 mixed：继续 mixed；
- null + scope：使用 scope。

source_scope 的最终语义是 informational last/mixed scope only。不得声称它能够精确回答 feed cost、test cost 或按业务 source 分账。若未来需要精确 cost-by-source，另建 usage event ledger/migration，不在 T3 V1 扩大范围。

## 11. Feed API read integration

### 11.1 API-only display DTO

首选新增一个 API/read model 类型，不改变持久化 FeedItem：

    FeedItemDisplay = FeedItem & {
      displayTitle: string
      displaySummary: string
      translation: {
        title: { status: FeedTranslationStatus }
        summary: { status: FeedTranslationStatus }
      }
    }

建议状态：

    translated
    historical_fallback
    original
    pending
    failed
    disabled
    budget_exhausted

具体内部 error code 不直接显示在普通 Feed 页面；status/settings 保留详细诊断。

### 11.2 title/summary compatibility decision

保留：

    title      = original source fact
    summary    = original source fact

新增：

    displayTitle
    displaySummary
    translation.title.status
    translation.summary.status

不新增 title_zh/summary_zh 到 feed_items，不把 title 从原文语义偷偷改成 display 语义。这样可以保护现有 Feed/Event/HOT dedupe 与 domain consumers。

由于 title/summary 已经保留原文，UI 的“查看原文”不需要再复制一份 nested original 对象；如前端交互需要，可在 API DTO 中明确提供 read-only original: { title, summary } 作为兼容别名，但第一版优先避免重复 payload。

### 11.3 Exact/historical/original resolution

对于每个 current FeedItem field：

1. current configured provider/model + exact sourceHash + target success -> display*=translated；
2. 同 sourceHash/target 的 deterministic historical success -> display*=historical_fallback；
3. 没有 success 时 display 使用原文；
4. 若有 pending -> status=pending；
5. 若只有 failed retryable/non-retryable -> status=failed；
6. settings disabled 且无 success -> disabled；
7. budget exhausted 且无 success -> budget_exhausted；
8. 已有历史 success 在 disabled/budget exhausted 时仍可 display，保持 T1/T2 fallback contract。

旧 sourceHash 的 success 不可用于新 sourceText，即使 entityId 没变。

### 11.4 Batch translation lookup

禁止 100 Feed × 2 fields 逐条调用 TranslationService.getCachedTranslation() 形成明显 N+1。

建议 T3B 在 TranslationRepository 增加 batch API，例如：

    findSuccessfulForFeedItems(
      lookups: readonly TranslationCacheLookup[],
      preference: TranslationPreference,
    ): Promise<Map<FeedFieldKey, TranslationCacheRecord>>

实现原则：

- 一次传入 current Feed 的 sourceHash/field/entity lookup；
- SQL 先按 entity_type='feed_item'、target、entity ids、field names、status 成批读取；
- sourceHash 必须参与最终 key match；
- exact current provider/model 优先；
- historical 按 translated_at DESC, provider ASC, model ASC, id ASC deterministic 选择；
- pending/failed 只用于 coarse status，不用于 display text；
- 100 item 目标使用一个 bounded query；超过 SQLite parameter 安全上限时按稳定 chunks，不按每 field 一个 query。

API mapper 在一次 batch read 后生成 display DTO。Feed GET 与 legacy aggregate GET 可共用 mapper，但 mapper 只能读 SQLite/Repository，绝不能创建或调用 Translation Provider。

### 11.5 Endpoint compatibility

当前 Feed UI 实际使用 /api/shipping，而专用 /api/shipping/feed 尚未被 FeedPage 消费。建议：

- T3B 在 /api/shipping/feed 增加 display DTO；
- T3B 同时为 /api/shipping 的 FeedItem 部分调用同一个 provider-free display mapper，避免首页 Feed preview 与 Feed 页面语义不一致；
- 两个 endpoint 的 events、hot、vessels、ports、voyages 仍使用原始事实；
- 原有 title/summary 字段保持原文，因此旧客户端不会被破坏；
- T3C 更新 Feed-only UI 使用 displayTitle/displaySummary，不需要修改 Event/HOT business inputs。

如果治理上希望 /api/shipping 暂不扩展 payload，则 T3C 必须改为 FeedPage 单独消费 /api/shipping/feed；这一取舍需人工批准，默认方案是两个 read endpoint 共享 display mapper。

## 12. Feed UI design (T3C only)

### 12.1 Display behavior

- Feed 页面默认优先显示 displayTitle/displaySummary；
- translated 与 historical_fallback 都允许中文优先，但可见状态细节要区分；
- original、pending、failed、disabled、budget_exhausted 显示原文，不阻塞 Feed；
- 普通页面显示“翻译中”或“暂不可用”，不显示 API key、Authorization、完整 Provider error message；
- status/settings 页面才显示 provider/config/budget/error code 等诊断。

### 12.2 Original-text access

每条 Feed 保留“查看原文”或等价展开/切换操作：

- 原文来自 DTO 的 title/summary；
- 不能只显示中文而丢失原文；
- toggle 只影响 UI display，不修改 FeedItem 或 cache；
- 原文 URL、日期、代码、港口/航次标识继续由原始 FeedItem 提供。

### 12.3 No Event/HOT propagation

T3C 不改 Event/HOT 页面文字。若 Feed item 同时产生 Event/HOT：

- Event/HOT 继续显示由 raw Feed/Event facts 生成的 title/summary；
- 不把 Feed displayTitle 写入 Event；
- 不用翻译文本做 Event detection、HOT classification、severity、dedupe、ranking、evidence 或 lineage。

## 13. Feed ingest / runtime / read sequence diagrams

### 13.1 Feed ingest

    Feed Provider
        -> Feed normalizer/parser
        -> Feed sync job
        -> ShippingRepository.upsertFeedItem()
        -> SQLite feed_items: ORIGINAL title/summary committed
        -> refresh Event from ORIGINAL FeedItem
        -> Feed ingestion success
        |
        +--> next Translation Runtime scan discovers candidate

Translation discovery is eventual and must never be awaited inside the Provider fetch or Feed persistence transaction.

### 13.2 Translation Runtime

    BackgroundRuntime
        -> translation-sync candidate scan
        -> canonical Feed eligibility + sourceHash
        -> exact cache recheck
        -> retry/lease gate
        -> settings/provider/model/budget/secret gate
        -> TranslationService
        -> DeepSeek Provider (only after all gates)
        -> translation_cache success/failure
        -> per-call provider_usage
        -> provider_runtime/sync_runs job state

On cache hit:

    candidate scan -> exact succeeded cache -> 0 DeepSeek call -> no request usage

On any pre-call gate failure:

    gate fails -> 0 DeepSeek call -> backlog/status remains observable

### 13.3 Feed GET

    Browser
        -> GET /api/shipping/feed or GET /api/shipping
        -> ShippingRepository current Feed read
        -> TranslationRepository batch successful-cache read
        -> provider-free display mapper
        -> FeedDisplayItem DTO
        -> Browser

    Feed GET -X-> DeepSeek

The Feed GET must not call TranslationService.translate(), instantiate a Provider, read a secret, or mutate translation_cache/provider_usage.

## 14. Readiness, failure isolation and rollback

### 14.1 Readiness boundary

Translation remains optional enrichment:

- Translation disabled/missing secret/budget exhausted/provider failed does not make Shipping core not-ready；
- REAL_OPERATIONAL continues to evaluate Feed/Event/HOT/Voyage/Port/AIS/Weather according to their own gates；
- Translation may expose its own coarse state: disabled、ready、degraded、provider_failed、budget_exhausted；
- verified_live 只在 real DeepSeek evidence 完成后使用，Fake 不产生 evidence；
- T3 engineering complete 不等于 live verified。

### 14.2 Feed failure isolation

DeepSeek timeout/429/500/secret missing/budget exhausted/contract changed：

- Feed original ingestion remains successful；
- original FeedItem remains readable；
- current/historical Feed API does not fail because Translation is unavailable；
- Event/HOT derived from original facts remains unchanged；
- Translation failure is visible only as coarse display/status state；
- no automatic second Provider.

### 14.3 Disable/budget exhaustion rollback

最简单 rollback：

    translation.enabled = false

效果：

- stops new external Translation calls；
- existing successful cached zh may still display；
- no new candidate Provider call；
- Feed ingestion unaffected；
- Event/HOT unaffected；
- UI falls back to raw original when no successful cache exists；
- no data deletion。

预算 exhausted 采用同一 no-call behavior；不要清除历史成功缓存。

## 15. Manual trigger decision

第一版不新增 POST /translation/sync：

- existing Background Runtime is the operational scheduler；
- runNow is an internal/runtime test capability, not public arbitrary translation；
- 不暴露 arbitrary sourceText、prompt、entityId 或 bulk unbounded request；
- 若未来需要运维 trigger，必须是 authenticated、bounded、no-arbitrary-input 的单独 ADR/API review；
- provider_contract_changed 的 requeue 也不通过普通用户 endpoint 完成。

## 16. Translation status extension

现有 GET /api/shipping/translation/status 继续 provider-free。T3A 可扩展 redacted response：

    runtime: {
      jobId,
      running,
      lastRunAt,
      nextRunAt,
      lastRunStatus
    }
    backlog: {
      candidates,
      pending,
      failedRetryable,
      failedNonRetryable,
      staleRecovered
    }

这些值都来自 SQLite/runtime state，不触发 Provider。普通 Feed page 不需要暴露完整 failure details。

## 17. T3 milestones

### T3A — Translation Runtime Foundation

前置批准：

- 该 proposal；
- 最小 translation_cache additive migration；
- runtime usage opt-out/per-call accounting contract；
- process-local translation executor lock。

实现范围：

- canonical current Feed candidate scanner；
- translation-sync registry/job；
- bounded scan/batch/concurrency=1；
- Translation Runtime + TranslationRepository 作为唯一 durable work-state owner；
- TranslationService.execute() execution-only primitive；现有 translate() 仅保留 T1/T2 compatibility；
- 专用 SQLite claim/pending/finalize/recovery/requeue lifecycle API，禁止 production path 依赖 generic save()；
- SQLite claim/pending lease；
- atomic cache finalization + per-call usage transaction boundary；
- retry classification/backoff；
- stale pending recovery；
- auth/forbidden/entitlement/contract provider circuit block、显式 unblock 与 controlled requeue；provider_attempt_unknown 仅 row-level block；
- settings/secret/budget hard pre-call gate；
- per-call usage accounting；
- runtime/backlog/status read；
- Fake provider only in tests, never Runtime/Readiness。

不改 Feed UI，不把 display fields 加入 Feed API。

验收：

    Fake/mocked DeepSeek boundary
        -> real SQLite
        -> bounded translation_cache population
        -> restart/retry/budget/failure isolation

### T3B — Feed Read Integration

实现范围：

- TranslationRepository batch successful lookup；
- exact -> historical -> original resolver；
- provider-free display mapper；
- Feed API display DTO；
- /api/shipping/feed 与 /api/shipping compatibility decision；
- status/backlog redacted read integration。

仍不改 Event/HOT semantics，不做 UI styling。

### T3C — Feed UI

实现范围：

- Chinese-first Feed display；
- displayTitle/displaySummary consumption；
- original text toggle；
- translated/historical/original/pending/unavailable coarse presentation；
- no-translation/error does not break Feed。

不新增 Settings UI，不改 Event/HOT UI semantics。

### T3D — Live Acceptance

前置：

- DeepSeek live verification 已通过；
- secret source/config review；
- production enabled 的人工批准；
- small bounded batch plan。

只用 1 个小 batch 做：

    Runtime -> DeepSeek -> translation_cache -> restart read-back
        -> Feed API -> UI

验证 auth、model、response/usage contract、placeholder/TEST STAR、cost persistence、cache hit no-call、restart、Feed original ingestion isolation。完成后才可将 Translation production 状态标记为 verified_live；Translation 仍不进入 Real Operational hard gate。

## 18. DeepSeek live verification gate

正式开启 production Translation Runtime 前必须先完成隔离、harmless、small live verification。至少检查：

1. DEEPSEEK_API_KEY server-only SecretStore source/configured；
2. fixed endpoint/model；
3. thinking.type=disabled、stream=false、no tools；
4. response content contract；
5. complete usage contract and arithmetic；
6. placeholder/identifier/date/URL/explicit protected term preservation；
7. no wrapper/prompt-injection output accepted；
8. success/failure cache persistence；
9. usage/cost persistence；
10. process restart provider-free read-back；
11. one app cache hit produces 0 external calls；
12. secret/error redaction。

没有 key 时，T3 code engineering 可以在 Fake/mocked boundary 完成，但 production enabled/live verified 必须保持 pending。

## 19. Test matrix

以下是 T3 实施验收矩阵；本轮不执行这些 T3 tests。

### 19.1 Candidate

1. current title candidate：eligible current Feed title is discovered。
2. current summary candidate：eligible current Feed summary is discovered。
3. history excluded：history-only Feed never enters candidate set。
4. expired excluded：expired/currentUntil-past Feed is excluded。
5. future excluded：future effective/publication Feed is excluded。
6. empty excluded：blank title/summary is excluded independently。
7. exact cache excluded：current provider/model exact success produces no work。
8. source changed becomes new candidate：same entityId with new sourceHash produces new work and does not reuse old translation。

### 19.2 Runtime and gates

9. bounded batch：one run processes at most 5 fields。
10. concurrency：Provider calls are serialized at concurrency 1。
11. disabled = 0 calls：settings disabled produces no external call。
12. budget zero = 0 calls：monthly budget zero produces no external call。
13. budget exhausted = 0 calls：aggregate spend at/above budget produces no external call。
14. secret missing = 0 calls：missing SecretStore value produces no external call。
15. success persists：successful Provider result writes succeeded cache and usage。
16. cache hit = 0 call：exact app cache hit returns without Provider or request usage。
17. restart continues：new process reads persisted runtime/cache state and continues bounded work。
18. stale pending recovery：expired lease is recovered and never remains permanently pending。

### 19.3 Retry

19. rate limit retry：rate_limited persists retryable state。
20. timeout retry：provider_timeout persists retryable state。
21. unavailable retry：provider_unavailable persists retryable state。
22. auth nonretry：auth_failed does not auto retry。
23. forbidden nonretry：provider_forbidden does not auto retry。
24. entitlement nonretry：entitlement_missing does not auto retry。
25. provider_contract_changed nonretry：contract error blocks automatic retry and stops the current run。
26. backoff capped：1/2/4/8/16/32/60 minute schedule never exceeds 60 minutes。
27. no retry storm：bounded run, concurrency=1 and circuit block prevent request storm。

### 19.4 Cost

28. request accounting：each real DeepSeek call increments request_count once。
29. app cache hit accounting：app cache hit increments neither request_count nor external-call usage。
30. DeepSeek cache-hit price accounting：Provider prompt cache hit remains one request and uses hit-token price。
31. monthly budget：complete UTC-month aggregate, not detail-row limit, controls hard gate。
32. unknown-cost contract failure never auto-retries：request/failure are recorded, cost is zero/unknown, no automatic repeat。

### 19.5 Feed API

33. exact current translation：display fields use current exact success。
34. historical fallback：same hash/target historical success displays when current exact is absent。
35. original fallback：no success uses original title/summary。
36. provider-free：Feed GET has zero Provider/Secret call and no cache mutation。
37. batch lookup no N+1：100 Feed items use bounded batch query/chunks, not 200 per-field queries。
38. changed hash does not use stale translation：new sourceHash never reads old hash success。

### 19.6 UI

39. Chinese display：translated/historical success uses display fields。
40. original accessible：original title/summary can be restored/shown。
41. pending fallback：pending keeps Feed readable and shows original/coarse translating state。
42. failed fallback：failed keeps Feed readable and shows original/coarse unavailable state。
43. no translation does not break Feed：disabled/budget/secret/provider failure does not fail Feed page。

### 19.7 Isolation

44. Event unaffected：Event facts remain raw Feed-derived values。
45. HOT unaffected：HOT output and classification remain raw facts。
46. severity unaffected：translation does not change severity。
47. dedupe unaffected：translation does not change dedupe key/input。
48. lineage unaffected：provenance/source lineage/evidence remain original。
49. freshness unaffected：translation does not change current/history/expiry/freshness。
50. Real Readiness unaffected：Translation failure/disabled does not make Shipping core Real Readiness pass or fail incorrectly。

### 19.8 Architecture ownership, atomicity and recovery

51. single durable owner：只有 Translation Runtime + TranslationRepository 改变 T3 translation work state；TranslationService 与 generic BackgroundRuntime 不创建第二套 lifecycle。
52. execution-only service：TranslationService.execute() 不 claim、不 lease、不 save、不写 usage、不 block provider，只返回 validated execution result。
53. T1/T2 compatibility：现有 translate() 可继续服务旧调用，但 production translation-sync 只走 execute() + Repository lifecycle API。
54. atomic claim：并发 claim 同一 identity 最多产生一个有效 pending lease。
55. claim final recheck：claim 在最终事务内重新检查 current eligibility、sourceHash、exact success、retry due 与 gate 输入。
56. atomic success finalize：success 一次性写 translated text、status、translatedAt、preferred、lease/retry/error 清理与 updatedAt。
57. atomic retry finalize：retryable failure 一次性写 failure、retry_count、nextRetryAt、error code/message 与 lease 清理。
58. atomic non-retry finalize：non-retryable failure 一次性写 failure、retryable=false、nextRetryAt/lease 清理与 error code/message。
59. cache/usage unit-of-work：真实 Provider call 的 cache finalization 与 provider_usage 不产生本地半提交，generic job-level usage 不重复计数。
60. crash A：claim 后尚未发 call 的 stale lease 恢复为 provider_attempt_unknown/non-retryable，0 次自动重试。
61. crash B：request 已发出但 response 丢失时同样保守恢复，不假设外部 request 未到达。
62. crash C：response 已收到但 finalize 未提交时同样恢复，不把内存 success 当 durable success。
63. crash D：finalize + usage 已提交后重启读取终态，不重复 Provider call。
64. stale no-auto-retry：provider_attempt_unknown 只阻断当前 row，不触发 provider-level circuit。
65. bounded requeue：controlled requeue 仅 server-side、显式过滤、limit<=100、无 Provider call、返回 selected/requeued/skipped audit counts。
66. config requeue gate：auth/forbidden/entitlement rows 只有配置修复、fixed harmless test 成功和 operator approval 后才能 requeue。
67. contract requeue gate：provider_contract_changed rows 需要 contract review、adapter/code review、targeted tests 和人工批准后才能 requeue。
68. stale requeue gate：provider_attempt_unknown 逐 row review，Feed 过期或 sourceHash 变化的 row 不得 requeue。
69. auth circuit：auth_failed 触发 persisted provider-level block，当前 run 停止且后续 run 0 calls。
70. forbidden circuit：provider_forbidden 触发 persisted provider-level block，当前 run 停止且后续 run 0 calls。
71. entitlement circuit：entitlement_missing 触发 persisted provider-level block，当前 run 停止且后续 run 0 calls。
72. contract circuit：provider_contract_changed 触发 persisted provider-level block、unknown cost/failure evidence 与 no-auto-retry。
73. block persistence/unblock：blocked 状态跨重启保留；clearTranslationProviderBlock 不调用 Provider、不自动 requeue，需显式 recovery sequence。
74. transient classification：rate_limited/provider_timeout/provider_unavailable 只进入 bounded retry/backoff，不被误标为永久 provider circuit。

## 20. Conservative performance target

First production target：

- 100 current FeedItems；
- maximum 200 translatable fields；
- candidate scan uses bounded SQLite/local read and canonical helper；
- one translation run max 5 fields；
- provider concurrency 1；
- Feed GET never does external network；
- Feed GET uses one batch translation lookup or bounded chunks；
- no 200 translation queries per Feed page；
- app cache hit requires 0 Provider call；
- startup only processes current bounded backlog，not historical translate-all；
- no complex benchmark required，but SQLite query plan and N+1 test are required before T3B acceptance。

## 21. Security boundaries

T3 implementation must not add or allow：

- arbitrary prompt API；
- arbitrary sourceText from browser；
- browser direct DeepSeek；
- frontend Secret or LocalStorage Secret；
- dynamic base URL；
- custom Provider；
- tools/function calls；
- reasoning mode；
- user-controlled system prompt；
- automatic second Provider fallback；
- secret/API key in logs、cache、DTO、provider_runtime、provider_usage or errors。

Existing FileSecretStore / environment-priority contract remains the server-only Secret boundary. This proposal adds no Secret and does not modify .env.local。

## 22. Rollback and operational controls

Operational rollback remains:

    enabled = false

No cache deletion is needed. Existing successful translations may continue to display; product may later choose an original-only UI switch, but that is not required for safe rollback.

If a provider contract change occurs：

- stop Translation Runtime calls；
- retain failed evidence and unknown-cost usage；
- keep Feed ingestion/read/HOT/Event operational；
- review provider contract；
- requeue only selected rows through a controlled internal operation after approval。

## 23. Open architecture decisions for human approval

进入 T3A 前必须明确批准：

1. 是否批准对 translation_cache 的最小 additive migration（retry_count、next_retry_at、retryable、lease_until、last_error_code）。
2. 是否接受 stale pending 在未知外部请求状态下变成 provider_attempt_unknown/non-retryable，而不是自动重试。
3. 是否接受 60s interval、5 fields/run、concurrency=1、20s timeout。
4. 是否批准 Runtime 与 fixed test 共用 process-local translation executor lock。
5. 是否批准修改 generic BackgroundRuntime usage contract，使 translation per-call usage 不被 job-level fallback 重复计算。
6. 是否接受 provider_usage.source_scope 为 literal feed/translation_test，多 scope 时为 informational mixed，不做 source cost ledger。
7. 是否接受 title/summary 保持原文，并新增 API-only displayTitle/displaySummary。
8. 是否让 /api/shipping/feed 与 legacy /api/shipping 共享 display mapper；默认建议是共享。
9. 是否接受第一版不提供 public POST /translation/sync 与 public requeue endpoint。
10. 是否接受 Translation 始终不进入 Real Operational readiness hard gate。
11. 是否在 T3D 前单独批准 DeepSeek harmless live verification，并将 production enable 与 verified_live 分开。
12. 是否批准 Translation Runtime + TranslationRepository 作为唯一 durable work-state owner，并禁止 TranslationService/generic BackgroundRuntime 维护第二套 lifecycle。
13. 是否批准 TranslationService.execute() execution-only primitive，并让现有 translate() 仅作为 T1/T2 compatibility path。
14. 是否批准专用 claim/finalize/stale-recovery/requeue Repository API，以及 cache finalization + per-call provider_usage 的同一 SQLite transaction boundary。
15. 是否批准 bounded server-side controlled requeue 的 error-code、sourceHash、eligibility、limit<=100 与 operator/code review gate。
16. 是否批准基于现有 provider_runtime status/error_code 的 Translation provider circuit block/unblock contract；明确 auth/forbidden/entitlement/contract 为 provider-level block，而 provider_attempt_unknown 仅 row-level block。

## 24. Proposal verification and governance state

本文件只应以 draft、pending approval 或项目治理对应的待审批状态存在。不得标记 ready、accepted 或 active。

本轮验证要求：

- git diff --check；
- git status；
- 确认实现代码、migration、.env.local、SQLite retained data、Provider registry、Feed API/UI 均未被本 proposal 修改；
- 不执行任何 external Translation/Feed/AIS/Voyage/Weather call。

## 25. Final proposal conclusion

- Base SHA：8490868ea707db37a8799142dcea1edb03b0f1b4
- Plan path：docs/plans/inbox/shipping-hot-translation-t3.md
- Plan status：draft，等待人工架构审批
- 当前 architecture：Feed 原文先持久化，Event/HOT 继续消费原始事实；Translation 通过 server-only Service/Provider/SQLite cache 独立存在；当前没有 Translation Runtime。
- T3 scope：只做 current FeedItem title/summary 的异步 DeepSeek enrichment、provider-free API display 和后续 UI。
- Candidate mechanism：独立 Translation Runtime periodic scan，复用 feedTranslationSources()/isFeedItemTranslationEligible()。
- Queue/state：无 external queue；使用 translation_cache + durable lease/retry metadata proposal；schema v11 对完整 T3A 不足。
- Migration：本轮 none；T3A 前置 minimum additive migration required，待人工批准。
- Durable owner：T3A 仅由 Translation Runtime + TranslationRepository 持有 work-state；TranslationService.execute() 只做 execution/domain processing，现有 translate() 仅作 T1/T2 compatibility。
- Lifecycle API：claimTranslationWork、completeTranslationSuccess、completeRetryableFailure、completeNonRetryableFailure、recoverStaleLease、requeueTranslationFailures；T3A production path 不依赖 generic save()。
- Atomicity/crash：cache finalization 与 per-call usage 在同一 Runtime transaction boundary；claim/finalize/stale recovery 对应 A/B/C/D crash windows，unknown external request 默认不自动重试。
- Pending lease/recovery：45s lease；stale pending 以 provider_attempt_unknown non-retryable recovery，避免未知外部请求的自动重复计费。
- Runtime：translation-sync，60s，5 fields/run，concurrency 1，20s request timeout，bounded/no storm。
- Retryable：rate_limited、provider_timeout、provider_unavailable。
- Non-retryable：auth_failed、provider_forbidden、entitlement_missing、provider_contract_changed、provider_attempt_unknown。
- provider_contract_changed：fail closed、request/failure +1、estimated cost=0 unknown、停止当前 run、禁止自动 retry，等待 review/requeue。
- Controlled requeue：server-side bounded limit<=100，仅对显式 provider/model/sourceHash/errorCodes 且仍 eligible 的 rows；配置类错误需 harmless test + operator approval，contract/unknown 需额外 review，绝不由 interval 自动 requeue。
- Provider circuit：auth_failed、provider_forbidden、entitlement_missing、provider_contract_changed 写入现有 provider_runtime block；provider_attempt_unknown 只阻断当前 row；clear block 不调用 Provider、不自动 requeue。
- Budget：hard pre-call gate；monthlyBudget 是 local estimated USD ceiling；unknown cost 不伪造账单。
- source_scope：literal feed/translation_test，同小时不同 scope 为 mixed，只作 informational。
- Feed DTO：保留原始 title/summary，新增 displayTitle/displaySummary/status；推荐 API-only read model。
- Feed GET：provider-free，batch translation-cache lookup，无 N+1，不调用 DeepSeek。
- Event/HOT：完全隔离，继续使用原始事实。
- Disabled/budget exhausted：停止新 call，但已有 successful cache 可继续展示；无 cache 则原文。
- Milestones：T3A Runtime Foundation -> T3B Feed Read -> T3C Feed UI -> T3D Live Acceptance。
- Live gate：T3D 前必须完成真实 DeepSeek harmless verification；当前仍 pending。
- Tests：74 项矩阵，新增 ownership、execution-only、atomic lifecycle、crash recovery、controlled requeue、provider circuit block/unblock 覆盖。
- Secret changes：none in this proposal。
- External calls：0 in this proposal。
- Blocker：T3A durable retry/lease requires approved additive migration and runtime accounting change；本轮只完成 architecture review repair，未实现任何 lifecycle/circuit code。
- Open decisions：见第 23 节，等待人工架构审批。

Translation T3 Architecture Review Repair 已完成并停止。
Plan 仍为 draft。
未开始 T3A 实现。
未创建 migration。
未修改生产代码。
未执行 DeepSeek 外部调用。
等待人工最终架构审批。
