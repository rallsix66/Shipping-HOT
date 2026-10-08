# Shipping HOT 信源目录（草案）

> 状态：`DRAFT`。首次核查日期 2026-09-30，核查方式为 curl 与 WebFetch，核查网络为编制者本机（中国大陆，Windows）。
> 所属计划：`docs/plans/shipping-hot-risk-intelligence-2026-09-29.md`。
>
> **本目录是信源的唯一来源。** 执行任何阶段时，只能接入本目录里的信源。要新增、替换或删除信源，先改本目录，经用户确认后才能改代码或种子数据。不允许执行者自己去找新网站接入。

## 0. 字段与状态说明

| 字段 | 含义 |
| --- | --- |
| ID | `国家-类别-序号`。国家：CN/VN/TH/MY/ID/PH/XX（跨国）。类别：`P` 港口/海事，`W` 天气，`C` 海关，`T` 贸易/电商政策，`H` 节假日，`L` 末端快递，`D` 灾害，`M` 媒体，`K` 船公司，`R` 运价，`E` 电商大促，`A` 数据接口 |
| 等级 | `A` 官方机构；`B` 港口运营方、船公司、快递公司、平台官方、专业媒体；`C` 综合媒体 |
| 方式 | `rss` / `web_list` / `json_list` / `api`：自动抓取。`manual`：在后台人工录入（自动抓取受阻，或内容太少不值得抓） |
| 核查 | `OK`：已抓到并看到 2026 年的条目。`PARTIAL`：能访问，但没确认到带日期的条目，或只验证了一部分。`BLOCKED`：反爬、超时、页面要 JS 渲染或无法访问。`STALE`：能访问，但内容已过时 |
| 优先级 | `P1` 演示版必须有；`P2` 上线前要补齐；`P3` 可选 |

**通用风险（R2 阶段必须处理）：**

1. **能不能抓到，和从哪里抓有关。** 同一个站，curl 和 WebFetch 的结果可能相反（如 BMKG 和菲律宾海关）。部分站点可能按国家限制访问（如泰国港务局、越南海关）。所以本目录的核查结果只代表编制者本机。R2 要在实际运行环境里重新核查；上云后，也要在云端出口重新核查一次。
2. **需要 JS 渲染的站点**，本轮默认不抓，改为 `manual`。是否引入无头浏览器，放到 R2 结束后评估，见计划 §6 R2-X。
3. **日期格式特殊：** 泰国用佛历（2569 = 2026），越南用 `dd/mm/yyyy`，部分列表页本身不带日期，日期只在 PDF 或详情页里。
4. **证书链不完整：** 如 PPA。只允许对单个信源配置额外的 CA 证书，**禁止**全局关闭 TLS 校验。
5. **项目里已有的信源有 3 个出了问题：** 蛇口公告已过时（最新条目是 2024-10），泰国港务局和巴生港务局从本机都访问不了，TMD 的 warning-news 也已过时。见 §9。

## 1. 中国（起运侧）

