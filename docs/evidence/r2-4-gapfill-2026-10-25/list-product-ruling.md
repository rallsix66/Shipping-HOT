# XX-W01 列表产品合同裁定（2026-10-25）

- 工作树分支：`codex/shipping-hot-r2-4-gapfill-20261025`
- 代码起点（本 docs 提交之前）：`4f689fd0bd557ae4f9153aeb6b8a5fbb64e81ee3`
- 零新网络采样；不重发六入口；不启生产；XX-W02 不动

## 裁定

XX-W01（目录「当前热带气旋列表」=`targetTc.json` / `json_list`）可按**独立列表产品**计为**限定** R2-4 OK。

- `r2_4=OK`，`countedOK=true`
- 限定 `scope=list product only`
- **不是**整条台风同步通过，也**不是**轨迹/路径产品通过
- **预报未取不再作为 XX-W01 否决条件**（预报/specifications 属 XX-W02 / 同步链，属合同外门槛）

## 保留的显著事实（不因本裁定抹掉）

1. **providerSync partial**：离线同步故意拒绝 2 次 forecast 读取后，provider 链仍为 `outcome=partial`（`offlineForecastReadsRefused: 2`，`forecastHttpRequests: 0`）。
2. **trackPersistence 未验证**：因未取预报/specifications，持久化气旋轨迹/路径字段本轮未验证。
3. **XX-W02** 仍 PARTIAL；**R2-5** 仍 25/34；**数值生产分区**仍 3/5；**不能宣称 R2 完成**，不能宣称生产启用。

## 逻辑矛盾改正

取样收尾曾同时写「列表证据齐全」与「行级 PARTIAL / 不计 OK」。在目录切分 + `countingRules.r2_4` 对 expected product 的字面要求下，列表产品侧证据已齐，行级应按**列表产品**计限定 OK；providerSync/track 缺口改记为显著保留事实，而不是 XX-W01 列表行否决条件。

## 原件哈希（公开）

| 项 | 值 |
| --- | --- |
| 相对路径 | `.tmp/r2-4-gapfill-20261025/private/XX-W01.response.bin` |
| 字节 | 210 |
| SHA-256 | `73f95b534b79ad9564162e10949f7d22bbaecf08eb31c0f9172bc5bb6b4b4c31` |
| 许可 | `rawRedistribution=not_assumed` → 不发布完整原件 |

最小公开字段见同目录 [public-fields.json](./public-fields.json)。

## 计数

- 取样快照（`4f689fd0bd557ae4f9153aeb6b8a5fbb64e81ee3` closeout）：**28/39**，XX-W01=PARTIAL，shortfall 4
- 本裁定落地后：**29/39**，XX-W01=限定 OK，shortfall 3（距最低 32）
- R2-5：**25/34** 不变

## 门禁说明

本提交**仅文档**。不冒称重跑全量代码门禁；代码门禁沿用 `4f689fd0bd557ae4f9153aeb6b8a5fbb64e81ee3` 的 `.tmp/r2-4-gapfill-20261025/gates/` 日志。本提交本地检查：JSON 解析、计数复算、证据链接、`git diff --check`。
