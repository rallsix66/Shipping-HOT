# R2 41项来源累计证据 — 2026-10-15

材料读取离线切片：当前测试代码`954c831f27eff4fd4382a0ea68be3894de053759`，独立审查pending。先核对固定materials.ts，复用已有版本/去重/A→B→A/审计，仅补显式item+version的内部许可材料读接口，五SELECT、无Feed正文隐式桥接/抓取/写入/R3模型。24新用例，正常新clone离线frozen install含scripts及九命令全0，134定向/1338全量通过/3跳过；源网络/新增真实记录/LLM/付费0，25/39、24/34、历史3/5不变。Readability c7ba3c6已获限定认可。[职责核对/结果](../r2-material-read-2026-10-15/report.md) / [门禁](../gate-954c831-material-read/summary.json)。

前轮Readability离线切片：已认可代码`c7ba3c62786a7554aeaf92ce9e4d9809fd137754`（主会话限定审查通过、未发现新增P2；不证明实时/24h或整体R2），唯一article-extractor合入固定AIHOT Readability，显式container优先且缺失失败，原安全fetch/许可/版本合同不变。正常第二份新clone九命令全0，124定向/1314全量通过/3跳过；首份0a511c0类型门禁FAIL及原件保留。业务信源/LLM/付费0，无UI/route/GUI/S7/生产/24h。本轮不改25/39、24/34、历史3/5。[实现与限制](../r2-readability-offline-2026-10-15/report.md) / [门禁](../gate-c7ba3c6-readability/summary.json)。

Westports 已获限定认可：R2-4仍 STALE、25/39；R2-5按既有 parser 的3条有效记录回放 PASS，累计24/34。原XML10项、7空标题排除；原XML最高日期2026-09-28，有效最新2025-08-01，两个日期不可混同。此前待审记录保留为历史，后续停止新信源请求。[认可范围](../r2-westports-acceptance-2026-10-15/report.md)。

前轮Westports MY-P02（当时待审，现已限定认可）：单次DNS1/GET1原XML200/36266字节，10原项中7title源空、3有效，raw最高2026-09-28但有效最新2025-08-01，STALE维持；正式collector3/3/3、重复0/query_only字段0差异，限定字段PASS待父审，25/39、23/34、历史3/5不增，无产品改动/新全门禁。旧3是有效子集、不代表全XML；失败/原件留存，本批不继续来源请求。[本轮报告](../r2-westports-rss-2026-10-15/report.md) / [14项精简阻塞](../r2-westports-rss-2026-10-15/remaining-blockers.md)。

前轮SITC应用后真页（8be5bdd负例保留）：DNS1/GET1=200/38839字节，20卡片原HTTP链接与点分发布日期不符合当前generic合同；隔离collector明确拒绝、业务0，空表重开不作正向PASS。PARTIAL建议待审，原资格/23/39、21/34、历史3/5不改。[本轮材料](../r2-sitc-applied-2026-10-15/report.md)。

前轮SITC主站精确索引（e37c5e4历史阻断）：DNS1=198.18.0.64安全阻断，GET0/响应0，无原页/配置/SQLite回放；仅XX-K03追加尝试，原资格与23/39、21/34、历史3/5不变。[本轮阻塞](../r2-sitc-index-2026-10-15/report.md)。

前轮JMA归属修正（14b6548限定认可）：同一次targetTc404也是XX-W01精确目录产品，现OK→BLOCKED，23/39、21/34、历史数值3/5；BMKG doc新DNS1/GET1=200文件目录，无apidoc/KODE。其他38项条目不改、无新JMA/PAGASA请求。[本批依据](../r2-bmkg-doc-jma-attribution-2026-10-15/report.md)。

前轮用户应用后补证（32c8974遗漏由上段修正）：扩展/生成26/原23/新3核验通过（生成整体额外字节差异unknown），DNS4公网/GET4：PAGASA403两次、BMKG根目录200、JMA列表404；没有活动/数值正样本，条件追加0，资格计数不变。[本批事实与限制](../r2-official-gaps-applied-2026-10-15/report.md)。

