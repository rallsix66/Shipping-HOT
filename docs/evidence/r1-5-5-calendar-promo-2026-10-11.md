# R1.5-5 日历 / 大促图层验收（2026-10-11）

结论：**已实现（限定范围），等待 dots 审查**。替代本文件上一版的「BLOCKED（未实现）」结论（`e6b77ce`）。dots 10:59 批准在 9.29 计划 + ADR-008 范围内实现，不另需用户授权。

- 代码 SHA：`339e49e39b7c433b6fdcb17f14680db180f5dea5`（实现）+ `fdfe238caa67e338fc96beb59955c707e60bd8fb`（translation.test 迁移版本期望 15→16）。门禁与浏览器验收都绑定在干净的 `fdfe238…`。
- 没有登录卖家后台，没有新增信源，没有调用 LLM，也没有抓取上游。

## 1. 实现范围
| 项 | 做法 |
|---|---|
| 存储 | 复用 `ops_calendar_event`；新增迁移 **016**（`platform` 默认 `'unspecified'`、`entry_kind`、`window_status`、`generation_basis`、`rule_year`、`occurrence`、`confirmation_source_id/evidence_ref/note`、`confirmed_at`、`manual_edited_at`）。已执行过的 015 没有改动。旧记录读出时平台显示为「未指定」、来源为 legacy |
| 稳定身份 | `promo:<rule>:<year>:<country>:<platform>:<occurrence>` |
| 日期语义 | 按日历日（YYYY-MM-DD）处理，严格校验：必须是真实日期（拒绝 02-30、2026-02-29、04-31），且 start<=end，国家限五国，平台限 Shopee/Lazada/TikTok Shop/未指定 |
| 生成 | `POST /api/shipping/calendar/promotions/generate {year}`，显式写入，幂等。已确认、人工录入、人工改过的行一律跳过（计为 protected），确认字段从不覆盖 |
| 确认 | `POST /api/shipping/calendar/promotions/confirm`，必须带 id，country/platform 要与记录一致，`evidenceSourceId` 取 XX-E01..E06 或 manual_url，`evidenceRef` 须为 HTTPS 链接（域名要与该信源一致，并适用于该平台/国家）。只传 `confirmed:true` 会被拒绝；锚点行（窗口待定）不能确认 |
| 查询 | `GET /api/shipping/calendar/promotions?year=` 只读库，缺口清单在内存中计算，不写库 |
| 安全边界 | 沿用现有本地单用户 Host/Origin 中间件，没有新增账号，没有放宽公网访问（外部 Origin 的 generate 请求返回 403，已验证） |
| 页面 | 真实 `/calendar` 新增可开关的「电商大促图层（运营参考，非停工事实）」，**默认关闭**。日格显示「大促 N 项」，详情列出国家·平台、日期、状态、规则、来源、生成依据，以及确认证据（若有）；底部列出规则缺口（待定）。假日参考层和 bundled JSON 没有改动 |

## 2. 规则逐条（信源目录 §9）
| 规则 | 生成内容 | 依据 / 限制 |
|---|---|---|
| E-R01 | 每月 m.m，窗口为当天前 7 天至后 3 天；三平台 × 五国，共 180 行 | 规则生成（待确认）；1.1 的窗口跨年，从上年 12-25 开始 |
| E-R02 | 每月 15 日；仅 Shopee/Lazada × 五国，共 120 行 | 规则生成（待确认） |
| E-R03 | 每月 25 日至真实月底（闰年 2 月为 29 日）；三平台 × 五国，共 180 行 | 规则生成（待确认） |
| E-R04 | 只覆盖 ID/MY；锚点 = 年度参考日历里的开斋节假日（2026-03-21–22），平台「未指定」，窗口待定，共 2 行 | 斋月起止不在现有可靠数据中，作为缺口「待定」；不套用 -7/+3 |
| E-R05 | 只生成 ID 2026-12-10–16 一行，平台「未指定」 | 依据仅为目录记录（贸易部/idEA 2026-08-27 公布，ANTARA 等报道），本系统未重新核实，状态仍为待确认；其他年份不外推，作为缺口 |
| E-R06 | 只取现有可靠假日数据：圣诞（ID/MY/PH 12-25）、越南春节（VN 02-16–20）、宋干节（TH 04-13–15，其主依据本身待核验），共 5 行，均为锚点、窗口待定 | 目录中的「等」没有列明具体节日，不推断；促销提前期和平台目录未列明，作为缺口「待定」 |

