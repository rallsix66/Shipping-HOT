# A2 RC material-bind — TrustedMaterialSource 精确绑定（2026-11-02）

- 基线 tip：`287473f888103175b2c8e36c5f8fc46a1880c798`
- 分支：`codex/shipping-hot-r3-1-llm-registry-20261027`
- dots REQUEST CHANGES：ts `1793612811.444339`
- **不是**实际素材授权、真实调用或生产颁发批准

## 本片交付

| 路径 | 说明 |
|---|---|
| `server/intel/llm/exact-version-evidence-verifier.ts` | 注入 TrustedMaterialSource；裸 persistence 忽略 |
| `server/intel/llm/exact-version-evidence-verifier.test.ts` | 26 夹具（错素材/收窄/裸 persistence 无效/±14:01/小数秒） |
| `docs/design/r3-a2-exactversion-evidence-boundary-draft.md` | material-bind 说明 |
| 本目录门禁日志 | **非空 UTF-8** 原始输出 + EXIT_CODE（对应最终 tip） |

## 假阳性关闭

有效 evidence 下，把实际 `excerpt_only` 素材经裸 `persistence:"full"` 传入，**不再**得到 full_text 核验成功；范围由 material source 读取结果决定，并与 evidence 取交集。

## 门禁（相对基线 tip 的工作区结果；提交后 tip 写入 gates/commit）

- typecheck/lint/build：PASS
- vitest A2：26/26
- vitest full：2235 passed | 10 skipped
- S7 NOT_RUN；R3-5 BLOCKED；未 merge/deploy
