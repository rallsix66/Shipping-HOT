# R2 全量 vitest CLI 超时收尾证据（2026-10-22）

基线 HEAD 045ad97a（分支 codex/shipping-hot-r2）。原始日志保留在本机 D:\diag-logs\（未入库）。

## 过程（如实记录）
1. 默认配置标准全量 `pnpm exec vitest run -c vitest.config.ts` 两次均失败：1813 passed / 1 failed / 3 skipped，失败项为 scripts/r2-intel-observe.test.ts 的 help/missing execute 合并用例 5000ms 超时；单文件 34/34 通过。
2. 将该用例拆为 help 与 missing execute 两个用例（每个子进程 timeout 5000 并检查 error）后，标准全量仍失败：help 5185ms，ETIMEDOUT/SIGTERM。日志 split-full1-20261022-152638.log。
3. 对照：命令行加 `--maxWorkers=8` 全量通过（full-maxw8-20261022-153244.log），但具体瓶颈（CPU/进程启动/IO 争用）尚未证实。
4. vitest.config.ts 设 `maxWorkers: "50%"` 后，标准全量连续两次通过：1815/0/3，19.69s / 19.61s（full-std-maxworkers50-run1/run2）。另有一次误加 json reporter 的运行（full-maxworkers50-run1-20261022-153813）不计入。
5. lint 报测试文件脱敏正则应使用 i 标志；改为等价写法 `/[a-z]:[\\/][^\s"']*/gi` 后最终复核（*-20261022-154809.log）：
   - lint exit 0（25.91s）；typecheck exit 0（3.97s）
   - 单文件 exit 0：35 passed，help 491ms，missing execute 465ms
   - 标准全量 exit 0：149 文件，1815 passed / 0 failed / 3 skipped，Duration 22.61s；help 915ms，missing execute 945ms

## 限制与说明
- 5 秒预算现按每个场景单独计算，两个场景合计预算比原合并用例变大。
- 高并发下 CLI 子进程变慢的根因未修复，只通过限制 worker 留出余量。
- redact 脱敏函数仅作日志辅助，不声称能完整处理所有路径格式。
- 视觉验证限制（时间线防溢出 3d42100/045ad97）：仅证明静态测试页使用了同一条 CSS 规则，真实页面与 1280 宽度未测。
