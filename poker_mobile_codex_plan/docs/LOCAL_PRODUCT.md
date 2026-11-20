# 本地复盘产品与接口规格 v1

## 输入、计算与界面

根目录 `index.html` 为桌面入口。自己和对手的底牌、公共牌及自定义范围中的具体手牌均通过点击牌位和牌组选择或替换，点中即生效。弹窗支持移除已有牌和取消；已用牌禁选，不同对手组合可以共享牌。范围权重可单独编辑。经典脚本随包分发。提交给计算核心的牌码采用 23456789TJQKA 与 cdhs，例如 As。

| 请求 | 示例 |
| --- | --- |
| 固定底牌 | `{"mode":"fixed","hero":["As","Ah"],"villain":["Ks","Kh"],"board":[]}` |
| 均匀范围 | `{"mode":"range","hero":["As","Qs"],"board":["Qd","8s","2s","7h","3c"],"range":"uniform"}` |
| 加权范围 | `{"mode":"range","hero":["As","Ks"],"board":["2s","7s","Td"],"range":"weighted","rangeText":"9c 9d 1"}` |

范围文本一行一个具体组合，第三列为可选的 0 至 1 相对权重，默认 1。拒绝重复组合（含倒序）、非法牌和空有效范围。依次过滤阻挡及零权重组合。按组合独立均匀补牌，再以有效权重作加权平均。发牌预算与精确参考样例见 [执行计划](../LOCAL_HTML_PLAN.md)。

完成结果为 `{method,win,tie,loss,equity,rows}`。数值为 0 至 1，相对于自己计算；显示百分数。方法取 `monte_carlo` 或 `showdown`。固定模式 rows 为空数组，范围行含 `cards,weight,current,win,tie,loss,equity`，current 为 1、0、−1。汇总在筛选前计算。数据处理、筛选、储存使用未格式化精度。显示胜、平、负及独立权益，不显示模拟或枚举次数。

## 接线、生命周期和存储

根页面依次载入 `web/equity.js`、`web/runner.js` 和界面脚本。主线程调用 `PokerRunner.start(request,onMessage)`，得到含 `requestId` 和 `cancel()` 的句柄。回调异步发送 `{requestId,type:"progress",percent}`、`{requestId,type:"result",result}`、`{requestId,type:"error",message}` 或 `{requestId,type:"cancelled"}`。每次任务仅有一个终态，运行中只发送进度。取消应实际终止独立 Worker，页面只接受当前任务 ID。输入变化立即作废旧结果。核心工厂 `createPokerEngine()` 提供 `analyze(request,random?,progress?)`；测试可注入伪随机数函数。

历史在本机保存已完成输入、结果和保存时间；同一浏览器、同一文件位置重开后可恢复。拒绝存储或空间不足时显示明确反馈，当前局面仍可用。个人局面不发送到任何服务。Android 使用 APK 内置同版页面，权限和 WebView 导航按离线资源需求配置。

## 发布验收

桌面在干净配置的真实 Chromium 浏览器、断网、file:// 条件下验证翻前概率、各街和权重、筛选、错误、取消、立即改牌隔离、历史保存并重开；抽样概率的三个固定种子及误差按执行计划核对。记录浏览器版本、外部请求、控制台异常和场景耗时。Android 在桌面通过后打包，以模拟器离线安装、运行及持久化作为独立关卡。GTO 另按 [河牌规格](GTO_RIVER_SPEC.md) 和两组等权/非等权基准验收，最终升级同一 APK。
