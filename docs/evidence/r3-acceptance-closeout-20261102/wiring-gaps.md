# 零付费可完成的代码接线缺口与最小下一片 — 2026-11-02

先交复核，**不直接扩范围**。需要真实模型/人工/费用的单项标 **BLOCKED**。

## A. 仍可零付费完成的接线缺口

| # | 缺口 | 现状 | 最小建议（需 dots 批准后再做） | 风险 |
|---|---|---|---|---|
| A1 | 分析完成 → 政策自动入库 | `applyFromExactIntel` 仅测试调用 | 在**离线** `runOfflineAnalyze` 成功且 extract 为政策类之后，可选 hook 调用 `applyFromExactIntel`（同进程注入 license/analysis ids）；配 feature flag 默认关；单测覆盖 | 勿接到 GET/浏览；勿开默认生产开关 |
| A2 | ExactVersion 颁发器（进程内） | 仅测试手工构造 | 增加**窄** factory：仅接受已校验 rights 的 item/version/hash，返回 license；仍不开放 HTTP 随意申请 | 防止 bare `modelUsePermitted=true` |
| A3 | 受控分析触发入口（非浏览） | 无 HTTP/任务 | 增加显式 operator-only `POST`（或脚本）调用 `runOfflineAnalyze`，强制 license+预算闸；GET 仍零分析 | 需权限模型；默否认 |
| A4 | 标注 enroll 批量/筛选辅助 | 单条 enroll API 已有 | 只读「候选入队」列表（已有 intel item、已授权摘录），仍人工点选 enroll | 不自动爬取 |
| A5 | 评测报告诚实字段 | offline eval INCOMPLETE | 固化缺失样本/类别/语言计数面板（只读） | 不填假数据 |

## B. BLOCKED（需真实模型 / 人工 / 费用）

| # | 项 | 原因 |
|---|---|---|
| B1 | R3-1 真实双厂商测连 + 向量 | 真实密钥与外呼 |
| B2 | R3-2 真实 200 人工集 | 人工复核与授权素材 |
| B3 | R3-3/R3-4 真实效果 | 依赖 B2 + 真实模型 |
| B4 | R3-5 真实费用与月度外推 | 用户确认预算 + 真实调用 |
| B5 | S7 整包集成 | 明示 NOT_RUN；另批 |
| B6 | 生产启用分析/抓取/付费 | 超出本收口；另批 |

## C. 建议的最小下一片（供复核，不执行）

**建议名**：`R3-wire-policy-auto-after-offline-analyze`（零付费）
**仅含**：A1 + A2 单测/假 Provider；默认 flag 关；补充矩阵行「生产仍未启用」。
**不含**：R4、真实预算、真实 200 集、merge/deploy、开放浏览触发。

若 dots 希望先只合并文档收口、接线另开切片，本包亦可止于矩阵+证据。
