# 9377cc3首轮门禁FAIL（6087a16重验取代）

实现SHA `9377cc352b3b99269dd07cd7458278437e6954cd`干净检出的定向172通过/1失败：新共享纯叶节点未加入只读依赖闭包严格清单。6087a16补清单并直接检查该叶节点无import/require/process/globalThis/fetch/XMLHttpRequest，没有放宽阈值，随后新检出全门禁通过。

本目录原命令和失败日志保留，不声称9377门禁通过。最终同SHA HTTP重试和Windows监督清理限制见[6087报告](../gate-6087a16-clip-synthetic/report.md)。未删除原临时现场。
