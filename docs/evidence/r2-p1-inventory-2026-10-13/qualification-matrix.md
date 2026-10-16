> 历史快照：以下只代表原记录的 SHA 与采集时点；其中目录标签、待定分母和当时缺口不代表当前状态。当前累计结论见[41项矩阵](../r2-current-source-matrix-2026-10-14/report.md)及[逐源机器记录](../r2-current-source-matrix-2026-10-14/mapping.json)。

# R2 P1 目录与已有证据资格盘点 — 2026-10-13

依据现行9/29方案R2-4/5、信源目录与ADR007/008/009；目录字节SHA256见source-inventory.json。基线 a9e637fd52c69fbfde7fd226c660e58da0ea2ae8。仅盘点及已有合规存档离线回放，没有新上游访问或历史封港事件收集。

**固定分母：P1共58个ID，manual17，自动41。** XX-M表头RSS计自动，XX-A数据接口全部保留在41，PARTIAL、参数化URL、HTTP、缺档、收费或非文章契约都不从分母删除；每个ID算1，PH-P01两URL和XX-K03主/越南站不拆行。本报告不改目录核查状态。目录统计116/83/33为旧全目录摘要，不是本轮P1分母。

本次已有真实页面衍生存档经当前intel采集器的**标题/链接/时间离线子检查3/41（7.32%）**：TH-W01、ID-W01、VN-W01；其余38/41 NOT_RUN或缺配置/缺档/契约不适用。不是R2-5整体PASS，更不是R2-4实网80%通过。BMKG原请求/en与目录/rss.xml不同，TMD/NCHMF为存储衍生存档且抓取谱系有下表限制；3仅证明这些存档有效内容可解析入库，不封口原始wire或目录URL实网资格。本轮实时核查与24h均NOT_RUN，不将NOT_RUN称为FAIL。

41中7个结构化/非资讯接口（ID-W02、XX-W01/02、XX-A01/02/03/04）无法直接套文章标题/链接/时间；继续保留在总分母，需用户/架构明确分域验收映射后才可能另列验收，不以34替换41。MY-W01亦缺稳定URL/ID和publication时间语义。当前无P1自动行标BLOCKED；P1 manual中的阻塞来源另列。XX-F04等BLOCKED自动行是P2，不能挪进/移出P1以调覆盖率。

盘点范围：目录、正式intel seeds、当前通用parser/collector及测试，server/providers/__fixtures__、docs/evidence、已知.tmp探测目录文件名。未读保留数据库，未复制历史key/cookie/headers；既有脱敏问题不称已清理。存档缺失指未发现具来源与时间谱系的合格材料，不证明所有磁盘目录不存在文件。