前轮官方缺口探测（440affa保留）：四固定入口DNS4/GET0，全部198.18保留地址安全阻断，没有当前页面或JSON响应；条件追加请求未启动。资格/计数24/39、21/34、数值3/5保持，历史成功/官方空状态不覆盖。[本批台账与精确下一步](../r2-official-gaps-2026-10-15/report.md)。

前轮NMC审定（cfce1b3已获限定认可）：CN-W01/CN-W02专用链历史实测OK/字段PASS，现24/39、21/34、数值3/5；10/13generic负例性质已更正，原件保留。其他39项不改、无新请求/重跑测试。[本轮报告](../r2-nmc-close-2026-10-15/report.md)。

前轮审定：MY-W01按9.29原条款复用既有天气provider/Feed与4条存档，OK/PASS，当前22/39、19/34、数值3/5。目录仅补同产品尾斜杠，10/10 08:30样本不是今天实网。13天气复核与101既有离线测试不改变其他来源资格。[本轮收尾/边界](../r2-weather-reuse-2026-10-15/report.md)。

前轮MY-W01零网络合同复用：更正0754/0830不同实跑，完整0830响应文本及4条Feed链复读通过，wire字节未认证。已批准身份/时间/未知影响语义复用，R2桥接只列差异不实施；全部计数不变。[本轮报告](../r2-my-w01-contract-2026-10-15/report.md)。

前轮两媒体RSS原XML验收：XX-M01/XX-M03各DNS1/GET1，实际各10条，共20条完整私有字节→既有collector→隔离SQLite→重复→readonly/query_only字段通过。R2-5现18/34，R2-4仍21/39；其他39源不变。[本批报告](../r2-two-media-2026-10-15/report.md) / [可用性缺口下一步](../r2-two-media-2026-10-15/availability-frontier.md)。产品未改，门禁NOT_RUN。

前轮三源RSS原XML资格已补齐：MY-C01/MY-T01/PH-M01各一次DNS/GET、均200，实际10/6/10条；完整原字节只私有ignored，复用RSS/collector隔离SQLite，源日期/明确offset逐字段、重复和query-only重开全部通过。仅R2-5由13/34到16/34；R2-4保持21/39，其他38项逐源未改。代码bebe144未改，本轮产品门禁NOT_RUN；整体R2、24h、GUI/S7未通过。[完整报告](../r2-three-rss-2026-10-15/report.md)。

前轮ONE同源目录URL更新已获批准并应用：XX-K02现为 https://www.one-line.com/en/newsroom，旧/en/news及原308链保留；目录web_list为HTML页面形态，现有默认关闭候选用json_list惰性HTML内嵌JSON模式。源码 `bebe1441465adfcabb9daf93cb2a8656ec1fc796` 干净门禁245定向、1230全量/3跳过及3smoke通过。已有635664原HTML经正式关闭候选回归10条字段、重复0新0修订、只读重开0差异，与前轮10条原字段完全相同；本轮来源DNS/HTTP0，不刷新02:56实网时间，不推导持续可用。覆盖仍21/39、13/34，数值3/5独立。[本轮目录/配置依据与至多三项建议](../r2-one-catalog-candidate-2026-10-15/report.md)。

本报告汇总已保存证据，供父会话独立审查。当前本地代码基准 `8d0993e4164dae0b7a7f96dc531b9aac92be54b1`（主会话限定代码/过程认可，无独立私有原页重放）；前一四源采集HEAD为 `50da3805ee14e72222a4e26f4230073cf1842bc7`。该历史批次四次系统DNS均公网、精确索引HTTP4；VN-D01原页有限通过、MY-L01真实探针失败，两源跳转未跟随；干净源码门禁已另存。[机器矩阵](mapping.json)保留全部41项的精确目录产品、采集时点、原证据路径/LF文本哈希、字段回放、时间角色、许可、默认状态及两项独立判定。

