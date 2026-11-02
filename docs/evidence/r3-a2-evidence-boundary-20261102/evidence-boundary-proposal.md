# A2 证据边界方案 — ExactVersion 送模授权（交审稿）

> 方案通过前**不执行** A2 产品实现。无可信证据时保持 **BLOCKED**。
> 复用已有契约（`admitModelPayload` / `ExactVersionModelLicense` / ClipAudit / persistence），**不**新造一套权限系统。

## 1. 现有证据为何不足

### 1.1 Manual clip 审计 = 未核验声明

`ClipAudit` 联合类型只有两种 verification：

| 字面量 | 含义（代码/ADR-010） | 对送模 |
|---|---|---|
| `user_declaration_unverified` | 历史「自有/获权」声明；actor/time 未身份认证 | **一律拒绝**（`admitModelPayload` → `rights_unknown`） |
| `manual_capture_unverified` | 新普通剪藏：`private_material` + `rightsStatus: unknown` | **一律拒绝**（`private_material`） |

仓库内**不存在** `verified` / `confirmed` / `attested` 等核验终态。声明存在 ≠ 权利已核验。

### 1.2 `source.persistence` 仅授予存储/可读范围

`IntelPersistence = full | excerpt_only | disallowed` 经 `content-license` / `manualPersistenceFor` / `readIntelMaterial` 收窄**本地可读正文范围**。

`material-read.ts` 明确：内部存盘材料读取，**不是** HTTP/模型载荷许可。
可读可存（甚至 `full`）**不等于**允许把正文送出到外部模型。

### 1.3 `ExactVersionModelLicense.evidenceId` 是未来接口

`model-payload-gate.ts`：

- `ExactVersionModelLicense`：`itemId` + `versionId` + `contentHash` + `permitted: true` + 可选 `evidenceId?`
- 注释写明：`evidenceId` 是 **future rights store** 的不透明指针；**本闸本身不证明**生产权利库/HTTP/权威总池
- 生产路径**无**颁发器；测试里 `licenseFor(...)` 手工构造 `permitted: true` —— **夹具 ≠ 生产许可**
- 只读盘点 `issuerFunctionHits: []`（见 `readonly-inventory.json`）

### 1.4 禁止的捷径（本方案硬拒）

- 把 `user_declaration_unverified` / `manual_capture_unverified` 改写成或升级成 `permitted: true`
- 因 `persistence === "full"` 或本地可读就发 license
- 因公开网页可读 / catalog 收录就当许可
- 因测试能注入 license 就宣称 A2 已接通
- bare `modelUsePermitted=true`（闸已 fail-closed）

## 2. 最小核验接口如何默认拒绝

建议 A2 窄颁发器（方案通过后再实现）对外唯一入口形如：

`tryIssueExactVersionModelLicense(input) → { ok:true, license } | { ok:false, code, reason }`

**默认拒绝面**（任一命中即拒；无证据 → BLOCKED，不发 `permitted:true`）：

| 拒绝类 | 条件 | 建议 code（对齐/扩展现有 deny） |
|---|---|---|
| 私有素材 | clip `usage === private_material` 且无独立送模许可记录 | `private_material` |
| 权利未知 | `rightsStatus === unknown` 或缺少可信 rights 记录 | `rights_unknown` |
| 未核验声明 | verification ∈ `{user_declaration_unverified, manual_capture_unverified}` 且无更高核验证据 | `rights_unknown` |
| 仅可读可存 | 仅有 persistence/contentScope，无 model-use 许可行 | `no_model_permission` |
| 身份不符 | 请求的 item/version/contentHash 与材料或许可绑定不一致 | `license_mismatch` |
| 版本/hash 不符 | 正文变更后旧许可不自动继承 | `license_mismatch` |
| 已撤销 | 许可记录 revoked / 过期 / 用途或模型服务超出范围 | `no_model_permission`（或未来 `license_revoked`） |
| 公开可读误认 | 仅因 URL 公开/可抓取/目录收录 | `no_model_permission` |
| 证据缺失 | `evidenceId` 空或 rights store 查无 | `rights_missing` / `no_model_permission` |

闸顺序保持现有 `admitModelPayload`：**先** clip 硬拒，**再**校验 ExactVersion 绑定；颁发器不得绕过该闸。

## 3. 未来可信记录所需字段

不新增平行权限产品；在现有 ExactVersion +（未来）rights evidence 行上落最小字段：

