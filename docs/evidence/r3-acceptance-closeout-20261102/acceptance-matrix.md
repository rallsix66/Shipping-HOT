# R3 验收矩阵（收口盘点，非完整通过）— 2026-11-02

基线 tip（已接受，R3-8 离线切片）：`2258810ca02f53382f85ba29a2d96bcaeea2fe9c`
R3-6 隔离浏览专项限定接受 tip：`da2ea5a40658056c74a234e882b005bf1be3f206`
A1（离线显式分析→政策编排）证据：`docs/evidence/r3-a1-offline-analyze-policy-20261102/`（相对 da2ea5a；RC retry 成功终态闸见 `rc-retry-success-gate/`）
本包性质：**矩阵 + 证据交审**；**不是**完整 R3 通过、**不是** PR 合并批准、**不进 R4**。
真实 200 人工集 / 模型效果 / 实际费用仍未验；**R3-5 BLOCKED**；**S7 NOT_RUN**；未合并未部署。
**口径：离线编排已接线，生产仍未启用。**

判定约定：
- **生产已接通** = 有用户可达入口（路由/API/定时）在真实请求路径上调用。
- **Helper / 注入接口** = 可测函数或测试夹具可注入，但**没有**生产入口接线。
- 有函数 ≠ 生产已接通。

## 总表

| ID | 计划验收要点 | 已实现入口 | 接线性质 | 真实/离线证据 | 准确提交与测试 | 剩余缺口 / 状态 |
|---|---|---|---|---|---|---|
| R3-1 | UI 加 ≥2 服务商（含向量）；测连成功；切步骤模型后分析结果记新模型名 | Settings `/settings` LLM 面板；`/api/shipping/llm/providers|models|bindings`；`POST .../test-connection`（mock） | **UI/API 已接通（假密钥/禁外呼）**；真实双厂商测连与真实分析切模 **未做** | Settings CDP e2e（历史 100/100）；registry + shared-pool 单测；本收口不重开 | tip 链 `76e6ec1a`…`fd73ef2f`…`88d9ecdc`；`e2e-r3-1-settings-browser.mjs` | 真实 2 厂商+向量测连、切模后真实分析记名 → 需密钥/外呼 **BLOCKED** 项 |
| R3-2 | ≥200 真实条目；政策≥30 / 天气≥30 / 港口≥30 / 末端≥20；中/英/越/泰/印尼；人工复核；仅 URL+摘录+标注 | `/label`；`POST /api/shipping/intel/labels/enroll`；`GET .../labels`；`scripts/intel-eval.ts` | **操作入口已接通**；真实标注集 **未建** | e2e 夹具仅 2 条（port/en、weather/zh）；见 `label-set-inventory.md` | tip `6a8dafff`…`483a8646`（§4.9 闭环） | 真实样本与人工复核 **缺口**；不凑 200、不新抓源 |
| R3-3 | 预筛召回≥95% / 精确≥70% | `runOfflineAnalyze` 内 prefilter 步骤；offline 假 Provider | **Helper 离线可跑**；无生产分析触发 | analyze-pipeline 单测假 Provider | `3fde142a` / `802d9971` / `98d28c08` | 真实评测 **BLOCKED**（依赖 R3-2+预算+模型） |
| R3-4 | 抽取准确率门槛（国家/类型/港口/生效/官方） | 同上 extract 步骤 + `label-eval` / `intel-eval` 指标骨架 | **Helper + 离线评测骨架**；无生产接线 | offline eval 报告 INCOMPLETE（缺真实样本） | 同上 + `scripts/intel-eval.ts` | 真实评测 **BLOCKED** |
| R3-5 | 标注集整跑费用入报告；≤设置页已确认预算；未配置则 BLOCKED 且零真实调用 | `sharedLlmBudget` Settings 字段 + GET `/api/shipping/llm/shared-budget`；`resolveSharedLlmBudgetGate`；analyze/translation 共享闸门 | **预算闸门与设置 UI 已接通**；真实费用跑未发起 | 未配置 → fail-closed；本收口仍 **BLOCKED** | `46a79db6` / `e5ff4ba2` / `35d34ca5` | **R3-5 BLOCKED**（无用户确认预算与真实密钥） |
| R3-6 | 打开所有页面，`paid_receipt` 无新增 | 已开放：`/` `/ports` `/events` `/policies` `/calendar` `/feed` `/label` `/settings`（天气模块未开放） | **浏览路径只读**；专项隔离浏览本包补证 | `r3-6-browse-e2e.txt` + `r3-6-browse-evidence.json`；policies/intel read-http 单测 | 本包 `scripts/e2e-r3-6-browse-zero-pay.mjs`；既有 `policies-read-http.test.ts` | 隔离浏览零付费 **本包证明**；**≠ S7** |
| R3-7 | 分析结果带 provenance=`ai`、模型名、prompt 版本 | `analyze-pipeline` 写入 `intel_analysis`（provenance/modelName/prompt hash）；label 投影 AI prelabel | **离线分析写入已实现**；生产触发未接通 | analyze-pipeline 单测断言 provenance/model | `3fde142a`…`52a40a28`（run_id） | 生产路径无自动分析 → 生产侧 provenance 覆盖未验 |
| R3-8 | 政策类自动新建/更新；缺文号进人工；TikTok 整页 diff（夹具） | `PolicyAutoService.applyFromExactIntel`；**A1** `runOfflineAnalyzeThenPolicy`（默认关）；政策页 GET；schema v37–v39 | **离线编排已接线**（显式 opt-in helper）；**生产仍未启用**；GET/浏览不触发 | RC1–RC4 + A1 假 Provider 单测 11/11 | `3fbac06a`…`2258810c`；A1 见 `r3-a1-offline-analyze-policy-20261102` | 生产自动入库仍关；**A2 ExactVersion 颁发器未接通** |

## Helper vs 生产接线（强制区分）

| 能力 | Helper / 注入 | 生产接线现状 |
|---|---|---|
| ExactVersion 权限 | `ExactVersionModelLicense` + `admitModelPayload`；测试内手工构造 license | **无**生产颁发器；**无** HTTP/任务在分析前发放 license |
| 总池预算 | `resolveSharedLlmBudgetGate` / Settings `sharedLlmBudget` | **已接通** Settings 读写 + paidRequest 共享闸；真实金额授权仍未做 |
| 分析触发 | `runOfflineAnalyze(...)`；A1 `runOfflineAnalyzeThenPolicy`（显式调用） | **无** analyze HTTP、**无** BackgroundRuntime 分析任务、GET **永不**分析；A1 仅离线显式入口 |
| 政策自动入库 | `PolicyAutoService.applyFromExactIntel` / `apply`；**A1** `runOfflineAnalyzeThenPolicy`（`enablePolicyAuto` 默认 false；env alone 不启用） | **离线编排已接线，生产仍未启用**；无 HTTP/cron；GET/浏览 invoke 仍为 0；**A2 颁发器未接通** |

## 明确非结论

- 本矩阵 **不**宣称完整 R3 通过。
- **不**批准 merge/deploy。
- R3-5 **BLOCKED**；S7 **NOT_RUN**；R3-2～4 真实效果未验。
