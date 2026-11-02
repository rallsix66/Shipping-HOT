# A2 证据边界方案 — ExactVersion 送模授权（交审稿 · Draft）

> **Status: Draft**（非 Accepted ADR）。只读 fail-closed 核验接口已按单项决定实现（见 `docs/evidence/r3-a2-failclosed-verifier-20261102/`）。**可信生产证据接入/颁发仍未完成**。无可信证据时保持 **BLOCKED**。
> 复用已有契约（`admitModelPayload` / `ExactVersionModelLicense` / ClipAudit / persistence），**不**新造一套权限系统。
> 相对 tip `3e420536` 的 RC 文档收紧见同目录 `rc-docs-tighten/`。

## 1. 现有证据为何不足（盘点结论：接受）

### 1.1 Manual clip 审计 = 未核验声明

`ClipAudit` 联合类型只有两种 verification：

| 字面量 | 含义（代码/ADR-010） | 对送模 |
|---|---|---|
| `user_declaration_unverified` | 历史「自有/获权」声明；actor/time 未身份认证 | **一律硬拒**（`admitModelPayload` → `rights_unknown`） |
| `manual_capture_unverified` | 新普通剪藏：`private_material` + `rightsStatus: unknown` | **一律硬拒**（`private_material`） |

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
- 未认证 operator 勾选「有权 + 同意」——**仍是声明**，**不得**列成达到可信核验的等价选项，也不得当作绕过现有硬拒的路径

## 2. 默认拒绝面 + 现有 clip 硬拒（本片保留，不设计绕过）

建议未来核验入口（**仅在用户批准下一片后**才编码；本包仍不实现）形如：

`tryVerifyExactVersionEvidence(input) → { ok:true, evidenceRef } | { ok:false, code, reason }`

> 注意：本片**不**预先设计「更高证据绕过现有 clip 硬拒」。现有 `admitModelPayload` 对 private / unverified 的硬拒**原样保留**；任何未来颁发/核验层都**不得**绕过该闸。

**默认拒绝面**（任一命中即拒；无证据 → BLOCKED，不发 `permitted:true`）：

| 拒绝类 | 条件 | 建议 code（对齐/扩展现有 deny） |
|---|---|---|
| 私有素材 | clip `usage === private_material` | `private_material`（**现有硬拒；本片不设绕过**） |
| 权利未知 | `rightsStatus === unknown` 或缺少可信 rights 记录 | `rights_unknown` |
| 未核验声明 | verification ∈ `{user_declaration_unverified, manual_capture_unverified}` | `rights_unknown`（**现有硬拒；不得以「有更高证据」预留绕过**） |
| 仅可读可存 | 仅有 persistence/contentScope，无 model-use 许可行 | `no_model_permission` |
| 身份不符 | 请求的 item/version/contentHash 与材料或许可绑定不一致 | `license_mismatch` |
| 版本/hash 不符 | 正文变更后旧许可不自动继承 | `license_mismatch` |
| 已撤销 | 许可记录 revoked / 过期 / 用途或模型服务超出范围 | `no_model_permission`（或未来 `license_revoked`） |
| 公开可读误认 | 仅因 URL 公开/可抓取/目录收录 | `no_model_permission` |
| 证据缺失 | `evidenceId` 空或 rights store 查无 | `rights_missing` / `no_model_permission` |
| 用途范围不足 | 证据未覆盖请求步骤（见 §3） | `no_model_permission` / `purpose_out_of_scope` |

闸顺序保持现有 `admitModelPayload`：**先** clip 硬拒，**再**校验 ExactVersion 绑定；核验/颁发层不得绕过该闸。

## 3. 用途清单须覆盖真实分析链

真实 `IntelAnalysisStep` 链为：

`prefilter` → `extract` → `severity` →（必要时）`severity_tiebreak`

（产品叙述里的 pairwise / tiebreak 对应后两步。）

**用途授权必须逐步明确覆盖上述链。** 规则：

1. 证据中的 allowed purpose / step 集合若**只含**前两步（如仅 `prefilter`+`extract`），则 **不得**据此放行 `severity` / `severity_tiebreak`；对应步骤必须拒绝（范围不足 → 拒该步，不是静默扩权）。
2. **不自动包含**：embeddings、训练、二次分享、任意第三方转发、未点名的其他厂商/模型服务。
3. 「用户允许传输」须绑定**指定服务**；「有权允许该素材使用」须有**可核验权利依据**——两者同时成立才谈得上 `permitted: true`（且仍受 §2 硬拒约束；本片不实现颁发）。

## 4. 推荐设计（默认；不把 A–G 七组一次推给用户）

本片把原先分散的技术选择题收成**推荐设计**。真实素材依据、指定服务与传输同意属于**后续实际授权**时再办；预算 / 真实密钥 / S7 继续既定边界（见 `r3-capability-and-blockers.md`），本包不催问。

| 主题 | 推荐默认 |
|---|---|
| 默认姿态 | fail-closed；无可信证据 → BLOCKED；零 Provider |
| clip 硬拒 | **保留**现有 private / unverified 硬拒；本片不设计绕过 |
| 精确绑定 | license / evidence 必须绑定 `itemId` + `versionId` + `contentHash`；hash 变则旧证据失效 |
| 范围收窄 | 送模正文范围 ≤ persistence；用途逐步覆盖 prefilter/extract/severity/severity_tiebreak；缺步拒步 |
| 撤销检查 | 查询与 admit 路径均必检 revoked/过期/超范围 |
| 未认证勾选 | **不是**可信核验；不得等价于 verified |
| 存储 | 优先扩展现有 metadata / 另批 evidence 行；`evidenceId` 指向该行；本方案不预支 DDL、**不写入授权记录** |
| 入口形态 | 无 HTTP 随意申请；不自动 grant；不接浏览 GET；不接 cron |
| 测试夹具 | 可继续手工 `licenseFor`；文档与门禁写明「非生产颁发」 |
| 预算/密钥/S7 | 维持既定 BLOCKED / 另批；本片不展开选项问卷 |

### 4.1 两个必须区分的判断（后续实际授权时）

1. **用户允许传输**：同意把该版本正文发往**指定**模型服务（传输同意）。
2. **有权允许该素材使用**：素材本身具备可核验的使用/再处理权利（权利依据）。

两者**同时**满足才可能 `permitted: true`。缺一即 BLOCKED。
**不把公开可读当许可**（ADR-010）。

## 5. 用户下一步（状态）

单项决定（ts `1793610779.487829`）已批准并实施：**零付费、无授权记录写入、无 HTTP** 的 fail-closed 证据核验接口与夹具测试。

**仍未批准**：可信生产证据接入、生产颁发器、真实授权写入、HTTP/UI、真实模型调用。

## 6. 明确不做

- 不升级现有未核验字段为 `permitted:true`
- 不创建「授权记录」假数据冒充生产
- 不开 HTTP/定时自动颁发
- 不 merge / deploy / 进 R4
- 不把公开可读、persistence、测试夹具当成送模许可
- 不预先设计「更高证据」绕过 clip 硬拒
- 不把未认证 operator 勾选当作可信核验等价项
- 不用仅覆盖前两步的授权放行全链 severity/tiebreak
