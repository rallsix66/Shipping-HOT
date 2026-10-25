# XJ001数值合同矩阵（2026-10-20，单样本）

本机一次GET为HTTP200/11259字节，原件SHA256 `3af2b483aeb5623312ae86fbef5d63ca31ec6653e10b2ac24bfaa6213da98ba1`。下表区分上轮已认可官方文档与本轮payload事实，不从单样本补造规则或更新资格。

| 项目 | 文档/索引依据 | 本次payload核对 | 结论/限制 |
| --- | --- | --- | --- |
| 精确产品 | 官方GET /pelabuhan/{KODE}.json，索引XJ001 | code=XJ001；name=Pelabuhan Tanjung Priok | 精确URL与返回身份在本次通过，不是持续可用或下游接入通过 |
| 位置 | 索引DK Jakarta，lat -6.103879776、lon106.882294878 | 产品不含坐标 | 不能声称产品坐标与索引实值比较成功；项目port-jakarta/IDJKT坐标(-6.1,106.88)不改 |
| issued/updated | 文档说明UTC预报时间；未规定本次issued的刷新SLA | issued=2026-10-19 12:00 UTC，无updated字段 | 明确保留issued，不能以抓取时间当源更新时间；issued语义/更新周期不能由一个样本扩成新规则 |
| 有效范围 | 官方UTC | valid_from=2026-10-20 00:00 UTC，valid_to=2026-10-23 00:00 UTC | 严格Gregorian UTC解析，首尾跨72h；不写4个完整24h或7日覆盖 |
| day1 | 文档逐小时24点 | 24点，20日00..23 UTC，相邻60min | 本次符合 |
| day2-4 | 文档每3h | 17点，21日00至23日00 UTC，相邻180min | 17仅本样本事实，不能固化为通用条数；不插值补小时 |
| 时间完整性 | 时间应有显式UTC | 全41点严格递增、重复0、越有效范围0 | 抓取时37未来点/4过去点；不能算作41小时预报 |
| 时效 | 尚无已批准BMKG issued-age SLA | 抓取03:33:55.108Z；issued距抓取15.5653h，仍在声明有效范围，剩68.4347h | 不直接判fresh/stale；现有6h逻辑用fetchedAt，不能据此洗白旧issued |
| 波高 | 文档m | wave_height，41个有限number，0.1..0.3 | 可候选投影waveHeightM；不当成swell |
| 风速/阵风 | 文档knot | wind_speed 1..9；wind_gust4..18，均41个number | 候选乘1.852→km/h；不推定10m高度或新阈值 |
| 能见度 | 文档km | visibility7..10，41个number | 候选乘1000→m |
| 流速 | 文档knot | current_speed0.59..0.8，41个number | 现有WeatherRow无对应字段，不偷存为风速 |
| 温度/湿度/潮位 | 文档摄氏/%/m | temp_avg27..30；rh_avg66..83；tides -0.52..0.22 | 现有WeatherRow无字段；负潮位不是异常负值 |
| 字符描述/方向 | 未取得完整码表/枚举合同 | weather/wind_from/wave_cat/current_to为印尼语字符串，wave_cat仅见Tenang | 不造数值方向、严重度、官方预警/港口影响 |
| 缺失/质量 | 未取得null/哨兵值/质量码完整合同 | 八个数值字段均41个有限number、missing/null0；无quality/qc/flag键 | 仅描述本样本，不能声明永不为空或发明-999等处理规则 |
| 简单异常诊断 | 非正式新增阈值 | 重复/倒序/越界0，非负量负值0，RH越0..100为0，gust低于wind为0 | 只是本次检查，不以观测min/max作为未来合法范围 |
| 覆盖不足 | 当前项目7日天气/规则合同不变 | 单港口、72h混合1h/3h；无降水mm、无单列swell、非实测current | 不满足7日逐小时/降水24h/全部规则，不由天气描述推降水量 |

所有单位来自已认可的本机apidoc；payload没有unit元数据块。原文的time均有UTC后缀，不借操作系统时区解析。既有历史数字3/5、25/39、24/34均不改。