| ID | 等级 | 机构 / 内容 | URL | 方式 | 语言 | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CN-P01 | A | 广东海事局 通告 | https://www.gd.msa.gov.cn/ | web_list | zh | OK (2026-09-29) | P1 | 通告链接在静态 HTML 里。航行警告列表的路径还没找到 |
| CN-P02 | A | 深圳海事局 | https://www.sz.msa.gov.cn/ | web_list | zh | PARTIAL | P1 | 会跳转，R2 要确认最终地址 |
| CN-P03 | A | 上海海事局 | https://www.sh.msa.gov.cn/ | web_list | zh | OK (2026-09-20) | P2 | 负责上海港 |
| CN-P04 | A | 福建海事局（厦门） | https://www.fj.msa.gov.cn/ | web_list | zh | OK (2026-09-24) | P2 | |
| CN-P05 | A | 中国海事局 航行警告（全国） | https://www.msa.gov.cn/ | manual | zh | BLOCKED (403) | P1 | 价值最高，但自动抓取受阻。先人工录入 |
| CN-P06 | A | 浙江海事局（宁波） | https://www.zj.msa.gov.cn/ | manual | zh | BLOCKED (JS) | P2 | 宁波港集团官网也访问不了 |
| CN-P07 | B | 盐田区政府（项目已有） | https://www.yantian.gov.cn/ | web_list | zh | OK | P3 | 区政府门户，港口相关内容少，需要关键词过滤 |
| CN-P08 | B | 南沙区政府（项目已有） | https://www.gzns.gov.cn/ | web_list | zh | PARTIAL | P3 | 静态 HTML 里没有日期 |
| CN-P09 | B | 招商港口 蛇口业务公告（项目已有） | https://www.portshekou.com/ywgg/ | web_list | zh | STALE (最新 2024-10) | P3 | 降权，由 CN-P01/P02 替代 |
| CN-W01 | A | 中央气象台 台风 | https://www.nmc.cn/publish/typhoon/typhoon_new.html | web_list | zh | OK | P1 | 另有未公开的 JSON 接口 `/f/rest/getContent?dataId=`，不作为依赖 |
| CN-W02 | A | 中央气象台 全国预警 | https://www.nmc.cn/publish/country/warning/index.html | web_list | zh | OK | P1 | |
| CN-W03 | A | 广东省气象局 | http://gd.cma.gov.cn/ | web_list | zh | OK (2026-09-29) | P2 | 备选 gd121.cn |
| CN-W04 | A | 深圳气象局 | https://weather.sz.gov.cn/ | web_list | zh | OK | P2 | |
| CN-C01 | A | 海关总署 公告 | http://www.customs.gov.cn/customs/302249/302266/302267/index.html | manual | zh | BLOCKED (412 JS 验证) | P1 | 价值高。先人工录入 |
| CN-T01 | A | 商务部 政策发布 | http://www.mofcom.gov.cn/zcfb/index.html | web_list | zh | OK (2026-09-30) | P1 | |
| CN-T02 | A | 财政部 税政司（出口退税） | https://szs.mof.gov.cn/zhengcefabu/ | web_list | zh | OK (2026-09-04) | P1 | |
| CN-T03 | A | 财政部 政策发布 | https://www.mof.gov.cn/zhengwuxinxi/zhengcefabu/ | web_list | zh | OK (2026-09-29) | P2 | |
| CN-T04 | A | 税务总局 政策法规库 | https://fgk.chinatax.gov.cn/ | web_list | zh | OK (2026-09-08) | P2 | |
| CN-H01 | A | 国务院办公厅 节假日安排 | gov.cn 原文（403）；2026 年通知的新华网转载：https://www.news.cn/politics/20251104/88bcffd88ae249e58c699b8772548e3d/c.html | manual | zh | PARTIAL | P1 | 每年 11 月前后发布。**现有日历里还没有中国**，要新增 |
| CN-M01 | C | 信德海事 | https://www.xindemarinenews.com/ | web_list | zh | OK (2026-09-30) | P2 | 没有 RSS |

## 2. 越南

