# 促销日期：开源项目与平台官方窗口核验（只读研究，2026-10-12）

依据：dots ts 1791790277.780789（2026-10-12 15:31 UTC+8）。本轮**只读研究和提出建议**：不安装依赖，不重写日历，不把任何事件标为已确认，不新增实时 provider。现有 E-R04/E-R06 仍然只有节日锚点，促销窗口仍为“待定”。证据目录：`r1-5-promo-research-2026-10-12/`。

> **更正（dots ts 1791790695.728109 / 1791790821.307749，2026-10-12 15:47 UTC+8）**：
> - dots 对官方 URL 的网页文本提取看到了 ID「Big Ramadan Sale 2026」2/11–3/22 和 VN 2.2 1/26–2/4（VN 那次提取约 4 天前、沿用了页面标题）。我们的直接抓取只拿到 JS 外壳。两者**不矛盾**：前者是提取文本，后者是原始 HTML。
> - 两条统一记为 **“官方URL提取文本支持，实时原始页面复核未完成”**。不写“官方站没有日期”，也不写“只有媒体证据”；**仍未确认**。
> - XX-E01 的目录口径覆盖 VN 博客（不只是 `/feed/`）；XX-E03 的目录口径覆盖各国活动页（PH 只是示例），当前实现只放行 PH 是另一回事，本轮**不扩白名单**。
> - 外部项目 19/19：当时没有保存日志，标为**执行者自报，未独立复核**。
> - VN 博客里的四个窗口是**有原文支持的候选**；本轮不新增字段，也不录入条目。

## 1. 开源候选 VN Peak Trading Calendar
- 仓库 https://github.com/dannybosie/vn-peak-trading-calendar，核验的提交是 `13ea6ad4d68596a0dffe3baad5162fe2ee3de89f`（2026-10-03T23:15:20+07:00）。在盒子上 `git clone --depth 1` 只读查看，**没有加入本项目，也没有执行 npm install**。
- **许可证**：`LICENSE` 是 MIT（Copyright (c) 2026 Thinh Nguyen (Danny)），`package.json` 里也写着 `"license": "MIT"`。如果借用代码，需要保留版权声明和许可文本。
- **越南规则**（`src/core/events.ts`）：
  - 规则有四类：fixed（固定日期）、monthly（每月某日）、lunar（农历）、nth-weekday（第 n 个星期几）。
  - 大促只有锚点日（m.m、15 日、25 日到月底）。README 的 Limits 一节明确写着：平台的实际窗口因平台和年份而异，要以各平台卖家中心为准。
  - 法定假日按法定日期放置，每年公布的实际放假安排单独写在 `observed`，按年份记录并附公告编号，例如 2026 年春节引用 Bộ Nội vụ 9441/TB-BNV。
  - 它是**规则锚点加每月重算**（GitHub Pages 每月 1 日由 cron 重建），**不采集平台的实际活动**。
- **农历测试**（`test/lunar.test.ts`）：
  - 2025 到 2028 年各节日的公历日期，作者注明逐一对照了越南出版的历书（xemlicham.com、VOV）。
  - 闰月：2025 年闰六月、2028 年闰五月。
  - 按越南 UTC+7 计算，与中国 UTC+8 的结果不同：例如 2007 年春节越南是 2 月 17 日、中国是 2 月 18 日，1985 年两国相差一个月。
  - 接近午夜的朔日：作者说 2026 年 Vu Lan 那次朔日是 8 月 13 日 00:37，用完整的 Meeus 级数才能正确算到 8 月 27 日，常见的截断级数会算成 26 日。
  - 我在用户机器的 TEMP 目录用 Node v24.15.0 运行 `node --test test/lunar.test.ts test/calendar.test.ts`：**19/19 通过，exit 0**（不需要装任何依赖；**执行者自报，未保存日志，未独立复核**）。盒子上的 Node v20 不能直接运行 .ts，结果 0/2，这是环境问题，不是项目本身的问题。
  - 这些只说明它的代码与它自己的测试数据一致；历书对照是作者的说法，**我没有独立重算**。
- **ICS 结构**（`src/core/ics.ts`）：
  - VCALENDAR 带 `X-WR-TIMEZONE:Asia/Ho_Chi_Minh`、`REFRESH-INTERVAL P1D`；事件是全天的 `DTSTART;VALUE=DATE`，`DTEND` 取结束日后一天（不含）；UID 稳定；按 75 字节折行且不切断 UTF-8 字符；另有单独的准备期提醒 feed。
  - **发现一个缺陷**：`escapeText` 里写的是 `"\;"`，在 JS 里这等于普通的 `;`，所以分号**没有**按 RFC 5545 §3.3.11 转义成 `\;`。实测 `X-WR-CALDESC:A\, B; C`，它自带的测试断言也是同样写错的。如果借用这段，要修正。
