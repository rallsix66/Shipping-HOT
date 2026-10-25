# 最小离线接入建议（历史；纯parser已实施，见更新）

> 2026-10-20更新：本页保留前轮设计证据；获批纯parser与测试已实现并完成完整41点原件离线回放，现役结果见[本轮报告](../r2-id-w02-offline-parser-2026-10-20/report.md)。原countingRules没有每数值源先入库/注册Provider条件，72h混合步长不套R1.5七日逐小时门槛；下列DB/多源/时效接线风险仅未来实现事项，不作为本轮R2-4字段验证前置条件。资格变更仅提议，待父审，现25/39与24/34不变。

## 可以直接复用与不能直接接线之处

| 层 | 已有实现 | 最小复用边界/真实限制 |
| --- | --- | --- |
| 安全抓取/解码 | `server/services/article-fetch-security.ts`、`response-decoding.ts` | 未来正式HTTP仍走原系统DNS/地址绑定/TLS/类型/大小/超时/跳转安全链；不另建fetcher或SDK |
| 领域数值 | `shared/shipping.ts:PortWeatherForecastRow` | 可容纳波高m、风/阵风km/h、能见度m；不含issued、有效期、来源点坐标、3h分辨率、流速/温湿/潮位/方向/码表 |
| Provider边界 | `server/providers/shipping.ts:WeatherProvider` | 未来可实现既有接口和drain/ack批次，但需另行审定来源选择/激活；当前Open-Meteo代码不是BMKG解析器，不能伪装Open-Meteo JSON |
| 调度 | `server/runtime/weather-sync-job.ts:createWeatherSyncJob`及唯一BackgroundRuntime | 数值产品属于既有weather-sync；不放进intel RSS/HTML/json_list资讯collector，不建第二scheduler，不能混进34资讯标题/链接/日期分母 |
| Repository | `ShippingRepository.replaceWeatherPortBatch/listWeatherForecastsForPort...` | 现方法按port删除全部weather_forecast和weather_impact，再写批次；没有按source隔离。直接写BMKG会覆盖同港Open-Meteo，不能当即并行接线 |
| row id | `openMeteoPointsToForecastRows` | 当前id含port/horizon/time，不含source；多来源同时间会冲突，不能直接复用该id生成逻辑并写库 |
| schema/trace | 现schema015 weather_forecast已有source_id/fetched_at/payload_json | payload_json当前writer硬编码NULL、reader未投影；不能绕过正式类型把issued/坐标等塞进去。类型/读写合同与多源策略须先审，不自动需要新表，但也不能承诺完整接线无变更 |
| 时效/覆盖/影响 | `weather-panel-policy.ts`、`weather-impact-interval.ts` | 既有7日窗口、fetchedAt的6h stale、hourly最大1h影响有效期保持。3h点不能延展/补齐三小时影响；不通过新抓取时间掩盖issued年纪 |

现有Jakarta身份是`port-jakarta / IDJKT`，别名含Tanjung Priok。BMKG索引点是其source元数据，不修改`shared/port-directory.ts`的港口坐标，也不冒用VNSGN的ADR-009参考点例外。

## 建议下一轮仅做的纯离线切片

1. 新增纯函数`server/services/bmkg-port-forecast.ts`及其必要测试；输入已存合法样本/原对象和显式XJ001目标上下文，输出模块内部结果：身份、issued/有效期、保留原分组/步长的稀疏点、可投影的四类数值及未支持字段说明。它不发请求、不写DB、不实现Provider注册或读取Settings，不改shared正式合同。
2. 严格解析源声明UTC格式并验证日历，区分issued/valid/fetched；核对code/name。doc支持的day1小时与day2-4三小时应检查；本次17点、数值min/max、无null只是事实，不固化为规则。未知/缺失不补0，未获码表不造方向/质量语义。
3. 可复用现有数值字段命名进行候选投影：wave_height保持m；wind_speed/wind_gust乘1.852转km/h；visibility乘1000转m。本次首点可核算4kn→7.408km/h、8kn→14.816km/h、10km→10000m。不把流速当风、wave当swell、描述当降水mm；不把3h点标成完整1h覆盖。
4. 回归覆盖固定时钟、正确/错误身份、非法/无UTC时间、重复/倒序/跨分组冲突、缺字段/null/非finite、单位换算不重复、3h间距不插值、负潮位保留、issued-age与有效范围分离。用原创最小结构fixture作长期测试；完整来源原件只在许可范围私有回放，不能提交完整payload。正常typecheck/lint/Vitest/build与真实Neat Freak，必要的隔离原件回放另行记录。

该纯离线切片不需schema迁移、新凭据或网络/启用权限；它也不完成SQLite/生产接入。正式接线前还要审定单来源选择或多来源并存、ID与整批替换策略、issued/坐标/分辨率的持久化合同、源时效SLA和许可；任何确需shared/schema/新Provider激活的变化按项目审批边界办理。本轮不替这些决策先写代码。

## 本轮能确认的验收子项

准确产品URL、一次安全响应、真实数值JSON、XJ001身份、UTC/文档单位、实际覆盖与基本结构诊断已有证据。仅可建议记为“单样本数值合同已核对，接入/持久化/时效及覆盖未通过”，不自动改为R2-4 OK或历史数值4/5；R2-5资讯字段对ID-W02仍N/A。受限的72h单港口数据不能替代系统7日需求或官方告警。
