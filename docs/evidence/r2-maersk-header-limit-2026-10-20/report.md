# Maersk精确URL响应头预算离线切片（2026-10-20，待父审）

本机`D:\try one\Shipping HOT`，`codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414`加既有未提交候选。实现仅现有安全fetch中的显式request-scoped预算能力及测试，不配置来源、不调用真实网站、不改全局Node参数/环境变量/CA/宽松parser、schema、Settings或Runtime。

## 已实现合同

`SourceHeaderLimitConfig`仅接受`sourceId=intel:xx-k01`、`url=https://www.maersk.com/news`、`maxHeaderSize=32768`三个字段且值全部精确匹配。缺省不传配置，Node原默认保持；没有Settings/seed/自动开启项。非法类型/0/非整数/其他数值/多余字段、来源或初始URL不匹配均在DNS前拒绝。固定32KiB是唯一已批准opt-in，不是可任意调大的通用参数。

输入配置在await前快照；每个跳转目标重新核对来源和精确URL，变为其他URL时在其DNS前拒绝，不转交更大上限。未opt-in的原跳转语义不变；显式0跳预算仍先返回原redirect_limit、不跟随。若policy来源在DNS期间改变，transport前仍拒绝。底层transport另校验非默认数值只能32768，然后将该选项传给Node请求；未配置时不传该property，保持Node原默认。

DNS全地址审查/连接pinning、TLS `rejectUnauthorized:true`、原CA机制、GET/outgoing headers、超时/取消、正文累计上限、Content-Type及协议/跳转检查保持。该预算只影响客户端接收响应头总字节限制，不关闭限制、不调整全局或放宽其他来源。

## 真实Node parser合成回归

新测试使用127.0.0.1随机端口的合成HTTP服务器；仅测试adapter将注入的source transport连接到该fixture，执行真实生产`defaultTransport`和Node响应头parser。source lookup为注入的固定公网元数据，socket只连接loopback；不发外部DNS/网站请求。不将该HTTP fixture宣称为真实TLS/马士基网页验证，TLS参数由既有Node边界mock回归另核对。

| 合成条件 | 实际首轮结果 |
| --- | --- |
| Node默认16384字节，20KiB合成header | HPE_HEADER_OVERFLOW，失败 |
| 精确opt-in32768，同一个20KiB合成header | 成功返回合成HTML |
| 精确opt-in32768，40KiB合成header | HPE_HEADER_OVERFLOW，继续失败 |
| 另一来源，无opt-in，20KiB合成header | 原默认仍失败 |
| 20KiB header＋524289字节body，body上限524288 | body_too_large |
| fixture不响应，测试缩短timeout100ms | fetch_timeout |
| fixture收到请求后主动abort | 原生ABORT_ERR，结果失败 |

新文件另覆盖配置/URL/source隔离、快照、跨URL跳转预DNS拒绝、原0跳预算、混合公网/私网DNS、Content-Type及预取消。首轮相关四文件91项通过（其中新文件38项）；随后补充了同一opt-in的Node请求TLS/pinning/取消参数回归。最终隔离门禁及测试计数以summary与原始日志为准，不将首轮91写成最终计数。错误只断言code，不序列化header/rawPacket。

本轮原生parser测试只证明有界机制：真实Maersk头大小、实际HTTP状态、反爬/CA或32KiB能否容纳真实响应仍未知；真实MaerskGET待本轮代码审查后另行执行，当前NOT_RUN。

## 用户应用反馈检查与网络停止点

用户报告已保存应用后，本轮在代码修改前只读核对当前关联扩展：29项及顺序完整，PPA/MOFCOM/BMKG各1次；磁盘生成配置PPA0/MOFCOM0/BMKG1、enhanced-mode=fake-ip、filter-mode未显式设置。运行内核未访问；不把生成差异归因用户未操作，也不声称生效。见[必要字段](configuration-apply-check.json)。

按前置条件停止所有三个post-apply URL网络验证，DNS/HTTP均0；未再次轮询或自行应用/重载/清缓存/改网络。该阻塞不妨碍本轮Maersk离线实现。公共26/39、资讯24/34及数字历史3项有限诊断＋新增1项完整原件离线解析保持，不提升来源资格。

## 门禁、边界与交付

全新本地clone按当前22份源码overlay执行正常frozen offline install（含scripts，无旧node_modules/native复制），build/typecheck/lint/相关定向/全量Vitest。Provider环境只在门禁子进程剥离，宿主设置不改；具体退出码、计数、源码hash、保留项与警告见[summary](summary.json)。原首轮lint仅一条JSDoc格式warning已修正，日志保留；无降低规则或静默丢弃失败记录。

真实[Neat Freak](closeout.md)完成后交父独立静态审查。涉及的生产改动仅article-fetch-security，另有新增测试与既有transport测试一项增量。无路由/shell/UI变化，S7本轮不重跑；既有GUI/S7和24h未验收边界不变。没有来源激活、真实请求、库/Secret/服务/插件操作、24h/R3、commit/push/PR/merge/deploy或清理。
