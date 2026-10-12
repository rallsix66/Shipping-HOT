# PH-W01 / PH-W02 PAGASA 官方入口：只读结构核验（2026-10-10）

范围：只读抓取，不写接入代码，不重跑八港天气，不动生产开关。信源目录 `docs/intel-source-catalog.md`：PH-W01 热带气旋公报（web_list，备注“HTML 页面 + PDF；PDF 在风暴结束一周后删除，需要及时抓取”），PH-W02 天气/降雨预警（备注“没有历史归档，只能轮询”）。

## 请求（`raw/fetch-log.txt`，UA `ShippingHOT-readonly/1.0`，`redirect: manual`，每个 URL 1 次）
| 时间（UTC+8） | URL | HTTP | 重定向 | 大小 |
|---|---|---|---|---|
| 19:03:48 | https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin（PH-W01） | 200 text/html | 无 | 131967 B |
| 19:03:49 | https://www.pagasa.dost.gov.ph/weather/weather-advisory（PH-W02） | 200 text/html | 无 | 131818 B |
| 19:04:05 | https://www.pagasa.dost.gov.ph/tropical-cyclone-advisory-iframe（页面导航里的“Tropical Cyclone Advisory”，仅作对照） | 200 text/html | 无 | 132254 B |

服务端为 Apache + PHP 7.4（响应头见 `raw/*.headers.txt`，已去掉 Set-Cookie）。没有重试，没有失败。

## 观察到的结构（仅限本次快照）
1. **PH-W01**：服务端渲染 HTML。正文容器 `.tropical-cyclone-weather-bulletin-page .article-content .panel-body`，本次只有一句 `<h3>No Active Tropical Cyclone within the Philippine Area of Responsibility</h3>`。页面中**没有任何公报正文、编号、发布时间或 PDF 链接**。
2. **PH-W02**：正文容器 `.article-content.weather-advisory .weekly-advisory-content .weekly-content-adv`，本次只有 `<p>As of today, there is no Weather Advisory issued.</p>`。同样没有正文、编号、时间、PDF。
3. **TC Advisory iframe 页**：`No Active Tropical Cyclone outside the Philippine Area of Responsibility`。
4. 三个页面中出现的 `pubfiles.pagasa.dost.gov.ph` 链接都只是侧栏图标；`.pdf` 链接 0 个；没有“归档/往期”链接。

## 只能确认的、无法确认的
- **可确认**：入口可达（200、无重定向）；“无活动公报/无预警”有固定的官方原文，可与抓取/解析失败区分（失败 = 非 200、重定向、或上述容器缺失）。
- **本次无法核验（没有正样本，均记为未知，不推测）**：公报身份与编号、修订/取消关系、原文发布时间格式与时区、有效期、官方等级体系（如 TCWS 信号、降雨颜色预警）、明确列出的影响区域、PDF 的位置与字段。
- **“已过期公报”**：本次两页都处于“无公报”状态，未观察到过期公报的呈现方式，无法区分“已过期”与“已撤下”。
- **信源目录的说法未核实**：页面上没有 PDF 链接，也没有历史/归档入口，所以“PDF 一周后删除”“没有历史归档”两条**本次既不能证实也不能否定**。没有猜测 PDF 地址去探测。
- **PDF**：本次没有官方 PDF 可分析。

## 脱敏与密钥扫描
- 抓取脚本（`probe.cjs.txt`，存为 .txt 不参与构建）在保存前：整段移除含 key/token/tracker（appid、api key、token、openweathermap、gtag/googletagmanager）的 `<script>`，把 `key/token/csrf/_token` 形式的长值替换为 `<redacted>`，移除 csrf meta 与 `_token` 表单值；响应头不保存 Cookie。
- 提交前扫描 raw：类密钥赋值 0 处；32 位十六进制串每页 2 处，均为站点 `/combine/<hash>-<ts>.css/.js` 静态资源合并文件名，不是密钥，保留。

## 结论
抓取时（2026-10-10 19:03–19:04 UTC+8）三个页面分别只显示：PH-W01 “No Active Tropical Cyclone within the Philippine Area of Responsibility”（PAR 内无活动热带气旋）；TC Advisory 页 “No Active Tropical Cyclone outside the Philippine Area of Responsibility”（PAR 外无活动热带气旋）；PH-W02 “As of today, there is no Weather Advisory issued.”（今天未发布 Weather Advisory）。这只是这三个页面当时的原文，**不能**解读为“菲律宾无预警”或“无天气风险”。缺少正样本，不能据此设计字段级解析。

## 检查类型区分（2026-10-11 补充）
- 自写扫描：抓取脚本的脱敏 + 提交前对 raw 的类密钥正则扫描（0 处）。仅覆盖本目录 raw。
- 盘点脚本：Neat Freak `scripts/audit-inventory.sh` 只是目录/规则链/Git/Markdown 盘点，exit 0 **不是**密钥扫描或安全审计。本次运行：2026-10-10 19:06:28 UTC+8，HEAD `ba0126d3f6754071474969d671acdd24a7f882d8`，exit 0，完整输出 `audit-inventory-ba0126d.log`。
- 人工复核：对页面结构、空状态原文的人工阅读。接入建议见 `docs/evidence/pagasa-warning-2026-10-10-integration-proposal.md`。
