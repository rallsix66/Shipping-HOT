# A2 — 零付费 fail-closed 证据核验接口 + 夹具测试（2026-11-02）

- 基线 tip（本 RC 相对）：`264d80809440a36349d968a3e5fd245fb9218639`
- 分支：`codex/shipping-hot-r3-1-llm-registry-20261027`
- dots REQUEST CHANGES：ts `1793611831.715999`
- **不是**实际素材授权、真实调用或生产颁发批准

## RC tighten 交付

| 路径 | 说明 |
|---|---|
| `server/intel/llm/exact-version-evidence-verifier.ts` | 无 license 返回；`parseStrictInstant`；persistence 收窄 |
| `server/intel/llm/exact-version-evidence-verifier.test.ts` | 夹具 24；测试 DB 在项目 `.tmp` |
| `docs/design/r3-a2-exactversion-evidence-boundary-draft.md` | RC 三点落地说明 |
| `docs/evidence/r3-a2-failclosed-verifier-20261102/rc-tighten/` | 上轮 RC tighten 门禁与 neat |
| `docs/evidence/r3-a2-failclosed-verifier-20261102/rc-material-bind/` | 本片：素材来源注入 + 非空 UTF-8 门禁日志 |

## 三点落地

1. **无 license 返回**：成功仅 `evidenceRef` + `productionAuthorized:false` + `licenseIssued:false`；正向测试断言 `admitModelPayload` 不能凭 evidenceRef 放行；不放宽旧 gate。
2. **严格时间**：`validFrom`/`validUntil`/`revokedAt` 真实日历 + 显式时区；拒绝 `"1"`、日期溢出、无时区、非法时区、撤销畸形、now 无效/抛错；显式 `null` 开放期限保留。
3. **内容范围写实**：注入 `TrustedMaterialSource`；有效范围 = evidence ∩ material.readableScope；裸 `persistence` 不能覆盖；缺/错/不可读 → BLOCKED。

## 契约要点

1. clip private/unknown/unverified **硬拒不放宽**
2. 无可信证据源/记录 → BLOCKED；不从 boolean / 公开 URL / persistence / 未认证勾选 / unverified 审计推导许可
3. 步骤仅 `prefilter` / `extract` / `severity` / `severity_tiebreak`
4. **不**写授权记录、**不**开授权 UI/HTTP、**不**定时/自动 grant、**不**实现可直接使用的生产颁发器
5. 正向分支仅隔离可信夹具；夹具成功 ≠ 生产有权；核验结果 ≠ 新创建授权 / 可消费 license
6. 无结果缓存绕过后续撤销或版本变化

## 测试覆盖（26+）

含原负例/正例 + 严格时间（含 ±14:01 拒绝、小数秒≤3）+ TrustedMaterialSource 绑定/错身份/收窄/裸 persistence 无效 + 成功无 license 且不可送入旧 gate + 项目 `.tmp` DB。

## 文档声明

**只读核验接口已实现；可信生产证据接入/颁发仍未完成。**

## 非结论

- 未 merge / 未 deploy；未配真密钥；未调真实模型；未采新素材
- 不重开 R2、不混 continuous 11、不做 R4
- S7 **NOT_RUN**；R3-5 **BLOCKED**