| ID | 等级 | 机构 / 内容 | URL | 方式 | 语言 | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VN-P01 | A | 越南海事与内河局 VIMAWA 海事通告 | https://vimawa.gov.vn/vi/thong-bao-hang-hai | web_list | vi | PARTIAL | P1 | 原名 VINAMARINE，于 2025 年更名。列表不带日期，用通告编号（TBHH）去重 |
| VN-P02 | B | 海防港 新闻 | https://haiphongport.com.vn/vi/tin-tuc | web_list | vi | OK (22/09/2026) | P2 | |
| VN-P03 | B | 西贡新港（吉莱、盖梅） | https://saigonnewport.com.vn/tin-tuc | web_list | vi | OK (25/09/2026) | P1 | 各地港务监督（cảng vụ）的网站都超时 |
| VN-W01 | A | 国家水文气象预报中心 NCHMF | https://www.nchmf.gov.vn/kttv/vi-VN/1/index.html | web_list | vi | OK (30/09/2026) | P1 | 风暴和洪水公告的链接形如 `-postNNNNN.html`。没有 RSS 或 CAP |
| VN-W02 | A | NCHMF 24 小时海上预报 | https://www.nchmf.gov.vn/kttv/vi-VN/1/thoi-tiet-bien-24h-s12h3-15.html | web_list | vi | OK | P2 | |
| VN-C01 | A | 越南海关 | https://customs.gov.vn/index.jsp?cid=31&pageId=6 | manual | vi | BLOCKED (超时) | P1 | 可能限制境外访问。R2 从越南出口的网络再试 |
| VN-T01 | A | 工贸部 电商与数字经济局 | https://idea.gov.vn/ | web_list | vi | OK (30/09/2026) | P1 | 工贸部主站 moit.gov.vn 返回 403 |
| VN-T02 | A | 财政部 | https://mof.gov.vn/ | manual | vi | BLOCKED (JS) | P1 | 与低价值包裹增值税相关：QĐ 01/2025/QĐ-TTg、86/2026/TT-BTC |
| VN-H01 | A | 政府门户 / 内务部 | https://chinhphu.vn/ | manual | vi | OK | P1 | 项目已有 VN-2026 年历。每年在这里人工核对 |
| VN-L01 | B | GHN | https://ghn.vn/blogs/tin-tuc-ghn | web_list | vi | OK (2026-08-17) | P2 | |
| VN-L02 | B | GHTK | https://ghtk.vn/blog/ | web_list | vi | OK (2026-06-26) | P3 | 以营销内容为主 |
| VN-L03 | B | J&T Express VN | https://jtexpress.vn/vi/news | web_list | vi | OK (23/09/2026) | P2 | |
| VN-L04 | B | Viettel Post / SPX VN / Ninja Van VN | — | manual | vi | BLOCKED | P3 | 反爬、JS 渲染或没有新闻页 |
| VN-D01 | A | 防灾减灾门户 | https://phongchongthientai.mard.gov.vn/Pages/Trang-chu.aspx | web_list | vi | OK (30/09/2026) | P1 | 主管部门已合并入 MAE，域名可能会变 |
| VN-M01 | C | VnExpress 经济 | https://vnexpress.net/rss/kinh-doanh.rss | rss | vi | OK | P2 | 需要关键词过滤 |
| VN-M02 | C | VietNamNet 经济 | https://vietnamnet.vn/rss/kinh-doanh.rss | rss | vi | OK | P3 | 单个 feed 约 1.1 MB |

## 3. 泰国

| ID | 等级 | 机构 / 内容 | URL | 方式 | 语言 | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TH-P01 | A | 泰国港务局 PAT（项目已有） | https://www.port.co.th/ | manual | th/en | BLOCKED (连接被断开) | P1 | 可能按 IP 限制访问。R2 从泰国出口的网络再试 |
| TH-P02 | A | 海事厅 Marine Department | https://md.go.th/feed/ | rss | th | OK (29/09/2026) | P2 | 采购、人事类内容多，需要关键词过滤 |
| TH-P03 | A | 皇家海军水道测量局 航行警告 | https://www.navigationsupport.com/noticestomariners2026 | web_list | th | PARTIAL | P2 | 日期只在 PDF 里。用编号去重 |
| TH-W01 | A | 泰国气象局 TMD CAP 预警（项目已有） | https://www.tmd.go.th/en/api/xml/CAP | rss | en | OK (30/09/2026) | P1 | 泰国气象预警只用这个源 |
| TH-W02 | A | TMD RSS 索引 | https://www.tmd.go.th/en/service/rss | rss | th/en | OK | P3 | 其中的 warning-news 停在 2025 年，不要用 |
| TH-C01 | A | 泰国海关 新闻 | https://www.customs.go.th/list_strc_simple_with_date.php?ini_content=customs_news&ini_menu=menu_public_relations_160421_04&order_by=date&sort_type=0&lang=th | web_list | th | OK (佛历 2569-09-29) | P1 | 佛历日期。也会发布低价值进口相关消息 |
| TH-C02 | A | 泰国海关 公告 | https://www.customs.go.th/list_strc_download_with_docno_date.php?ini_content=announce_160426_01&order_by=date&sort_type=0&lang=th | web_list | th | PARTIAL | P1 | 海关节假日公告：`ini_content=announce_160922_01` |
| TH-T01 | A | 税务厅 / 商务部 / 外贸厅 | https://www.rd.go.th/ ，https://www.moc.go.th/ ，https://www.dft.go.th/ | manual | th | PARTIAL | P2 | 没找到可以抓取的列表页。2026-01-01 起所有进口货物都要缴 VAT，由海关代征 |
| TH-H01 | A | 泰国银行 节假日 | https://www.bot.or.th/en/financial-institutions-holiday.html | manual | en/th | PARTIAL (JS) | P1 | 项目已有 TH-2026 年历 |
| TH-L01 | B | Flash Express | https://www.flashexpress.co.th/news | web_list | th | OK (2026-08-14) | P2 | |
| TH-L02 | B | Kerry/KEX | https://th.kex-express.com/th/news | web_list | th | OK (2026-09-02) | P2 | |
| TH-L03 | B | 泰国邮政 / J&T TH / SPX TH | — | manual | th | BLOCKED | P3 | |
| TH-D01 | A | 防灾减灾厅 DDPM | https://www.disaster.go.th/ | manual | th | BLOCKED (403) | P2 | |
| TH-M01 | C | Bangkok Post 商业 | https://www.bangkokpost.com/rss/data/business.xml | rss | en | OK | P2 | |

