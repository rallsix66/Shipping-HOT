# R1.5-4 尼格（Nalgae 2022）单事件来源记录（供下一轮试录，2026-10-12）

> **只是来源记录，没有录入。** 真实语料 `qualifiedPortClosureReplayEvents` 仍为空，状态 0/10 BLOCKED。下面的结构校验结果不等于来源真实性鉴定。

## 事件
- 拟用 eventId：`2022-nalgae-cnshk-sct-cct-mct-gate`；weatherSystemId：`TC-2222-NALGAE`。
- 港口：只映射 **CNSHK**（蛇口），不扩展到盐田、南沙或其他港口。
- 作业范围：**SCT、CCT、MCT 码头闸口的交提箱服务**（原文「停止所有交、提箱服务」「全面恢复交提箱服务」）。不代表船舶靠离泊、引航或全港停航。

## 停工、恢复原文（运营方 CN-P09 招商局港口（华南）营运中心）
| | 停工 | 恢复 |
|---|---|---|
| 实际抓取地址 | `https://www.portshekou.com/ywgg/1200` | `https://www.portshekou.com/ywgg/1199` |
| 页面标题 / 发布日期 | 业务公告——SCT，CCT，MCT预防台风通知 / 2022.10.31 | 业务公告——SCT，CCT，MCT将于11月03日14时全面恢复交提箱服务。/ 2022.11.03（正文：通知时间 2022年11月03日 12:00） |
| 原句 | 「SCT，CCT，MCT码头闸口将于11月01日07时00分停止所有交、提箱服务。」 | 「SCT，CCT，MCT将于11月03日14时全面恢复交提箱服务。」 |
| 本地时间 | 2022-11-01 07:00 | 2022-11-03 14:00 |

- **协议核实**（2026-10-12 14:31 UTC+8，盒子网络环境）：两个地址用 https 访问都返回 200、没有跳转；用 http 访问在 30 s 内连接超时（`fetch-log-2026-10-12.txt`、`hdr-*.txt`）。首次存档时（2026-10-12 13:4x UTC+8）也是用 `curl https://www.portshekou.com/ywgg/<id>` 抓取的；之前文档里出现的 http 地址都是其他二手来源（例如 jtys.sz.gov.cn），不是这两篇公告。本轮没有为通过校验而改写任何字符串。
- **时区**：原文**没有写时区**。推定为 UTC+8，理由：发布方是深圳本地码头运营方，面向本地司机发布闸口作业安排，同期深圳市气象台的信号时间（「10月31日17时00分」）也是本地时间。这只是**推定**（`statedOffset: null`、`inferredOffset: "UTC+8"`、附理由、`ambiguous: false`），不能说成原文写明。
- 换算后的 UTC 窗口：`2022-10-31T23:00:00Z` 到 `2022-11-03T06:00:00Z`。

## 天气输入（HKO 最佳路径，事后分析）
- **批准范围**：用户 2026-10-12 14:05 UTC+8 回复「可以」。只用于**离线事后回放**，不新增实时 provider，不扩港。目录已登记为 XX-W06。
- 官方页面标识：香港天文台《2022年热带气旋》Nalgae（2222）六小时位置及强度数据，路径 `/en/publica/tc/tc2022/six_hrly_data_nalgae.html`（hko.gov.hk 与 weather.gov.hk 两个域名都提供这个路径）。**实际抓取地址**是 `https://www.weather.gov.hk/en/publica/tc/tc2022/six_hrly_data_nalgae.html`（HTTP 200）。报告页实际抓取的是 `https://www.hko.gov.hk/en/publica/tc/tc2022/section3_6rpt.html`。
- 数据类型：`post_analysis`，经度纬度只取六小时整点定位，不插值；用这些定位计算与港口的距离（`derived_distance`，单位 km）。港口坐标用项目代表点，蛇口 22.48N 113.91E（`shared/shipping-fixtures.ts`），不是官方码头测点。计算公式：haversine，地球半径 R=6371 km。
- **窗口内全部定位点**（UTC，原文时间）：