| 核查 | 已有证据计数 | 剩余 / 结论 |
| --- | --- | --- |
| R2-4公开自动来源 | **25/39（64.10%）** | 最少32项，尚差7；25 OK、7 PARTIAL、1 STALE、2 BLOCKED、4 NOT_RUN，未通过 |
| R2-5资讯/公告原页字段回放 | **24/34（70.59%）** | 尚差10；24 PASS、2 FAIL、1 PARTIAL、7 NOT_RUN，未通过 |
| 数值字段独立检查 | **3/5** | 仅历史归一化诊断；不加到34项原页回放分子 |
| R2连续24小时 | **NOT_RUN** | 未启用，不推导生产可用性或整体R2 PASS |

34资讯/公告、5数值天气、2后续阶段的分类于06:31:44 UTC已批准，41项全部保留。后续付费天气与向量只从公开39项分母排除，没有标PASS。这里的OK只描述留证时的实产品可用和数据/解析检查，不描述今天实时可用、生产默认启用或24小时表现。默认关闭独立于来源资格，不记作失败。

NMC旧降级依据现已更正：10/13 03:55Z是读10/11存档、注入200、强制generic web_list配置的零网络适配负例；原日志/脚本保留，但不是后续实网不可达或专用provider失败。现按用户审定复用既有专用链计OK/PASS，[合并收口](../r2-nmc-close-2026-10-15/report.md)。Westports有效记录最新2025-08-01（原XML最高2026-09-28，10原项中7空标题排除）仍STALE，其他缺口不变。

字段PASS忠实保留源实际时间角色。TH-C02是文件日，ID-T01是制定日；包括VN-D01的其余七个新增HTML原页是源显示的列表日，全部day精度、时区缺失、发布瞬间null。BMKG旧12条/en别名原文与最新13条精确/rss.xml响应分开；NCHMF旧脱敏DOM保留+07来自测试配置的限制。字段通过不证明发布瞬间、预警有效性、港口影响、法规全文或政策人工审核。

## 34项资讯 / 公告

