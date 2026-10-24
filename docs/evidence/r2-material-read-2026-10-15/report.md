# Intel 许可材料精确版本读取 — 2026-10-15

代码`954c831f27eff4fd4382a0ea68be3894de053759`，独立审查 **pending**；上轮Readability代码`c7ba3c62786a7554aeaf92ce9e4d9809fd137754`已获主会话限定审查通过、未发现新增P2，[认可范围](readability-acceptance.json)。计数仍25/39、24/34，历史数值有限诊断3/5，整体R2/实时/24h未通过。

## 有界差异与实施

先完成[逐项职责映射](audit.md)，固定AIHOT@44578fa的materials.ts仅从已有本地clone读取，[原文件hash/导出职责](upstream-reference.json)。上游upsertMaterial的写入、身份、hash、版本、事务、发现审计在现有Repository/collector/manualSubmit中已有对应能力；不因文件名缺失复制第二套存储。上游全局跨源identity、48h时间阈值、模糊损坏字符去重、X/media/import等不移植。

确有一个内部读取合同缺口：现有readIntelItem返回H3界面DTO，虽可按旧版本许可读blocks，却没有hash/extractorVersion等材料身份字段；ArticleRepository只属于FeedItem，不能证明intel_item材料读取衔接。新增唯一`readIntelMaterial(repo,itemId,versionId)`组合现有五个SELECT接口，版本ID必须显式提供；不回退current、不按URL桥接Feed正文。返回所选版本的标题、原存canonical/source产品URL、版本ID/hash/extractor及原source时间/dateEvidence、许可blocks和bodyText。缺记录/跨item版本/缺历史标题/存储失败有明确代码，不吞成空成功。

当前source许可∩已存version范围决定contentScope；manual继续经独立精确source/item/version审计查询及manualPersistenceFor，超出已验证Feed产品的同域页面仍metadata-only。metadata-only正文null，excerpt最多280字符，全文只读已存blocks；已存full但只有标题时正文也明确null，不启动抓取。原许可等级交集函数提取到现有content-license供HTTP和内部适配共享，原HTTP响应行为不变。仅补映射已有source_updated_at列到IntelVersionRecord；没有迁移、写入、版本改写或新字段存储。

contentHash保持**原存储版本身份**，不是裁剪后body的重新计算hash；storedContentScope与有效contentScope分列，不因裁剪改版本。intel只保存canonical URL，不能声称恢复了原wire href。接口是**内部存储材料读取**，不是可直接对外的HTTP/模型DTO：原来源/dateEvidence如实读取，既有HTTP脱敏仍在原适配层，R3外发模型输入合同本轮不实现。FeedItem正文与intel_item之间没有新增桥接/正文自动物化，不能宣称任意Feed全文已供intel分析。

## 验证

24个新增离线用例覆盖精确旧标题/正文/来源/hash/原source时间，九种当前与存储许可组合、unknown日期、标题单独存在、manual旧审计超20条、同域非产品旧full版本限权、缺item/source/version/标题、跨item版本、五个SELECT依赖失败、非法/缺版本ID。每次读在query_only=ON下执行，仅允许SELECT；native序列化数据库字节hash前后不变，fetch/TCP/DNS尝试全部0。原存版本与hash不改；没有额外存储或取正文路径。

全新clone正常`pnpm install --frozen-lockfile --offline`含scripts（已有官方包缓存，不用旧node_modules/手工native），Node24.15.0/ABI137、pnpm10.30.3；build/typecheck/lint、134定向、1338全量通过/3跳过及三个隔离SQLite smoke，9命令raw exit全部0，测试源码diff为空。[门禁](../gate-954c831-material-read/summary.json) / [结果](result.json)。定向含既有HTTP/manual/collector/chain/ArticleRepository/ArticleService等回归，A→B→A和审计沿用原测试证明，不重建实现。根三保留DB和Secret文件hash与上轮及门禁前后一致。

早期测试辅助代码曾因本项目原生类型省略serialize及声明顺序导致类型/提交hook失败，hook正常阻止提交；仅修测试签名/顺序后通过，记录见[预检查历史](precheck-history.json)。不将这些失败记为通过。

业务信源DNS/GET、新增真实记录、LLM/付费均0；软件参考本地读取0请求、依赖离线安装。仅交付阶段按授权使用GitHub协作接口/正常push。无新依赖、迁移、来源配置/许可扩大、网络设置、R3模型、生产/24h、合并部署。没有UI/route行为变化，GUI/S7未重跑且既有pending保留。待主会话审查；下一项可先核对未来分析消费者如何显式选择该版本材料，仍不越过R3模型/预算边界。本轮复核现场全部保留，无清场。