- **可以借鉴的点**（只是建议，本轮没有实施）：
  1. 越南农历按 UTC+7 计算，用完整的朔日级数，并把那些容易错的测试点（2007 和 1985 年春节、2026 年 Vu Lan、闰月）作为我们自己的**回归测试点**。我们现在的 VN 春节锚点来自年度参考日历的假日数据，可以用这些点做交叉检查。
  2. 把**规则日期**和**当年公告的实际放假安排**分开，后者附上公告编号。这和我们“生成依据”与“确认证据”分离的原则一致。
  3. ICS 的全天事件 DTEND 不含结束日、稳定 UID、按 UTF-8 折行（但要修正分号转义）。
- **差异，以及不照搬的部分**：
  - 不照搬它的准备期天数（60、30、21、14、7 天）、强度分级（tentpole、major 等）、文化送礼日期和 UI。
  - 它的 15 日、25 日锚点对所有平台都是一样的；我们的 E-R02 只适用 Shopee 和 Lazada，E-R01 的窗口是目录规定的“前 7 天到后 3 天”。两者口径不同，**不应该互相覆盖**。
  - 它只覆盖越南；我们是五国三平台。

## 2. 两个平台官方活动窗口
| 线索 | 实际抓取 | 结果 | 结论 |
|---|---|---|---|
| Shopee ID「Big Ramadan Sale」，线索 2026-02-11 到 03-22 | `https://shopee.co.id/m/big-ramadan-sale`：200，无跳转；页面是 JS 外壳，没有标题、没有可见文字，HTML 里没有活动名或日期；WebFetch 也只拿到 JS | 我方直接抓取只拿到 JS 外壳；dots 的官方 URL 提取文本含该名称和 2/11–3/22 | **官方URL提取文本支持，实时原始页面复核未完成**（未确认） |
| Shopee VN「tet-sieu-sale」，线索 2026-01-26 到 02-04 | `https://shopee.vn/m/tet-sieu-sale`：200，无跳转；同样是 JS 外壳 | 我方直接抓取只拿到 JS 外壳；dots 的官方 URL 提取文本（约 4 天前、沿用页面标题）含 2.2 和 1/26–2/4 | **官方URL提取文本支持，实时原始页面复核未完成**（未确认）；该 URL 与活动名的对应关系仍待原始页面复核（见下） |

- **Shopee ID**：
  - 除 dots 的官方 URL 提取文本外，媒体也有同一窗口：Kompas.com 2026-02-13 07:59 WIB 的报道写着「Kampanye Big Ramadan Sale 2026 sendiri berlangsung selama 40 hari, mulai Rabu (11/2/2026) hingga Minggu (22/3/2026)」，已存档。页面上「Lihat Foto Media Gathering」说明是媒体见面会稿件；它属于**媒体**，不是平台原文。
  - 原文只写了日期，没写起止时刻，也没写时区，所以不补造。
  - 搜索摘要里还有 detik 提到 3 月 9 日高峰日、00:00 到 04:00 WIB 的 Midnight Sale，以及 shopee.co.id 另一个落地页上“Berlaku Hingga: 23 Mar”的店铺券。这些都**只是摘要，没有存档**，而且店铺券和单日场次都不是整个活动的窗口。
- **Shopee VN**：
  - 官方买家博客（XX-E01 的域名）https://shopee.vn/blog/uu-dai-tet/ 已存档，发布于 2026-01-29T23:35:47+07:00，修改于 2026-02-10T15:42:07+07:00。原文列出的 2026 年春节系列活动：
    - 「1.1 Sale Mở Màn Năm Mới」01.01.2026
    - 「15.1 Siêu Sale Năm Mới」从 26.12.2025 到 17.01.2026
    - 「25.1 Sale Năm Mới」从 18.1 到 25.1
    - 「2.2 Tết Sale」：**原文没有写起止日期**
    - 「Mua Hàng Xuyên Tết – Shopee Có Hết」从 14/2 到 22/2
    - 「25.2 Sale Khai Xuân」从 23/2 到 25/2
  - **01-26 到 02-04**：dots 对官方 URL 的提取文本含这组日期；BigSeller 博客（卖家工具类）对「Tết Sale 2.2」也有同样描述；我们抓到的官方博客 2.2 一节没有写日期。记为“官方URL提取文本支持，实时原始页面复核未完成”，未确认。
  - 而 `/m/tet-sieu-sale` 这个 URL：在媒体稿（Saostar，只看到搜索摘要）里，它是「15.1 Siêu Sale Năm Mới」的落地链接，不是 2.2 那个活动的。
  - 官方原文对日期也只写日，不写时刻和时区，所以不补造。
  - 原文里的「Hưởng ứng chương trình Khuyến mại Tập trung …（18/01/2026 – 20/02/2026）」和「…quốc gia 2025（1/12/2025 – 18/1/2026）」是**政府组织的集中促销计划**，不是 Shopee 的活动窗口。运费券、SPayLater、Xu 这些属于单项优惠，也不是平台的整体活动。
