# 三类真实缺口：现存资料与精确下一步

本轮没有请求，以下不是自动执行或范围扩张。来源保持已批准目录产品，不猜实际URL/ID。

| 缺口 | 现存依据与已知事实 | 下一步最小交付 / 仍需的真实材料 |
| --- | --- | --- |
| PAGASA PH-W01/PH-W02活动正样本 | [10/10存档结构](../pagasa-warning-2026-10-10.md)与[原接入建议](../pagasa-warning-2026-10-10-integration-proposal.md)：两个既定入口分别有局部无活动TC/未发Weather Advisory原文，无公报编号、发布时间、有效期或PDF正样本 | 先沿用已有“成功空/失败/已过期未知”三态字段清单；下一次获准补证只取目录同一入口的真实活动页面，记录身份/原发布时间、有效期、修订/解除与区域原文。未出现正样本前不造字段、不把空状态当活动覆盖；若真实页面出现PDF，只记录真实链接，PDF处理另审，不猜地址、不扩域 |
| ID-W02具体港口产品映射 | [目录ID-W02](../../intel-source-catalog.md)只给既定BMKG海事API根、文档`/apidoc`和`/pelabuhan/{KODE}.json`模板，备注**不需要鉴权**；当前[矩阵](../r2-current-source-matrix-2026-10-14/mapping.json)没有具体官方KODE/数值样本 | 先列八港范围内适用的印尼关注港IDJKT/Tanjung Priok映射表：官方KODE的出处、与港口坐标/名称一致性、响应时间/时区、风浪字段/单位/缺测语义。现存资料未给可核实KODE，保持未知；不能拿UN/LOCODE或城市拼音充KODE，也不凭模板构造已验证请求。后续如需补官方文档与具体产品实录，另定精确有界预算；不要求新密钥/付费或扩港 |
| XX-W02 specifications覆盖 | [目录XX-W02](../../intel-source-catalog.md)已同时包含`forecast.json`与`specifications.json`，不是新增产品范围。既有[适配器](../../../server/providers/jma-tropical-cyclone.ts)只请求targetTc/forecast；[旧数值证据](../r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json)没有specifications实录 | 先以现存forecast/持久化字段列出产品对照表，specifications字段、单位、时间与适用对象栏保持“未实录”。未来补证以当次已确认target TC身份绑定同一对象的两份产品；不能把旧推导TC2634/2635路径充真实请求或拼成当前URL，不能用forecast部分成功覆盖整行。继续PARTIAL，本轮不请求 |

已认可VN-W01/TH-W01/ID-W01与XX-W01/XX-A01/XX-A02只整理引用，见[索引](accepted-reference-index.json)：不重复测试、不增资格。NCHMF8成功4失败及旧job误报与修复原件都保留；VNSGN原点海况仍缺，ADR-009约61.8km独立参考不冒充原点/泊位。
