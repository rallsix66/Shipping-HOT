# ID-W02纯离线解析与完整原件回放（2026-10-20，待父审）

本机`D:\try one\Shipping HOT`，`codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414`。本轮产品仅新增`server/services/bmkg-port-forecast.ts`及对应测试；无网络、DB、shared/schema、WeatherProvider、Settings、weather-sync、ShippingRepository、坐标/源开关/正式合同或服务/插件变更。

## 解析边界

纯函数保留source URL/fetchedAt、code/name、issued/valid range原文及严格UTC ISO、分组和文档支持的60/180分钟步长。所有原数值与文本单独保留，missing/null/value区分；四类投影只作用于原始有限number：波高m保持、风/阵风knot×1.852→km/h、能见度km×1000→m。无插值、补降水/方向/严重度/港口影响；不读时钟、不发请求、不判断fresh。

身份、UTC/日历、范围、重复/倒序/跨组冲突/越界及组内步长错误fail closed，错误仅含code/path不回显原件。非法类型/nonfinite/溢出拒收；非负物理量和百分比作基本语义校验，温度及潮位可为负。未知字段只报告名称，不造质量码；未建模原值仍由调用者的私有原件留证。空分组显式保留0点，没有自动PASS/健康判定；不把17或41固化为产品条数。

本模块不接收/伪装indexed coordinates为payload坐标；既有位置证据独立保留。source issued与抓取时间不同，不以新fetchedAt洗白源时效。

## 完整私有原件回放

精确输入`.tmp/id-w02-xj001-20261020/response.bin`，11259字节，SHA256 `3af2b483aeb5623312ae86fbef5d63ca31ec6653e10b2ac24bfaa6213da98ba1`。完整JSON全部送入真实parser，不使用摘要/重建fixture/假parser。

结果41点＝day1 24×60min＋day2-4 17×180min；328个数值原值、164个文本字段、164个单位投影、41个原始/ISO时间逐点一致，差异0；原件missing/null/未支持字段/拒收点均0，无插值/网络/DB写入。受控克隆原件验证missing和null各一项仍分开、不投影成0；非法wind_speed字符串被明确拒收。逐点记录只存时间/比较计数，不发布完整41条预报。原件仍ignored/private，未入Git。

原创最小fixture与固定输入验证错误身份、UTC/非法日历/范围、重复/倒序/跨组冲突、类型/物理值/投影溢出、缺失/null、负潮位、mixed cadence、输入不变和不读时钟/网络，具体数量/原始退出码见summary。完整原件回放独立raw exit0，并绑定当前parser源码hash。

## 资格建议（提出，不落地）

原matrix countingRules的R2-4要求真实预期产品和可用解析/归一化/字段验证；没有新增“每个数值源先入库或注册Provider”的门禁。此前提到的整港替换/多源ID/持久化风险属于以后运行接入，不阻挡本纯离线R2材料验收；72h混合步长是产品范围，不拿R1.5七日逐小时要求改写本项。

本轮完成真实产品41点解析及原件回放，建议父审无阻塞后将ID-W02 R2-4由NOT_RUN改为限定OK（该归档样本/字段合同），累计可能25→26/39；原机器矩阵和目录尚未改判，当前仍25/39。资讯24/34不变，ID-W02的R2-5仍N/A。数值证据分列“历史3项有限归一化诊断＋ID-W02新增1项完整原件离线解析”，不粗写4/5已接入，更不是生产/持续可用。

## 门禁与保留

新本地副本`.tmp/bmkg-offline-clean-20261020`基于同HEAD叠加已认可18文件及本轮2文件；正常frozen offline install含scripts、没有复制旧node_modules/native，Corepack下载禁用。build/typecheck/lint/相关与全量测试的命令、实际计数、原始stdout/stderr/exit和源码指纹见[summary](summary.json)。首次source lint多语句/动态typeof问题已修正，日志保留；没有降低规则。完整回放见[raw-replay](raw-replay.json)。

本轮只更新status、给旧接入设计加现役指针，新增本目录report/summary/raw-replay/qualification-proposal/closeout；未改其他已审源码/原资格矩阵/目录。真实[Neat Freak](closeout.md)完成后交父审，无暂存/提交/推送/PR/merge/deploy或清理。CN-T01不轮询、不请求，24h/R3仍暂停。