| ID / 目录核查 | 固定URL / 格式 | 现有适配 | 已有存档 | 来源/抓取时间 | 断言状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| CN-P01 / OK (2026-09-29) | https://www.gd.msa.gov.cn/ / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| CN-P02 / PARTIAL | https://www.sz.msa.gov.cn/ / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| CN-W01 / OK | https://www.nmc.cn/publish/typhoon/typhoon_new.html / web_list | 旧nmc-warning专用Feed链；无intel配置 | docs/evidence/nmc-integration-2026-10-11/raw/typhoon_flash.html | 目录原URL；nmc-live-evidence.json ranAt 2026-10-11T01:38:50.372Z（逐请求时间在egress） | 当前intel NOT_RUN；不能用旧专用链通过替代 | 缺intel selectors/日期配置/全链回放 |
| CN-W02 / OK | https://www.nmc.cn/publish/country/warning/index.html / web_list | 旧nmc-warning专用Feed链；无intel配置 | docs/evidence/nmc-integration-2026-10-11/raw/warning_index.html | 目录原URL；nmc-live-evidence.json ranAt 2026-10-11T01:38:50.372Z | 当前intel NOT_RUN | 缺intel selectors/日期配置/全链回放 |
| CN-T01 / OK (2026-09-30) | http://www.mofcom.gov.cn/zcfb/index.html / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 目录为HTTP；当前安全入口拒绝HTTP，需独立确认合规URL策略，不可放松安全或擅改URL |
| CN-T02 / OK (2026-09-04) | https://szs.mof.gov.cn/zhengcefabu/ / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| VN-P01 / PARTIAL | https://vimawa.gov.vn/vi/thong-bao-hang-hai / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 目录已标列表无日期；TBHH可去重但不能充当时间，当前标题/链接/时间资格NOT_RUN |
| VN-P03 / OK (25/09/2026) | https://saigonnewport.com.vn/tin-tuc / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| VN-W01 / OK (30/09/2026) | https://www.nchmf.gov.vn/kttv/vi-VN/1/index.html / web_list | 仅已有测试配置#left-col>.ct-news-nb-block>ul.list-news/li/a alt/label，DMY UTC+07；无正式intel seed | docs/evidence/nchmf-integration-2026-10-10/raw/index.html | 目录原URL；live-evidence.json egress at 2026-10-10T09:52:07.791Z；存储衍生页面252878字节，日志原响应259550字节 | PASS 离线：5条；post54549标题片段+2026-10-10T09:27:01Z；replay.log | 脱敏存储页不是原wire逐字节证据；日期时区为配置；未接正式seed或启用 |
| VN-T01 / OK (30/09/2026) | https://idea.gov.vn/ / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| VN-D01 / OK (30/09/2026) | https://phongchongthientai.mard.gov.vn/Pages/Trang-chu.aspx / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| TH-W01 / OK (30/09/2026) | https://www.tmd.go.th/en/api/xml/CAP / rss | 正式 intel RSS 种子；feed.ts；CAP详情/官方影响仍为专用链 | server/providers/__fixtures__/tmd-cap-2026-10-10/index.xml；同hash docs/evidence/th-w01-tmd-cap-2026-10-10/index.xml | 目录原URL；旧记录2026-10-10约13:33 UTC+8（docs/evidence/th-w01-tmd-cap-2026-10-10.md）；不是07:02:58探测的同一响应 | PASS 离线：7条 title/同host HTTPS link/publishedAt；replay.log | 完整精确抓取时间/原始wire字节未封口；不核CAP有效性；当前实网NOT_RUN |
| TH-C01 / OK (佛历 2569-09-29) | https://www.customs.go.th/list_strc_simple_with_date.php?ini_content=customs_news&ini_menu=menu_public_relations_160421_04&order_by=date&sort_type=0&lang=th / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 通用佛历日期能力存在，未配置本源/真实存档/时间断言 |
| TH-C02 / PARTIAL | https://www.customs.go.th/list_strc_download_with_docno_date.php?ini_content=announce_160426_01&order_by=date&sort_type=0&lang=th / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| MY-P02 / OK (28/09/2026) | https://www.westportsholdings.com/category/press-release/feed/ / rss | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| MY-P03 / OK (15-09-2026) | https://www.northport.com.my/np/page-announcements.html / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| MY-W01 / OK (30/09/2026) | https://api.data.gov.my/weather/warning / json_list | 旧metmalaysia-warning专用Feed链；通用json_list存在但无本源配置 | docs/evidence/metmalaysia-integration-2026-10-10/raw/warning-2026-10-10T0830Z.json | 2026-10-10T08:30:40.728Z；旧请求URL带尾/；目录无尾/在07:54:41Z返回301 | 当前intel NOT_RUN；valid_from/to不能当publishedAt | warning_issue.issued时区、稳定URL/ID映射、非publication字段、完整回放待定 |
| MY-C01 / OK (28/09/2026) | https://www.customs.gov.my/ms/arkib/pengumuman?format=feed&type=rss / rss | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| MY-T01 / OK (29/09/2026) | https://www.mof.gov.my/portal/ms/berita/siaran-media?format=feed&type=rss / rss | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| MY-L01 / OK (22/09/2026) | https://www.pos.com.my/service-update / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| ID-W01 / OK (WebFetch) | https://www.bmkg.go.id/alerts/nowcast/en/rss.xml / rss | 正式 intel RSS 种子；feed.ts；非CAP地区/有效性解析 | server/providers/__fixtures__/bmkg-cap-2026-10-10/index.xml；同hash docs/evidence/bmkg-cap-2026-10-10/raw/index.xml | 旧fetch-log：2026-10-10T06:48:32Z GET /alerts/nowcast/en；RSS self-link为目录/en/rss.xml | PASS 离线：12条 title/同host HTTPS link/publishedAt；replay.log | 原请求URL与目录URL不同，不能称目录URL实网通过；24h及有效性NOT_RUN |
| ID-W02 / PARTIAL | https://maritim.bmkg.go.id/marine2026-data/ （文档 `/apidoc`；`/pelabuhan/{KODE}.json`） / json_list | 无BMKG港口海况intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 目录是根路径+参数化文档，缺批准具体港口URL及映射；不是文章feed |
| ID-T01 / OK | https://jdih.kemendag.go.id/ / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| ID-T02 / PARTIAL | https://jdih.kemenkeu.go.id/ / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| PH-P01 / PARTIAL | https://www.ppa.com.ph/content/ppa-helpdesk-advisory ，https://www.ppa.com.ph/ppa-port-news / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 目录一行两URL，仍只算1个ID；仅离线sourceCa机制，未配置真实CA/selector/存档 |
| PH-W01 / OK | https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin / web_list | 旧PAGASA探测；无intel配置 | docs/evidence/pagasa-warning-2026-10-10/raw/www.pagasa.dost.gov.ph_tropical_cyclone_severe_weather_bulletin.html | 目录原URL；fetch-log 2026-10-10T11:03:48Z | 当前intel NOT_RUN；无活动正样本 | 空壳/iframe与正样本缺口；不称标题时间通过 |
| PH-W02 / OK | https://www.pagasa.dost.gov.ph/weather/weather-advisory / web_list | 旧PAGASA探测；无intel配置 | docs/evidence/pagasa-warning-2026-10-10/raw/www.pagasa.dost.gov.ph_weather_weather_advisory.html | 目录原URL；fetch-log 2026-10-10T11:03:49.920Z | 当前intel NOT_RUN；无活动正样本 | 正样本/selector/时间规则缺失 |
| PH-C01 / OK (WebFetch) | https://customs.gov.ph/category/media-releases/ / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| PH-M01 / OK (30/09/2026) | https://portcalls.com/feed/ / rss | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| XX-W01 / OK | https://www.jma.go.jp/bosai/typhoon/data/targetTc.json / json_list | 既有jma-tropical-cyclone专用Runtime，非intel种子 | docs/evidence/r1-5-1-live-2026-10-10-356e6fe/r1-5-1-sync-live.json（旧操作诊断，非本源文章夹具） | 旧2026-10-10运行；本轮未回放其载荷 | NOT_RUN 标题/链接/时间 | TC列表非文章标题/链接/时间契约；现有证据不计本轮intel通过 |
| XX-W02 / OK | `https://www.jma.go.jp/bosai/typhoon/data/TC{id}/forecast.json` 、`/specifications.json` / api | 既有jma-tropical-cyclone详情适配器，非intel | 同XX-W01旧操作诊断；未确认本轮独立原始响应夹具 | 旧2026-10-10运行；本轮NOT_RUN | NOT_RUN 标题/链接/时间 | 参数化TC路径/forecast/specifications，非文章列表；不得编造事件标题日期 |
| XX-K01 / OK | https://www.maersk.com/news / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| XX-K02 / OK | https://www.one-line.com/en/news / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| XX-K03 / OK | https://www.sitc.com/en/list.asp?classid=44 ；越南站 https://sitcline.vn/ / web_list | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| XX-M01 / OK | https://theloadstar.com/feed/ / rss（表头RSS） | 旧ShippingFeedSources RSS同URL；无intel种子 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 未找到合格真实Feed存档/标题链接时间证据；现有Feed注册不等于intel验证 |
| XX-M03 / OK | https://splash247.com/feed/ / rss（表头RSS） | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 缺来源专属配置、存档谱系与回放 |
| XX-A01 / OK | https://api.open-meteo.com/v1/forecast / api (非资讯接口) | 既有Open-Meteo陆地天气适配器，非intel | docs/evidence/r1-5-1-live-2026-10-10-356e6fe/（旧七天验收） | 旧2026-10-10；本轮NOT_RUN | NOT_RUN 标题/链接/时间 | 天气时序不是资讯；旧验收不计intel/R2-5；免费演示/上线许可限制保留 |
| XX-A02 / OK | https://marine-api.open-meteo.com/v1/marine / api (非资讯接口) | 既有Open-Meteo海况适配器，非intel | 同XX-A01旧七天验收 | 旧2026-10-10；本轮NOT_RUN | NOT_RUN 标题/链接/时间 | 非文章契约；VNSGN原点缺测/独立参考点限制不变 |
| XX-A03 / OK（未带 key 时返回 401） | https://customer-api.open-meteo.com / api (非资讯接口) | 未配置付费版；非intel | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 仅目录401历史备注，无真实授权数据；付费/凭据需另行批准，NOT_RUN |
| XX-A04 / OK（文档） | https://help.aliyun.com/zh/model-studio/embedding / api (非资讯接口) | 已选定Bailian但未接真实embedding调用；非intel抓取源 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 目录为文档链接不是可抓资讯；真实付费/预算/凭据均未授权，NOT_RUN |
| XX-F01 / OK（更新于 17/09/2026） | https://seller-my.tiktok.com/university/essay?knowledge_id=4293090978809617 / web_list（整页对比） | 通用解析器能力存在；无本源正式intel配置 | 未找到可资格化真实存档（本次已盘点范围） | 缺失 | NOT_RUN 标题/链接/时间 | 整页带日期段落对比不是已配置list；无合规存档及可复现intel断言 |