2026 年共 488 条候选。2027 年只生成 E-R01/02/03，E-R04/05/06 全部作为缺口（待定）。

## 3. 测试（fixture，`server/services/promo-calendar.test.ts`，9 项）
覆盖：适用范围（平台/国家/规则）；闰年、月底、跨年；非法日期 / start>end / 非法国家与平台；重复生成幂等；同日多平台；确认后再生成不覆盖（原生成依据保留）；人工改过和人工录入不被覆盖、可以区分；缺证据、只传 confirmed、http 链接、国家或平台不符、信源不适用、域名不符、锚点行、未知 id 都被拒绝；旧记录标为 confirmed 但没有证据的，显示为「数据异常（待确认）」。迁移 016 让 schema 升到 v16，因此 015/article/translation 测试和 S7 的版本期望同步改为 16。

## 4. 隔离 SQLite → 重启 → API → 真实 /calendar（`fdfe238`，工作区干净）
脚本：`node scripts/r1-5-5-promo-display.mjs`，exit 0，PASS，24/24 项检查。证据：`docs/evidence/r1-5-5-calendar-promo-2026-10-11/promo-display-evidence.json`，截图 `calendar-2026-11-11.png`、`calendar-2026-12-12.png`。
- 新库生成前为 0 行；第一次生成 created 488，第二次 unchanged 488。
- 确认负例：只传 confirmed、国家不符、平台不符、缺证据链接，均返回 422；锚点行返回 409。
- **fixture 确认 1 条**：VN·Shopee 11.11，证据 `https://shopee.vn/blog/fixture-r1-5-5-test-only`。**这是测试用 fixture，不是真实的官方确认**；正式数据中目前没有任何已确认条目。
- 直接写入 2 条异常旧记录（无平台但标为 confirmed、平台为 amazon）。重启后 API 共 490 行：仅上述 fixture 那 1 条显示 confirmed，两条异常记录显示「未指定」、待确认并带 dataIssue。
- 浏览器（系统 Chrome headless / CDP）：图层默认关闭；打开后 11-11 共 15 张卡（5 国 × 3 平台），其中 1 张显示「已由 XX-E01 确认」并附证据链接，其余为「规则生成（待确认）」并带规则、来源和生成依据；02-16 越南春节显示「节日锚点（促销窗口待定）」；05-05 两条异常记录显示「数据异常（待确认）」；12-12 的 Harbolnas 显示目录来源和「本系统未重新核实」；缺口清单可见；假日层仍正常。
- GET 检查：对 `ops_calendar_event` 行数/指纹和 `provider_usage` 行数，在 GET 前后各做一次比对，结果不变。运行条件：Runtime 关闭，各 provider 为 mock，不注入密钥。**这只能说明所检查的计数/指纹没有变化，不能证明 GET 完全没有网络或 LLM 调用。**

## 5. 门禁（干净 SHA `fdfe238caa67e338fc96beb59955c707e60bd8fb`，`docs/evidence/gate-fdfe238/`）
install --frozen-lockfile 0 · build 0 · typecheck 0 · lint 0 · vitest 0（96 个文件，780 通过 / 3 跳过）· smoke:p0-native 0 · S7 0（PASS）。
三项检查分开写：
- 自写 key-like 扫描（`git diff e6b77ce..fdfe238`，rg）exit 1，表示没有匹配；
- `audit-inventory.sh .` exit 0，**它只是目录/规则/Git/Markdown 清单脚本，不是密钥扫描或安全审计**；
- 人工复核新增文件：没有密钥。

同一 SHA 上第一次 vitest 因 translation.test 的版本期望仍为 15 而失败（`339e49e` 上 exit 1），已在 `fdfe238` 修复后整组重跑。

## 6. 限制 / 未做
- 生成和确认目前只能通过 API 调用；页面只读展示，没有确认表单。人工录入和人工编辑只有仓库方法（经测试覆盖），没有页面入口。
- 目前没有任何真实的官方确认；所有正式规则日期都是「规则生成（待确认）」或「窗口待定」。
- 大促不是停工事实，不进入 HOT、事件或港口判断。
