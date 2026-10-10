# VN-W01 NCHMF 有限接入（2026-10-10，dots 17:14 审核边界）

代码：`c064e5a`（接入）；样本/文档更正：`1faa4d9`。门禁（干净 `c064e5a`）：`docs/evidence/gate-c064e5a/`。

## 样本更正（A）
- 洪水 post54547 正文有原文风险级别“Cảnh báo cấp độ rủi ro thiên tai do lũ: Cấp 1”，海上 post54353 有“cấp 2”；潮汛 post54492 未给出 → 未提供。原文级别一律按“原始级别，标准化严重度未映射”展示，不映射 CAP/系统级别。
- 存档详情页内嵌的第三方天气挂件脚本含其 API key：脚本块整段移除、残留参数值 `<redacted>`；代码不使用该值，真实运行保存的 raw 同样先脱敏。限制：此前已推送的 `5e439a7` 的 Git 历史仍含原样本，按规则不强推改写（如需轮换/清理历史，需用户决定）。

## 边界 → 实现（B）
1. 抓取：只抓固定 HTTPS 列表页 `https://www.nchmf.gov.vn/kttv/vi-VN/1/index.html` + 同 host、路径 `/kttv/vi-VN/1/<slug>-post<digits>.html` 的文章；拒绝凭据、query、fragment、端口、其他 host/路径、PDF/图片/脚本；`redirect: "error"` 并复核 `redirected`/最终 URL；按 postId 去重；每次运行最多 1 + 12 个请求（`NCHMF_MAX_ARTICLES`），超出的计入 `truncated`。
2. 解析：标题 `.content-news h2.tt-content-news`，正文 `.content-news .text-content-news`；去掉 script/style/iframe/form/img 等，保留段落与表格文本（单元格以 ` | ` 分隔），NFC 规范化；标题、正文都非空才算成功，HTTP 200 空文章 = 失败；页眉页脚、菜单、侧栏不读（只读“Tin cảnh báo thiên tai”与“Tin khí tượng thủy văn”两个列表块）。
3. 筛选：预警块内全部 + 样本确认的标题族（越南文大小写/Unicode 不敏感：`tin canh bao…`、`ban tin canh bao…`（含“Bản tin cảnh báo lũ”）、`tin du bao gio manh/song lon/mua lon/bao/ap thap nhiet doi/trieu cuong/lu…`、含 `trieu cuong` 的潮汛）；排除 10 天趋势、每日（hang ngay）、xu thế、气候特征。
4. 身份：`weather-alert:nchmf:<postId>`；同 postId 内容变化 → 更新记录，保留首次接收时间并记 `contentUpdatedAt`；新 post = 新记录；不推断更新/取代/取消。列表时间、正文发布时间、下一期发布时间各自原文保存；下一期时间 ≠ 有效期；不猜时区。
5. 展示：仅既有 Feed（`/feed`），按发布国家分组（侧栏“官方预警·发布国家（实验）”计数 + 每条“发布国家：VN”，列表按发布国家排序）；生命周期未知、预警状态未知、有效性待确认、时区未确认；不关联港口、不推断影响（`relatedPortIds: []`、`eventEligibility: false`，WR-O01/O02 不命中）；有原文级别显示“原文风险级别：X（原始级别，标准化严重度未映射；非系统级别）”，否则“原文风险级别：未提供”。
6. 失败语义：列表抓取失败或结构丢失 → 来源失败，旧记录标 failed 保留、不清除；单篇失败 → 计入 `failed`，已有记录标 degraded 保留；结构有效但无匹配 → “本次未发现符合筛选的记录，含义未确认”，旧记录只标 `warning_missing_from_current_index`。
7. 开关：配置 `enabled:false / liveStatus:"experimental"`，只在既有 `SHIPPING_WEATHER_ALERT_PROVIDER=experimental` 下运行；GET 不触发抓取。
8. 测试：`server/providers/nchmf-warning.test.ts`（18，含固定负例：结构丢失、空文章、仅脚本正文、页眉页脚、重定向、query/凭据/其他 host/PDF、无匹配、部分失败、内容更新、SQLite 持久化）。

## 真实运行（隔离 `.tmp/nchmf-live-c064e5a`，干净 `c064e5a`）
- 2026-10-10 17:52:07 UTC+8，13 次请求（1 列表 + 12 文章），全部 HTTP 200、无重定向。`live-evidence.json`，脱敏 raw：`nchmf-integration-2026-10-10/raw/`。
- 列表链接 20，候选 12，排除 8，截断 0；**收到 8 条，失败 4 条**（post54540/54545/54533/54544：水库联调 LHC 公报正文只有 PDF 链接，按规则不抓 PDF → 空正文 = 失败）；新建 8 / 更新 0。
- 8 条中原文级别 5 条（Cấp 1 ×4、cấp 2 ×1），未提供 3 条；事件资格 0，关联港口 0，VNSGN 规则命中 0。分类 `received_with_partial_failures`。

