# MY-W01 MET Malaysia 预警（data.gov.my）— 只读结构核验，2026-10-10

范围：只读结构核验。**尚未接入流水线**（按 dots 指示，等审查本摘要）。本轮没有任何天气请求，也没跑天气 live；天气基线仍是 `ff4ac76`（见 `gate-50bad03`）。配置开关未改。

## 请求与响应（原始样本：`metmalaysia-warning-2026-10-10/raw/`）
- `GET https://api.data.gov.my/weather/warning`（目录登记 URL，不跟随重定向），2026-10-10T07:54:41Z → **HTTP 301**，`location: /weather/warning/`（同主机），正文为空。见 `headers-301.txt`。
- `GET https://api.data.gov.my/weather/warning/`（带斜杠，不跟随重定向），约 07:55Z → **HTTP 200**，`application/json`，7688 字节，返回 **JSON 数组，共 4 行**。见 `warning.json`（原样，内容为公开数据，无需脱敏）和 `headers-200.txt`（已去掉 report-to/nel 等无关头）。
- 官方字段说明：https://developer.data.gov.my/realtime-api/weather（Warning Forecast 一节）。

## 实际结构（按样本与官方文档，不按字段名猜）
| 字段 | 实际内容 |
|---|---|
| `warning_issue.issued` | 发布时间，如 `2026-10-10T14:00:00`，**无时区偏移** |
| `warning_issue.title_en/title_bm` | 标题，如 Strong Winds and Rough Seas Warning / Thunderstorms Warning / No Advisory |
| `valid_from` / `valid_to` | 有效期，**无时区偏移**；"No Advisory" 行为 `null` |
| `heading_*` / `text_*` / `instruction_*` | 自由文本；受影响地区只出现在 `text_*` 里 |

- **有效期**：有 `valid_from`/`valid_to` 两个字段，但时区未在文档中说明（同一页面的 earthquake 接口明确区分 UTC 和 UTC+08:00，warning 接口没有）。样本里 issued 14:00 在 15:54 MYT 时可见，与 +08:00 一致，但这**只是推断，不是有文档依据的事实**。
- **官方严重度**：**没有严重度字段**。标题里有类别名（如 Strong Winds and Rough Seas），但没有等级字段。
- **结构化区域**：**没有任何结构化区域字段**（没有代码、坐标、多边形或区域列表）。地区只出现在自由文本中，例如 "waters of Perak • Selangor • …"、"Northern Straits Of Melaka"、"Selangor (… Klang …)"。
- **"无预警"表示**：样本中有一行 `title_en: "No Advisory"`，`valid_from`/`valid_to` 为 null。空数组 `[]` 的含义未在文档中说明。

## Port Klang 映射：缺口
- 当次样本中，第 3 行（Thunderstorms Warning）的正文写有 "Selangor (… Klang …)"，第 1、2 行写有 "waters of … Selangor …" 和 "Northern Straits Of Melaka"。这些**全部是自由文本地名**。
- 按规则，正文地名不能算覆盖，所以**目前没有可靠依据把任何一行映射到 Port Klang**。如果要映射，需要官方结构化区域字段，或经审查认可的官方区域编码表；本源两者都不提供。
- 结论：这个源目前只能提供"马来西亚存在有效官方预警"这一信息（有效期需按推断的 +08:00 解读），**无法关联 Port Klang**，严重度也无法取官方值。

## 本轮未做的事
- 未把该源加入 `officialWeatherAlertSources`，没有改 parser/provider/存储/面板，也没改任何开关。
- 收到改计划指示前，我曾在本地写了一版接入草稿（未推送）。已撤回本地提交，草稿保存在被 git 忽略的 `.tmp/my-w01-shelved/`，不在仓库里。草稿当时跑过一次隔离探测：1 次请求，3 条有效预警，Port Klang 影响为 0。这次探测只调用 data.gov.my 的预警接口，不是天气请求；它不作为本次核验的依据，仅如实说明。
