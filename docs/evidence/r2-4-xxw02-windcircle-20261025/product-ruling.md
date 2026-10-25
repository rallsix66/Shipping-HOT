# XX-W02 限定产品裁定（2026-10-25）

- 工作树分支：`codex/shipping-hot-r2-4-gapfill-20261025`
- 代码基线（本 docs 提交之前）：`a2e99a01d50f21fbce87e2972eed85d6d39a7156`
- 裁定时间（Slack ts → ISO）：`2026-10-25T10:08:31.869439Z`（`rulingMessageTs=1792922911.869439`）
- 零新网络；不复制原件；不启生产；不合并；不部署

## 裁定

XX-W02（目录 forecast + specifications）可按**已有两 TC 的 forecast+specifications 捕获及离线字段验证**计为**限定** R2-4 OK。

- `r2_4=OK`，`countedOK=true`
- 限定 `scope=existing two-TC forecast+specifications capture and offline field verification`
- **是**已取产品的真实解析验证（路径、预报位置、风圈字段、身份对账）
- **不是**生产 sync 集成通过，也**不是**持续运行通过

## a2e99a01 两处 P2 已关闭（本裁定前置）

1. 风圈 usable-radius：有限非负且至少一有效单位；空/`null`/仅负值走既有 `*_range_invalid`
2. 身份对账：缺/空 → `"unknown"`；仅两侧均有非空且相等时为 `true`

## 引用原件哈希 / 来源链（不发布完整原件）

| 项 | SHA-256 |
| --- | --- |
| map.html（z/o/n 来源链） | `71c57265064a4d54cc1ff957f3582059ff772403f1430b759333d053852c12e4` |
| TC2637 forecast.json | `9e4f3a259846c3317f0238d8d76755ba06709385d71d0c0a577d255a92012a02` |
| TC2637 specifications.json | `4559062942c8c65dd89b4a197392c4b8c92f2beeecd55243080c1677d97c7317` |
| TC2636 forecast.json | `d2c871329ecdabd374e80d54312c3a95e9363d6209257d272ba632fb37cf60ce` |
| TC2636 specifications.json | `b6110f8e5eb5d6b85ff611913a3c228b142bf181c9098209679bac7d6287824d` |

绝对产品 URL（来源链 z/o/n）：`https://www.jma.go.jp/bosai/typhoon/data/{TCID}/forecast.json` 与 `.../specifications.json`。公开字段与离线回放见同目录 [wind-circle-fields.public.json](./wind-circle-fields.public.json) / [offline-replay.public.json](./offline-replay.public.json) / [source-chain-zon.public.json](./source-chain-zon.public.json)。

## 保留的显著事实（不因本裁定抹掉）

1. **specifications 尚未接入生产 sync**；未验证整条实时持久化 / 持续运行。
2. **数值生产分区仍 3/5**（不因本离线验证加计生产接入）。
3. **R2-5 仍 25/34**；XX-W02 为数值源，不进资讯分母。
4. **PH-P01 / PPA 继续 BLOCKED**（TLS `UNABLE_TO_VERIFY_LEAF_SIGNATURE`）。
5. **overallR2Pass=false**；不能宣称 R2 完成或生产启用。

## 原快照保留

- 代码轮 / 风圈落地时：**29/39**、XX-W02 未抬升、forecast-only / PARTIAL 等结论保留为**当时快照**（见本目录 `report.md` / `gates.public.json` / `wind-circle-fields.public.json` 的 countsHeld / countsUnchanged）。
- 取样与前序矩阵行级 PARTIAL 不重写为从未发生。

## 计数

- 裁定前（`a2e99a01` / XX-W01 列表产品落地后）：**29/39**，shortfall 3
- 本裁定落地后：**30/39**，XX-W02=限定 OK，shortfall 2（距最低 32）
- R2-5：**25/34** 不变；数值生产分区：**3/5** 不变

## 门禁说明

本提交**仅文档**。不冒称重跑全量代码门禁；代码门禁沿用 `a2e99a01d50f21fbce87e2972eed85d6d39a7156`（定向 7 passed；全量 2021 passed / 5 skipped；build/typecheck/lint/diff EXIT 0）。本提交本地检查：JSON 解析、39 行重新计数、引用链接、`git diff --check`。
