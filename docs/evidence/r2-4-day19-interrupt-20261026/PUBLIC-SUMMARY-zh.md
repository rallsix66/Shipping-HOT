# day19 观测中断 — 只读诊断摘要（dots ts 1792977829.388019）

检查时刻：2026-10-26 09:34:03 Asia/Shanghai
原路径：`D:/try one/Shipping HOT/.tmp/worktrees/r2-compat/.tmp/r2-intel-observe-day19-20261025a`
诊断产物：`D:/try one/Shipping HOT/.tmp/worktrees/r2-4-gapfill-20261025/.tmp/r2-4-day19-interrupt-20261026/`（gitignore，未提交）
隔离确认：gapfill HEAD `37eab90b` / branch `codex/shipping-hot-r2-4-gapfill-20261025`；未动 main/r2-compat；未重启观测；未删 lock；未开 DB；零新 HTTP/TLS；未发 Slack / 未联系 Guyang。

## 结论要点
- **最后成功事件（已证实）**：2026-10-25 15:45:29 Asia/Shanghai（`2026-10-25T07:45:29.905Z`）seq=799 `job_result` success read=0 write=0
- **进程退出时刻**：**未知**（无 exit_code footer / 无 `finished` 事件）
- **退出原因**：**未知**（不宣称“自然异常停止 / 休眠杀掉 / 人工杀掉”）
- **旧轮次状态**：incomplete；不可拼进连续 24h；不可宣称 24h 通过；窗口终点仍为 **2026-10-26 11:57:37 Asia/Shanghai**
- 计数冻结：R2-4 30/39，R2-5 25/34

## 启动与托管（已证实）
- Cursor agent terminal `605466`，cwd = r2-compat
- 命令：`pnpm observe:intel --execute --profile 24h-19 --run-id day19-20261025a --sources <19 ids> --duration-ms 86400000 --max-http-requests 2000 --approved-redirect jdih…`
- Shell PID 78372 → parent node 75280 → worker node **29736**（与 lock.pid 一致）；三者现在均不存在
- stdio inherit 到该 terminal；无独立 stdout/stderr 文件
- terminal 元数据仍写 `status: running` 且 **无 exit_code footer**（陈旧）；LastWrite 2026-10-25 15:49:12 Asia/Shanghai

## Lock
- 仍在：`…sqlite3.intel-owner.lock` = `{token, database, pid:29736}`
- PID 不存活；**未释放**；本轮未删除

## 日志摘要（events.jsonl，799 条，无 finished）
- HTTP：reserved/started 83，completed 79，failed 4（PH-C01×3 timeout，CN-P01×1 timeout），approved redirect 4
- job_result 15：success 13 / failed 2（`intel_all_sources_failed`）
- 累计 recordsRead/itemsSeen **1465**，recordsWritten/itemsNew **390**
- 缺：`finished` / `shutdown_incomplete` / exit code / lock release

## 机器本地记录
- LastBoot：2026-09-20 10:48:46 Asia/Shanghai → 观测窗口内**无重启**
- 休眠/注销：**未证实**（查询窗口无命中；powercfg lastwake 空）

## 最小恢复建议（稍后另开范围，本轮不重跑）
1. 旧 run 保持 incomplete；勿 splice 连续 24h
2. 勿按 age/PID 删残 lock
3. `resumeSupported=false` → 若再跑须新 `--run-id` + 单独批准
4. 建议附带 exit-code 落盘 / 更稳托管；新目录隔离 DB

## DB
- 未打开（防 WAL/SHM/recovery）。旁路：无 -wal/-shm；DB mtime 2026-10-25 16:00:29 Asia/Shanghai（仅 mtime，非退出证据）
