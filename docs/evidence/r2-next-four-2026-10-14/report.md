# 下一四项目录核查与 Thai 文件日期回放 — 2026-10-14

目录四URL均与下达清单一致，无差异；只读扫描现有docs/evidence JSON没有这些ID的既往HTTP响应记录，没有重复已完成源。原始抓取基线39f2882a9bdeb2c8cffab30afdf3c3d9abf7a8e3，实际08:33:16.379–08:33:17.702 UTC；**本批实际HTTP1**，每源最多1GET、DNS/TLS/SSRF固定地址入口不变，redirect/retry/detail/interface0。没有更改Clash/DNS/CA/系统配置，没有重抓Northport/Thai-C01或上一已完成三源。

| 源／精确目录URL | 本批HTTP | 结论 |
| --- | ---: | --- |
| VN-P03 https://saigonnewport.com.vn/tin-tuc | 0 | BLOCKED：现有secureFetchArticle系统DNS安全检查blocked_address；无响应/原页/解析，不称源本身不合格，不改路或重查DNS。 |
| VN-T01 https://idea.gov.vn/ | 0 | BLOCKED：blocked_address，未发送HTTP；无响应，不转访问moit.gov.vn。 |
| TH-C02 https://www.customs.go.th/list_strc_download_with_docno_date.php?ini_content=announce_160426_01&order_by=date&sort_type=0&lang=th | 1 | 200 text/html UTF-8，115531bytes；抓取hash d3569050a2f6be3f01a0a8cd9e62fd6c5c632520bc91956efefa679364f85ec7。完整原页100行，以下离线现有adapter回放通过。 |
| ID-T01 https://jdih.kemendag.go.id/ | 0 | BLOCKED：blocked_address，无HTTP响应；不换出口/CA/接口或扩资料。 |

三项阻断地址本批未单独留存，不能声称已确认fake-IP具体值/代理配置；只保留原始代码分类，不追加DNS或推断网站不可用。请求ledger在transport前reservation落盘；每个源result/failure分别保存，不因另一项失败丢证据。TH raw在解码/观察之前立即写本地；初始启发日期计数0是观察器未覆盖Thai月份，不是表格无日期。后续使用完整raw和已有Thai规则核实100条，未新增宽松解析规则。

## 最小代码及真实回放

代码 `2acfda4c8ddab3f8064d199bb3cfcf26873ff288` 仅增加一个默认关闭的TH-C02 HTML候选配置（persistence=disallowed→metadata_only）和4项作者自写合成测试，未加入活动registry，生产仍仅既有TMD/BMKG允许。无迁移/框架/调度器/Provider/付费/预算变化。

完整raw中唯一table.table-hover / tbody>tr，column3标题/详情链接、column4日期。**column4表头 วันที่เอกสาร 表示文件日期，column2是文件编号、column5下载计数**。复用thai_month_name/Buddhist，dateRuleBasis明确仅当地文件日，不是发布时间；day精度、timezone missing、publishedAt null。不把120/2569编号或计数当日期；详情只记录cont_strc_download_with_docno_date.php业务current_id链接，不访问详情/PDF。

精确SHA新克隆内，完整原字节decodeResponse→fromHtml→现collect→新隔离SQLite，首次100items/100versions；重复new0/revised0、versions100；只读重开逐项title/URL/完整dateEvidence及metadata_scope比较mismatches0，100个day/未知timezone/instantnull。注入离线raw transport两次，不是真实HTTP；过程/result先落盘再断言。完整结果见 ../r2-thai-document-replay-2026-10-14/ 。没有把派生骨架当raw，也没有选择条目消除真实冲突。

4项合成测试独立标注：同标题不同business query保留为不同条目、第4列日期与第2列编号/第5列计数分离、collector只存title metadata/重复无版本、同URL不同date/title继续fail-closed。所有既有规则/冲突保护保持，未重复实现月份或改日期算法。

## 门禁、许可、限制

干净代码SHA fresh clone frozen install/scripts/build/typecheck/lint全部rawexit0；13文件155定向、126文件1182全量通过/3既有Windows跳过；3个现有native/Runtime/Feed smoke退出0；源raw回放harness1退出0。保留DB及secret-file哈希前后一致；clone tracked code diff忽略行尾exit0。既有重复imports/Browserslist/chunk/loader/CRLF警告记录，不声称无警告。GUI/S7 NOT_RUN，本轮无UI/路由改动，过去视觉缺口仍保留。

未知原页再分发许可保持：TH完整字节仅本地ignored `.tmp/r2-next-four-2026-10-14-private/`及隔离clone取证，SQLite只metadata且本地；远端仅最多六个截短标题/业务链接/日期证据、hash、状态/步骤/报告，无完整HTML/正文/scripts/input/header/cookie/key值。原始字节可能含第三方标识/脚本，本地留存用于授权核验、不再分发；未承诺原始page敏感值全部删除，未打印秘密。敏感值扫描有synthetic阳性对照，只检查必要派生元数据，不当历史全库安全审计；不清理原页、DB、预览或其他残留。

本轮新增的是**一份实际原页的100条文件日期metadata离线回放有限通过**，不扩成发布时间/政策内容完整性、停工/航行警告覆盖或生产24h。三个BLOCKED尚无可回放原页，39公开源≥32/全源100%与整体R2仍未通过。Northport真实冲突FAIL、VN-P01无日期、前轮三源/Thai-C01有限回放范围不变。

下一最小缺口：三项blocked_address先交父核对是否要单独批准一次精确域系统DNS留证，再决定用户授权网络例外；本轮不自行读代理凭据/改Clash。其它目录源继续逐项，不能为通过率降低边界或用HTTP200替代字段验证。生产/24h/LLM/付费/merge/deploy/forcepush均未执行。

真实Neat Freak Closeout：installed inventory rawexit0，仅盘点、不安全审计；status/architecture与候选关闭/文件日期语义已同步，AGENTS/README/原计划无需命令或授权变更，未写memory。capture及replay JSON扫描阳性对照有效、值命中0；docs lint/diff无错误。六事实：代码changed-and-verified（离线）；本批有界观察/回放已留证、生产pending；文档changed-and-verified；规则verified-current未改；memory只读/范围外；workspace原页/DB/预览/旧残留保留、cleanup未授权。父复审pending、整体R2未通过。
