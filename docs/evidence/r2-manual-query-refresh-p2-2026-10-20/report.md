# 人工录入刷新错误传播 P2 修复（2026-10-20）

独立审查指出的问题成立：本机安装的 React Query 5.90.21 / query-core 5.90.20 默认在 refetchQueries 中 catch(noop)。前一轮仅 mockRejectedValue 的测试不能证明页面上的刷新失败提示可达。此证据修正前一轮对此提示的验证口径；不修改或追认此前 S7 整体证据。

本次产品增量仅给保存确认后的三次 invalidateQueries 增加第二参数 { throwOnError: true }，把提示改为“读取刷新失败”，涵盖清单、列表和详情。POST 确认后继续保留成功提示、清空 pending request ID；真正 POST 未知或失败仍保留输入和原 request ID，finally 总会释放 busy。没有改写存储、许可、版本、API、Runtime 或来源资格。

测试使用安装版真实 QueryClient、真实活跃 QueryObserver 和页面实际 queryFn；hooks/视图仍由既有控制器驱动，myFetch 仅转交本地真实 manual/读取 DTO/native SQLite，不建立 HTTP 服务。用一项契约测试证明默认吞错、开启 throwOnError 后拒绝；三项分别让清单/列表/详情实际 GET queryFn 拒绝并断言真实 cache error、保存确认、刷新提示、pending 清空、busy/button恢复和已入库两版本/两审计；两项证明事务失败与已提交丢响应后的相同 ID 重试，各仅一版本/一审计。不是仅检查函数参数或 mockRejectedValue。

未修复产品先跑定向：48 通过、恰好上述三个提示回归失败；修后同组51全部通过。新隔离 clone 正常 frozen offline 安装含脚本，build/typecheck/lint及全量 Vitest 均退出0：1794通过、3个既有Windows跳过、147文件。全量只运行一次；RED日志保留。lint只有原有header测试JSDoc警告，build已有chunk/Browserslist提示不改。

[本轮两文件完整差异](product.diff)相对本轮开始的脏工作区快照；[文件与差异SHA](product-files.json)、[安装版源码契约](query-contract.json)、[RED/GREEN和全门禁](gate-evidence.json)、[Neat Freak收尾](closeout.md)、[保留核对](summary.json)。位置 D:\try one\Shipping HOT，codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414；全部旧改动保留。

本轮没有启动应用验收服务、Chrome或扩展，没有实网源请求、保留DB查询/写入、Secret管理（仅进行不输出内容的文件哈希核对）、网络配置、24h/R3、提交/推送/合并/部署或清理。既有准备环境DB与manifest只核对不打开；GUI、实际布局/键盘/刷新和S7整体仍由主会话继续审查，不因P2测试绿色写成通过。