## P1 manual（17，不计自动41）

保持manual和目录状态，纯手动录入能力另验收；不自动重试被阻塞来源。

| ID | URL | 目录核查 |
| --- | --- | --- |
| CN-P05 | https://www.msa.gov.cn/ | BLOCKED (403) |
| CN-C01 | http://www.customs.gov.cn/customs/302249/302266/302267/index.html | BLOCKED (412 JS 验证) |
| CN-H01 | gov.cn 原文（403）；2026 年通知的新华网转载：https://www.news.cn/politics/20251104/88bcffd88ae249e58c699b8772548e3d/c.html | PARTIAL |
| VN-C01 | https://customs.gov.vn/index.jsp?cid=31&pageId=6 | BLOCKED (超时) |
| VN-T02 | https://mof.gov.vn/ | BLOCKED (JS) |
| VN-H01 | https://chinhphu.vn/ | OK |
| TH-P01 | https://www.port.co.th/ | BLOCKED (连接被断开) |
| TH-H01 | https://www.bot.or.th/en/financial-institutions-holiday.html | PARTIAL (JS) |
| MY-P01 | https://www.pka.gov.my/index.php/en/ | BLOCKED (403) |
| MY-H01 | https://www.kabinet.gov.my/hari-kelepasan-am/ | BLOCKED (本次连接被断开) |
| ID-P01 | https://maritimhub.kemenhub.go.id/ | BLOCKED (JS) |
| ID-C01 | https://www.beacukai.go.id/ | BLOCKED |
| ID-H01 | https://www.kemenkopmk.go.id/ | PARTIAL |
| PH-H01 | https://www.officialgazette.gov.ph/section/laws/executive-issuances/proclamations/ | BLOCKED (403) |
| XX-F05 | https://seller.tiktokglobalshop.com/university/home | BLOCKED（JS） |
| XX-F06 | https://shopee.cn/edu/ | BLOCKED（JS，公告需要登录） |
| XX-F08 | https://university.lazada.com/ | BLOCKED（JS，部分内容需要登录） |

