# PH-W01 / PH-W02 限定产品裁定（2026-10-26）

- 工作树分支：`codex/shipping-hot-r2-4-gapfill-20261025`
- 代码基线（本 docs 提交绑定，不重跑全量门禁）：`7a1975682078e1fb8107a7992b6a36833a293b0b`
- 父 tip（裁定落地前）：`d5d366ce09bcfb9f89abf4f3020c69d1f4f2818c`
- 裁定时间（Slack ts → ISO）：`2026-10-26T02:22:19.583919Z`（`rulingMessageTs=1792981339.583919`）
- 零新网络；不复制原件；不启生产；不合并；不部署

## 裁定

PH-W01（Severe Weather Bulletin）与 PH-W02（Weather Advisory）各自可按**已有官方明确空状态捕获及离线产品范围解析核验**计为**限定** R2-4 OK：

- `r2_4=OK`，`countedOK=true`（两源各计 1）
- 限定 `scope=existing official explicit-empty captures and offline product-scoped parse verification`
- **是**两独立官方产品的真实已存 explicit-empty + 严格双原件 parse replay，且 conflict / false-PASS（含 self-media residual）议题已关闭
- **不是**仅凭 HTTP 200；**不要求**捕获当时必有活动公报
- **不是**活动公报字段、生产 ingest 启用、持续可用或 24h 通过

## 代码门禁绑定（纯文档，不重跑）

本提交**仅文档**。已跑门禁绑定代码 SHA `7a1975682078e1fb8107a7992b6a36833a293b0b`（P2 self-media residual）：

- 定向 `pagasa-empty-state-parse`：strict `PAGASA_STRICT_PRIVATE_REPLAY=1` → **27 pass / 1 skip**
- 全量 Vitest **2047 passed / 7 skipped**；typecheck / lint / build / `git diff --check` exit 0
- 见同目录 [gate-parsed-empty.public.json](./gate-parsed-empty.public.json) / [parsed-empty-replay.public.json](./parsed-empty-replay.public.json)

## 引用原件哈希 / 公开字段（不发布完整原件）

| 项 | SHA-256 |
| --- | --- |
| PH-W01 wire HTML（private） | `b5ecb77a40ada689ef08f52fb942b94cc3f5fe88f6e2dbb84096cb1d08a5a1ad` |
| PH-W02 wire HTML（private） | `8ac1546c1681d5b67f71ceeb1626a92553d0ffe6f5224294d7cc9de62068ff53` |
| PH-W01-fields.public.json | `865a39b720e22305c8985056912170c5bde8a3f05a91d1bec68e9da6dc5b563c` |
| PH-W02-fields.public.json | `e5de15f3c1e8fd17451de6e630f31985d2fa3ea05c44192cf435fde1c831f67a` |
| parsed-empty-replay.public.json | `def8f1e7bb3a38272a675ee6d34165fbd06ec9534424090268167e81ca7b146a` |

产品 URL：

- PH-W01：`https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin`
- PH-W02：`https://www.pagasa.dost.gov.ph/weather/weather-advisory`

空状态原文：

- PH-W01：`No Active Tropical Cyclone within the Philippine Area of Responsibility`
- PH-W02：`As of today, there is no Weather Advisory issued.`

## 保留的显著事实（不因本裁定抹掉）

1. **不是**活动公报正文 / 身份 / 发布时间 / PDF 可用；归档 PDF 主机 DNS 曾 blocked，本裁定不改写该事实。
2. **R2-5 仍 25/34**；PH-W01/PH-W02 资讯字段回放仍 NOT_RUN。
3. **数值生产分区仍 3/5**。
4. **PH-P01 / PPA 继续 BLOCKED**（TLS `UNABLE_TO_VERIFY_LEAF_SIGNATURE`）。
5. **day19 observation incomplete**（退出时间/原因未知；不宣称 24h 通过）。
6. **overallR2Pass=false**；不能宣称 R2 完成或生产启用。

## 原快照保留

- 裁定前公开资格：**30/39**（shortfall 2）；PH-W01/PH-W02 为 PARTIAL / `countedOK=false`（含 P2 self-media 待裁）。
- 历史 **HTTP 403**（2026-10-15 after-apply）及更早 DNS blocked / 2026-10-10 shell 快照保留为 **historical/superseded**，不重写为从未发生。
- 取样与前序矩阵行的 PARTIAL / 403 结论保留为当时快照。

## 计数

- 裁定前（`7a1975682078e1fb8107a7992b6a36833a293b0b` / P2 self-media 文档绑定后）：**30/39**，shortfall 2
- 本裁定落地后：**32/39**，PH-W01=限定 OK，PH-W02=限定 OK，shortfall 0（达到 R2-4 最小 32 门槛）
- R2-5：**25/34** 不变；数值生产分区：**3/5** 不变；`overallR2Pass=false`

## 门禁说明

本提交**仅文档**。不冒称重跑全量代码门禁；代码门禁沿用 `7a1975682078e1fb8107a7992b6a36833a293b0b`。本提交本地检查：JSON 解析、39 行重新计数、引用链接、`git diff --check`。