## 4. 马来西亚

| ID | 等级 | 机构 / 内容 | URL | 方式 | 语言 | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MY-P01 | A | 巴生港务局 PKA（项目已有） | https://www.pka.gov.my/index.php/en/ | manual | en/ms | BLOCKED (403) | P1 | 由 MY-P02/P03 部分替代 |
| MY-P02 | B | Westports（巴生西港） | https://www.westportsholdings.com/category/press-release/feed/ | rss | en | OK (28/09/2026) | P1 | |
| MY-P03 | B | Northport（巴生北港） | https://www.northport.com.my/np/page-announcements.html | web_list | en/ms | OK (15-09-2026) | P1 | 发布费率和停工通告 |
| MY-P04 | B | 丹戎帕拉帕斯港 PTP | https://www.ptp.com.my/announcements | web_list | en | PARTIAL | P3 | |
| MY-P05 | B | 槟城港 | https://www.penangport.com.my/Media-Center/Announcements | web_list | en | OK | P3 | |
| MY-P06 | A | 海事局 JLM | https://www.marine.gov.my/feed/ ；航运通告页 https://www.marine.gov.my/b-notis-perkapalan-malaysia/ | rss + web_list | ms | OK / PARTIAL | P2 | |
| MY-W01 | A | 马来西亚气象局（经 data.gov.my） | https://api.data.gov.my/weather/warning | json_list | en/ms | OK (30/09/2026) | P1 | 开放 API，带 valid_from 和 valid_to 字段 |
| MY-W02 | A | 洪水信息门户 | https://publicinfobanjir.water.gov.my/ | manual | ms/en | PARTIAL (JS) | P2 | |
| MY-C01 | A | 皇家关税局 JKDM 公告 | https://www.customs.gov.my/ms/arkib/pengumuman?format=feed&type=rss | rss | ms | OK (28/09/2026) | P1 | 媒体报道 feed：`/ms/arkib/liputan-media?format=feed&type=rss` |
| MY-T01 | A | 财政部 新闻稿 | https://www.mof.gov.my/portal/ms/berita/siaran-media?format=feed&type=rss | rss | ms | OK (29/09/2026) | P1 | 低价值商品税为 10%（≤ RM500）。2027 年预算案将于 2026 年 10 月公布 |
| MY-T02 | A | MyLVG / MITI | https://mylvg.customs.gov.my/Home ，https://www.miti.gov.my/ | manual | en/ms | BLOCKED | P3 | |
| MY-H01 | A | 内阁部 公共假期 | https://www.kabinet.gov.my/hari-kelepasan-am/ | manual | ms | BLOCKED (本次连接被断开) | P1 | 项目已有 MY-2026 年历 |
| MY-L01 | B | Pos Malaysia 服务更新 | https://www.pos.com.my/service-update | web_list | en/ms | OK (22/09/2026) | P1 | |
| MY-L02 | B | J&T MY | https://www.jtexpress.my/news | web_list | en/ms | OK (2026-08-09) | P3 | |
| MY-D01 | A | 国家灾害管理署 NADMA | https://www.nadma.gov.my/bm/media-2/berita?format=feed&type=rss | rss | ms | OK (28/09/2026) | P2 | 部分标题编码有问题 |
| MY-M01 | C | Bernama | https://www.bernama.com/en/rssfeed.php | rss | en | OK | P2 | 需要关键词过滤 |

## 5. 印尼