| ID | 精确目录URL / 原文本 | 最新已有采集UTC / HTTP | R2-4 | R2-5 | 判定理由 / 保留缺口 |
| --- | --- | --- | --- | --- | --- |
| CN-P01 | https://www.gd.msa.gov.cn/ | 2026-10-14T07:56:30.108Z / 200 [取证](../r2-four-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-public-index-replay-2026-10-14/summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| CN-P02 | https://www.sz.msa.gov.cn/ | 2026-10-15T08:27:32.616Z /302真实自指Location，DNS1/GET1 | PARTIAL | NOT_RUN | Location等于原URL，零重试停止、目标0，无实际列表/结构/回放；旧正文相对路径不当跳转目标。 |
| CN-W01 | https://www.nmc.cn/publish/typhoon/typhoon_new.html | 2026-10-11历史200 [实跑](../nmc-integration-2026-10-11/nmc-live-evidence.json) | OK | PASS [专用映射](../r2-nmc-close-2026-10-15/product-mapping.json) | 固定产品URL/标题/原时间或年度期号，unknown TZ/生命周期、历史/解除提示、0港口影响；10/13为零网络generic适配负例，不是源实网失败。 |
| CN-W02 | https://www.nmc.cn/publish/country/warning/index.html | 2026-10-11历史200 [实跑](../nmc-integration-2026-10-11/nmc-live-evidence.json) | OK | PASS [专用映射](../r2-nmc-close-2026-10-15/product-mapping.json) | 固定产品URL/标题/原时间或年度期号，unknown TZ/生命周期、历史/解除提示、0港口影响；10/13为零网络generic适配负例，不是源实网失败。 |
| CN-T01 | http://www.mofcom.gov.cn/zcfb/index.html | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 目录URL为HTTP；现安全入口只接受HTTPS，未假设替代URL，也没有当次请求。 |
| CN-T02 | https://szs.mof.gov.cn/zhengcefabu/ | 2026-10-14T07:56:30.392Z / 200 [取证](../r2-four-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-public-index-replay-2026-10-14/summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| VN-P01 | https://vimawa.gov.vn/vi/thong-bao-hang-hai | 2026-10-14T07:56:30.690Z / 200 [取证](../r2-four-after-clash-2026-10-14/summary.json) | PARTIAL | PARTIAL [字段](../r2-four-after-clash-2026-10-14/VN-P01-table-metadata.json) | 实表10行有标题/链接，无可见日期或日期属性；TBHH编号、表头不当日期。 |
| VN-P03 | https://saigonnewport.com.vn/tin-tuc | 2026-10-14T09:08:39.423Z / 200 [取证](../r2-three-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-post-clash-index-replay-final-2026-10-14/summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| VN-W01 | https://www.nchmf.gov.vn/kttv/vi-VN/1/index.html | 2026-10-10T09:52:07.791Z / 200 [取证](../nchmf-integration-2026-10-10/live-evidence.json) | OK | PASS [字段](../r2-p1-inventory-2026-10-13/replay.log) | 旧真实脱敏DOM5条字段回放；+07是测试配置，不能说源声明时区或独立UTC验证。 |
| VN-T01 | https://idea.gov.vn/ | 2026-10-14T09:08:42.879Z / 200 [取证](../r2-three-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-post-clash-index-replay-final-2026-10-14/summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| VN-D01 | https://phongchongthientai.mard.gov.vn/Pages/Trang-chu.aspx | 2026-10-15T01:16:09.783Z / 200 [本批](../r2-four-reapplied-2026-10-15/report.md) | OK | PASS | 原页4条完整title属性+同锚点末尾D/M/Y；关闭配置，完整入库/重复/只读重开0差异；源列表日而非发布瞬间。 |
| TH-W01 | https://www.tmd.go.th/en/api/xml/CAP | 2026-10-13T07:00:38.389Z / 200 [取证](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | OK | PASS [字段](../r2-p1-inventory-2026-10-13/replay.log) | 最新精确CAP实网10条，原XML另有回放；预警有效性/港口影响不在本字段通过范围。 |
| TH-C01 | https://www.customs.go.th/list_strc_simple_with_date.php?ini_content=customs_news&ini_menu=menu_public_relations_160421_04&order_by=date&sort_type=0&lang=th | 2026-10-14T07:16:50.062Z / 200 [取证](../r2-six-public-2026-10-14/summary.json) | OK | PASS [字段](../r2-two-raw-dns-2026-10-14/replay-summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| TH-C02 | https://www.customs.go.th/list_strc_download_with_docno_date.php?ini_content=announce_160426_01&order_by=date&sort_type=0&lang=th | 2026-10-14T08:33:16.386Z / 200 [取证](../r2-next-four-2026-10-14/summary.json) | OK | PASS [字段](../r2-thai-document-replay-2026-10-14/summary.json) | 100条完整原页回放通过；日期是文件日，不是发布日期，时区/发布瞬间未知。 |
| MY-P02 | https://www.westportsholdings.com/category/press-release/feed/ | 2026-10-15T08:46:47.628Z /200，DNS1/GET1 | STALE | PASS（已认可既有parser的3条有效记录；10原项/7空标题排除，原XML最高2026-09-28） | 完整10项中7源title空，raw最新2026但3有效最新2025-08-01；3/3/3、重复0/query_only0差异，不能把回放或2026空标题项当当前可用。 |
| MY-P03 | https://www.northport.com.my/np/page-announcements.html | 2026-10-14T07:16:47.635Z / 200 [取证](../r2-six-public-2026-10-14/summary.json) | PARTIAL | FAIL [字段](../r2-two-raw-dns-2026-10-14/replay-summary.json) | 原页同URL对应冲突标题/日期；首次与重复均失败，写入0，不择优消除冲突。 |
| MY-W01 | https://api.data.gov.my/weather/warning/ | 2026-10-10T08:30:40.728Z / 200（历史实测，非本日） | OK | PASS（已审定天气Feed复用） | [4条完整响应文本回放](../r2-my-w01-contract-2026-10-15/feed-replay.json)：unknown时区/有效性、received_at、0港口影响不变；目录同产品补尾斜杠，旧301保留。未运行24h。 |
| MY-C01 | https://www.customs.gov.my/ms/arkib/pengumuman?format=feed&type=rss | 2026-10-15T04:10:40.625Z / 200 [本轮取证](../r2-three-rss-2026-10-15/capture-summary.json) | OK | PASS [字段](../r2-three-rss-2026-10-15/MY-C01-replay.json) | 完整私有XML→既有collector→隔离SQLite 10条；重复0新0修订，readonly/query_only重开0差异；pubDate秒精度、原offset +0800，无独立updated。仅metadata，未生产启用。 |
| MY-T01 | https://www.mof.gov.my/portal/ms/berita/siaran-media?format=feed&type=rss | 2026-10-15T04:10:41.342Z / 200 [本轮取证](../r2-three-rss-2026-10-15/capture-summary.json) | OK | PASS [字段](../r2-three-rss-2026-10-15/MY-T01-replay.json) | 完整私有XML→既有collector→隔离SQLite 6条；重复0新0修订，readonly/query_only重开0差异；pubDate秒精度、原offset +0800，无独立updated。仅metadata，未生产启用。 |
| MY-L01 | https://www.pos.com.my/service-update | 2026-10-15T01:16:13.254Z / 200 [本批](../r2-four-reapplied-2026-10-15/report.md) | PARTIAL | FAIL | 原页10张卡片标题锚点均无href；类别链接是列表自身。真实适用性探针失败/写入0，不猜路由或时区。 |
| ID-W01 | https://www.bmkg.go.id/alerts/nowcast/en/rss.xml | 2026-10-13T07:00:40.269Z / 200 [取证](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | OK | PASS [字段](../r2-p1-inventory-2026-10-13/replay.log) | 最新精确RSS13条可读；回放是旧12条、原GET为/en别名，不把两份payload混为一份。 |
| ID-T01 | https://jdih.kemendag.go.id/ | 2026-10-14T09:08:45.056Z / 200 [取证](../r2-three-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-post-clash-index-replay-final-2026-10-14/summary.json) | 8条完整原页回放通过；制定日不是发布日期，标题原有省略号保留，初始失败另存。 |
| ID-T02 | https://jdih.kemenkeu.go.id/ | 原07:37:48.414Z root307→真实Location/home07:37:48.920Z 200，当前无新请求 | OK | PASS | 主会话限定代码/过程认可7条原件验收，日期角色/TZ未知、publishedAt null及漏检更正保留，不称独立私有原页重放/CI/24h通过。 |
| PH-P01 | https://www.ppa.com.ph/content/ppa-helpdesk-advisory ，https://www.ppa.com.ph/ppa-port-news | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |
| PH-W01 | https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin | 2026-10-15T05:53:36.714Z / 403 [本次](../r2-official-gaps-applied-2026-10-15/PH-W01-capture.json) | PARTIAL | NOT_RUN | 本次错误页非天气空状态，无活动正样本；10/10官方局部无活动状态另作历史，不称今天无风险。 |
| PH-W02 | https://www.pagasa.dost.gov.ph/weather/weather-advisory | 2026-10-15T05:53:36.848Z / 403 [本次](../r2-official-gaps-applied-2026-10-15/PH-W02-capture.json) | PARTIAL | NOT_RUN | 本次错误页非天气空状态，无活动正样本；10/10官方局部无活动状态另作历史，不称今天无风险。 |
| PH-C01 | https://customs.gov.ph/category/media-releases/ | 2026-10-14T07:56:33.170Z / 200 [取证](../r2-four-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-public-index-replay-2026-10-14/summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| PH-M01 | https://portcalls.com/feed/ | 2026-10-15T04:10:42.206Z / 200 [本轮取证](../r2-three-rss-2026-10-15/capture-summary.json) | OK | PASS [字段](../r2-three-rss-2026-10-15/PH-M01-replay.json) | 完整私有XML→既有collector→隔离SQLite 10条；重复0新0修订，readonly/query_only重开0差异；pubDate秒精度、原offset +0000，无独立updated。仅metadata，未生产启用。 |
| XX-K01 | https://www.maersk.com/news | 2026-10-15T02:38:28.356Z / 尝试1、未捕获响应 [当前证据](../r2-carrier-reapplied-2026-10-15/summary.json) | BLOCKED | NOT_RUN | 公网23.53.3.137、23.53.3.144；fetch_failed无底层错误记录，不判断CA/TLS/反爬；不重试。 |
| XX-K02 | https://www.one-line.com/en/newsroom（旧/en/news与308另存） | 2026-10-15T02:56:22.136Z / 200（前轮实测；本轮HTTP0）[沿革](../r2-one-catalog-candidate-2026-10-15/catalogue-change-applied.json) | OK | PASS [正式关闭候选原页回归](../r2-one-catalog-candidate-replay-2026-10-15/summary.json) | 目录web_list页面由json_list惰性数据模式读取；1置顶+9列表，日期秒精度无时区/瞬间null，默认关闭metadata-only且不进入活动源。 |
| XX-K03 | https://www.sitc.com/en/list.asp?classid=44 ；越南站 https://sitcline.vn/ | 原06:32:48.737Z /200，当前无新请求 | OK | PASS | 主会话限定代码/过程认可执行线程20条原页验收；未独立重放私有原页，不称CI/24h通过。 |
| XX-M01 | https://theloadstar.com/feed/ | 2026-10-15T04:25:58.202Z / 200 [取证](../r2-two-media-2026-10-15/capture-summary.json) | OK | PASS [字段](../r2-two-media-2026-10-15/XX-M01-replay.json) | 完整私有RSS10条，pubDate秒精度+0000；隔离collector/重复零新增修订/query_only重开零差异；metadata-only，生产未配置。 |
| XX-M03 | https://splash247.com/feed/ | 2026-10-15T04:25:58.867Z / 200 [取证](../r2-two-media-2026-10-15/capture-summary.json) | OK | PASS [字段](../r2-two-media-2026-10-15/XX-M03-replay.json) | 完整私有RSS10条，pubDate秒精度+0000；隔离collector/重复零新增修订/query_only重开零差异；metadata-only，生产未配置。 |
| XX-F01 | https://seller-my.tiktok.com/university/essay?knowledge_id=4293090978809617 | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |

