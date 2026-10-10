# VN-W01 NCHMF 官方预警入口：只读结构核验（2026-10-10）

范围：只读抓取，不写接入代码，不改 VNSGN 已验收参考点，不重跑八港天气 live。VN-W02（24 小时海上预报）只有 24 小时，不能替代 7 天数据，本次不涉及。

## 固定入口
- 信源目录 `docs/intel-source-catalog.md` VN-W01：`https://www.nchmf.gov.vn/kttv/vi-VN/1/index.html`（web_list，vi），ADR-008 官方预警行列出 NCHMF。
- 抓取时间 2026-10-10 17:07–17:10（UTC+8），UA `ShippingHOT-readonly/1.0`，curl 跟随跳转。日志：`raw/fetch-log.txt`；响应头：`raw/*-headers.txt`。

## 样本（`raw/`，已脱敏：ASP.NET_SessionId、__VIEWSTATE、地图 token 均替换为 `<redacted>`）
| 文件 | URL | HTTP |
|---|---|---|
| index.html | 入口首页 | 200，259279 B |
| post54353.html | tin-du-bao-gio-manh-song-lon-va-mua-dong-tren-bien-post54353（海上大风大浪雷雨） | 200 |
| post54492.html | tin-canh-bao-du-bao-trieu-cuong-vung-ven-bien-nam-bo-post54492（南部沿海天文大潮） | 200 |
| post54547.html | tin-canh-bao-lu-tren-song-dong-nai-post54547（同奈河洪水） | 200 |
| missing.html | 不存在的 post99999999 | **200**（空正文） |
| post54353/54492-attachment-404.html | 页面内 PDF 链接（kttv.gov.vn//upload/...pdf） | **404** |

## 结构发现
1. **格式**：服务端渲染 HTML（IIS / ASP.NET WebForms，`text/html; charset=utf-8`）。没有 RSS/CAP/JSON。首页列表项为 `<a href=".../<slug>-postNNNNN.html">标题</a>`，标题后括号带日期，有的带时间（如 `(10/10/2026 15:30:00)`），有的只有日期 `(10/10/2026)`。
2. **身份**：唯一可用标识是 URL 中的 `postNNNNN` 数字。同一主题的更新是**新 post**（例如同奈河洪水 09:00 为 post54527、15:31 为 post54547；顺化以北洪水 post54529→post54546），没有“替代/取消哪一条”的结构字段。更新方式：列表追加新 post，旧 post 仍可访问。
3. **发布时间/时区**：正文末尾为自由文本，如 `Tin phát lúc: 16h00`（post54353 只有时刻无日期，日期只能取自列表标题）、`Tin phát lúc 15h30' ngày 10/10/2026`。**原文不标时区**（越南当地时间为常识推断，未经原文证实 → 记为未确认）。响应头无 Last-Modified。
4. **有效期**：没有结构化 valid_from/valid_to。正文只有“预报 24 小时内 / 24–48 小时”及“下一期发布时间”（如 `Tin phát tiếp theo lúc: 04h00 ngày 11/10`、`Bản tin tiếp theo được phát lúc: 15h30 ngày 11/10/2026`）。有效期 = **未知**；下一期时间只能作为参考文本保存。
5. **影响区域**：只在正文自由文本中，例如 post54353“vùng biển từ Nam Quảng Trị đến Cà Mau … vịnh Thái Lan … Bắc Biển Đông”；post54492“ven biển Nam Bộ”，站点 Vũng Tàu（TP. Hồ Chí Minh）。没有多边形、坐标、行政编码。原文**未提及** Cát Lái / Sài Gòn 港或任何港口名。
6. **级别**：没有 CAP 式 severity。部分正文有官方文字“Cấp độ rủi ro thiên tai trên biển: cấp 2”（海上灾害风险等级 2，post54353），这是原文字段，可原样保存；其他样本（洪水、潮汛）未见同类字段 → 未提供。不推断 severity。
7. **附件**：页面内 PDF 链接（kttv.gov.vn）本次均 404，PDF 不可作为依赖。
8. **空数据 vs 抓取失败**：不存在的 post 返回 **HTTP 200 + 空正文**（标题区为空）。因此 HTTP 200 不能证明拿到预警；需以“正文标题/内容区非空”判定。网络错误/非 200 = 抓取失败；首页列表无预警类链接 = 空（但不能区分“确无预警”与“页面改版”）。
9. 列表混有非预警内容（10 天趋势、水文日报、10 天浪/流预报），需按标题/栏目白名单区分预警类（`TIN CẢNH BÁO`、`TIN DỰ BÁO GIÓ MẠNH, SÓNG LỚN`、`TIN DỰ BÁO MƯA LỚN`、台风等）。

## 未知（如实记录）
时区、有效期、结构化区域、官方 severity（除个别正文“灾害风险等级”外）、取消/替代关系、港口覆盖：均为**未知**。不编造级别，不推断 VNSGN/港口覆盖。

集成建议见 `docs/evidence/nchmf-warning-2026-10-10-integration-proposal.md`。
