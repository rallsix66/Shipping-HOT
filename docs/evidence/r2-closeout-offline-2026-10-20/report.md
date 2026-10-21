# R2离线收口第一切片（2026-10-20）

> 历史本地证据说明（2026-10-21 补注）：本目录是 2026-10-20 的离线收口快照，正文保持原样。其中 25/39、24/34 是当时的数字，现行口径以 [mapping.json](../r2-current-source-matrix-2026-10-14/mapping.json) 的 28/39、25/34 为准，均未通过。MY-L01 日期格式代码已随 `3f8971e3` 推送；观察启动器与环境修复已随 `c9af8c55`、`160c67a9` 推送。文中 `.tmp/…`、私有原存档、隔离 DB、clone 与原始 stdout/stderr 路径都是历史本地证据，不随库交付，也没有补造。原文中的本机用户目录已替换为 `<USERPROFILE>`。

本轮停止在主审点：本地修复与验证完成，待父会话审查，未提交/推送/更新PR。执行目录`D:\try one\Shipping HOT`，分支`codex/shipping-hot-r2`，HEAD仍`40629587e22d8932df105962ec214530e4054414`。既有草稿PR8/未合并R1.5叠层保持原样；本轮不作远端查询或写入。原dirty `.gitignore`、观察启动器及Windows环境修复、用户服务/数据库/插件均保留。

## 已完成与资格边界

- [14个可用性非OK、10个资讯字段未PASS逐项矩阵](remaining-matrix.md)，每项包含精确原因、可复用归档/哈希出处、最小修复和网络/用户资料前提；[机器版](remaining-matrix.json)。原资格矩阵字节不变：**25/39，至少32，差7；24/34，差10；历史数字诊断3/5独立。** 这些是累计归档资格，不是当前在线率。
- R2-6在aea56e72已获限定PASS，Readability、材料只读接口不重开。观察启动器及Windows环境修复按本次父交接继承离线限定认可、仍未提交。历史天气回放1/10已停止扩展，不列为本轮R2 blocker。
- [R2-7交互复用与精确余项](interaction-acceptance.md)：继承用户dom-v4实测和既有HTTPS保存读回，不再重复已解决的论坛捕获。检查清单/版本选择/无新内容/错误/键盘与窄屏等实际交互仍单独待验；现有SQLite/HTTP/组件/SSR测试的证据范围分别列明。

## 本轮最小产品修复

MY-L01原`https://www.pos.com.my/service-update`私有合法原存档SHA256为`9e9787d4cf60f454824a0529787b1d345a2814ac45f91a957ff1d8b57c1cb310`，124208字节，未重请求/重分发/提交原文。该页十张卡片的事实时间为`07 Oct 2026 06:30 pm`等完整字符串；此前原解析器十条均`unsupported_format`。

在既有web-list白名单加入显式`english_month_abbr_12h`，仅接受完整Gregorian `dd Mmm YYYY hh:mm am/pm`，严格校验月、日期、1–12小时和分钟，拒绝上下文取日期/隐式语言解析、带时区后缀或配置offset/佛历。保留原始raw、规则依据、localDate和minute精度，timezone missing、offset/publishedAt null，不声称原时间是出版角色。不增表、源配置、活跃来源、依赖或Provider。

原十张标题锚仍无href。本轮完整原页进入原collector→隔离SQLite时继续`failed / web_list_invalid_link`，0材料/0版本，0provider_usage/translation_cache/provider_runtime，关闭后只读重开一致；注入一次存档transport不是真实DNS/HTTP。[十条原时间回放](my-l01-date-replay.json)。因此MY-L01仍PARTIAL/FAIL，资格分子不变。

29个新增格式用例覆盖归档事实时间、AM/PM边界、闰年/非法日期和时钟、完整字符串/大小写/offset/配置拒绝以及无href仍拒绝。未改全局Host/Origin/CORS/SSRF、secureFetchArticle、Readability、Runtime、去重或版本策略。

## 验证