## 5项数值天气（不混入R2-5）

| ID | 精确目录URL / 原文本 | 最新已有采集UTC / HTTP | R2-4 | 独立数值字段 | 判定理由 / 保留缺口 |
| --- | --- | --- | --- | --- | --- |
| ID-W02 | https://maritim.bmkg.go.id/marine2026-data/ （原目录文档/港口KODE模板） | 2026-10-15T06:05:16.816Z / doc200 [本次](../r2-bmkg-doc-jma-attribution-2026-10-15/ID-W02-doc-capture.json) | NOT_RUN | NOT_RUN | doc是16文件/子目录索引，非已确认apidoc，无目标港口/KODE映射或数值样本，所有链接未跟进，资格不升。 |
| XX-W01 | https://www.jma.go.jp/bosai/typhoon/data/targetTc.json | 2026-10-15T05:53:37.778Z / 404 [同次归属](../r2-bmkg-doc-jma-attribution-2026-10-15/jma-cross-product-attribution.json) | BLOCKED | PASS_LIMITED_STORED_REAL_DIAGNOSTIC [历史字段](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json) | 最新精确URL404移出当前OK；历史数值诊断保留，404非无气旋，同一请求不重复计数。 |
| XX-W02 | `https://www.jma.go.jp/bosai/typhoon/data/TC{id}/forecast.json` 、`/specifications.json` | 2026-10-15T05:53:37.778Z / 同次targetTc404 [归属](../r2-bmkg-doc-jma-attribution-2026-10-15/jma-cross-product-attribution.json) | PARTIAL | PARTIAL_FORECAST_ONLY_SPECIFICATIONS_UNVERIFIED [旧字段](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json) | 前置列表与XX-W01是同一请求，没有两产品新请求；历史forecast保留，spec仍缺。 |
| XX-A01 | https://api.open-meteo.com/v1/forecast | 2026-10-10T03:58:39.141Z / 200 [取证](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-sync-live.json) | OK | PASS_LIMITED_STORED_REAL_DIAGNOSTIC [字段](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json) | 10/10陆地8港风/降水/能见度与时间字段诊断；不是保留原JSON回放或今天刷新。 |
| XX-A02 | https://marine-api.open-meteo.com/v1/marine | 2026-10-10T03:58:39.141Z / 200 [取证](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-sync-live.json) | OK | PASS_LIMITED_STORED_REAL_DIAGNOSTIC [字段](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json) | 10/10原点海况7港；VNSGN仍缺，约61.8公里独立参考点不能冒充泊位/原点。 |

