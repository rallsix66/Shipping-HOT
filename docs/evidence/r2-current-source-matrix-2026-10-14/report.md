# R2 41项来源累计证据 — 2026-10-14

本报告汇总已保存证据，供父会话独立审查。代码基准 `355bc861d4020ba22ddd00401de709d7cee497e3`，起始证据 HEAD `679400c1970cf270eabe85ec866a52b0bef820b6`。本轮仅更新文档：没有新源请求、DNS、字段回放或功能门禁；此前执行者的测试记录仍是此前记录。[机器矩阵](mapping.json)保留全部41项的精确目录产品、采集时点、原证据路径/LF文本哈希、字段回放、时间角色、许可、默认状态及两项独立判定。

| 核查 | 已有证据计数 | 剩余 / 结论 |
| --- | --- | --- |
| R2-4公开自动来源 | **20/39（51.28%）** | 最少32项，尚差12；20 OK、8 PARTIAL、11 NOT_RUN，未通过 |
| R2-5资讯/公告原页字段回放 | **11/34（32.35%）** | 尚差23；11 PASS、3 FAIL、1 PARTIAL、19 NOT_RUN，未通过 |
| 数值字段独立检查 | **3/5** | 仅历史归一化诊断；不加到34项原页回放分子 |
| R2连续24小时 | **NOT_RUN** | 未启用，不推导生产可用性或整体R2 PASS |

34资讯/公告、5数值天气、2后续阶段的分类于06:31:44 UTC已批准，41项全部保留。后续付费天气与向量只从公开39项分母排除，没有标PASS。这里的OK只描述留证时的实产品可用和数据/解析检查，不描述今天实时可用、生产默认启用或24小时表现。默认关闭独立于来源资格，不记作失败。

NMC两项是本次从暂计22/39修正到20/39的原因：10/11原URL旧Feed读取早于10/13 03:55:13.246 UTC真实页面适用性回放。后者在 `0b532e1917ee5425194965b20e0fdf8c2a1f4805` 断言零合格链接、`web_list_invalid_link`、写入0；harness退出0证明预期失败得到验证，不代表源解析成功。[原始日志](../r2-p1-acceptance-mapping-2026-10-13/nmc-offline.log)、[过程](../r2-p1-acceptance-mapping-2026-10-13/nmc-offline.test.ts.txt)。已核对当前9个关闭HTML候选与后续R2记录，没有取代这两项失败的合格回放；它们保留为R2-4 PARTIAL / R2-5 FAIL，不称未测试。

字段PASS忠实保留源实际时间角色。TH-C02是文件日，ID-T01是制定日；其余六个新增HTML原页是源显示的列表日，全部day精度、时区缺失、发布瞬间null。BMKG旧12条/en别名原文与最新13条精确/rss.xml响应分开；NCHMF旧脱敏DOM保留+07来自测试配置的限制。字段通过不证明发布瞬间、预警有效性、港口影响、法规全文或政策人工审核。

## 34项资讯 / 公告

