# 零付费可完成的代码接线缺口与最小下一片 — 2026-11-02

先交复核，**不直接扩范围**。需要真实模型/人工/费用的单项标 **BLOCKED**。

**更新（A1）**：离线显式分析→政策编排已接线；retry 完整成功终态闸已补；生产仍未启用；A2 颁发器未接通。

## A. 仍可零付费完成的接线缺口

| # | 缺口 | 现状 | 最小建议（需 dots 批准后再做） | 风险 |
|---|---|---|---|---|
| A1 | 分析完成 → 政策自动入库 | **已交付 + RC**：`runOfflineAnalyzeThenPolicy` + `retryPolicyApplyFromExactRun`（持久完整成功终态校验）；默认关；单测 15/15；证据 `…/r3-a1-offline-analyze-policy-20261102/` + `rc-retry-success-gate/` | 完成：离线显式编排。**生产仍未启用** | 勿接到 GET/浏览；勿开默认生产开关；**A2 仍未接通** |
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

**A1 已执行**（离线编排已接线，生产仍未启用）。
**下一片候选**：A2 ExactVersion 窄颁发器（仍零付费；不开放 HTTP 随意申请）± A3 受控 operator 触发。
**不含**：R4、真实预算、真实 200 集、merge/deploy、开放浏览触发、默认生产开。

若 dots 希望先只合并文档收口、接线另开切片，本包亦可止于矩阵+证据。