数值历史检查只有adapter/主机状态汇总与持久化字段，没有完整逐请求URL/原JSON回放台账；矩阵没有补造线证据。XX-W02 forecast/specifications产品范围仍须明确，不因旧forecast成功把整行标OK。VNSGN独立参考海况按ADR-009隔离，原点缺测继续保留。

## 2项后续阶段（保留库存，不计公开分母）

| ID | 原目录URL | 状态 | 理由 |
| --- | --- | --- | --- |
| XX-A03 | https://customer-api.open-meteo.com | DEFERRED_POST_STAGE | 付费天气后续阶段保留；本汇总无授权真实调用、凭据、预算或权益。 |
| XX-A04 | https://help.aliyun.com/zh/model-studio/embedding | DEFERRED_POST_STAGE | 向量后续阶段保留；目录为文档URL，真实API产品端点及调用未验证。 |

## 许可、启用与历史边界

逐项完整状态在mapping.json。未知HTML许可仅允许metadata，完整私有字节不发布；远端导出字段/hash不能重建完整原页。TMD精确CAP按已有public-domain声明，BMKG RSS仅excerpt范围，未知同主机页面不继承许可。旧第三方档案本轮未做全面脱敏审计或清理。

TMD/BMKG内置seed的声明是 `enabled=true`，而默认生产Intel job仍关闭，未显式启用时启动选中源为空；这两个事实分开。11个页面候选均 `enabled=false`（10个web_list mapper、ONE为json_list的HTML模式）。其他资讯源未配置；数值天气属于现有运行设置所控制的运营层，本轮不读取用户持久化设置，不写成已开或已关。

