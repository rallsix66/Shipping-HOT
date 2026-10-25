# 既有覆盖与实质新增

| 层 | 已有/继承 | 本轮实际新增 | 未声称 |
| --- | --- | --- | --- |
| Domain/native SQLite | manual.test.ts27项：精确许可、幂等、A→B→A、审计/事务回滚、checked-empty分离 | 不重复实现这些规则 | 不等于GUI |
| HTTP/读取 | manual-http.test.ts3项同源、409/503、只读DTO；SSR3项结构/转义/错误态；clip-import已有未知结果重试 | 普通手工页7项真实事件/query回调接现有manual/读取DTO及native SQLite，控制hooks/query cache，无新HTTP服务 | 不是React DOM、焦点、布局或实际Chrome |
| 普通手工页串联 | 原仅SSR | 清单→created→unchanged→revised→旧版与原录入时间→客户端状态重置后读取；切源清body/detail；无新内容无材料且never_run；提交后丢响应同requestId/不重复审计；事务故障重试/编辑换ID；busy禁用；非法日期保留并修正 | 重载断言为真实读取逻辑加组件状态重置，不冒充真实浏览器刷新或OS重启 |
| 发现并修复的产品缺陷 | 保存与invalidateQueries共用catch | 已确认保存后的缓存刷新错误单独提示，保存确认不丢；最初回归用例确实失败，修后通过 | 不改POST/幂等/许可/Provider |
| 既有S7 seed | 原port/feed/article合成夹具 | 5个真实CLI/native测试：manual-only schema29/空业务库/disabled源/翻译off0预算；不接受旧越界flag；manual-only数据不被误判为空；既有manifest保留；原默认夹具保留 | 不运行S7浏览器入口，历史封存S7不重新标记 |

新增7+5=12项；定向总51、全量1789通过＋3既有Windows跳过。无新依赖、schema迁移、harness、浏览器控制或应用服务。新CLI用例20秒deadline只覆盖它们自己的子进程启动，不修改任何旧超时/门槛。
