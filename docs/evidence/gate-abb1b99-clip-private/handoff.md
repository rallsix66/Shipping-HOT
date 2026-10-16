# 待父审的普通私人剪藏包

产品`abb1b992a7de030025b16ad06ded63211e99ff1b`，新目录：

```text
D:\try one\Shipping HOT\.tmp\clipper-manual-abb1b99\extension-test
```

ZIP`.tmp/Shipping-HOT-Clipper-Synthetic-abb1b99.zip`，SHA256 `ff35fbc33aa98f0446ddb34c46ee5068b484ecfc9f843a7e009b06f351268487`。ID/三项权限/合成标记和精确来源URL不变。旧6087/bdc7包和原数据库完整保留。

**现在不要让用户更新。当前5173仍是bdc7b59；父审通过后必须先切换接收服务，再更新扩展。** 新普通请求没有legacy声明，旧后端不能正确处理。

1. 父审后由本地执行者重新只读检查当前PID/命令、DB UUID及保存计数。如果已有用户数据，不清空。准备的`.tmp/clip-private-update.ps1`只接受当前已核实的10880/40064旧进程，身份不同会拒绝；需要实际调用时检查最新状态，不直接绕过保护。
2. 执行者切换时使用`.tmp/clip-private-serve.cjs`：同一个`.tmp/clipper-manual-6087a16/run/.data/shipping-hot-v3.sqlite3`和旧隔离标记不变，先做一致backup到新artifact，再运行e627新app。没有新空库替换。该脚本目前**未执行**。启动后核对5173/5174、实际HTML/JS、service实际代码SHA/旧isolation SHA、UUID与行数未丢，之后才能通知用户更新。
3. 用户在独立测试Chrome移除旧Shipping HOT合成测试扩展并加载新目录，刷新`http://127.0.0.1:5173/feed`。打开`http://127.0.0.1:5174/synthetic-article.html`，选中测试正文→插件选“选中文字”并提取→编辑预览→送入系统→明确保存。**无需姓名、权利/范围/依据或时间角色表单。** 截图预览和保存重开结果即可。
4. 用户操作后执行者只读运行`node .tmp/clipper-manual-abb1b99/read-saved.cjs`。脚本会确认实际receiver已经是e627，否则停止；只读原库和既有GET许可投影、先校验精确合成URL。检查正文、private_material/rights unknown、来源/时间/版本及usage等零增量，不伪造nonce消息或GUI证据。

本包仅允许已批准的合成页面测试，普通HTTPS实页另验。UI保存的正文属于人工私人资料，权利未知，不授予自动抓取、公开发布、模型使用/训练许可。当前新包GUI、sender/nonce、保存重开均NOT_RUN，主会话复审pending。
