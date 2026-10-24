# ID-T02资格认可与CN-P02单次真实Location取证

执行起点`45d2296301bb85aa18a6e4a5e6509bfa854319b0`，产品代码仍`8d0993e4164dae0b7a7f96dc531b9aac92be54b1`。本轮只有文档/取证，产品没有改动，完整install/typecheck/lint/test/build门禁 **NOT_RUN**。旧代码门禁只按原范围保留，未当本轮新验证。

## ID-T02限定认可

主会话2026-10-15明确认可ID-T02本轮限定审查通过、无新增P2，批准 **R2-4 OK / R2-5 PASS**。累计 **25/39**（至少32，差7）、**23/34**（差11），历史数值诊断仍 **3/5**。分类为25 OK / 7 PARTIAL / 1 STALE / 2 BLOCKED / 4 NOT_RUN；字段为23 PASS / 2 FAIL / 1 PARTIAL / 8 NOT_RUN。

认可的是代码与执行过程证据，不称主会话独立重放私有原页、CI或24h通过。[前轮完整原页7条验收及更正](../r2-id-t02-finite-cn-p02-2026-10-15/report.md)保持原样：日期角色未知、时区missing、`publishedAt=null`、offset=null，原叶节点/date-class漏检已纠正，旧证据保留。默认关闭、metadata-only、无详情/脚本执行边界不变，当前13关闭候选、active仅TMD/BMKG且默认job off。

## CN-P02一次请求及真实Location

先核对目录精确URL **`https://www.sz.msa.gov.cn/`** 和[旧Location缺失审计](../r2-anchor-date-review-repair-2026-10-15/redirect-material-inspection.json)。旧302的207字节正文出现相对`/btatw23_atbp/bt`，但当时没有保存Location；不能将正文链接猜成跳转目标。本轮没有更改目录或网络设置。

- 2026-10-15T08:27:32.368Z开始，系统DNS **1次**，解析到公网`125.124.253.156`；连接复用已验证地址，既有SSRF/TLS边界保留，无自定义CA/凭据。
- 精确目录 **GET1次**，08:27:32.616Z收到 **HTTP302 / text/html / 207字节**。完整响应body SHA-256：`0636ef4de5a01c1744ea9e76e6dbb29b0668d130d6b7f349d1b2268ea73dd29e`，与旧body一致；旧记录不覆盖。
- 本次真实Location为 **`https://www.sz.msa.gov.cn/`**，header值SHA-256：`0830d1a040223df9f6c8d4a2b448a6254fe5d2e9890aedacd62ac19307ad6966`。解析后同主机HTTPS、无凭据/query/异常端口，但**目标与已请求原URL完全相同**。
- 追加GET会重复原请求，按零重试边界停止；**目标DNS0 / 目标GET0**。`maxRedirects=0`返回`redirect_limit`是禁止自动跟随的预期结果。本次只观察到一条指回自身的302，不声称已实测多跳循环或判断其服务端根因。

最终 **系统DNS1 / GET1 / 完整响应1**，没有自动多跳、重试、猜正文路径、抓详情/分页/其他来源或修改Clash/系统网络配置。上限2次不等于必须请求两次；没有新的不同目标获准访问。[请求结果](capture-summary.json) / [DNS台账](dns-ledger.json) / [真实Location条件决策](location-decision.json) / [原命令输出](capture-command.json)。原header记录与完整body只在本地ignored `.tmp/r2-cn-p02-location-20261015-private/`；远端仅Location脱敏后的公开origin/path（本例无query和凭据）、必要元数据与hash，没有全文/DB/Cookie/凭据。

## 结构与状态终点

没有获得实际列表或目标页面，因此栏目/标题/身份/日期结构核验 **NOT_RUN**，规范化记录/入库 **0**，没有parser/config/产品扩展或原件字段回放。CN-P02仍 **PARTIAL / NOT_RUN**，只新增本次真实Location证据；其他39源不改，分子只因ID-T02审定而变为25/39、23/34。

已完成[真实Neat Freak](closeout.md)、现役矩阵/status/交接同步与文档/归档核验。根保留DB/secret-file摘要不变，原件、旧失败/漏检、私有库及克隆全部保留，不清场。GUI/S7、生产/24h本轮均NOT_RUN；无LLM/付费/密钥/启用/持久化配置/合并部署。本项已停止，下一项应由主会话审查真实自指Location，决定是否需要新的官方精确产品依据或另一个有界范围，不重复本URL或猜路径。
