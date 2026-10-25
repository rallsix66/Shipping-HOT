# 初次ONE离线回放：断言修复前记录

原始[command.json](command.json)退出1。10条真实元数据首次入库、重复0新0修订后，脚本错误地要求包含lastSeenAt的item整行不变；正常第二次采集应推进该字段。失败原件、过程与隔离库保留，不标PASS，也不是来源/产品解析失败。

只修离线脚本：lastSeenAt单独核对新时钟，其他item字段和完整versions保持，未改产品或再请求上游。最终通过记录见[最终回放](../r2-one-newsroom-replay-final-2026-10-15/summary.json)，完整背景见[本轮报告](../r2-one-newsroom-target-2026-10-15/report.md)。