| ID | 等级 | 机构 / 内容 | URL | 方式 | 语言 | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ID-P01 | A | 交通部海运总局 Hubla / MaritimHUB | https://maritimhub.kemenhub.go.id/ | manual | id | BLOCKED (JS) | P1 | 门户正在迁移 |
| ID-P02 | B | Pelindo | https://www.pelindo.co.id/media/berita | manual | id/en | BLOCKED (403) | P2 | |
| ID-W01 | A | BMKG nowcast 预警（项目已有） | https://www.bmkg.go.id/alerts/nowcast/en/rss.xml | rss | en/id | OK (WebFetch) | P1 | 限流 60 次/分钟/IP，必须注明来源。curl 会返回 403 |
| ID-W02 | A | BMKG 海事天气 API | https://maritim.bmkg.go.id/marine2026-data/ （文档 `/apidoc`；`/pelabuhan/{KODE}.json`） | json_list | id | PARTIAL | P1 | 按港口提供海况数据，不需要鉴权 |
| ID-C01 | A | 印尼海关 DJBC | https://www.beacukai.go.id/ | manual | id | BLOCKED | P1 | 新闻页还指向旧站 |
| ID-T01 | A | 贸易部 法规库 JDIH | https://jdih.kemendag.go.id/ | web_list | id | OK | P1 | 可以看到 2026 年的法规 |
| ID-T02 | A | 财政部 法规库 JDIH（PMK） | https://jdih.kemenkeu.go.id/ | web_list | id | PARTIAL | P1 | 跨境电商进口规定以 PMK 形式发布 |
| ID-H01 | A | 人类发展与文化统筹部（三部长联合决定 SKB） | https://www.kemenkopmk.go.id/ | manual | id | PARTIAL | P1 | 项目已有 ID-2026 年历 |
| ID-L01 | B | JNE | https://www.jne.co.id/berita | web_list | id | OK (2026-09-10) | P2 | 其他快递公司都没找到可用的公告页 |
| ID-D01 | A | 国家抗灾署 BNPB | https://bnpb.go.id/berita | manual | id | BLOCKED (403) | P2 | |

## 6. 菲律宾

| ID | 等级 | 机构 / 内容 | URL | 方式 | 语言 | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PH-P01 | A | 菲律宾港务局 PPA | https://www.ppa.com.ph/content/ppa-helpdesk-advisory ，https://www.ppa.com.ph/ppa-port-news | web_list | en | PARTIAL | P1 | 证书链不完整，需要给这个信源单独配置 CA 证书 |
| PH-P02 | A | 海事产业局 MARINA | https://marina.gov.ph/feed/ | rss | en | OK (29/09/2026) | P2 | |
| PH-P03 | A | 菲律宾海岸警卫队 PCG（海上交通暂停） | https://coastguard.gov.ph/ | manual | en | BLOCKED (403) | P2 | 主要在 Facebook 上发布 |
| PH-W01 | A | PAGASA 热带气旋公告 | https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin | web_list | en | OK | P1 | HTML 页面加 PDF。PDF 在风暴结束一周后删除，需要及时抓取 |
| PH-W02 | A | PAGASA 天气/降雨预警 | https://www.pagasa.dost.gov.ph/weather/weather-advisory | web_list | en | OK | P1 | 没有历史归档，只能轮询 |
| PH-C01 | A | 菲律宾海关 BOC 新闻稿 | https://customs.gov.ph/category/media-releases/ | web_list | en | OK (WebFetch) | P1 | WordPress 站，R2 试一下 `/feed/`。CMO 列表：https://customs.gov.ph/customs-memorandum-order-cmo-2026/ |
| PH-T01 | A | 贸工部 DTI 公告 | https://www.dti.gov.ph/category/dti-advisories/feed/ | rss | en | PARTIAL | P2 | |
| PH-T02 | A | 国税局 BIR | https://www.bir.gov.ph/ | manual | en | BLOCKED (JS) | P2 | 负责数字服务 VAT |
| PH-H01 | A | 政府公报 公告（Proclamation） | https://www.officialgazette.gov.ph/section/laws/executive-issuances/proclamations/ | manual | en | BLOCKED (403) | P1 | 项目已有 PH-2026 年历 |
| PH-L01 | B | LBC / J&T PH / Flash PH / Ninja Van PH / SPX PH | — | manual | en | BLOCKED | P3 | 都没找到可用的公告页 |
| PH-D01 | A | 国家减灾委 NDRRMC | https://ndrrmc.gov.ph/ | manual | en | BLOCKED (403) | P2 | |
| PH-M01 | B | PortCalls Asia | https://portcalls.com/feed/ | rss | en | OK (30/09/2026) | P1 | 菲律宾物流资讯里价值最高的源 |

