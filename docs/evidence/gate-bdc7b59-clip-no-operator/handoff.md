# 免填姓名的新包：用户手动续测

产品SHA `bdc7b59d88d440966d8c6aff7fc68229c136dbb1`；新扩展目录：

```text
D:\try one\Shipping HOT\.tmp\clipper-manual-bdc7b59\extension-test
```

ZIP `.tmp/Shipping-HOT-Clipper-Synthetic-bdc7b59.zip`，SHA256 `5cfc96382f5cd620c2a0f7aad790d647d3e102f65810ca9d0ea3a813ca3b8f6d`。旧6087目录及ZIP完整保留，不能只对旧目录点“重新加载”然后认为已升级。

1. 父审同意后，用户在原独立测试Chrome的`chrome://extensions`移除旧的**Shipping HOT剪藏合成测试扩展**，加载上面的新目录。仅操作这个测试扩展。ID仍`jihkanbaffodclncabodmbahbbgkjoad`、权限仍activeTab/scripting/storage，名称仍含“合成测试版”。
2. 刷新`http://127.0.0.1:5173/feed`，丢弃此前未保存的旧内存草稿。打开精确原创来源`http://127.0.0.1:5174/synthetic-article.html`，选中测试正文→点插件→“选中文字”→“重新提取”。
3. **不用填写录入人，两个预览中都没有姓名输入框。** 原时间保持未知；权利依据“本人原创”、范围“全文”、填写仅针对本原创夹具的依据。截图popup及系统预览。
4. “送到 Shipping HOT 预览”→核对来源/未知时间/声明/正文→用户明确“保存人工剪藏资料”→重开记录并截图。审计应显示未识别人工操作（未经身份认证）和自动保存时间，不代表认证身份。

原测试库仍在6087的run目录，UUID和已有数据原样保留；没有新空库替换。07:24UTC只读仍0材料/版本/动作，来源配置42。当前receiver PID10880/source40064、仅loopback5173/5174、GET200，服务为用户保留。使用前复核；若退出，本轮更新运行器`node .tmp/clip-no-operator-serve.cjs`包含拒绝覆盖已存在快照的保护，**不要直接重复运行/删快照来绕过**，由本地执行者检查存活和现场后恢复。

实际保存后，主会话可请本地执行者只读运行：

```powershell
node .tmp/clipper-manual-bdc7b59/read-saved.cjs
```

该脚本读取原DB文件、复核UUID/schema/real和原隔离标记，只读现有intel GET许可投影与计数；先核对精确合成URL，不读取其他网页、不POST/模型/浏览器控制。输出新目录`manual-readback-<时间>.json`。以实际读数判定保存，不能用程序化测试替代真实nonce/GUI。本SHA真实GUI、普通HTTPS、GUI/S7、24h仍NOT_RUN；旧包与全部现场保留。
