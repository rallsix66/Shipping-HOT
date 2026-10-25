# ID-W02限定资格落地与VN-P01单详情日期证据（2026-10-20）

本机`D:\try one\Shipping HOT`，`codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414`加既有未提交候选；本轮产品源码/测试没有增量。父独立静态源码审查对BMKG纯parser无P2阻断，限定认可真实归档产品和完整原件离线解析/归一化/字段验证。30项定向、1688通过/3跳过及41点零差异均是执行者前轮证据，父没有重跑。

## 已应用的唯一资格变化

[认可记录](qualification-acceptance.json)与[逐项变更审计](matrix-change-audit.json)：权威machine matrix仅ID-W02从NOT_RUN改为限定OK，其余40项条目、原countingRules、资讯R2-5及该源默认开关不变。R2-4累计**26/39**，目标至少32、还差6；资讯**24/34**、缺10项。数字证据明确分列**历史3项有限归一化诊断＋新增1项ID-W02完整原件离线解析**（分母5），不称4/5生产接入。

限定产品是`https://maritim.bmkg.go.id/marine2026-data/pelabuhan/XJ001.json`，41点、72h、60/180分钟混合步长。原文档/原件/旧proposal/测试日志作为当时证据保留，未重写。没有增加先入库、注册Provider或七日逐小时资格条件，也不宣称DB/生产/实时在线/24h或整体R2通过。原日期、许可、源开关和独立数字分区保持边界。现役[13项可用性非OK＋10项资讯字段剩余矩阵](remaining-matrix.md) / [机器版](remaining-matrix.json)取代前轮剩余快照，旧快照不改。

## VN-P01选择与已有归档核对

[选择依据](vn-p01-selection.json)：读取已保存、SHA256 `da133741708879c9fd4544a0137dd8050a92c1dab662ac843bc9892d412bd4ef`的完整63083字节原HTML，共10行真实材料。选第一行`200/TBHH-CHHĐTVN`的原始相对href，沿原list URL解析，不由文号/标题造路径。该行标题为Quy Nhơn航道/转向水域技术参数通告；精确链接为：

`https://vimawa.gov.vn/vi/noi-dung/thong-bao-hang-hai-thong-so-ky-thuat-cua-luong-tu-phao-bao-hieu-hang-hai-so-0-den-het-vung`

同一已批准`vimawa.gov.vn`、HTTPS、公开HTML详情路线，无URL凭据或新host。原检查明确detailsFetched0；本轮在项目证据及私有capture目录枚举/核对2997个JSON/HTML/bin文件（排除依赖、构建/clone快照、保留DB），仅命中原表元数据，无已请求该精确URL的账本或canonical/og:url同身份详情归档，因此执行获批的一次GET。该范围的“未发现”不扩写为扫描用户浏览历史/所有磁盘的结论。

## 单次请求账本

| 项 | 实际 |
| --- | --- |
| 开始/接收 | 2026-10-20T04:08:23.785Z / 04:08:26.323Z |
| 系统DNS / 物理GET | 1 / 1；既有安全链验证并绑定公网地址 |
| 响应 | HTTP200，`text/html; charset=utf-8`，45326字节 |
| 原字节SHA256 | `53f944fa37ba4a7cf7423b171b81d749511650044656f5777eb88c498be2847e` |
| 限制/退出 | 10秒、512KiB、0重试/0跟随，raw exit0 |
| 其他详情/图片/分页/PDF/付费/DB写入 | 全0 |

使用原`secureFetchArticle/defaultTransport`，无TLS/CA/Host/Origin/CORS/SSRF或网络设置变更，无登录/浏览器控制。原件只保留ignored私有`.tmp/r2-qualification-vnp01-20261020/response.bin`；Git证据仅允许的身份、日期、结构和账本元数据，不含完整HTML、cookies或鉴权头。[日期与请求审计](vn-p01-date-audit.json)保留完整所需字段。

## 日期角色与最小链结论

`h3.page-header`与原行完整标题逐字一致；相对canonical解析后与精确href一致，无密码登录表单。文号来自原表；详情正文未再次显示完整文号，不能据此推日期。详情article仅展示地区与`200.pdf`附件条目，未请求附件。

`.submitted`节点存在但文本为空；无time/datetime、日期属性、日期meta或JSON-LD日期。唯一可见日期是`.region-footer`内公共网站许可证颁发日`29/12/2003`，不属于本通告。发布日、更新时间、时间角色/精度、时区及publication instant均保持unknown/null；抓取时间和文号均未充当来源时间。

**本样本日期无效，不能补全字段链。** 不新增VN parser/config，不传播到其余9条，不提升R2-4/R2-5；VN-P01仍PARTIAL/PARTIAL。若后续另获明确绑定同一材料的自身日期证据，才可设计显式的“原行稳定href→同身份详情日期节点→原值/角色/精度/时区”最小链；只有day证据就保留day，未知时区/instant不补值。这不是自动批准十条详情抓取、PDF抽取或公共页脚兜底，当前样本也没有支持可实施selector。

## 校验与收尾

本轮不重复产品门禁；前轮已认可的产品证据仍归执行者。[真实Neat Freak](closeout.md)核对代码/运行边界/文档/规则/只读记忆/工作区，文档lint、链接、JSON统计与保护校验见[summary](summary.json)。CN-T01等待用户应用反馈，本轮未轮询；无浏览器探测、服务/插件切换、来源启用/入库、24h/R3、commit/push/PR/merge/deploy或清理。
