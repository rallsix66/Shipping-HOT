# R1.5-4 尼格（Nalgae 2022）蛇口闸口单事件离线回放（事后一致性试录，2026-10-12）

> **结论先行**：这一个事件通过了固定的 C1–C8 准入并且命中，但**只计 1 个**；合格事件少于 10 个，R1.5-4 状态仍为 **BLOCKED（1/10）**。这是**事后条件一致性试录**：用分析后的最佳路径对照已知的停工窗口，**不能证明系统有提前预测能力**，也不宣布通过。本次没有根据回放结果调整时间选择、窗口或阈值。

- 依据：dots ts 1791787171.126289（2026-10-12 14:39 UTC+8）。
- 代码与数据：`server/data/weather-calibration/qualified-port-closure-replay.ts`（真实语料只有这一条）；类型 `shared/weather-impact.ts` 新增可选的 `derivation`（距离推导依据）和 `hashes`（分类哈希），两者只用于审计，准入逻辑不读取。
- 机器输出：`docs/evidence/gate-<代码SHA>/nalgae-replay.json`，由 `scripts/r1-5-4-nalgae-replay.ts` 生成（不联网）。
- 来源记录：`r1-5-4-nalgae-source-record-2026-10-12.md`。

## 事件
| 字段 | 值 |
|---|---|
| eventId / weatherSystemId | `2022-nalgae-shekou-gate` / `TC-2222-NALGAE` |
| 港口、范围 | CNSHK；**仅 SCT/CCT/MCT 码头闸口交提箱**。不是全港停航，也不涉及靠离泊或引航 |
| 停工 | 运营方，`https://www.portshekou.com/ywgg/1200`：「SCT，CCT，MCT码头闸口将于11月01日07时00分停止所有交、提箱服务。」 |
| 恢复 | 运营方，`https://www.portshekou.com/ywgg/1199`：「SCT，CCT，MCT将于11月03日14时全面恢复交提箱服务。」 |
| 哈希 | 每个来源分两类记录：`fetch_raw_pre_redaction`（抓取时脱敏前的字节）和 `archive_git_blob_redacted`（当前存档）。数值见来源记录，两类不混用 |
| 时区 | 原文没写（statedOffset 为 null）；**推定** UTC+8，理由已写入 `inferenceReason`；ambiguous=false |
| UTC 窗口 | 2022-10-31T23:00:00Z 到 2022-11-03T06:00:00Z |

## 天气输入（XX-W06，仅事后分析）
- 窗口内 HKO 六小时最佳路径定位点**全部 9 个**都录入了，保留原始坐标，不插值。只映射 `typhoonDistanceKm`；中心最大风速**不**映射为港口风。
- 距离 = haversine（定位点，CNSHK 项目代表点 22.48N 113.91E，取自 `shared/shipping-fixtures.ts` 的 `portWeatherConfig["port-shekou"]`），R=6371 km，保留 0.1 km。
- HKO 表的末尾：最后一个定位点是 2022-11-03 00Z，之后只写「Dissipated」（已消散），**没有提供更多定位点，也没有给出明确的消散时刻**。

## 逐点结果（机器输出）
| 定位时间（UTC） | 定位点 | 距离 km | 规则命中 | 是否计入命中 |
|---|---|---|---|---|
| 2022-11-01T00:00Z | 18.7N 116.0E | 473.3 | — | 否 |
| 2022-11-01T06:00Z | 19.2N 115.8E | 414.2 | — | 否 |
| 2022-11-01T12:00Z | 19.8N 115.7E | 351.1 | — | 否 |
| 2022-11-01T18:00Z | 20.2N 115.5E | 302.3 | — | 否 |
| 2022-11-02T00:00Z | 20.5N 115.3E | 263.0 | WR-S03 critical | **是（首次命中）** |
| 2022-11-02T06:00Z | 21.1N 115.0E | 190.3 | WR-S03 critical | 是 |
| 2022-11-02T12:00Z | 21.6N 114.6E | 121.0 | WR-S03 critical | 是 |
| 2022-11-02T18:00Z | 22.1N 113.9E | 42.3 | WR-S03 critical | 是 |
| 2022-11-03T00:00Z | 22.2N 113.3E | 70.0 | WR-S03 critical | 是 |

- **准入**：eligible，reasons 为空，9 个点全部有效；rejected 和 pendingReview 都为空。
- **事件级结果**：命中；hitAtUtc 为 2022-11-02T00:00:00Z，规则 WR-S03（距离 ≤300 km）。
- **汇总**：eligibleCount=1，hits=1，状态 blocked，reason「Need 10 eligible events; have 1.」。
- **说明**：首次命中出现在停工开始约 25 小时之后。窗口前 4 个点都在 300 km 以外，没有命中。这正好说明，这次试录只是验证停工期间的数据与规则一致，不能拿来论证提前预警。

## 三类核验分开说明
1. **代码测试（自动、可复现）**，`server/services/weather-calibration-replay.test.ts` 新增 3 项固定回归：
   - 语料只有这一条；范围仅限闸口；两个 HTTPS 地址；分类哈希；时区推定；UTC 窗口。
   - 9 个定位点完整；只映射距离；用 haversine（R=6371）从原始坐标**重算**每个距离并与录入值逐一比对。
   - 准入为 eligible，逐点命中模式为 [否×4, 是×5]，首次命中 11-02 00Z、规则 WR-S03，状态 BLOCKED 1/10。
2. **人工来源核验（不能由代码证明）**：
   - 两篇公告的原文和发布方身份。
   - 用 HTTPS 访问 200、无跳转（14:31 复核）。
   - 时区推定的理由。
   - HKO 表格数值与存档 HTML 一致：已人工对读，测试中的录入值来自这次对读。
3. **未独立重算或核验的项目**：
   - HKO 最佳路径本身的准确性：这是事后分析产品，不是观测。
   - 公告实际执行的时间是否与公告一致。
   - 项目代表点与 SCT/CCT/MCT 实际闸口位置的偏差：没有量化，可能有几公里。
   - 存档 HTML 是否等于当时线上页面：页面有动态内容，今天重新抓取的哈希已经不同。
   - 运营方公告页（列表页和其他文章）里与停工无关的内容。

## 证据卫生（同一轮）
- `raw-cn-p09/recheck-2026-10-12/hdr-https-1199.txt`、`hdr-https-1200.txt` 里 `PHPSESSID`、`__jsluid_s` 的 Set-Cookie 值已替换为 `[REDACTED]`，头名和属性（path、max-age、HttpOnly、SameSite、secure）保留。这些是公开网站下发给匿名访客的会话 cookie，**不是已确认的账户泄露**。没有重写历史（旧值仍在提交 9d70d63 的历史里），也没有重新抓取上游。
- 本轮的证据扫描覆盖 `docs/evidence` 下本轮新增或修改的文件和原始头文件，见 gate 目录下的 `evidence-scan.log`。
