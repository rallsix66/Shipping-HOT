# R2 四源重新应用后核验与VN-D01适配 — 2026-10-15

用户重新应用当前本地订阅后，只读确认生成配置原17项+4项精确例外，共21项，当前脚本与获批文件一致。本轮没有修改网络设置。采集时HEAD50da3805ee14e72222a4e26f4230073cf1842bc7（产品355bc86），新增适配/离线回放/干净门禁对应完整源码SHA **9ec4a2dd4e6a76657ec3ed2a6dabb15187b4d5a8**，后续文档提交不是源码测试SHA。

01:16 UTC四源各一次系统DNS，全部公网；同一批已验证地址注入原安全入口并固定transport，不重复DNS。每源仅一个精确目录索引GET，共HTTP4；保留TLS/SSRF、512KiB上限、10秒时限，未跟随跳转、重试、迁域、分页、详情或隐藏接口。原字节在响应后、解码前即时留存在本地ignored目录。

| 来源 | 系统DNS公网地址 | 精确索引响应 / 原字节 | 本批结论 |
| --- | --- | --- | --- |
| CN-P02 | 125.124.253.156 | 302 / 207 bytes | PARTIAL；redirect_limit，未跟随，列表字段NOT_RUN |
| VN-D01 | 103.9.86.254 | 200 / 183913 bytes | 有限原页字段PASS；4条关闭候选 |
| MY-L01 | 23.56.0.78、23.56.0.83 | 200 / 124208 bytes | PARTIAL / 原页适用性FAIL；10张卡片标题链接均无href |
| ID-T02 | 103.196.166.252 | 307 / 5 bytes | PARTIAL；redirect_limit，未跟随，列表字段NOT_RUN |

[21项配置只读核验](applied-config-check.json)、[系统DNS台账](dns-ledger.json)、[请求台账](request-ledger.json)、[逐源结果](summary.json)、[采集命令](command.json)、[过程](capture-procedure.ts.txt)。旧198.18阻断已被此批公网地址与实际响应取代，只作历史，不再作为当前四源阻断。

VN-D01唯一`.boxtopnews ul.news-headlines`中4条同锚点数据：`title`属性是完整标题，可见文本末尾是`(D/M/YYYY)`，可见标题有省略号。新增现有linkTextFormat的严格`title-dmy-date`模式，要求同锚点title属性和显式dmy，禁止混配其他title/date选择器；仅提取终端括号日期，缺失/非法时保持unknown，不搜索相邻文案。保存源显示列表日/day精度、时区missing/UTC瞬间null，不宣称灾害/停工或港口影响。候选enabled=false、persistence=disallowed→metadata_only，未加入active seeds或生产允许列表，没有迁移/Provider/框架。

完整私有原字节经现fromHtml→collectIntelSource→隔离SQLite：首轮4 items / 4 versions，重复new0/revised0；只读重开对全部title、canonical URL、published_at、完整dateEvidence及metadata_scope比较，0差异，4条时区missing/发布瞬间null。[完整原页回放](../r2-reapplied-raw-replay-2026-10-15/summary.json)、[过程与MY探针](../r2-reapplied-raw-replay-2026-10-15/raw-replay-procedure.ts.txt)。

MY-L01页面有十张真实卡片的标题与本地时间，但标题锚点均无href，唯一有href的类别链接只指向`/service-update`自身。临时适用性配置经真实原页/collector明确`parse_failed/web_list_invalid_link`、写入0，未加入永久配置。日期原文如`07 Oct 2026 06:30 pm`也不在现严格语法内，保持unknown；没有从隐藏状态/JS/API或标题猜详情URL。[原页失败证据](../r2-reapplied-raw-replay-2026-10-15/MY-L01-suitability.json)。探针harness退出0证明失败断言得到验证，不代表MY源通过。

干净新克隆、无旧node_modules、正常frozen install及scripts（未ignore-scripts）；随后build/typecheck/lint、15文件190定向、128文件1217全量通过/3既有Windows跳过、3个隔离smoke全部raw exit0。新增17项合成边界与真实原页回放分开。测试后源码diff0，根保留数据库/secret-file摘要不变；计数/摘要不变不能单独证明无外呼。[精确SHA门禁](../gate-9ec4a2d-reapplied-four/summary.json)。

当前累计 **R2-4 20/39（51.28%，距32差12）**：20 OK、11 PARTIAL、1 STALE、7 NOT_RUN；**R2-5 12/34**：12 PASS、4 FAIL、1 PARTIAL、17 NOT_RUN。数值有限历史诊断仍3/5，41项库存和批准分母不变。[当前41项矩阵](../r2-current-source-matrix-2026-10-14/mapping.json)。Westports最新保存日期2025-08-01仍STALE；Northport冲突、VN-P01日期、NMC适用性、XX-W02 specifications及VNSGN原点/独立参考限制均保留。

未知许可完整HTML/redirect字节只在`.tmp/r2-four-reapplied-2026-10-15-private`，远端为必要脱敏metadata/过程/hash，不能重建完整原页。没有更新/提交系统配置、启生产、24h、付费、LLM、GUI/S7、merge/deploy/force-push。GUI/S7本轮无UI/路由变化而NOT_RUN，原GUI验收仍pending。[真实Neat Freak收尾](closeout.md)、[目录盘点摘要](inventory.txt)。stdout/stderr完整字符串及摘要在各command JSON，展示日志仅去尾部空行。

[只读源码与证据核对](../gate-9ec4a2d-reapplied-four/source-proof.json)确认7个源码/工具链文件与测试克隆一致、4份私有原字节的长度/摘要与响应记录相同且被Git忽略；没有为此新增请求或重跑功能测试。
