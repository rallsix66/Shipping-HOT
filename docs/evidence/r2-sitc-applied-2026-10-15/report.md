# SITC主站：27项核验后的真实列表与既有适配边界

执行起点 `e37c5e49c0c90d69663af3c5f45f347bfc8326f4`，产品仍 `bebe1441465adfcabb9daf93cb2a8656ec1fc796`。用户于2026-10-15T06:30:48Z确认已保存/应用；先[只读确认](clash-applied-verification.json)扩展/生成fake-ip-filter均27项、原26项顺序保留、`www.sitc.com`各出现一次。未写系统设置，未重查无法恢复的旧全文；旧生成文件额外字节差异未知限制沿用，不宣称全配置相同。

## 一次真实采集

精确目录URL `https://www.sitc.com/en/list.asp?classid=44`，2026-10-15T06:32:47.777Z开始，06:32:48.737Z收到 **200 text/html; Charset=utf-8，38839字节**。本批 **安全DNS1 / GET1**，全部DNS地址公网、连接固定到本次已校验地址，正常HTTPS/SNI/证书检查；无Location、跳转或重试，越南站/详情/分页/其他来源0。

完整原字节仅本地ignored `.tmp/r2-sitc-applied-20261015-private/XX-K03.response.bin`，SHA-256 `2f590a0f00dbe6f6cacc98102775942c42d288995c69206c0d33b46b99afe7c4`。[DNS](dns-ledger.json) / [请求](request-ledger.json) / [状态/hash](XX-K03-capture.json)。原[e37c5e4 DNS阻断](../r2-sitc-index-2026-10-15/report.md)不改，不再当当前连通性结论。

## 原页结构与忠实字段观察

页面标题为 `News_SITC International`。唯一`#content`内有 **20个`.media.row-fluid`新闻卡片**，每个自身`h4.title.media-heading > a[href]`提供标题与链接，`ul.meta > li`提供原字段`发布日期: YYYY.MM.DD`。排除导航、图片链接和Details；没有请求任何链接。只保留标题可见原文，不补造被截短的标题或不存在的title属性，也不把公司活动新闻当港口影响。

[字段观察](field-observation.json)记录全部20项标题/原链接hash、原日期字符串及现有规则返回；完整标题/URL对应只在私有`XX-K03-exact-field-audit.json`。没有复制摘要/正文到远端。

- **20个源站原始标题链接全部为`http://www.sitc.com/en/show.asp?id=...`**，20个身份各异。没有去详情验证HTTPS，也没有把协议擅自改成HTTPS。现有`web-list.allowed`固定只接受HTTPS，因此全部返回false；这不是GET失败或来源页面无效。
- 原日期例如`发布日期: 2026.09.20`，没有时钟或时区。既有`parseLooseDate`对完整原串和单独点分日文字均返回`unsupported_format`；保持原串、precision unknown/timezone missing、localDate/publishedAt/offset null，不替换分隔符、去标签后冒充已支持或猜UTC。

这是**有效源页面与当前通用适配合同不兼容**，不能只增加选择器配置就得到合格入库。本轮授权的最小站点配置不包含放松既有HTTPS链接边界；也不能据此把来源本身判作无效或把通用适配当额外业务硬门槛。此差异交父审，不修改parser、日期规则或安全语义，不加入生产候选/registry。

## 完整原字节到既有collector的隔离负向核验

只用本次完整原字节、现有解码/`fromHtml`/`parseLooseDate`/`collectIntelSource`/Repository，隔离配置`enabled=false / persistence=disallowed`（metadata_only上限），配置仅用于证据，不是正式站点候选。[隔离配置](isolated-config.json) / [结果](compatibility-result.json)。

直接parser返回`web_list_no_allowed_items`；首次和重复collector都返回`failed / parse_failed / itemsCommitted0`，两条`intel_fetch_run`错误均为同一明确原因，new/revised均0。SQLite **items0 / versions0 / blocks0**，provider_usage无变化。readonly+query_only重开后空业务表与DB字节hash一致。实际TCP/DNS/global fetch均0，注入transport两次只是离线复读原件。

**这不是正向字段验收PASS，也不是成功空列表。** 没有业务记录可核对，不能把0新增/0修订或空表重开一致包装成20条字段通过。正向入库/日期字段验收未完成；本轮只核实真实卡片字段和现有合同拒绝行为。

首次离线核验脚本误用了不存在的表名`intel_source_run`，已修正为实际`intel_fetch_run`，不改产品代码。原[失败命令/输出](replay-command.json)、[初始过程](replay-first-procedure.test.ts.txt)与私有失败库均保留；[修正后离线命令](replay-command.final.json)rawexit0。没有重抓原页或重试网络。这个脚本错误与真实HTTP链接限制分别记录。

## 资格、门禁与下一步

仅XX-K03更新真实200、字段观察和兼容性负例。可提出“本源可读、有20真实卡片但当前适配受阻”的**PARTIAL建议待父审**，不自动变更既有批准的NOT_RUN资格。其他40项条目与当前计数 **23/39、21/34、历史数值3/5**保持；不是整体R2或24h证明。

下一步需要父审决定原HTTP链接能否在metadata_only中忠实作为身份保存（同时页面获取仍HTTPS、无详情外呼），以及明确的`发布日期: YYYY.MM.DD`源日期规则；或者提供源站实际给出的可核验HTTPS身份依据。现有拒绝HTTP语义不可悄悄放宽，不能猜或批量替换协议，不能凭国别补时区。本文只给出具体差异，不实施规则变化或新请求。

本轮采集harness rawexit0和最终兼容性负向harness rawexit0不代表来源字段通过。定向文档/引用/hash验证、Markdown lint、正常提交钩子与真实Neat Freak单列。产品代码无改动，干净SHA产品install/typecheck/lint/full Vitest/build、GUI/S7/24h **NOT_RUN**，不继承成新门禁；无迁移/生产/LLM/付费/merge/deploy/force-push，所有现场保留，待父审。原自动导入/固定wrapper DEP0190提示保留。
