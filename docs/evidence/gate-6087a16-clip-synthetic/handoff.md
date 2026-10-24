# 6087a16人工合成首条保存交接

父审同意后，由用户在已批准的独立Chrome测试配置中操作。ChatGPT不操作扩展、页面、CDP或浏览器；不需要ChatGPT控制扩展。只用本原创夹具。

## 当前包与服务

- 加载目录：`D:\try one\Shipping HOT\.tmp\clipper-manual-6087a16\extension-test`。
- ZIP：`D:\try one\Shipping HOT\.tmp\Shipping-HOT-Clipper-Synthetic-6087a16.zip`；SHA256 `6cf98f33451b8c0d82f20a62855df809378f7502f801d8bc046d8520def2e86b`。
- 产品SHA `6087a169cb2e591e3acb10d23ccc641d8212f5c0`；名称`Shipping HOT 剪藏【合成测试版】`、ID `jihkanbaffodclncabodmbahbbgkjoad`、activeTab/scripting/storage。
- 来源`http://127.0.0.1:5174/synthetic-article.html`，接收`http://127.0.0.1:5173/feed`；06:51UTC均200有标记，来源PID25368、接收PID58772，仅127.0.0.1监听。
- cwd `D:\try one\Shipping HOT\.tmp\clipper-manual-6087a16\run`，新DB UUID `f79f2bd2-050f-42b0-831e-6e787eb1344f`、schema29/real。材料/版本/人工操作/usage/runtime/cache/fetch/executor0，仅初始化来源42，无凭据、Runtime/intel关闭。[零基线](manual-zero-baseline.json)。

PID/健康是时间点证据，操作前复核。若退出，确认端口无无关监听后在仓库根运行`pnpm serve:clip-synthetic -- .tmp/clipper-manual-6087a16`；不得停止无关进程、删库或绕过防护。

## 最短首条路径

1. 用户打开`chrome://extensions`，开发者模式→加载已解压的扩展程序→上面的**extension-test**。核对合成名称、ID与权限，截图扩展详情。
2. 打开精确来源URL，点“选中整段测试正文（随后点击剪藏插件）”，再点插件。选“选中文字”并“重新提取”。
3. 录入人填`合成测试录入人`；权利依据“本人原创”、范围“全文”；依据说明`本轮专门创作的原创合成验收资料，仅此URL和本次人工保存，不涉及真实来源`。保留原时间文本、时间角色“未知”。检查段落/列表/表格/PRE，截图popup尤其URL、许可、时间。这只是对原创夹具的声明，未经独立核验。
4. 点“送到 Shipping HOT 预览”，系统中核对合成标记、真实URL、未知原时间、声明及正文并截图。然后由用户明确点**“保存人工剪藏资料”**。
5. 成功后重开记录，截图来源/时间/正文/版本。父审用下方只读结果核实；首次一次成功保存预期1材料/1版本/1人工动作，以实际读数为准。

仅元数据、article提取、取消/返回/刷新、过期/已消费、重复/修订及失败提示后续分别观察；108程序化检查不能替代。selection保留PRE原空白；article经过Defuddle既有代码块整理，不承诺原始页全部空白保真。普通HTTPS另验。

## 只读核实

从仓库根执行：

```powershell
node .tmp/clipper-manual-6087a16/read-saved.cjs
```

脚本只读指定DB并检查UUID/schema/mode，读取现有intel GET list/detail/version许可投影；不POST、不运行Provider/模型、不操作浏览器。先核对list的sourceId与精确canonicalUrl，再读正文，若越出本合成URL立即停止。输出`.tmp/clipper-manual-6087a16/manual-readback-<时间>.json`；[脚本归档](readonly-inspector.cjs.txt)。对比零基线usage/runtime/cache/fetch/executor仍0，核实真实URL/未知时间/许可/正文/版本。不模拟用户点击消息。

本包真实Chrome加载和保存尚未发生，离线PASS、浏览器NOT_RUN、父审pending。R2/普通HTTPS/GUI/S7/24h不因此通过。现场保留。