已被后续真实响应/回放取代的DNS阻断、旧selector缺口保留为历史，不继续当当前失败。Northport真实冲突与VN-P01无日期不因DNS修好消失。R1.5历史1/10仍为用户延后、未完成验证，不重新找事件，也不阻塞R2。

## 前一四源批次（精确索引已各GET一次）

原提议四源现均已核验，旧DNS阻断是历史。VN-D01关闭配置/4条原页字段有限通过；MY-L01缺详情链接失败；CN-P02/ID-T02跳转未跟随。实际地址、HTTP、原字节摘要和逐项理由见[该历史批次报告](../r2-four-reapplied-2026-10-15/report.md)。本批没有自动后续请求授权。

文档验证与收尾见[closeout.md](closeout.md)及[validation.json](validation.json)。

P2复审修复：尾部模式不匹配不再交通用日期解析，原四条保存原页全字段与修前一致，覆盖不变，P2修复轮新增来源HTTP/DNS0。两个重定向只保存正文相对路径，未保存Location，不确认同域或绝对目标；MY静态卡片只缺详情href。[修复报告](../r2-anchor-date-review-repair-2026-10-15/report.md)。

## 下一批仅建议，尚未执行

建议MY-C01、MY-T01、PH-M01三项既有RSS元数据补完整原XML回放/幂等/只读重开；已有10/6/10条完整标题链接时间派生，R2-5仍NOT_RUN。均已R2-4 OK，不重复增加可用性分子；没有新探测或重复失败检索。详见[三项证据与缺口](../r2-one-catalog-candidate-2026-10-15/next-batch-recommendations.json)。
