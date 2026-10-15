# materials.ts 有界差异核对（实施前）

核对起点 `0780da4e7d36bdffbf0114e7079d0511679fb69f`；固定本地 AIHOT `44578fa11da55f2e863900752653e0c221f6cf70` 的 `packages/backend/src/content/materials.ts`。本核对没有网络、抓取、LLM、迁移或生产操作。

| 上游职责 | Shipping HOT 现状 | 本轮处置 |
| --- | --- | --- |
| 单一写入入口/upsertMaterial | IntelRepository.writeEntry，collector/manualSubmit复用同一写入；ArticleRepository另属FeedItem正文 | 已有，不新建material表或写入服务 |
| identityKeyFor/URL身份 | intel按source+canonical URL；Feed正文按feed_item_id；两者没有自动关联键 | 保留已批准身份合同，不做上游全局跨源去重或按URL自动桥接 |
| contentHash/不可变历史/去重 | 两个Repository各有既有内容hash与版本；intel支持A→B→A恢复指针/变化审计 | 已有，不重写hash、存储、损坏字符模糊去重或历史baseline |
| 事务并发与发现审计 | SQLite BEGIN IMMEDIATE；first/last seen、fetch runs、manual request/version审计 | 已有，不复制Postgres事务/第二审计机制 |
| 来源与原文 | Feed ArticleState有original/canonical URL；intel item仅持久化canonical URL，source记录产品URL | 不能宣称原始wire href已保存，不能把Feed正文存在当成intel正文可读证明 |
| 时间线/回填/历史排除 | intel保留unknown日期、版本source时间/dateEvidence；上游48h/未来1h、heat规则不同 | 不移植时间阈值或R3/R4判断。现有source_updated_at列尚未由IntelVersionRecord暴露，可最小补读映射，无迁移 |
| 正文/摘要/metadata与获取状态 | 既有contentScope/licensedBlocks和manualPersistenceFor；Feed ArticleService专属显式抓取；intel存有collector/manual版本blocks | 只读已存许可内容；无正文时不启动抓取、不从Feed同URL隐式补入 |
| 作者/语言/media/X/import等上游特性 | 当前intel模型并非上游完整articles模型 | 不增加字段/迁移/渠道，不因上游文件存在扩大范围 |
| 精确版本供未来分析消费 | Repository能按item+version SELECT及读blocks；readIntelItem能按许可返回历史界面DTO，但要求H3Event、隐藏hash/extractorVersion，item标题属于当前版本 | 存在一个服务端材料读取合同缺口：精确选择旧版本、返回其身份/标题/来源及许可正文，且不依赖HTTP或触发写入 |

决定：仅新增 `readIntelMaterial` 读取适配接口，组合现有Repository五个SELECT方法、现有manual精确产品许可及blocks裁剪；有效许可仍是当前来源许可与已存版本范围的交集。将原HTTP许可等级交集提取到现有content-license共享，保持HTTP响应行为。读取成功不保证有正文：metadata-only明确返回null正文；缺item/source/version、缺版本内容或存储失败返回可识别代码。必须显式指定versionId，禁止默默改用current或FeedItem正文。

这个接口是Shipping HOT本地缺口适配，上游materials.ts没有等价的独立读取函数；不会宣称移植了上游写入文件。需通过旧版本/来源身份、九种许可组合、manual旧审计与产品范围、缺失/失败及query_only无网络/无写入测试，再以干净代码SHA运行完整门禁。
