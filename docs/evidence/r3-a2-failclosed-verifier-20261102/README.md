# A2 — 零付费 fail-closed 证据核验接口 + 夹具测试（2026-11-02）

- 基线 tip：`3e985da224484da86da135622919e1659084b3ca`（A2 Draft 文档已接受）
- 分支：`codex/shipping-hot-r3-1-llm-registry-20261027`
- 用户/dots 范围确认：ts `1793610779.487829`（零付费、无授权记录写入、无 HTTP）
- **不是**实际素材授权、真实调用或生产颁发批准

## 交付

| 路径 | 说明 |
|---|---|
| `server/intel/llm/exact-version-evidence-verifier.ts` | `tryVerifyExactVersionEvidence` + fixture source |
| `server/intel/llm/exact-version-evidence-verifier.test.ts` | 夹具负例/正例；断言无 Provider、无授权表写入 |
| `docs/design/r3-a2-exactversion-evidence-boundary-draft.md` | 方案更新为「核验已实现；生产接入/颁发未完成」 |

## 契约要点

1. 复用 `ExactVersionModelLicense` / `admitModelPayload`；clip private/unknown/unverified **硬拒不放宽**
2. 无可信证据源/记录 → BLOCKED；不从 boolean / 公开 URL / persistence / 未认证勾选 / unverified 审计推导许可
3. 校验精确 item/version/hash、证据身份、有效期/撤销、指定模型服务、步骤与内容范围
4. 步骤仅 `prefilter` / `extract` / `severity` / `severity_tiebreak`；超出拒绝；embeddings/训练/二次分享不自动含
5. 读取失败、字段畸形、时间未知 → 不放行
6. **不**写授权记录、**不**开授权 UI/HTTP、**不**定时/自动 grant、**不**实现可直接使用的生产颁发器
7. 正向分支仅隔离可信夹具；夹具成功 ≠ 生产有权；核验结果 ≠ 新创建授权
8. 无结果缓存绕过后续撤销或版本变化（每次 `getById` 重读）

## 测试覆盖（17）

缺证据、无源、查无、读失败、时间未知/畸形、撤销、过期、错版本/hash、错服务、步骤不足、正文超范围、private_material 硬拒、unverified 硬拒、boolean/URL/persistence 不放行、夹具合法匹配、撤销/hash 变更后先前成功不可绕过、零 Provider + 无授权表写入。

## 文档声明

**只读核验接口已实现；可信生产证据接入/颁发仍未完成。**

## 非结论

- 未 merge / 未 deploy；未配真密钥；未调真实模型；未采新素材
- 不重开 R2、不混 continuous 11、不做 R4
- S7 **NOT_RUN**；R3-5 **BLOCKED**