- **没有为了过关借用别的国家或年份的数据**。官方 `/m/` 页面今天渲染出来的是当前内容，就算渲染成功也不能代表 2026 年 2 月的活动；而这次连渲染都没有拿到。

## 3. 来源分级（这次看到的）
| 类别 | 例子 | 能否作为官方确认 |
|---|---|---|
| 官方活动原文 | shopee.co.id/m/…、shopee.vn/m/…（我方直抓为 JS 外壳；dots 的提取文本有日期，原始页面复核未完成）；shopee.vn/blog（官方买家博客，有原文） | 博客：可以作为 VN 的窗口依据，但只限原文明确写了起止日期的活动；`/m/` 页：提取文本可作支持，完成原始页面复核前不标确认 |
| 官方社媒 | 本轮没有检索 | — |
| 媒体 | Kompas、detik、Saostar、vnexpress | 不能，只算线索 |
| 卖家经验或第三方工具 | BigSeller 博客 | 不能，只算线索 |
| 开源规则 | VN Peak Trading Calendar | 不能，只能作为生成依据或交叉检查 |

另外：节日日期不是促销窗口；物流延期、银行券、线下市集、政府集中促销都不是平台的整体活动。

## 4. 对照现有实现，以及最小建议
- **现状**：
  - `server/services/promo-calendar.ts` 里，E-R04（ID、MY 开斋节锚点）和 E-R06（VN 春节等）都是 `promo_anchor`，`windowStatus` 为 pending，`platform` 为 `unspecified`。
  - 确认靠 `promoEvidenceSources`（XX-E01 到 E06 加 manual_url），`generationBasis` 不会被确认覆盖。
- **发现的口径缺口**：
  - (a) XX-E03 的**目录口径**覆盖各国 Shopee 活动页（shopee.ph 只是示例）；**当前实现**的 `hostsByCountry` 只放行 PH，ID 活动页目前只能走 `manual_url`。这是实现与目录的差异，单独记录，本轮**不扩白名单**。
  - (b) XX-E01 的**目录口径**覆盖 VN 官方博客（不只是 `/feed/`）；当前实现按域名 `shopee.vn` 校验，`/m/*` 活动页也会被接受。是否按路径区分由 dots 决定，本轮不改。
- **最小建议（不在本轮实施，需要批准后再做）**：
  1. 新增“特定年、国家、平台的有据活动”条目（可以作为 `entryKind: "evidenced"`，或者复用 manual 加字段）。必须填：`year`、`countryCode`、`platform`、`originalCampaignName`（原文名称，原样保留）、`startsAt`/`endsAt`（只用原文写明的日期）、`timeOfDay`（原文没写就是 null）和 `timezone`（原文没写就是 null，不推定）、`sourceUrl`、`sourceClass`（取值：official_campaign_page、official_blog、official_social、media、seller_tool、open_source_rule）、`fetchedAt`、`archiveSha256`（脱敏前和脱敏后分开记录）。
  2. **生成依据和确认证据分开存放**：规则或开源计算出的日期只能进 `generationBasis`。只有 `sourceClass` 为 official_campaign_page 或 official_blog，并且原文写明了这个年份、国家、活动名和起止日期，才能变成“已由 … 确认”。media、seller_tool、open_source_rule 只能标为“线索（未确认）”。
  3. **不覆盖 E-R04/E-R06 的锚点**：有据活动作为单独的一条显示，和锚点并列，互相引用。
  4. 按这个口径，目前**可以录入的只有** VN Shopee 2026 年的「15.1 Siêu Sale Năm Mới」26.12.2025 到 17.01.2026、「25.1 Sale Năm Mới」18.1 到 25.1、「Mua Hàng Xuyên Tết」14/2 到 22/2、「25.2 Sale Khai Xuân」23/2 到 25/2（都来自官方博客，只有日期，没有时刻和时区）。ID 的 Big Ramadan Sale 只能作为媒体线索。这四条是**有原文支持的候选**，**本轮不新增字段，也没有录入任何一条。**
