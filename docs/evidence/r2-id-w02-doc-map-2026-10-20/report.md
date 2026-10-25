# ID-W02官方文档与位置映射取证（2026-10-20）

本机`D:\try one\Shipping HOT`，`codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414`。仅文档/元数据取证，无产品代码、源配置、目录资格或分母变更，无提交/推送。CN-T01保持暂停，本轮未查看其配置或进行DNS/HTTP；BMKG旧轮零请求记录已核对。

## 实际请求

| 步骤 | 精确URL | HTTP/字节 | 开始/收到（UTC） | raw exit |
| --- | --- | --- | --- | --- |
| 文档 | `https://maritim.bmkg.go.id/apidoc` | 200 / 148259 | 03:23:54.736 / 03:23:55.586 | 0 |
| 位置索引 | `https://maritim.bmkg.go.id/marine2026-data/meta/port_province.json` | 200 / 132947 | 03:25:47.670 / 03:25:48.459 | 0 |

日期均2026-10-20。两步各一次系统DNS/物理GET，总HTTP2；全部地址通过原安全规则。既有secure fetch/default transport、系统DNS、每步10秒/512KiB、0重试/跳转跟随/详情/图片/分页/付费；无单港口预报请求。独占step launch及共享同步预算在派发前落盘，不以失败退还额度，不重发不确定结果。未更改DNS/Clash/CA、安全规则或切工具绕过。

第二步由第一份本机真实文档支持：明确基址`https://maritim.bmkg.go.id/marine2026-data/`、GET `/meta/{file}`及文件例子`port_province.json`。仅据这三项组合出获准精确路径；没有请求示例的area_province、pelabuhan.json或任何其他链接。父网页研究成功不替代本机证据；父曾见Internal Error没有本机HTTP记录，本轮也未重复其请求。

## XJ001位置证据

真实JSON结构为`data[] → {province, ports[]}`，这份响应含37个省份分组/659个港口条目，不宣称全国完整。唯一目标记录：

```json
{
  "jsonPath": "$.data[6].ports[0]",
  "province": "DK Jakarta",
  "id": "XJ001",
  "name": "Pelabuhan Tanjung Priok",
  "lat": -6.103879776,
  "lon": 106.882294878
}
```

省名原值为`DK Jakarta`，不改写为其他拼法；经全索引扫描，XJ001或Tanjung Priok名称仅这一目标匹配。该索引并非只有省份，已提供港口id/名/坐标，因此这次位置映射不必追加其他位置索引。父核实的官方主站`https://www.bmkg.go.id/cuaca/maritim/pelabuhan/XJ001`标题为Tanjung Priok，仅列作父证据，本机未请求该页。

## 文档合同与未验证部分

已从本机文档确认：GET `/pelabuhan/{KODE}.json`；UTC预报有效时间、格式YYYY-MM-DD HH:00 UTC；day1逐小时24点，day2–4每3小时。波高/潮位m、风速/阵风与流速knot、能见度km、温度摄氏、相对湿度百分比。GeoJSON坐标为[longitude,latitude]/WGS84，索引自身使用命名lat/lon字段。meta章节说明无需认证头；本轮未提交或保存账号凭据。

由正式模板和真实元数据id可提出候选：`https://maritim.bmkg.go.id/marine2026-data/pelabuhan/XJ001.json`。**未请求该产品，不能称API code最终验证。** 精确预报JSON字段/空值/质量码、数组时间覆盖、发布/更新与有效时间区分、时效、单位归一化、异常值和collector/SQLite持久化/去重/重启均未验证；没有生产/Runtime/连续24h证据。

文档另列`https://maritim.bmkg.go.id/marine2026-data/meta/pelabuhan.json`；本轮未请求，不作为额外必需步骤或已实测接口。下一步应由父审决定是否单独批准一个XJ001预报产品样本，本轮不追加。

## 许可、保留与验证边界

可访问/无需认证不等于获得再发布或全文/模型许可。完整原始文档和索引仅保留本机ignored `.tmp/id-w02-doc-map-20261020/*-response.bin`，不进入Git或分发；许可仍按既有metadata-only/disallowed边界。Git只收请求元数据、hash、合同事实和单一目标位置元数据；不复制文档长段落、其他港口完整索引、脚本或敏感响应头。响应记录只保留status/content-type/空Location等白名单字段，没有Cookie/Authorization/账号数据。

原始SHA256：文档`9e93a3e44829174d6ef9e660b0fbd80e021d0d2a6fae09fce093650c2130e0a3`；索引`299fc83669ca506b42d66ddee3444844ea589b66bff29cc39516e65244e97b1a`。具体ledger、step launch/result及stdout日志保留本地；[结构/映射](mapping-evidence.json)、[第二路径依据](document-proof.json)、[执行摘要](summary.json)。

只有一次临时本地DOM检查命令的PowerShell引用错误，未执行网络；随后使用本地脚本解析同一原件，未重取。产品diff为空，不新增或重跑Vitest/build/install；本轮适用验证为实际安全抓取、JSON/唯一映射/坐标校验、保护hash、文档lint及真实Neat Freak知识收尾。R2仍BLOCKED，25/39、24/34、历史数字3/5不变。