| 字段组 | 最小内容 | 说明 |
|---|---|---|
| 素材/来源 | `itemId`, `versionId`, `contentHash`, sourceId/catalogId, actualUrl（若有） | 精确版本绑定；hash 变则旧许可失效 |
| 允许的模型服务与用途 | provider/model 绑定范围或 step 集合；用途枚举如 `analyze_prefilter_extract` | 「用户允许传输」≠「允许任意厂商/训练」 |
| 正文范围 | `metadata_only` / `excerpt` / `full_text`（可窄于 persistence） | 送模范围 ≤ 存储许可 |
| 许可依据 | basis（own_work / written_permission / license_text / …）+ 证据指针/摘要 | 公开可读 ≠ 依据 |
| 确认身份 | 确认人（可认证身份或显式 operator 策略）、确认时间、确认渠道 | 区别于 `CLIP_UNIDENTIFIED_OPERATOR` 未认证声明 |
| 撤销机制 | revokedAt / reason；查询时必检 | 撤销后颁发器与 admit 均拒 |

### 3.1 两个必须区分的判断

1. **用户允许传输**：操作者同意把该版本正文发往指定模型服务（传输同意）。
2. **有权允许该素材使用**：素材本身具备可核验的使用/再处理权利（权利依据）。

两者**同时**满足才能 `permitted: true`。缺一即 BLOCKED。
**不把公开可读当许可**（ADR-010：产品授权 ≠ 任意页面版权许可）。

## 4. 最小实现方案（仍待批准；本包不编码）

1. **进程内窄 factory**（wiring-gaps A2）：只接受「已存在且未撤销的可信 rights evidence」+ 精确 item/version/hash + 用途/服务范围匹配 → 返回 `ExactVersionModelLicense`。
2. **无 HTTP 随意申请**；不自动 grant；不接浏览 GET；不接 cron。
3. **复用** `admitModelPayload` 为最终送模闸；pipeline / A1 编排继续要求注入 license。
4. **evidence 存储**：优先扩展现有 manual action metadata / 专用 evidence 表（另批 schema），`evidenceId` 指向该行；本方案不预支 DDL。
5. **失败语义**：查无/未核验/撤销/失配 → 不构造 license；分析入口保持 BLOCKED/denied，零 Provider。
6. **测试**：夹具仍可手工 license，但文档与门禁继续写明「非生产颁发」。

### 4.1 需要用户一次确认的选项（勿碎片催问）

请 dots/用户对下列选项给**一批**答复即可（可勾选/改写）：

**A. 可信确认身份**

- A1：仅本机已登录/已配置的单一 operator 身份可确认送模许可
- A2：允许未认证本地 operator，但必须每次显式勾选「我确认有权 + 同意传输」，并永久审计（仍非公开网页自动许可）
- A3：其它（请写明）

**B. 许可依据最低线**

- B1：仅 `own_work` 或持有书面/票据类 permission 证据可进入核验队列
- B2：额外允许特定已审核 catalog 源的「官方公告摘录送模」白名单（按 sourceId+URL 精确产品，不扩全站）
- B3：暂时不做任何自动源；仅人工素材走确认流

**C. 模型服务与用途范围**

- C1：仅绑定 Settings 中已配置的 chat 分析步骤（prefilter/extract），禁止训练/二次分享表述
- C2：允许 embeddings 另议
- C3：其它限制

**D. 正文范围默认**

- D1：默认最多 `excerpt`（≤280）送模，full_text 需额外确认
- D2：允许与 persistence 同级（仍需双重同意）

**E. 撤销**

- E1：提供本地「撤销该 version 送模许可」动作；撤销后立即 BLOCKED
- E2：仅手动清库/改 evidence（不推荐）

**F. A2 实现时机**

- F1：批准本方案后立刻做进程内颁发器（仍无 HTTP）
- F2：先只合并文档边界；颁发器另开切片
- F3：与 A3 受控触发入口同批（仍默否认）

**G. 与 R3 阻塞一并确认（见 `r3-capability-and-blockers.md`）**

- 真实密钥/双厂商测连、真实约 200 标注集、预算数字、S7 是否另批 —— 本包只列出，不执行

## 5. 明确不做

- 不升级现有未核验字段为 `permitted:true`
- 不创建「授权记录」假数据冒充生产
- 不开 HTTP/定时自动颁发
- 不 merge / deploy / 进 R4
- 不把公开可读、persistence、测试夹具当成送模许可
