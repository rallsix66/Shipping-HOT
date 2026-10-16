# 限定复审通过：普通私人剪藏续测

产品`abb1b992a7de030025b16ad06ded63211e99ff1b`，新目录：

```text
D:\try one\Shipping HOT\.tmp\clipper-manual-abb1b99\extension-test
```

ZIP`.tmp/Shipping-HOT-Clipper-Synthetic-abb1b99.zip`，SHA256 `ff35fbc33aa98f0446ddb34c46ee5068b484ecfc9f843a7e009b06f351268487`。ID/三项权限/合成标记和精确来源URL不变。旧6087/bdc7包和原数据库完整保留。

**限定复审已通过，接收服务已切换为abb1b99，可由用户加载此准确目录续测。** 新构建HTML/JS/合成文章逐字节匹配，5173/5174均200；未操作Chrome。[切换核验](switch-verification.json)。

1. 本地执行者已核实并仅结束原自有10880/40064测试进程，没有触碰其他进程。新receiver PID33992/source PID40400，只监听127.0.0.1:5173/5174。
2. 已运行`.tmp/clip-private-serve.cjs`中的abb1b99 app，复用同一个`.tmp/clipper-manual-6087a16/run/.data/shipping-hot-v3.sqlite3`及旧隔离标记，原UUID不变，先以SQLite backup保留一致快照。08:16UTC新旧材料/版本/操作/usage等计数均0，来源42，没有清空或换库。脚本已执行，不要重复运行或删除backup来绕过拒绝覆盖保护。
3. 用户在独立测试Chrome移除旧Shipping HOT合成测试扩展并加载新目录，刷新`http://127.0.0.1:5173/feed`。打开`http://127.0.0.1:5174/synthetic-article.html`，选中测试正文→插件选“选中文字”并提取→编辑预览→送入系统→明确保存。**无需姓名、权利/范围/依据或时间角色表单。** 截图预览和保存重开结果即可。
4. 用户操作后执行者只读运行`node .tmp/clipper-manual-abb1b99/read-saved.cjs`。脚本会确认实际receiver已经是abb1b99，否则停止；只读原库和既有GET许可投影、先校验精确合成URL。检查正文、private_material/rights unknown、来源/时间/版本及usage等零增量，不伪造nonce消息或GUI证据。

本包仅允许已批准的合成页面测试，普通HTTPS实页另验。UI保存的正文属于人工私人资料，权利未知，不授予自动抓取、公开发布、模型使用/训练许可。主会话限定复审已通过；实际新包GUI、sender/nonce、用户保存重开仍NOT_RUN，待用户操作。