## 7. 跨国信源

### 7.1 台风路径（供系统规则计算，见计划 §4.8）

| ID | 等级 | 内容 | URL | 方式 | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| XX-W01 | A | 日本气象厅 当前热带气旋列表 | https://www.jma.go.jp/bosai/typhoon/data/targetTc.json | json_list | OK | P1 | 接口没有公开文档，但一直很稳定 |
| XX-W02 | A | 日本气象厅 路径和预报 | `https://www.jma.go.jp/bosai/typhoon/data/TC{id}/forecast.json` 、`/specifications.json` | api | OK | P1 | 包括路径、预报位置和风圈半径 |
| XX-W03 | A | 美军联合台风警报中心 JTWC | https://www.metoc.navy.mil/jtwc/rss/jtwc.rss | rss | OK | P2 | 美国政府数据，属公共领域 |
| XX-W04 | A | 香港天文台 警告汇总 | https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en | api | OK | P3 | 以香港为中心 |
| XX-W05 | A | 中央气象台 台风（JSONP） | http://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default | json_list | OK | P3 | 只有 HTTP，没有公开文档，仅作备用 |

### 7.2 船公司公告

| ID | 等级 | 船公司 | URL | 方式 | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| XX-K01 | B | Maersk | https://www.maersk.com/news | web_list | OK | P1 | 文章路径里带日期，有台风季更新。没有 RSS |
| XX-K02 | B | ONE | https://www.one-line.com/en/news | web_list | OK | P1 | 页面约 635 KB |
| XX-K03 | B | SITC | https://www.sitc.com/en/list.asp?classid=44 ；越南站 https://sitcline.vn/ | web_list | OK | P1 | 近洋航线主力船公司 |
| XX-K04 | B | Hapag-Lloyd / Yang Ming | https://www.hapag-lloyd.com/en/services-information/news.html ，https://www.yangming.com/en/esolution/news | manual | PARTIAL (JS) | P3 | |
| XX-K05 | B | COSCO / Evergreen / Wan Hai / MSC / CMA CGM | — | manual | BLOCKED | P2 | 反爬或需要 JS 渲染 |

### 7.3 航运媒体

| ID | 等级 | 名称 | RSS | 核查 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| XX-M01 | B | The Loadstar（项目已有） | https://theloadstar.com/feed/ | OK | P1 |
| XX-M02 | B | Maritime Executive（项目已有） | https://maritime-executive.com/articles.rss | OK | P2 |
| XX-M03 | B | Splash247 | https://splash247.com/feed/ | OK | P1 |
| XX-M04 | B | gCaptain | https://gcaptain.com/feed/ | OK | P2 |
| XX-M05 | B | Container News | https://container-news.com/feed/ | OK | P2 |
| XX-M06 | B | Seatrade Maritime | https://www.seatrade-maritime.com/rss.xml | OK | P3 |
| — | — | Lloyd's List / JOC | 有付费墙，RSS 不可用 | BLOCKED | 不接入 |

### 7.4 运价

| ID | 等级 | 名称 | URL | 方式 | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| XX-R01 | A | SCFI 上海出口集装箱运价指数（东南亚航线） | https://www.sse.net.cn/index/singleIndex?indexType=scfi | — | OK | **不接入** | 用户于 2026-09-30 决定不需要 |
| — | — | Drewry WCI / Freightos FBX | — | — | — | 不接入 | 没有中国到东南亚的航线 |

## 8. 数据接口（非资讯）

