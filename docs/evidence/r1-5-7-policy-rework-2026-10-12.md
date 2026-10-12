# R1.5-7 政策库返工（dots 2026-10-12 驳回 f65117e/7312f17 的 5 项）

- 代码提交：`da337b0894ac6cd1ff517df38e42ab5c64dacd98`（基于 `f65117e645cc80bb7272f838216a5b29245c3fdb`）
- 状态：**待修复 / 待 dots 复审**。R1.5 整体**未通过**（R1.5-4 回放 BLOCKED、PAGASA 只做了只读核验，这两个缺口保留）。
- 全部示例都是 fixture（isFixture=true，链接用 example.org，标题带 [FIXTURE]），不是真实官方公告。没有附件/PDF，没有自动采集，没有 R3 扩展。

## 1. 替代（supersedesPolicyId）不再立即终止旧政策
- 新政策只有在「已发布待生效 / 已生效」时才能替代旧政策；传闻、草案一律 422 `supersession_requires_published_or_effective`。
- 替代关系先记录为待生效：旧记录写入 `superseded_by_policy_id`、`superseded_by_relation_kind`、`supersede_switch_at`（= 新政策生效日）和 `supersede_switch_tz`（= 新政策适用时区）。旧记录的录入状态和版本**不变**，只有到切换日（新政策所在时区的当地 00:00）才显示为「已修订 / 已废止」（`datePosition=superseded`）。如果新政策已经生效，就立即切换。
- 待生效期间：旧记录不能再修订、不能被第二条替代（409）；修订新政策的生效日，切换日会跟着改；新政策不能改成草案/传闻；新政策在切换前被废止，原定替代取消，并写入变更记录。已经切换后，不允许再改切换日（409）。
- 测试：传闻替代、草案替代被拒，并且旧记录详情序列化后完全不变；未来替代在 VN 23:59:59 之前仍是「已生效」，VN 00:00 起切换为「已修订」；改期、撤回、立即切换各有用例。

## 2. fixture 隔离改为双向
- 创建替代时，两边的 isFixture 必须一致，否则 422 `fixture_flag_mismatch`（正式→fixture、fixture→正式都会拦）。所有检查都在写入前完成；失败时两条原记录的详情、版本、变更记录都不变（测试按序列化逐字比对）。

## 3. 两个方向的关系分开存储
- 新增 `supersedes_relation_kind`（本条对被替代者的关系）和 `superseded_by_relation_kind`（本条被替代的方式）两列，017 的单列 `relation_kind` 不再写入。迁移 018 会尽量回填旧数据；如果 017 时期的链条已经被覆盖，回填值可能不准（目前只出现在测试库）。
- 三条链 A 被 B 修订、B 被 C 废止：仓储测试、API、CSV、浏览器详情都显示 B「本条修订：A」「已被 C 废止」，不会显示「废止 A」。

## 4. 适用时区
- 每条政策都有 `applicableTimezone`：CN 用 Asia/Shanghai，VN 用 Asia/Ho_Chi_Minh，TH 用 Asia/Bangkok，MY 用 Asia/Kuala_Lumpur，PH 用 Asia/Manila。这些国家只有一个时区，所以默认取本国时区。**印尼必须明确选择**（Asia/Jakarta、Asia/Makassar 或 Asia/Jayapura），不填返回 422 `timezone_required`；所选时区不属于该国返回 `timezone_country_mismatch`。这几个时区都不实行夏令时，按固定偏移计算。
- 生效、失效和替代切换，都按政策所在时区的当地日历日判断。旧印尼记录没有时区时，迁移不会猜，显示为「适用时区未确认（不自动生效）」。
- TEST_NOW 覆盖了每个时区当地午夜前后（UTC+7、+8、+9）。详情、列表筛选（status）、导出（新增「适用时区」「当地判断日」两列）、日历都用同一个 `policyDisplay`。

## 5. 中国政策图层
- /calendar 的政策图层下新增独立开关「含中国（CN）政策生效日」。只在政策层显示，不改动假日国家集合和假日覆盖口径。/policies 的国家筛选原本就有 CN，这次补了 API 和浏览器正例。

## 测试与验收
- 仓储测试 `server/database/policy.test.ts` 共 13 项通过（新增：时区切换、时区输入、替代负例和正例、fixture 双向、三链混合）。
- 浏览器验收 `scripts/r1-5-7-policy-display.mjs` 共 43 项检查，覆盖：隔离 SQLite → 重启 → API → 真实表单 → /policies → /calendar（CN 正例）→ 用 TEST_NOW 2026-11-01T00:00+08:00 重启（CN 已生效；VN 仍待生效，当地还是 10-31）→ 用 TEST_NOW 2026-11-01T00:00+07:00 重启（VN 生效，替代切换）。
  - **第一轮**（工作区有未提交改动，基于 `f65117e`，不算干净 SHA 证据）：43/43 PASS，见 `docs/evidence/r1-5-7-policy-rework-2026-10-12/round1-dirty-tree/`
  - **复跑**（干净 `da337b0`，workspaceClean=true）：43/43 PASS，见 `docs/evidence/r1-5-7-policy-rework-2026-10-12/rerun-da337b0/`（含 3 张截图）
- 干净 SHA `da337b0` 门禁（原始 exit code）：install --frozen-lockfile 0、build 0、typecheck 0、lint 0、vitest 0（97 个文件，796 通过，3 跳过）、smoke:p0-native 0、S7 0。另外分开记录：`audit-inventory.sh` exit 0（只是清单脚本，不是安全审计）；自写 rg 密钥扫描 exit 1（= 没有匹配，不是失败）。第一次批量执行时，外层 Shell 在 840s 超时，自写扫描被中断，之后单独重跑才得到 exit 1。见 `docs/evidence/gate-da337b0/`。

## 未覆盖 / 限制
- 迁移 018 回填旧 `relation_kind` 是尽力而为；没有专门测试回填路径。
- 时区只覆盖这 6 国 8 个时区，按固定偏移计算，不处理夏令时（这些时区都不实行夏令时）。
- 没有实现通用关系引擎；一条政策最多替代一条、最多被一条替代。
