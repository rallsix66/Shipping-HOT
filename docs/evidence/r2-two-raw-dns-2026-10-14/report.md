# 两源完整原字节离线回放及四域 DNS — 2026-10-14

代码沿用 e5d2f0bb0aa4651984d69d280db0c2485d9467a2，起点3f76a414c9152a2b0f17183f8294de4a47256c52。**产品代码、现有候选配置、日期算法均未改；本轮HTTP0，四域系统DNS各一次。**

## 完整本地原字节回放

使用上一批忽略目录中两份完整 response.bin，先对抓取SHA256，再经现有 decodeResponse/fromHtml/collectIntelSource→新隔离SQLite文件→重复收集。每源 adapter、首次、重复及异常结果先落盘，再统一断言；一个源FAIL没有中止另一个源留证。enabled=false、persistence=disallowed，只有注入原字节 transport，未使用真实transport；原始日期证据按 metadata_only 落库，没有生产启用。harness2通过，rawexit0；不等于两源可用性PASS。

| 源 | 真实原字节 SHA256 | 结果 |
| --- | --- | --- |
| MY-P03 | 880e1a180dc686d9d9d71578a753ee87af24042563a7c58f82c0885f8d3c5691 | 与10/13 fetch-results/duplicate-link-observation完全同哈希。现有 .div-article-main2 / article.card2 / 前缀日期配置首次与重复均 web_list_duplicate_conflict，itemsCommitted0，items/versions均0；只读结构审计保留2个真实冲突组，未挑选或消除冲突。源验收仍FAIL。 |
| TH-C01 | 96349dcd1383c8ed1e33b9ad7905f5355f4a6ff9c5528e065e13a09aae30398c | 现有 table.table-hover / tbody>tr / 第3列title/link、第4列date / thai_month_name / Buddhist 配置解析100条，首次100 items/100 versions；重复新增0、修订0、仍100 versions。只读重开SQLite检查全部100条完整dateEvidence+title+URL+metadata_scope，mismatches0。localDate范围2026-08-27..2026-10-13；100条day precision，publishedAt全部null，未发明时间或时区。只是此原页的离线回放有限通过，不计全P1可用性PASS。 |

首个回放结果的 allStoredDateEvidenceMatches 在 Northport空行上为true属于空集合统计，**不作成功证据**；后续storage-and-conflicts-audit用非空100条验证Thai完整日期JSON，并明确Northport0行/2冲突组。

原字节再分发许可未知，完整HTML仍仅本地忽略目录，隔离DB含必要metadata且也仅本地；提交源级结果、最多六条截短标题/关联日期、冲突元数据及过程文本。远端材料不是完整raw，不能远端独立重建原页。存档hash/抓取hash分离，原字节本地可按hash核实。未知许可/敏感值边界沿用上一批：不提交脚本/属性值/cookie/key或完整正文，不打印秘密，不清理旧残留。

## 四域一次系统 DNS

2026-10-14 07:30:18.927–07:30:18.939 UTC。调用 node:dns/promises.lookup(hostname,{all:true})，不换解析器、不读代理secret、不发HTTP、不改Clash。

| 域名 | 系统返回 | 现有isBlockedAddress分类 |
| --- | --- | --- |
| www.gd.msa.gov.cn | 198.18.2.24 / IPv4 | blocked_address |
| szs.mof.gov.cn | 198.18.2.25 / IPv4 | blocked_address |
| vimawa.gov.vn | 198.18.2.26 / IPv4 | blocked_address |
| customs.gov.ph | 198.18.2.27 / IPv4 | blocked_address |

均属于198.18.0.0/15基准测试地址段，符合常见代理fake-IP地址形态；**解析输出不能单独证明由哪个代理产生或当前Clash配置**。不声称已确认配置，交父判断是否需要向用户申请这四个准确域名的例外。不自行修改、白名单豁免或绕过SSRF；四源阻塞维持。上一批未保存DNS地址的缺口现在补为本次明确时间下的结果，不倒推上一批具体地址。

## 纠正上一轮下一需求

Northport article日期前缀、Thai第3/4列关联、泰文月份/佛历、同URL不同标题/日期fail-closed **已经实现**。上一报告建议重新实现这些规则是不准确的，已纠正。当前没有发现需要修复的产品代码缺陷，不能为清除Northport真实冲突改选择器。下一工作应由父基于本轮证据判断剩余来源核查/网络授权，而不是重做规则。本轮新增全P1可用性PASS0，39公开源≥32要求不变，24h/生产/付费/LLM/GUI/S7仍NOT_RUN。

验证：回放+DNS harness2通过，完整dateEvidence只读存储审计1通过；原始命令、stdout/stderr/rawexit均保存，三条断言不是新产品实现或全量门禁替代。代码未变，不重跑整组既有门禁。Neat Freak Closeout检查状态/历史需求指针和git，盘点不当安全审计；不清理原字节/DB/预览。

Closeout：真实Neat Freak inventory rawexit0、元数据敏感扫描阳性对照有效/命中0、文档lint及diff检查无错误。六事实：代码未改/既有门禁沿用；本轮离线运行和DNS事实已留证/生产未运行；文档纠正已核对；规则与架构未变；memory未写/本轮范围外；本地原字节/隔离DB/旧预览均保留、cleanup未授权。父独立复审待完成，整体R2不标PASS。
