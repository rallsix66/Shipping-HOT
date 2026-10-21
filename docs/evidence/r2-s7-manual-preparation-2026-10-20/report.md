# R2-7离线准备完成，真实GUI仍待（2026-10-20）

本地D:\try one\Shipping HOT，codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414；所有旧修改保留。父要求先交付进展时已给出覆盖/缺口、代码改动、51定向与五步人工清单，不等长收尾。

本轮五文件增量：既有S7 seed增加--manual-only，只在新的.tmp目录创建schema29/空材料/无Provider活动的合成验收数据和manifest；目标Feed源disabled、Translation关闭预算0；既有S7 schema常量27→29/必需intel表同步，移除越界/覆盖逃生flag并识别R2材料/审计为业务数据。没有第二个harness。普通手工页补7个真实回调→manual/读取DTO→native SQLite用例；seed补5个真实CLI用例。它们不是DOM点击/焦点/布局或GUI通过。

唯一产品修复是保存已经确认但列表invalidateQueries失败被误报“保存未确认”：现在保留成功并提示刷新失败；真正POST未知仍保留输入、沿同requestId重试。最初定向回归确实失败，修后验证通过。许可/源策略/存储/版本/API/Runtime未改。

正常全新clone冻结离线安装含scripts、build/typecheck/lint/full Vitest最终raw exit0；定向51、全量1789通过＋3既有Windows跳过（147文件）。首次CLI直接导入触发Vite/unimport转换冲突，改在既有Vitest中启动原seed CLI并于测试子进程拒绝网络，没有换框架/关闭插件；三轮新增类型边界与格式失败均修正，日志保留。产品TSX自成功build后未再改，后续仅修测试类型/seed显式配置。既有HTTP/loopback单元夹具按全量测试运行，未启动Nitro应用验收服务或Chrome。

专用环境已准备：cwd为D:\try one\Shipping HOT\.tmp\s7-manual-clean-20261020\.tmp\s7-r2-manual-ready-20261020，build入口D:\try one\Shipping HOT\.tmp\s7-manual-clean-20261020\dist\output\server\index.mjs；schema29、业务/审计/usage/runtime/cache计数均0，3个目标源enabled0、Secret文件不存在。[具体路径/manifest/DB hash](prepared-environment.json)。**未启动服务**，4489仅计划且未探测；启动方法、端口/cwd/凭据隔离方案与五步预期/最少返回证据在[中文人工清单](manual-checklist.md)。不切换当前5173服务，不重装扩展或改变固定origin，不重测forum clip。

[完整本轮增量](product.diff) / [五文件SHA](product-files.json) / [覆盖差异](coverage.md) / [原始门禁指针](gate-evidence.json) / [Neat Freak](closeout.md)。R2-7真实GUI/S7、360/1280/键盘仍NOT_RUN；此前自建CDP拒绝仍有效。当前来源资格28/39、25/34不变，R2整体未过；无实网、生产DB/Secret/网络变更、服务切换、试跑/24h/R3、提交推送部署或清理。