| ID | 精确目录URL / 原文本 | 最新已有采集UTC / HTTP | R2-4 | R2-5 | 判定理由 / 保留缺口 |
| --- | --- | --- | --- | --- | --- |
| CN-P01 | https://www.gd.msa.gov.cn/ | 2026-10-14T07:56:30.108Z / 200 [取证](../r2-four-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-public-index-replay-2026-10-14/summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| CN-P02 | https://www.sz.msa.gov.cn/ | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |
| CN-W01 | https://www.nmc.cn/publish/typhoon/typhoon_new.html | 2026-10-11T01:38:50.427Z / 200 [取证](../nmc-integration-2026-10-11/nmc-live-evidence.json) | PARTIAL | FAIL [字段](../r2-p1-acceptance-mapping-2026-10-13/nmc-offline.log) | 原产品页可读；10/13实页列表回放零合格链接，缺发布日，收藏失败，未有后续合格证据。 |
| CN-W02 | https://www.nmc.cn/publish/country/warning/index.html | 2026-10-11T01:38:51.146Z / 200 [取证](../nmc-integration-2026-10-11/nmc-live-evidence.json) | PARTIAL | FAIL [字段](../r2-p1-acceptance-mapping-2026-10-13/nmc-offline.log) | 原产品页可读；10/13实页列表回放零合格链接，作者日期语法不支持，未有后续合格证据。 |
| CN-T01 | http://www.mofcom.gov.cn/zcfb/index.html | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 目录URL为HTTP；现安全入口只接受HTTPS，未假设替代URL，也没有当次请求。 |
| CN-T02 | https://szs.mof.gov.cn/zhengcefabu/ | 2026-10-14T07:56:30.392Z / 200 [取证](../r2-four-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-public-index-replay-2026-10-14/summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| VN-P01 | https://vimawa.gov.vn/vi/thong-bao-hang-hai | 2026-10-14T07:56:30.690Z / 200 [取证](../r2-four-after-clash-2026-10-14/summary.json) | PARTIAL | PARTIAL [字段](../r2-four-after-clash-2026-10-14/VN-P01-table-metadata.json) | 实表10行有标题/链接，无可见日期或日期属性；TBHH编号、表头不当日期。 |
| VN-P03 | https://saigonnewport.com.vn/tin-tuc | 2026-10-14T09:08:39.423Z / 200 [取证](../r2-three-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-post-clash-index-replay-final-2026-10-14/summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| VN-W01 | https://www.nchmf.gov.vn/kttv/vi-VN/1/index.html | 2026-10-10T09:52:07.791Z / 200 [取证](../nchmf-integration-2026-10-10/live-evidence.json) | OK | PASS [字段](../r2-p1-inventory-2026-10-13/replay.log) | 旧真实脱敏DOM5条字段回放；+07是测试配置，不能说源声明时区或独立UTC验证。 |
| VN-T01 | https://idea.gov.vn/ | 2026-10-14T09:08:42.879Z / 200 [取证](../r2-three-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-post-clash-index-replay-final-2026-10-14/summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| VN-D01 | https://phongchongthientai.mard.gov.vn/Pages/Trang-chu.aspx | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |
| TH-W01 | https://www.tmd.go.th/en/api/xml/CAP | 2026-10-13T07:00:38.389Z / 200 [取证](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | OK | PASS [字段](../r2-p1-inventory-2026-10-13/replay.log) | 最新精确CAP实网10条，原XML另有回放；预警有效性/港口影响不在本字段通过范围。 |
| TH-C01 | https://www.customs.go.th/list_strc_simple_with_date.php?ini_content=customs_news&ini_menu=menu_public_relations_160421_04&order_by=date&sort_type=0&lang=th | 2026-10-14T07:16:50.062Z / 200 [取证](../r2-six-public-2026-10-14/summary.json) | OK | PASS [字段](../r2-two-raw-dns-2026-10-14/replay-summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| TH-C02 | https://www.customs.go.th/list_strc_download_with_docno_date.php?ini_content=announce_160426_01&order_by=date&sort_type=0&lang=th | 2026-10-14T08:33:16.386Z / 200 [取证](../r2-next-four-2026-10-14/summary.json) | OK | PASS [字段](../r2-thai-document-replay-2026-10-14/summary.json) | 100条完整原页回放通过；日期是文件日，不是发布日期，时区/发布瞬间未知。 |
| MY-P02 | https://www.westportsholdings.com/category/press-release/feed/ | 2026-10-13T07:00:27.722Z / 200 [取证](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | OK | NOT_RUN [字段](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | 实网RSS解析字段完整，累计可用；只保存导出元数据/hash，未保留完整原文供完整回放。 |
| MY-P03 | https://www.northport.com.my/np/page-announcements.html | 2026-10-14T07:16:47.635Z / 200 [取证](../r2-six-public-2026-10-14/summary.json) | PARTIAL | FAIL [字段](../r2-two-raw-dns-2026-10-14/replay-summary.json) | 原页同URL对应冲突标题/日期；首次与重复均失败，写入0，不择优消除冲突。 |
| MY-W01 | https://api.data.gov.my/weather/warning | 2026-10-10T08:30:40.728Z / 200 [取证](../metmalaysia-integration-2026-10-10/live-evidence.json) | PARTIAL | NOT_RUN | 目录无尾斜杠URL曾301；相关尾斜杠JSON可读，精确产品映射及完整字段回放未合格。 |
| MY-C01 | https://www.customs.gov.my/ms/arkib/pengumuman?format=feed&type=rss | 2026-10-13T07:00:30.791Z / 200 [取证](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | OK | NOT_RUN [字段](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | 实网RSS解析字段完整，累计可用；只保存导出元数据/hash，未保留完整原文供完整回放。 |
| MY-T01 | https://www.mof.gov.my/portal/ms/berita/siaran-media?format=feed&type=rss | 2026-10-13T07:00:35.340Z / 200 [取证](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | OK | NOT_RUN [字段](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | 实网RSS解析字段完整，累计可用；只保存导出元数据/hash，未保留完整原文供完整回放。 |
| MY-L01 | https://www.pos.com.my/service-update | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |
| ID-W01 | https://www.bmkg.go.id/alerts/nowcast/en/rss.xml | 2026-10-13T07:00:40.269Z / 200 [取证](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | OK | PASS [字段](../r2-p1-inventory-2026-10-13/replay.log) | 最新精确RSS13条可读；回放是旧12条、原GET为/en别名，不把两份payload混为一份。 |
| ID-T01 | https://jdih.kemendag.go.id/ | 2026-10-14T09:08:45.056Z / 200 [取证](../r2-three-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-post-clash-index-replay-final-2026-10-14/summary.json) | 8条完整原页回放通过；制定日不是发布日期，标题原有省略号保留，初始失败另存。 |
| ID-T02 | https://jdih.kemenkeu.go.id/ | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |
| PH-P01 | https://www.ppa.com.ph/content/ppa-helpdesk-advisory ，https://www.ppa.com.ph/ppa-port-news | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |
| PH-W01 | https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin | 2026-10-10T11:03:48Z / 200 [取证](../pagasa-warning-2026-10-10/raw/fetch-log.txt) | PARTIAL | NOT_RUN | 200页面外壳/iframe，无合格活动正样本；页面可读不代替预警数据。 |
| PH-W02 | https://www.pagasa.dost.gov.ph/weather/weather-advisory | 2026-10-10T11:03:49.920Z / 200 [取证](../pagasa-warning-2026-10-10/raw/fetch-log.txt) | PARTIAL | NOT_RUN | 200页面外壳/iframe，无合格活动正样本；页面可读不代替预警数据。 |
| PH-C01 | https://customs.gov.ph/category/media-releases/ | 2026-10-14T07:56:33.170Z / 200 [取证](../r2-four-after-clash-2026-10-14/summary.json) | OK | PASS [字段](../r2-public-index-replay-2026-10-14/summary.json) | 完整私有实页标题/链接/源显示日期回放，重复和只读重开无差异；day精度，不推断时区。 |
| PH-M01 | https://portcalls.com/feed/ | 2026-10-13T07:00:29.490Z / 200 [取证](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | OK | NOT_RUN [字段](../r2-bounded-rss-after-dns-2026-10-13/batch-results.json) | 实网RSS解析字段完整，累计可用；只保存导出元数据/hash，未保留完整原文供完整回放。 |
| XX-K01 | https://www.maersk.com/news | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |
| XX-K02 | https://www.one-line.com/en/news | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |
| XX-K03 | https://www.sitc.com/en/list.asp?classid=44 ；越南站 https://sitcline.vn/ | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |
| XX-M01 | https://theloadstar.com/feed/ | 2026-10-13T08:25:10.410Z / 200 [取证](../r2-four-index-2026-10-13/batch-results.json) | OK | NOT_RUN [字段](../r2-four-index-2026-10-13/batch-results.json) | 实网RSS解析字段完整，累计可用；只保存导出元数据/hash，未保留完整原文供完整回放。 |
| XX-M03 | https://splash247.com/feed/ | 2026-10-13T08:25:11.082Z / 200 [取证](../r2-four-index-2026-10-13/batch-results.json) | OK | NOT_RUN [字段](../r2-four-index-2026-10-13/batch-results.json) | 实网RSS解析字段完整，累计可用；只保存导出元数据/hash，未保留完整原文供完整回放。 |
| XX-F01 | https://seller-my.tiktok.com/university/essay?knowledge_id=4293090978809617 | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 没有可计数的实际产品抓取与完整原页回放证据；目录旧标签不充当实测。 |

