# Westports一次RSS取证与完整源条目记账

执行起点`3e3b2fc94c2965a96a5952b3ea29c035ed723c56`，产品代码仍`8d0993e4164dae0b7a7f96dc531b9aac92be54b1`。本轮信源 **DNS1 / GET1**，只访问已批准的精确RSS `https://www.westportsholdings.com/category/press-release/feed/`；不重试、跟随跳转、抓详情或改网络设置。本批之后已停止新信源请求。

## 真实原件与旧材料边界

旧证据明确`rawStructureFixtureRetained=false`，只有3条派生元数据，不能拼成XML。本轮按明确授权重新取证：2026-10-15T08:46:45.729Z开始，08:46:47.628Z收到 **200 / application/rss+xml; charset=UTF-8 / 36266字节**。完整原字节保存于本地ignored `.tmp/r2-westports-rss-2026-10-15-private/MY-P02.response.bin`，SHA-256 **`db9676f1167a48d5c36ad76364e6215221173eefb6874d16a77204a160befc8b`**。

安全DNS一次返回三个公网地址，既有入口校验并连接已验证地址，TLS开启，maxRedirects=0，无Location。哈希与10/13旧采集记录相同，但这不使旧3条派生成为完整原件，也不证明本次是新刊发内容或连续可用。[采集](MY-P02-capture.json) / [DNS与请求汇总](capture-summary.json) / [原命令输出](capture-command.json) / [旧材料边界](old-material-scope.json)。

## 10原条目与3有效记录必须分开

XMLValidator验证完整XML有效，1个RSS channel、**10个item**。其中原始pubDate最新为2026-09-28，channel lastBuildDate为2026-09-28T07:28:24+0000；channel时间不能充当文章新鲜度。

前7个item的`title`节点在原XML中确为空，Cheerio及独立XMLParser读取结果一致；它们包含5个2026日期项及2个2025-10日期项，保留原链接但不能从正文、URL、GUID或日期补造标题。后3个item有完整标题/链接/pubDate。既有正式`parseFeedEntries`明确`if (!title) continue`，因而本次规范化 **3条**，不是漏读10条的产品缺陷，也不是对原条目静默丢账。

**最新原始日期项：2026-09-28；最新有标题、可规范化的有效记录：2025-08-01。** 另外两条有效记录为2025-02-01和2024-11-08。因此继续 **R2-4 STALE**，不能因HTTP200、2026原始时间项、channel时间或字段回放通过而增加当前可用分子。旧“feed仅3条/全量最新2025”的措辞过宽，现更正为“10原条目中只有3条有效，最新有效2025”，STALE结论以完整原件重新得到验证。[10项处置记账](source-item-accounting.json) / [XML预检](xml-preflight.json)。

初次预检误以旧派生3条为原XML总量而失败；修正动态原条目计数后，首次回放又错误要求10项标题全部非空，在调用collector前失败。两者均是验收脚本假设错误，不是产品缺陷；未改parser或重抓。最终明确核对 **10 = 3有标题项 + 7空标题排除项**，将既有合同当作待验证事实，保留完整排除记账与原失败材料。[预检错误摘要](preflight-first-error.json) / [首次回放原输出](replay-command-first-error.json) / [首次结果](MY-P02-replay-first-error.json)。失败时创建的私有空库也保留。

## 正式collector与隔离SQLite回放

完整XML直接经既有解码、Feed parser、`collectIntelSource`与Repository，未截取、改写或用派生重建。仅隔离证据配置`enabled=false / persistence=disallowed`，不是正式候选、active seed或生产注册；沿用metadata-only标题块许可，不持久化RSS摘要/正文。

- 首次 **3 seen /3 new /0 revised**；SQLite **3 items /3 versions /3 metadata-only title blocks**。
- 重复 **3 seen /0 new /0 revised**；ID/完整标题/URL/源时间/版本/hash保持，仅lastSeenAt正常推进。
- pubDate原串全部秒精度、明确 **+0000 / +00:00**，独立updated缺失；既有sourceUpdatedAt按pubDate回退，未用channel时间替代。逐项核对原串、offset、UTC、完整标题及链接。
- readonly+query_only重开 **3条 /0字段差异**，item/version/block完整快照及DB字节hash不变，provider_usage不变。
- 回放实际系统DNS/TCP/global fetch均0，注入lookup/transport各2次只复读同一原件；详情、正文请求、LLM及付费调用0。

RSS既有`date_evidence`列仍null，原日期字面量/时区在私有XML及最小字段审计中留证，不新增迁移。[最终结果](MY-P02-replay.json) / [3条字段审计](MY-P02-field-audit.json) / [最终原命令](replay-final-command.json) / [隔离配置](MY-P02-isolated-config.json)。远端仅必要字段hash、日期、处置原因与计数，无完整XML、标题全文、摘要、正文或DB。

## 状态与交审终点

本地回放通过仅说明既有合同下3条有效记录的字段链；7个空标题源项仍是原始字段缺口。R2-4保持STALE，R2-5本地结果交主会话审查，批准资格仍NOT_RUN、分子 **25/39、23/34** 不自动增加，历史数值 **3/5** 不变；其他40源不改。若主会话认可该限定字段回放，R2-5至多可提议24/34，不能据此改变R2-4 STALE。

产品/适配器/目录/Runtime/依赖/工作流未改，完整产品install/typecheck/lint/test/build门禁 **NOT_RUN**；本批实际执行一次采集、XML验证、失败与最终离线回放、文档/归档核验及[真实Neat Freak](closeout.md)。GUI/S7、生产/24h本轮NOT_RUN，无启用/密钥/预算/付费/合并部署，原件、旧派生/失败、库与克隆全保留。按要求附[14项精简剩余阻塞及最小条件](remaining-blockers.md)，不因此授权后续试探。
