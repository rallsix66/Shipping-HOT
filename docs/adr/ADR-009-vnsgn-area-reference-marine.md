# ADR-009：VNSGN 独立区域参考海况（工程取点）

- 状态：已接受（实现边界见下）
- 日期：2026-10-10
- 授权依据：
  - 用户 guoyong lai 在 Grok Bot 对话中批准（2026-10-10 13:47 UTC+8，原话「可以啊」）。这是对一个具体提议的回复：取点 10.2917N 107.0417E、名称「胡志明关联海域海况参考（工程取点）」、标注为工程取点。
  - dots 审查线程（2026-10-10 13:33 UTC+8）规定了实现边界。

## 背景

- VNSGN 的港口坐标是 10.77N 106.75E，在内河。Open-Meteo marine 用 `cell_selection=sea` 时，这个坐标返回不到浪高和涌浪（见 `docs/evidence/vnsgn-marine-coverage-diagnosis-2026-10-10.md`）。
- 单点核查（`docs/evidence/vnsgn-point-check-2026-10-10/`）确认，10.2917N 107.0417E 位于水域，并且在 01/2026/TT-BXD 规定的胡志明港水域 Gành Rái/Đồng Tranh 湾区（HCM1–HCM7）内。距港口坐标约 62 km。best_match 在该点能返回完整的滚动 7 天海况。
- 官方没有给出「代表点」。本轮尚未核实到官方代表点。

## 决定

1. **三类数据严格分开：**
   - **陆地数据**：港口坐标（风、降水、能见度）。不变。
   - **港口自身海况**：港口坐标，`sourceId=open-meteo-marine`。不变。缺测时仍按缺测显示：`forecastMeta.marineCoverageNote`、`missingCounts.wave` 照常报告，**不会被参考点数据替代**。
   - **独立区域参考海况**：在参考点单独请求 marine（`forecast_days=8`、`past_days=1`、`cell_selection=sea`、`models=best_match`）。数据存在自己的键 `marine-ref:port-ho-chi-minh:ganh-rai-eng` 下，`sourceId=open-meteo-marine-reference`。规则也只在这批数据上计算，结果存在同一个键下。
2. **面板展示**：面板返回一个独立的 `marineReference` 块，页面上单独显示。块中明确标注：「工程取点」、约 62 km、「非官方代表点」、「不代表泊位/港内条件」，并写明港口自身海况仍按缺测显示。
3. **失败隔离**：参考点请求失败时，不影响、也不改变港口自身的预报。
4. **范围**：只有 VNSGN 配置了参考点，其他港口不受影响。没有新增数据源，不收费。没有修改生产开关（`SHIPPING_WEATHER_PROVIDER` 等）。GET 请求不会触发网络调用。

## 不做的事

- 不把参考点叫作港口海况、泊位海况或官方代表点。
- 不用参考点数据去填港口自身的 `forecasts`、`impacts`、`ruleCoverage`。
- 不放宽 9/29 方案 R1.5-1 的验收标准。是否把这个带标注的参考算作 VNSGN 满足了 R1.5-1，由用户和审查方决定，见验收说明。
