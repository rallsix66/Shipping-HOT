# 截图新增证据后的Clash最小只读诊断（2026-10-20）

本检查在Maersk一次真实GET与离线字段核查完成后追加，未重发Maersk，也未发PPA/MOFCOM请求。父已亲自读用户截图：选中脚本有两个域名、保存按钮灰色；UI说明应用设置会最终回写。截图是诊断依据，不是修改/重载或网络授权。

## 本机当前事实

- 已安装Clash Verge **2.5.8**，卸载注册信息与安装目录`clash-verge.exe`的ProductVersion/FileVersion一致。
- 当前订阅仍关联`profiles/shf0fNvLCn9b.js`，选中merge为`mBhQBurZWbst.yaml`；原27域名保留，脚本中PPA与MOFCOM各1。
- 脚本mtime **2026-10-20T07:32:12.938Z**；磁盘生成文件`C:\Users\Administrator\AppData\Roaming\io.github.clash-verge-rev.clash-verge-rev\clash-verge.yaml`为58415字节，mtime **2026-10-20T07:32:13.019Z**。
- 新生成DNS列表**29项**，PPA与MOFCOM各1、原27项完整。07:06缺项快照已被这份较新文件取代，不能继续当作现在仍缺项，也不据此归咎用户先前没操作。

## 接管/覆写与脚本条件

必要配置键和值见[脱敏字段快照](clash-dns-readonly.json)：

| 位置/键 | 当前值 |
| --- | --- |
| `verge.yaml:enable_dns_settings` | false |
| `verge.yaml:enable_builtin_enhanced` | true |
| `dns_config.yaml:dns.enable` | true |
| `dns_config.yaml:dns.enhanced-mode` | fake-ip |
| `dns_config.yaml:dns.fake-ip-filter-mode` | blacklist |
| `dns_config.yaml:dns.fake-ip-filter` | 10项，不含两目标或原27项 |
| 生成DNS `enable/enhanced-mode/ipv6/use-hosts` | true / fake-ip / true / true |
| 生成DNS `fake-ip-filter-mode` | 未显式设置 |
| 生成DNS `fake-ip-filter` | 29项，两目标各1、原27完整 |

独立DNS设置文件与生成DNS整个子树不相同、filter数组也不相同；当前`enable_dns_settings=false`。所以本机事实**不支持当前由独立应用DNS覆写把两域名覆盖掉**，不能只凭UI通用提示断言该原因。

脚本仅在输入DNS为fake-ip、filter-mode为blacklist（缺值按脚本自身默认blacklist）时追加。选中订阅原文DNS为fake-ip，filter-mode缺省；选中merge及全局Merge没有DNS字段。当前输出已含完整29项，也不支持“当前条件未命中导致缺项”。这不是对所有历史执行阶段的回溯证明。

## 生成文件与运行态边界

应用数据目录顶层只有这五个YAML：`clash-verge.yaml`、`config.yaml`、`dns_config.yaml`、`profiles.yaml`、`verge.yaml`，未发现其他顶层生成候选。后四个属于设置/关联输入，选中订阅原文和merge也不能直接当运行最终配置。

**受阻项：** `Get-CimInstance Win32_Process`按Clash/Mihomo进程过滤读取exe元数据及仅`-f/-d`配置路径的操作被系统拒绝访问；未取得运行核心参数，未重试或换方法读取进程命令行。独立的注册表/安装文件版本读取成功。故运行核心实际加载哪个文件、是否已加载07:32这份内容仍pending，不能完全排除运行文件路径/内存版本差异。

## 最小后续建议

当前生成层缺项已经消失，**没有证据需要再改DNS接管设置、列表、模式或脚本**。最小下一步是通过获准的应用内“运行配置/核心配置路径”只读凭证，或另有合法权限的核心路径核验，确认运行态与上述磁盘文件一致。之后是否进行有界DNS/网站验证由父会话按最新授权决定，本轮不做。

不关闭DNS覆写、不改TUN/路由/代理/CA、不清缓存、不重载。若未来证实核心加载别处或旧内容，再针对该确切位置提出修正与影响，不能现在猜测修改。只读文件快照不包含订阅URL、代理节点、密钥或完整进程命令行。
