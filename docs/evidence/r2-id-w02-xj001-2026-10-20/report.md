# ID-W02 XJ001单样本合同取证（2026-10-20）

本机`D:\try one\Shipping HOT`、`codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414`。本轮仅一次安全GET、离线合同核对/设计，无产品代码/测试、schema、港口坐标、来源开关、正式合同或资格改动。

前置精确URL搜索只发现三份candidate/mapping元数据，明确forecastRequests0，无产品launch/result；项目Node进程仅原用户服务PID33364。独立新轮launch/同步一次预算防止重复或不确定结果重发。请求`https://maritim.bmkg.go.id/marine2026-data/pelabuhan/XJ001.json`，2026-10-20T03:33:54.513Z开始、03:33:55.108Z收到：HTTP200、application/json、11259字节、raw exit0。系统DNS1、物理GET1，地址均经原规则通过，10秒/512KiB、无重试/跳转/其他港口/索引/详情/图片/付费；未轮询CN-T01配置或请求该源。

原件SHA256 `3af2b483aeb5623312ae86fbef5d63ca31ec6653e10b2ac24bfaa6213da98ba1`；只留ignored `.tmp/id-w02-xj001-20261020/response.bin`，不进入Git或再分发。公开无需认证不代表全文/模型或再发布许可；响应记录只白名单status/content-type/空Location等，不存认证/会话头或账号凭据。Git仅留结构/身份/时间范围/聚合数值事实与hash，没有完整41条预报。

code/name与索引逐字匹配；产品无坐标，不能补成已核对坐标。issued距抓取15.5653h、有效窗72h；41点为24个1h＋17个3h，无null/质量码只是本样本；详情见[合同矩阵](contract-matrix.md)与[聚合审计](contract-audit.json)。不得用fetchedAt代替源issued、补造updated或插值成7日逐小时。

复用层与真正接线阻塞见[最小离线建议](integration-design.md)：既有weather-sync/WeatherProvider/ShippingRepository可作为未来边界，但现存整港替换和无source的row id不能直接并行写BMKG；完整issued/位置/分辨率也无现成正式字段。下一小轮建议纯parser/投影验证，不碰网络/DB/Provider开关，正式持久化策略另审。

本轮只改status及本证据，无产品门禁重跑；实际安全取证与本地JSON/时间/唯一身份/聚合异常检查已完成，doc lint/链接/保护与真实Neat Freak收尾见summary.finalAudit及[closeout](closeout.md)。25/39、24/34、历史数字3/5不改；ID-W02属于数值，不能加入34资讯字段分母。未提交/推送/PR/merge/deploy、操作现用库/服务/插件、开启24h或R3。