全新本地clone`.tmp/r2-closeout-clean-20261020`，基于相同HEAD叠加12个已审观察文件和本轮3文件；冻结锁文件正常离线安装含生命周期脚本，未忽略scripts、未复制旧node_modules/原生模块。Corepack网络下载禁用，仅当前命令进程PATH补入现有rg。受控输入/root/candidate哈希见[summary](summary.json)，不是干净提交SHA验证。

| 命令/范围 | 原始退出码 | 结果 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile --offline` | 0 | 正常新目录安装 |
| `pnpm build` | 0 | 普通生产构建通过，未启动产物 |
| `pnpm typecheck` | 0 | 通过 |
| `pnpm lint` | 0 | 通过 |
| 相关Vitest | 0 | 3文件/76通过，包含29新增 |
| 全量Vitest | 0 | 143文件/1658通过，3既有Windows migration-copy-guard跳过 |
| 完整私有原页离线collector/SQLite回放 | 0 | 十条时间解析，无href仍失败，0材料/版本，只读重开 |
| 真实Neat Freak inventory脚本 | 0 | 全Markdown机械盘点；详见[收尾](closeout.md) |

收尾补充文档lint曾发现status六处既有重复空行；仅按ESLint合并空行/统一行尾，前后正文归一化比较完全一致，原快照与证明在`.tmp/r2-closeout-20261020/status-format-proof.json`。没有覆盖原用户文字。受影响文档最终lint另行记录于summary的finalAudit。

命令、时间、raw exit、原始stdout/stderr路径与哈希均在summary。原始失败保留：临时Vitest合并配置意外扩大include至根全量，出现2项rg缺PATH和1项既有CLI 5秒超时；该次不是通过门禁，before负例日期结果已写入，但父进程raw exit未留取。改为精确include后本轮原页回放raw0。首次独立构建Windows原生exit3221225477，未确定底层原因；同一副本随后正常构建raw0。新测试7处lint格式由既有ESLint修正，最终lint raw0。首次gate脚本猜错pnpm入口，在安装前失败，已改用现场Corepack入口。没有改旧观察测试超时来消除失败。

## 完整修改清单

产品/测试仅：

- `server/intel/sources/config-keys.ts`：一个显式格式枚举及Gregorian/无offset校验。
- `server/intel/sources/web-list.ts`：严格完整格式解析，复用既有日期/时间验证和unknown规则。
- `server/intel/sources/web-list-english-12h.test.ts`：29项日期/边界回归。

文档：

- `docs/status.md`：当前收口状态、继承认可与本轮验证；保留旧时点原文。
- `docs/architecture.md`：既有parser合同内的格式/unknown边界。
- `docs/evidence/r2-final-reuse-audit-2026-10-15/{report.md,acceptance-and-next-actions.md,pilot-24h-proposal.md}`：更新现役指针，24h继续未授权。
- `docs/handoffs/r2-next-execution-2026-10-15.md`：当前交接指针。
- 本目录新增`report.md`、`remaining-matrix.md`、`remaining-matrix.json`、`interaction-acceptance.md`、`my-l01-date-replay.json`、`summary.json`、`closeout.md`。

一次性工具/全部日志/新隔离DB和clone保留在`.tmp/r2-closeout-20261020*`，不作为产品采集器或第二验收框架；本轮未加入Git暂存区。

## 未执行与下一步

没有新上游DNS/HTTP、正预算观察、24h、R3/模型/付费、浏览器控制、新GUI/S7、现用服务/插件更换、schema/来源/网络改动、commit/push/PR/merge/deploy。受保护7个SQLite、SecretStore、不变用户ignore/锁文件/AGENTS/原存档/原矩阵、现用插件8文件及服务入口共22项hash不变；Secret只作不透明字节hash，未解码，保留DB未开SQL连接。

下一步由主审选择资料补齐和有界来源任务，详见矩阵；单个MY-P02新Feed响应的候选上限为1次物理HTTPS GET/0重试/0重定向/0详情/0付费，当前仅提案。不能把十四项整批盲重试，也不能靠改分母或unknown提高分子。浏览器验收需可用的受支持本地通道及明确隔离验收范围；此前自建CDP拒绝保持有效，不绕过、不接管其他标签。R2整体仍BLOCKED。
