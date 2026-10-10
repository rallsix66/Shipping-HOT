# VNSGN 独立区域参考海况：实现与验收说明（2026-10-10）

依据：ADR-009（`docs/adr/ADR-009-vnsgn-area-reference-marine.md`）。

- 授权：
  - 用户 guoyong lai，2026-10-10 13:47 UTC+8，原话「可以啊」，回复的是对取点、名称和标注方式的具体提议；
  - dots 审查线程 2026-10-10 13:33 UTC+8 规定了实现边界。

## 实现

- **配置**：`server/config/port-marine-reference.ts`
  - 名称：「胡志明关联海域海况参考（工程取点）」
  - 取点：10.2917N 107.0417E
  - 模型：best_match
  - 距港口坐标：约 62 km（球面距离 62.0 km）
  - 标注：`kind=engineering_reference_point`，`officialRepresentativePoint=false`，`berthConditions=false`
- **数据源**（`server/providers/shipping.ts`）：参考点单独请求。数据和规则结果都存在参考键下，`sourceId` 为 `open-meteo-marine-reference`。请求失败时被隔离，不影响港口自身数据。
- **面板服务**（`server/services/port-weather-panel.ts`）：
  - 返回独立的 `marineReference` 块：参考预报、覆盖统计、最大浪高、参考规则命中。
  - 港口自身的 `forecasts`、`forecastMeta`（含 `marineCoverageNote` 和浪高缺测计数）、`impacts` 不变。
- **页面**（`src/components/shipping/pages.tsx`）：独立显示参考块（`data-testid=port-weather-marine-reference`），带名称、工程取点标注和摘要。
- **测试**（`server/services/marine-reference.test.ts`）。范围是数据源请求和持久化批次，以及面板服务层；HTTP 接口、SQLite 和浏览器由 live 验收覆盖。测试内容：
  - 配置标注；
  - 请求参数；
  - 港口自身海况仍为缺测，`sourceId` 不变；
  - 参考数据单独存储，规则只在参考数据上计算；
  - 参考请求失败时被隔离；
  - 其他港口不发参考请求；
  - 面板分块正确，缺测说明仍然存在。
- **live 验收**（`scripts/r1-5-1-live-acceptance.mjs`）新增 `kind=reference` 的检查项，不计入最终判定：
  - `reference_marine_7d_port-ho-chi-minh`：参考点 SQLite 和重启后 API 的 7 天海况，按滚动窗口逐小时检查，只看海况字段；
  - `reference_labelled_port-ho-chi-minh`；
  - `reference_not_substituted_port-ho-chi-minh`：港口行不是参考来源；港口海况仍缺测时，缺测说明必须存在；
  - 浏览器 `browser_shows_marine_reference_label`。

## 按 9/29 标准如实判定 R1.5-1

- 9/29 方案 R1.5-1 的原文是「8 个港口都有 7 天的海况和陆地预报」。这里说的是**港口的**海况。现行验收（`coverage_port-ho-chi-minh`）也按港口自身数据判定。
- 带标注的区域参考海况在 62 km 外的海上点，不是港口海况。方案原文没有说可以用参考点代替。所以本轮**不宣称 R1.5-1 通过**。
- **已满足**：
  - 7 个港口完整通过；
  - VNSGN 的陆地数据完整；
  - VNSGN 已有一份独立的区域参考海况：工程取点，按 live 证据检查 7 天是否完整；单独展示、单独存储，规则单独计算。
- **仍未满足**：VNSGN **自身**海况（港口坐标）仍然缺测。
- R1.5-1 保持 **BLOCKED**。要变成 PASS，必须由用户或审查方明确决定：「VNSGN 以带标注的区域参考海况满足 R1.5-1 的海况要求」，并相应修改方案或 ADR。在没有这个决定之前，验收标准不变。

## live 证据（代码 SHA 3e25a4571c04f8adcab3747ae52565ba12e6ab7b，工作区干净）

- `pnpm test:r1-5-1-live` exit 2，判定 BLOCKED，87 项检查中 86 项通过。唯一阻塞项是 `coverage_port-ho-chi-minh`，原因 `marine_wave_or_swell_present`：港口自身海况缺测，如实保留。
- 参考海况：SQLite 同步时的数据和重启后 API 返回的数据，都覆盖了 169/169 个整点（2026-10-10T06:00:00.000Z 到 2026-10-17T06:00:00.000Z），没有缺测。本次 7 天最大浪高 0.66 m，参考规则命中 0 条。
- 检查项全部通过：`reference_labelled`（engineering_reference_point、非官方、非泊位、best_match、62 km）；`reference_not_substituted`（港口海况仍缺测，缺测说明仍然存在）；浏览器能看到参考块的名称和「非官方代表点」标注。
- 证据：`docs/evidence/gate-3e25a45/vnsgn-reference-marine-summary.json`、`r1-5-1-evidence.json`、`summary.txt`。

## 已批准的验收映射与本轮结果（代码 SHA 50bad03ee3560c7ff8fb398bee170b9b2368e7bd）

- **映射**：依据 ADR-009「验收映射」一节（dots 2026-10-10 14:11 UTC+8，Slack ts 1791612673.820639）。
- **本次判定**：live exit 0，判定 **PASS**，95 项检查中 95 项通过。
- **结论**：R1.5-1按ADR-009映射PASS；VNSGN原点海况不可用
- **参考状态**：fresh；最近尝试 2026-10-10T06:42:04.550Z（success）；最近成功 2026-10-10T06:42:04.550Z。
- **网格**：
  - 请求点：10.2917N 107.0417E，请求模型 best_match；
  - 实际返回网格：10.291664N 107.04167E，距请求点 0.01 km；获取于 2026-10-10T06:42:04.550Z。
- **覆盖**：7 天窗口内含海况的整点 169/169。
- **原点海况**：可用 = false，即**原点海况不可用**，已披露。
- **证据**：`docs/evidence/gate-50bad03/`（`adr009-mapping-summary.json`、`r1-5-1-evidence.json`、`summary.txt`）。
