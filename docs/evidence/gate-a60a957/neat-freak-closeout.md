# Neat Freak 收尾记录（R2 第二轮 P2 返修，代码 SHA a60a957a2a281066bca61f565f12db99095965bd）

所有日志由 `docs/evidence/run-gates.cjs` 生成（Node spawnSync，UTF-8 写入）。每个 .log 的头部记录命令、完整 SHA、开始时间，正文是 stdout/stderr，末行是 `raw_exit_code`。汇总见 summary.txt。

## 上一轮（gate-a0c547e）日志"为空"的原因
- 当时在 Windows PowerShell 5.1 里用 `>` 重定向。PS 5.1 的 `>` 等同于 `Out-File`，默认编码 UTF-16LE（BOM ff fe）。git 把这类文件判定为二进制，GitHub/diff 中显示为空或二进制，所以无法核验。
  - neat-freak-inventory.log：实际 19788 字节、UTF-16LE。
  - scan-network-llm.log：实际 1590 字节、UTF-16LE。
- scan-secrets.log 是真正的 0 字节：rg 无匹配时没有输出，exit 1。
- 当时的 exit code 只出现在终端输出和 summary.txt 里，没有写进日志本身。这是证据缺陷，本轮已修正。
- 上一轮执行 inventory 时还出现过两次失败：一次是 PowerShell 解析错误，脚本没有运行；一次是 PATH 中没有 `bash`。之后改用 Git Bash 重跑，exit 0。
- 旧文件保持原样，不改写历史证据。

## 本轮检查
- 盘点：`"C:\Program Files\Git\bin\bash.exe" scripts/audit-inventory.sh .`，raw_exit_code 0，187 行。它只是文件盘点，不是安全审计。
- 代码 vs 文档：status.md 新增第二轮返修行；计划 §9 已同步。registry/GET 仍标为未完成。
- 网络/LLM 扫描：raw_exit_code 0。只命中 sources.ts 的两个种子 URL 和 collect.test.ts 的 fixture 字符串，没有 fetch( 或 LLM 调用。job 默认关闭，测试都离线注入 transport。
- 密钥扫描（本轮改动范围）：raw_exit_code 1，即无匹配。这不代表历史已清理、GitHub 告警已关闭或整个仓库安全。
- git status：门禁前工作区干净（worktree_clean_before_gates=true）。
- 仓库外中转文件按 dots 要求保留，未删除：C:\Users\Administrator\t23.tgz、d23.js；本轮新增 p24.js、p24t.js、d24.js、run-gates.cjs（仓库内另有一份副本）。
- 未执行：浏览器 / S7 / 天气重跑（没有 UI 或路由改动）；24h 实跑、P1 实跑、付费调用（受约束）。