## 5项数值天气（不混入R2-5）

| ID | 精确目录URL / 原文本 | 最新已有采集UTC / HTTP | R2-4 | 独立数值字段 | 判定理由 / 保留缺口 |
| --- | --- | --- | --- | --- | --- |
| ID-W02 | https://maritim.bmkg.go.id/marine2026-data/ （文档 `/apidoc`；`/pelabuhan/{KODE}.json`） | NOT_RUN / 未知 | NOT_RUN | NOT_RUN | 目录是根/文档/港口KODE模板；具体获批产品URL和实测数值字段未知。 |
| XX-W01 | https://www.jma.go.jp/bosai/typhoon/data/targetTc.json | 2026-10-10T03:58:39.141Z / 200 [取证](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-sync-live.json) | OK | PASS_LIMITED_STORED_REAL_DIAGNOSTIC [字段](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json) | 历史实网targetTc/持久化气旋ID诊断；无逐请求原JSON台账，不当文章回放。 |
| XX-W02 | `https://www.jma.go.jp/bosai/typhoon/data/TC{id}/forecast.json` 、`/specifications.json` | 2026-10-10T03:58:39.141Z / 200 [取证](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-sync-live.json) | PARTIAL | PARTIAL_FORECAST_ONLY_SPECIFICATIONS_UNVERIFIED [字段](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json) | 旧实网仅forecast分支；目录还列specifications，后者未验证，整行保留PARTIAL。 |
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

