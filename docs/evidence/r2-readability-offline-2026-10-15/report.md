# Readability 正文抽取离线切片 — 2026-10-15

代码 `c7ba3c62786a7554aeaf92ce9e4d9809fd137754`，主会话独立审查 **pending**；执行交审完成不等于整体R2通过。Westports限定认可已独立落地，当前R2-4 **25/39**、R2-5 **24/34**，历史数值有限诊断 **3/5**。本切片不改变任何来源资格。

## 实现和边界

- 依赖的专门批准已有：ADR-007/008、9.29方案§5.4及2026-09-30确认；首次使用从官方npm registry加入精确版本@mozilla/readability0.6.0、linkedom0.18.13，未添加其他直接依赖。固定软件参考AIHOT@44578fa11da55f2e863900752653e0c221f6cf70的content/extract.ts，MIT许可与文件改编头保留，[参考字节/来源hash](software-reference.json)。上游未发现extract/readability专用测试文件，新回归均是本地编写，不宣称搬运了上游整套测试。
- 唯一入口仍是server/providers/article-extractor.ts。显式source container优先，缺失/无内容仍结构失败，不回退整页；无container的通用HTML走惰性linkedom DOM→Readability（charThreshold200、keepClassesfalse）→已有ArticleBlock walk。先移除页面base，用现有安全fetch提供的最终URL设base；不执行脚本、资源/详情加载或增加抓取器。Jina、X、上游SQL/独立material存储不引入。
- 现有heading/paragraph/list/table/caption转换、表格行、段落首个安全链接语义、source completeness和内容hash合同保留。Readability负责正文选择及标题去重，标题作为既有title返回；其输出回到同一block转换，绝非保证保留整页所有DOM。通用结果少于200字符或解析失败为source_unavailable；显式短容器仍按原source规则标incomplete。语言只读原html lang，不猜。
- extractorVersion更新为article-extractor-v2-readability；不改既存版本，不将extractorVersion塞入内容hash，显式容器同内容复跑不新增版本。ArticleService仍是唯一已有显式安全抓取/写入编排；许可裁剪后才写库，disallowed不抓正文，excerpt_only最多280字符。intel collector既有metadata-only只写标题的规则保持。没有新增intel详情获取、自动正文物化或Provider；SSRF/TLS/许可配置均未改。

## 验证

第二份全新clone、Node24.15.0/ABI137、pnpm10.30.3，正常frozen install含scripts；build/typecheck/lint、124定向、1314全量通过/3跳过、p0-native/p2c-runtime/p3-feed-freshness三个smoke，9命令原始退出码全部0，测试源码diff为空。[完整门禁](../gate-c7ba3c6-readability/summary.json) / [结果](result.json)。定向11文件覆盖唯一extractor、ArticleService、secure fetch/transport、Repository、翻译只读/版本、intel metadata-only和默认关闭Runtime。

14个新增离线用例覆盖通用正文/导航干扰、中/泰/越原文、标题/列表/多行表格/安全链接、脚本与资源不执行、恶意base、空/短页/解析失败、显式容器缺失及旧完整性合同；调用链覆盖幂等、历史版本只读、失败保留最后版本、v1元数据版本不强制修订、excerpt许可裁剪。所有内容为合成固定HTML，不是新增真实来源验收。根3个保留SQLite及Secret文件hash与前轮Westports基线及本轮门禁前后一致。

首份代码0a511c0在正常install/build通过后typecheck退出2：Cheerio泛型和linkedom Window的Node类型声明。最小修复保留原惰性parseHTML流程，通过Cheerio设base并窄化document类型，不扩大全局DOM配置。[失败门禁原件](../gate-0a511c0-readability/summary.json)及全部日志保留，后续不是接着旧node_modules拼装通过。另有早期测试列表分隔符预期误写?而非既有•、初次lint入口未能执行及格式错误，均已修正；这些不记为通过。

## 尚未验证

业务信源DNS/GET、LLM、付费调用均0；仅读取批准的软件GitHub固定源码和官方registry以取得依赖。没有新来源请求、真实文章质量验证、UI/route改动、GUI/S7重跑、生产配置/24h、merge/deploy。既有GUI/S7待验和R2总体缺口不变，候选与Intel job默认关闭。启发式Readability对真实来源的适用性须以后按许可、有界批准另验，不把合成用例等同全源可用性。

下一项先由主会话审查本代码/证据，再核对9.29§5.3材料/版本链剩余缺口，优先继续零业务上游的有界离线工作；未经新授权继续停止信源探测。原XML/失败/临时库/克隆全部保留，无清场。