## 展示核验（`display-evidence.json`，PASS 17/17，HEAD `c064e5a` 干净）

> 范围更正（dots P2，2026-10-10 18:32）：这 17/17 只证明**预警记录的展示**（API 字段与 /feed 渲染），**不证明来源失败状态**。`c064e5a` 下真实运行 8 成功 / 4 失败，但 `live-evidence.json` 的 `jobResult` 仍为 `success`，即当时失败没有传到运行状态；已在 `be78026` 修复，见下节。
- 服务：生产构建 `dist/output/server`（Nitro），隔离库，Runtime 关闭，`SHIPPING_WEATHER_ALERT_PROVIDER` 未设，无 provider 密钥。
- API：`GET /api/shipping/feed`（8 条，原文字段齐全、生命周期未知、级别未映射、无港口）与 `GET /api/shipping`。GET 前后：Runtime 关闭、预警开关未设，所检查的 feed_items / provider_usage 计数及 id+长度指纹未变；runtimeRows=-1 表示该表不可用（未检查 runtime 表）。这不证明没有网络或 LLM 调用。
- 浏览器：系统 Chrome headless（CDP）`/feed`：摘要措辞、生命周期未知/时区未确认/有效性待确认/预警状态：未知、原文级别（Cấp 1，未映射）与“未提供”、列表时间与“下一期发布时间（不等于有效期）”、来源/抓取时间/首次接收、发布国家分组、每条原文块 8 个；无“生效”字样。
- 未覆盖：港口页（按设计不关联）、Runtime 调度器在 experimental 开关下的实际调度（仅服务层 sync-job 测试）。

## 覆盖与限制
- 只覆盖列表页当前展示的两个块（每块约最新 10 条）与上述标题族；不是全国全量，不代表“越南无其他预警”。每次最多 12 篇，正文最多保存 8000 字符（`bodyTruncated`）。
- 只有 PDF 附件的公报（如 LHC 水库公报）正文为空 → 记为失败，不抓 PDF。
- 原文时间/级别均为原文文本，未换算、未映射。八港天气 live 未重跑；未动天气基线与 VNSGN。

## P2 修复：文章失败传到正常同步路径（代码 `be78026`，dots 18:32）
- 问题：文章失败只经 `onNchmfReport` 回调上报；正常 registry 没接这个回调，sync job 只看 `sourceStatus=failed`，所以部分失败记成 success，首次全部失败也记成 success/0，与真正的零匹配混在一起。
- 修复（不加通用框架、不整体回滚）：
  - `WeatherAlertProvider.lastRunIssue()`：provider 在本次运行有文章失败时给出 `errorCode: nchmf_partial_article_failure`、失败 postId 列表和数量、成功数量。
  - sync job：照常写入成功记录；有 issue 时返回 `status: failed`（带 postId/数量的 errorMessage），不归档任何记录；BackgroundRuntime 据此写 sync_runs 和 provider_runtime（来源状态非 healthy）。失败文章的旧记录保留、标 stale/degraded，旧值不变。
  - 本次所选文章全部失败（received 0）→ provider 抛错：首次运行 → 运行失败，无记录；已有记录 → 旧记录全部保留并标 failed/stale，运行失败。
  - 结构有效、没有匹配标题 → 仍是 success、0 条，含义未确认。
- 固定样本测试（走正常 registry 同款 provider 配置 → BackgroundRuntime.runNow → sync job → SQLite，不依赖回调），`server/providers/nchmf-warning.test.ts` 新增 4 个：
  1. 部分成功/失败：job 与 sync_runs 为 failed（`received 3, failed 9 (postIds …)`），来源状态非 healthy，3 条成功记录入库且 healthy；下一轮 54547 失败时其旧记录保留、标 stale/degraded，原文级别和首次接收时间不变。
  2. 首次运行全部失败：failed（`nchmf_articles_all_failed: received 0/12`），无记录。
  3. 已有记录后全部失败：failed，旧记录全部保留并标 stale/failed。
  4. 真零匹配：success、recordsRead 0、只请求列表页 1 次。
- 证据：`docs/evidence/gate-be78026/p2-fixture-tests.txt`（4/4 通过）；门禁 `docs/evidence/gate-be78026/`（install/build/typecheck/lint/vitest 755 通过 3 跳过/smoke:p0-native/S7 exit 0；审计说明见 `live-note.txt`）。本轮没有重抓上游、没有重跑八港天气、没有扩展 PDF 抓取。
- 脱敏补充：35a5c8b 的真实运行 raw `index.html` 含站点地图 token，已在当前文件替换为 `<redacted>`；历史不改写。