| 时间（UTC） | 纬度 | 经度 | 与蛇口距离 km |
|---|---|---|---|
| 2022-11-01T00:00Z | 18.7 | 116.0 | 473.3 |
| 2022-11-01T06:00Z | 19.2 | 115.8 | 414.2 |
| 2022-11-01T12:00Z | 19.8 | 115.7 | 351.1 |
| 2022-11-01T18:00Z | 20.2 | 115.5 | 302.3 |
| 2022-11-02T00:00Z | 20.5 | 115.3 | 263.0 |
| 2022-11-02T06:00Z | 21.1 | 115.0 | 190.3 |
| 2022-11-02T12:00Z | 21.6 | 114.6 | 121.0 |
| 2022-11-02T18:00Z | 22.1 | 113.9 | 42.3 |
| 2022-11-03T00:00Z | 22.2 | 113.3 | 70.0 |

  2022-10-31T18:00Z（517.5 km）在窗口之外，不计入。2022-11-03T06:00Z 之后原文写的是 Dissipated（已消散），没有定位点。
- **不使用**：最佳路径表中的「Estimated maximum surface winds」是气旋中心附近的最大风速，**不能当作港口阵风**；报告里的站点最大阵风（昂坪、横澜岛、长洲）没有发生时刻，站点也不在港区，同样不用。
- 本轮**不跑**规则判断。

## 存档与哈希（两种哈希不能混用）
| 文件 | 抓取时原始字节的 sha256 | 当前存档（git blob）的 sha256 | 差异原因 |
|---|---|---|---|
| raw-cn-p09/ywgg-1200.html | af36144c5844950122d8aa6c19592ea6867c15b8cea12c621d4acb623f62f36e | 356a5ee06326db67ceccb8cccbad7c2f1190d62b8ae4f231dfc0ed3b4edcee9e | csrf-token 的值已替换为 [REDACTED] |
| raw-cn-p09/ywgg-1199.html | 885a7932e7315c365711f5f96241e16ec517f8b751d8f8b3ecccb61c59a0fee1 | 5fd4c4e6f3130ab585579ce106ecb068f896bbf1ad35e39c30e0f30070f6bc95 | 同上 |
| raw-weather-inputs/hko-six_hrly_data_nalgae.html | 8c1e987f4e5686344965900daf53161e3c00835866f562b3042e9eefab64f837 | 9f6d1571354c833aaa86952f7dafe65b1fe7c808ba5e8fadd1e181acbda1510b | git 把 CRLF 换行规范化为 LF，内容没改；去掉原始字节里的 \r 后算出的 sha256 与存档一致 |
| raw-weather-inputs/hko-section3_6rpt.html | 8f2eaf4088bbe1bb957cc985b8c46aa74c6edcd6d4eed5919d7a4132c93847d9 | 7d393e063acc6a937f11cd22e4554dd1096f4b15eed0c19ded5d050d2bc44003 | 同上（CRLF→LF） |

- `raw-cn-p09/sha256.txt` 和 `raw-weather-inputs/sha256-hko.txt` 记录的都是**抓取时原始字节**的哈希（CN-P09 为脱敏前的字节）。
- 2026-10-12 14:31 重新抓取了这两篇运营方公告，按同样方式脱敏后的 sha256 是 94c5f53e…（1200）和 b309e93f…（1199），和首次存档不同。原因是页面里有动态内容，所以存档以首次存档为准。

## 结构校验预检（下一轮试录前要做的）
- C2 CNSHK 在八港内；C3 作业范围已写明；C4 两篇都是 https 链接、有原句、发布方是 operator；C5 时区是推定且附理由，UTC 窗口有效；C6 的 9 个定位点：产品已批准，类型为 derived_distance，单位 km，数值都非负；C7 窗口外的定位点（10-31 18Z）已剔除。
- 这些只是**结构检查**，不能证明来源内容是真的。