TMD/BMKG内置seed的声明是 `enabled=true`，而默认生产Intel job仍关闭，未显式启用时启动选中源为空；这两个事实分开。9个HTML候选均 `enabled=false`。其他资讯源未配置；数值天气属于现有运行设置所控制的运营层，本轮不读取用户持久化设置，不写成已开或已关。

已被后续真实响应/回放取代的DNS阻断、旧selector缺口保留为历史，不继续当当前失败。Northport真实冲突与VN-P01无日期不因DNS修好消失。R1.5历史1/10仍为用户延后、未完成验证，不重新找事件，也不阻塞R2。

## 下一批建议（未执行，至多4项）

| ID | 精确目录URL | 可复用入口 / 尚需先观察 |
| --- | --- | --- |
| CN-P02 | https://www.sz.msa.gov.cn/ | 现secureFetchArticle → fromHtml/config keys/严格日期 → collectIntelSource/隔离SQLite；先观察真实容器与源时间角色，本轮未请求或新增配置 |
| VN-D01 | https://phongchongthientai.mard.gov.vn/Pages/Trang-chu.aspx | 现secureFetchArticle → fromHtml/config keys/严格日期 → collectIntelSource/隔离SQLite；先观察真实容器与源时间角色，本轮未请求或新增配置 |
| MY-L01 | https://www.pos.com.my/service-update | 现secureFetchArticle → fromHtml/config keys/严格日期 → collectIntelSource/隔离SQLite；先观察真实容器与源时间角色，本轮未请求或新增配置 |
| ID-T02 | https://jdih.kemenkeu.go.id/ | 现secureFetchArticle → fromHtml/config keys/严格日期 → collectIntelSource/隔离SQLite；先观察真实容器与源时间角色，本轮未请求或新增配置 |

下一批仅为待发完整指令建议，不构成实网、CA、详情页、生产开关或付费调用授权。父会话保留发令权。文档验证与真实Neat Freak收尾见[closeout.md](closeout.md)及[validation.json](validation.json)。