| ID | 内容 | URL | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- |
| XX-A01 | Open-Meteo 天气预报（港口坐标的陆地预报：降雨、风、能见度） | https://api.open-meteo.com/v1/forecast | OK | P1 | 免费版只限非商业用途，并要求按 CC BY 4.0 注明来源；条款没有直接说明企业内部使用算不算商业用途。开发和演示阶段用免费版，上线前再决定，见计划 §4.8 |
| XX-A02 | Open-Meteo 海况预报（项目已有） | https://marine-api.open-meteo.com/v1/marine | OK | P1 | 同上 |
| XX-A03 | Open-Meteo 付费版 | https://customer-api.open-meteo.com | OK（未带 key 时返回 401） | P1 | 按月固定收费，价格见 https://open-meteo.com/en/pricing |
| XX-A04 | 阿里云百炼 text-embedding-v4（向量模型，**已选定**） | https://help.aliyun.com/zh/model-studio/embedding | OK（文档） | P1 | 兼容 OpenAI 接口，约 0.5 元 / 百万 tokens，支持 100 多种语言 |
| XX-A05 | 智谱 embedding-3（向量模型） | https://open.bigmodel.cn/api/paas/v4/embeddings | OK（文档） | P2 | 约 0.5 元 / 百万 tokens，作为备选 |
| — | DeepSeek | — | — | — | **不提供向量模型**，只能用于对话和抽取 |
| — | 小米 MiMo | https://api.xiaomimimo.com/v1 | 部分（文档与第三方资料） | — | 2026-09-30 未查到向量模型，以其控制台为准。兼容 OpenAI 接口，可作为二次确认用的对话模型。注意：Token Plan 订阅额度仅限编程工具使用，应用后端须按量付费 |

## 9. 电商大促日历

平台：Shopee、Lazada、TikTok Shop，覆盖越南、泰国、马来西亚、印尼、菲律宾五国。

**做法：先按规则生成日期，再用公开来源核对确认。** 各平台的报名窗口需要登录卖家后台才能看到，所以不做自动抓取。

| 规则 ID | 活动 | 生成规则 | 适用 |
| --- | --- | --- | --- |
| E-R01 | 双数日大促 | 每月 m.m（1.1 到 12.12），活动窗口为当天前 7 天到后 3 天 | 三个平台，五国 |
| E-R02 | 月中大促 | 每月 15 日 | Shopee / Lazada |
| E-R03 | 发薪日大促 | 每月 25 日到月底 | 三个平台 |
| E-R04 | 斋月、开斋节促销季 | 按伊斯兰历计算 | 印尼、马来西亚 |
| E-R05 | Harbolnas 全国网购日 | 2026 年是 12 月 10 日到 16 日（贸易部和 idEA 于 2026-08-27 宣布，经 ANTARA 等媒体报道核实） | 印尼 |
| E-R06 | 圣诞、越南春节、宋干节等 | 固定日期或按农历计算 | 对应国家 |

| ID | 用于核对的来源 | URL | 方式 | 核查 |
| --- | --- | --- | --- | --- |
| XX-E01 | Shopee 越南博客（每月大促日历） | https://shopee.vn/blog/feed/ | rss | OK (29/09/2026)。这是买家博客，只用来核对大促日期，里面没有卖家规则 |
| XX-E02 | Lazada Solutions 活动公告 | https://www.lazadasolutions.com/feed/ | rss | OK (09/09/2026)。另外会发布**广告产品**的规则变化，收录时标为“广告规则”，不当作店铺运营规则 |
| XX-E03 | Shopee 各国活动页 | 例如 https://shopee.ph/m/10-10 | manual | PARTIAL (JS) |
| XX-E04 | Shopee 卖家学习中心 | https://banhang.shopee.vn/edu/article/19321 | manual | OK |
| XX-E05 | TikTok Shop 卖家大学 | https://seller-ph.tiktok.com/university/home | manual | PARTIAL（多数内容需要登录） |
| XX-E06 | Harbolnas 官网 | https://harbolnas.com/ | manual | BLOCKED（只返回一个空页面），改用新闻报道核对 |

每条大促日期都要标明依据：`规则生成（待确认）`、`已由 XX-E0n 确认` 或 `人工录入`。

## 9b. 电商平台规则（政策库使用，核查于 2026-09-30）

**结论：三个平台都没有官方的规则 RSS。** 只有 TikTok Shop 各国卖家大学的“最新政策更新”页面是公开的，不用登录，页面直接带 2026 年的日期。Shopee 和 Lazada 的官方卖家页面，抓到的都是需要 JS 渲染的空壳。跨境（中文）卖家的规则公告在卖家中心后台和企业微信群里，需要登录。