## 非P1来源

P2完整ID/URL/格式见source-inventory.json.p2（40条）；P2/P3、XX-E核对来源（未标P1）、退役/不接入和仅历史HKO回放都不计41。本轮不回放历史封港事件，也不新增候选来源。

## 实际回放及可复现性

replay.log记录基线完整SHA、命令、stdout/stderr和raw exit0，3 tests通过：TMD7/BMKG12/NCHMF5。每条存储item断言title非空、同源HTTPS canonicalUrl、publishedAt可解析；NCHMF post54549额外断言标题片段与2026-10-10T09:27:01Z，UTC+07来自显式配置而非页面时区。日志有存档hash、字节数和首条三字段，不输出全文。只读已有bytes，经注入lookup/transport到secureFetch/统一feed或HTMLparser/许可裁剪/内存SQLite；global fetch阻断，传输每源1次，全无真实socket。RSS索引通过不代表CAP正文、生命周期、港口影响或全部列表分页通过；NCHMF仅所配5项，不等于网站所有内容。

保存replay.test.ts.txt/replay.config.ts.txt，复制到忽略目录.tmp同名.ts后可复现命令；只写新内存库，不运行生产server。正式seed仅TH-W01/ID-W01；VN配置仅测试局部，未改source种子或URL。合成GBK/TIS-620/windows-1258、HTML日期、JSON、CA夹具仅机制回归，不计3/41。旧TMD/BMKG专用预警live、NMC/MY/NCHMF专用Feed和七天天气验收都不是本轮intel全链验证。

## 下一轮最小有限实网建议（尚未执行）

本节保留上一轮提案历史，已由 `../r2-p1-acceptance-mapping-2026-10-13/bounded-batch.md` 的六项统一批次提案取代，仍未获执行批准。前版2MiB混用了Feed列表上限；现役提案遵守intel默认512KiB/10秒。41保留为自动总清单，最终R2文章分母尚未批准，不能将本页3/41子检查当最终覆盖率。

1. 先确认仅针对TH-W01与ID-W01目录精确URL的只读资格核查：各最多1次索引GET，零详情或重定向跟随、零重试、零调度；总HTTP请求最多2次、每响应不超过现有2MiB、现有timeout/DNS固定/TLS/host白名单不变。遇403/证书错误或任何重定向即停并记录，不自动换URL/出口或放宽策略；这只封口当前端点与字节谱系，不能交付R2-4全目录80%或24h。
2. 确认实际执行出口（当前Windows本机）和抓取授权；仅记录固定URL、时间/status/content-type/编码/脱敏hash及有限标题链接时间，不保存cookie/key值，不取受限全文。任何新增重定向host、CA、URL变更需独立批准。
3. 后续再按每个P1ID批准来源配置与实网批次；PH-P01具体URL/CA、CN-T01 HTTP限制、ID-W02港口URL、XX-F01整页版本及7个非文章接口验收语义先决策。无预算/密钥调用XX-A03/04，不跑LLM或24h。

本次仅文档/证据，无产品代码、schema、安全策略或开关变化。GET离线片父审PASS；本盘点父审pending；R2整体未完成。
