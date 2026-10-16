# SITC资格认可与ID-T02真实Location有界取证

执行起点`4ca3a77cd8cdb1be3c793052b7edff628cec0529`，产品代码仍`0a483dd18a2027c73bf950cc0b948c013e29cf09`。本轮只有文档/取证，完整产品install/typecheck/lint/test/build门禁 **NOT_RUN**；未复用旧门禁冒充本轮新验证。旧失败、原件、私有库及克隆全部保留。

## SITC独立审查的限定结论

主会话2026-10-15明确认可SITC本轮独立审查限定通过、未发现新增P2，并批准XX-K03 **R2-4 OK / R2-5 PASS**。当前累计 **24/39**（至少32，差8）、**22/34**（差12），历史数值诊断仍 **3/5** 单列。R2-4分类24 OK / 8 PARTIAL / 1 STALE / 2 BLOCKED / 4 NOT_RUN；R2-5为22 PASS / 2 FAIL / 1 PARTIAL / 9 NOT_RUN。

这是代码与执行过程证据认可。20条私有原页回放是执行线程在0a483dd下完成的本地验收，**主会话没有独立重放私有原页**；没有新增实网、CI通过或24h通过的结论。[原实现与执行证据](../r2-sitc-metadata-2026-10-15/report.md)和[原代码门禁](../gate-0a483dd-sitc-metadata/summary.json)按原范围保留，不修改旧pending时点报告。默认关闭、metadata-only、未知时区及HTTP正文/HTTPS降级安全边界不变。

## ID-T02精确请求与真实Location

目录仍为`https://jdih.kemenkeu.go.id/`，未改目录。先读取[旧307记录](../r2-four-reapplied-2026-10-15/ID-T02-response.json)及[旧Location缺失审计](../r2-anchor-date-review-repair-2026-10-15/redirect-material-inspection.json)：旧正文仅`/home`，无已保存Location，不能据此推导绝对目标。本次完整原字节仅保存在本地ignored的`.tmp/r2-id-t02-location-20261015-private/`。

| 请求 | 真实结果 | 原字节/hash |
| --- | --- | --- |
| 原目录，07:37:46.846Z开始、07:37:48.414Z接收 | 公网安全DNS1 / GET1，HTTP307；真实Location为`/home`，解析为同主机HTTPS目标，无凭据/query/异常端口/fragment | 5字节；`2cc974af6afc822c42a4e914df05c697348b80420941f6b27561b2bf688587b7` |
| 仅一次明确目标`https://jdih.kemenkeu.go.id/home`，07:37:48.417Z开始、07:37:48.920Z接收 | 再次公网安全DNS1 / GET1，HTTP200，text/html; charset=utf-8，无下一Location | 212037字节；`be6dd13c7c42b55e6c5526fd88dd00c2c8fcc4f7a1526929c713725776bd8d2b` |

合计 **系统DNS2 / GET2 / 完整响应2**，预算用尽。每次都通过现有`secureFetchArticle`/`defaultTransport`，连接只用已校验地址，TLS验证开启，无自定义CA/HTTP/凭据。两次调用均`maxRedirects=0`，第一调用的`redirect_limit`是禁止自动跟随的预期返回；原307与真实Location先保存，再经显式条件审计发起唯一目标调用。没有自动多跳、重试、猜/home、搜索链接、详情/分页/feed请求或其他信源请求，没有修改Clash/系统网络配置。[请求汇总](capture-summary.json) / [DNS台账](dns-ledger.json) / [Location决策](location-decision.json) / [原命令输出](capture-command.json)。

## 仅结构观察与适配差异

对保存的目标HTML做离线Cheerio读取，没有执行网页脚本或浏览器挂载。观察到`.jdih-recent` **16个DOM卡片节点**，分为四组各4个，均处于带hidden属性的流式片段`S:1/S:2/S:4/S:5`。按原URL身份hash，第一/第三组、第二/第四组分别重复；一共 **7个不同文档身份**。这些是结构计数，**规范化记录0、SQLite入库0**，不等于16条或7条已验收业务记录。

每张卡片的外层`a[href]`为同主机HTTPS `/dok/...`身份，`span.title`是法规标识，`p`是较长描述标题；它们不能简单合并成一个标题字段。16卡片内没有明确time/datetime或date-class日期字段，法规标识中的年份不能当发布日期。其他脚本数据/发布日期语义没有评估，日期精度、时区和发布时间瞬间保持unknown/null。完整身份与标题仅在私有观察文件，远端只存字段hash/结构计数。[最小结构证据](structure-observation.json)。

当前没有ID-T02正式候选/config。目标首页混有导航和重复卡片，泛用`a[href]`会混入无关/重复条目；需要先审定栏目范围、标识/描述标题及日期来源，再讨论有界适配。本轮未实现parser/config、去重规则、日期推断或collector/SQLite回放，未请求页面出现的RSS/Atom/JSONfeed、文档或其他链接。ID-T02仍 **PARTIAL / NOT_RUN**，只有SITC批准升级使累计变为24/39、22/34，其他39源条目保持。

真实Neat Freak与文档一致性校验见[收尾](closeout.md)。GUI/S7、生产/24h本轮均NOT_RUN；不改迁移、registry/启用、密钥、预算、付费或LLM，不合并部署。下一项建议是主会话先审这份结构及适配差异，确定是否以及如何继续ID-T02，执行方不自动扩展实现或再取证。
