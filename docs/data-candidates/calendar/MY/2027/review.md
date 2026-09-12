# 马来西亚 2027 年度日历候选

- 状态：`published_official_file_pending` / **未晋级**
- 核查日：2026-09-12
- 范围：联邦与州别公共假日；替代休假规则。

## 已确认事实

- BKPP / Jabatan Perdana Menteri（首相署内阁、宪法及政府间关系组）已在官方渠道正式列出 **Hari Kelepasan Am Tahun 2027**（联邦 15 日 + 州别）。
- 2026-09-12 尝试直接取得 kabinet.gov.my 官方 downloadable file 时发生连接错误（transport error），**尚未取得官方 PDF**。

## 严禁

- 不得依据新闻报道的“15 个联邦假日”作为正式依据晋级。
- 未取得并逐项解析官方文件前，不创建 `server/data/annual-calendar/MY-2027.json`，也不生成猜测 JSON。

## 下一步

1. 取得官方 HKA-2027 / 宪报文件（kabinet.gov.my）。
2. 逐项解析 federal/state applicability、替代休假规则、发布日期。
3. 结构化候选 → `calendar:diff` 校验 → 通过后才晋级运行时 JSON。

## 官方文件获取尝试（2026-09-12，均未取得）

- https://www.kabinet.gov.my/hari-kelepasan-am/ → 连接超时（Connect Timeout Error, 443）。
- https://www.kabinet.gov.my/storage/2026/08/HKA-2027.pdf → 连接超时。
- https://www.malaysia.gov.my/en/calendar → HTTP 200，但为 JS 应用，未返回 2027/HKA 直链。
- 结论：保持 `published_not_imported`；未用新闻报道替代官方文件，未生成 MY-2027.json。取得官方文件后按 candidate→calendar:diff→语义核对→runtime 晋级。