| ID | 等级 | 平台 / 站点 | URL | 方式 | 核查 | 优先级 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| XX-F01 | B（当事方） | TikTok Shop 马来西亚（页面注明也适用于越南） | https://seller-my.tiktok.com/university/essay?knowledge_id=4293090978809617 | web_list（整页对比） | OK（更新于 17/09/2026） | P1 | 单个长页面，平台会反复改写它。按带日期的段落计算哈希，用来发现新增和修改 |
| XX-F02 | B（当事方） | TikTok Shop 越南 | https://seller-vn.tiktok.com/university/essay?knowledge_id=8831988245645057&lang=en | web_list（整页对比） | OK（更新于 01/07/2026） | P3 | 可能已经被 XX-F01 取代 |
| XX-F03 | B（当事方） | TikTok Shop 菲律宾 | https://seller-ph.tiktok.com/university/essay?knowledge_id=1348211165366017&lang=en | manual | STALE（页面标注已废弃，最后更新 25 Jun 2026） | P2 | 新页面的地址还没找到，R2 阶段再查 |
| XX-F04 | B（当事方） | TikTok Shop / Tokopedia 印尼 | https://seller-id.tokopedia.com/university/essay?knowledge_id=4293090979071761 | web_list（整页对比） | BLOCKED（本次返回 504） | P2 | R2 阶段重试 |
| XX-F05 | B（当事方） | TikTok Shop 跨境（中文，全球卖家学习中心） | https://seller.tiktokglobalshop.com/university/home | manual | BLOCKED（JS） | P1 | 跨境运费、规则公告都在这里 |
| XX-F06 | B（当事方） | Shopee 跨境（中文卖家学习中心 / 卖家中心公告） | https://shopee.cn/edu/ | manual | BLOCKED（JS，公告需要登录） | P1 | 费率附件一般只在后台或企业微信里发 |
| XX-F07 | B（当事方） | Shopee 马来西亚、菲律宾本地卖家教育中心 | https://seller.shopee.com.my/edu ，https://seller.shopee.ph/edu | manual | BLOCKED（JS） | P3 | 本地卖家规则，和跨境规则只有部分重叠 |
| XX-F08 | B（当事方） | Lazada 跨境（中文，Lazada University / 卖家中心公告） | https://university.lazada.com/ | manual | BLOCKED（JS，部分内容需要登录） | P1 | LGS 运费、技术支持费、佣金 |
| — | — | 第三方聚合站（雨果网等） | — | 不接入 | — | — | 只能当线索，不作为规则的依据 |

**录入分工建议：** Shopee 和 Lazada 的跨境规则，由平时就会登录卖家后台的同事看到新公告后顺手录入。不要求固定频率，但建议每周看一次后台公告。无头浏览器能不能抓这些页面，放到 R2-X 一起评估。

## 10. 天气预报地点

**港口海况（已有 8 个港口）：** CNSHK、CNYTN、CNNSA、THLCH、MYPKG、PHMNL、IDJKT、VNSGN。

**末端派送城市：本轮不做**（2026-09-30 用户决定）。派送影响依据各国的官方预警、灾害机构通报和媒体报道来判断。

**候选扩展港口（信源里出现过，本轮不纳入，2026-09-30 用户决定）：** 海防 VNHPH、盖梅 VNCMT、宁波 CNNGB、上海 CNSHA、厦门 CNXMN、泗水 IDSUB、宿务 PHCEB、丹戎帕拉帕斯 MYTPP。

## 11. 统计与主要缺口

- 目录共 116 条（按行计）：自动方式 83 条（包括数据接口和部分 `PARTIAL` 条目），人工录入 33 条。
- **最有价值但抓不到的官方来源：** 中国海事局航行警告、海关总署公告、越南海关和财政部、泰国港务局、巴生港务局、印尼海关和 Hubla、菲律宾海岸警卫队。这些来源可以在后台通过“人工录入”补充，录入的内容标为“官方通知（人工录入）”。人工录入是**可选的**，不录入不影响系统运行。
- **快递公司公告普遍抓不到。** 末端派送的判断主要依靠天气规则、灾害机构和媒体报道。
