# R1 验证记录

本轮在 Windows x64 工作区执行。每项对照均调用发布代码；测试把 fixture 的两张具体牌和权重序列化为现有 rangeText 输入，再读取引擎结果。

| 验证 | 实际结果 |
| --- | --- |
| 修改前基线 | `node --test tests/equity.test.cjs tests/strategy.test.cjs`，12/12 通过。 |
| 最终主机回归 | `node --test tests/equity.test.cjs tests/r1.test.cjs tests/strategy.test.cjs`，17/17 通过。保留三种子翻前和翻牌抽样、独立五张牌参考、河牌 990 行及既有策略回归。 |
| 全范围转牌 | 1,035 行共 45,540 个终局。将每行胜平负与逐张补河牌后调用河牌摊牌模块的计数交叉核对，所有行各 44。另有固定对手与独立最佳五张牌参考的对照。 |
| 加权样例 | Kd Kh 权重 0.75 时赢 2、平 0、输 42；Qc Qd 权重 0.25 时赢 42、平 0、输 2。权益 3/11。覆盖单组合、同比缩放、等权全范围、已用牌冲突、零权重、反序重复、空范围、范围扩展。 |
| 当前持平样例 | 当前持平，最终赢 9、平 35、输 0。独赢率 9/44、平局率 35/44、权益 53/88。 |
| 调度竞态 | 无效输入创建 0 个 Worker；人工延迟投递旧任务的完成事件后，新请求仍使用自己的结果。取消与异常不会填充完成缓存。浏览器另外观测真实 Worker 关闭、换牌、重算。 |
| 桌面断网 | [Chrome 157](r1-browser/desktop-test.json) 从源码、[Edge 157](r1-browser/desktop-test-edge.json) 从已校验的最终 APK 解出的资产各通过 13 项。覆盖窄屏、筛选不改汇总、原始计数、编辑后命中缓存、取消无部分概率、范围跨浏览器重启恢复。外部请求和页面异常均为 0。初次冷启动超出 12 秒，导航等待放宽至 90 秒后重跑通过。 |
| Android 编译与签名 | [API 35 / JDK 17 构建记录](android-build-strategy-v3.json)。v3 签名和 4 字节对齐通过。复查 ZIP CRC、包内全部 11 份网页资产与磁盘源码逐字节相等；包内无 fixture 文件。 |
| Android 运行 | [Android 15 离线模拟器，6/6 场景通过](android-r1.json)。先在 v2 保存局面并强停，覆盖安装 v3 后恢复原结果。实测转牌两个样例、命名范围跨强停恢复、改权重命中 2/2、扩展只补 1,033 行、收到进度即取消后冷算命中 0 行。依次发出 Android HOME 和返回 Activity，验证共享 Worker 取消、保留输入、恢复最近完成的局面及重算。安装包指纹相同，运行前后无默认网络，页面异常和外部请求均为 0。 |
| 实体设备与 iOS | ADB 本轮仅发现模拟器。当前工程提供 Android 外壳，未包含 iOS 工程，Windows 环境无 Xcode。 |

### 复现

```powershell
node --test tests/equity.test.cjs tests/r1.test.cjs tests/strategy.test.cjs
node tools/bench_turn.cjs
node tests/desktop.cjs
node tests/android-emulator.cjs --r1 --serial emulator-5574 --avd RiverNotes_R1_API35 --baseline dist/poker-strategy-android-v2.apk --apk dist/poker-strategy-android-v3.apk --adb .work/toolchain/android-sdk/platform-tools/adb.exe
```

桌面验收用 POKER_PLAYWRIGHT 指定本机 Playwright，POKER_BROWSER 指定 Chrome/Edge 可执行文件，POKER_REPORT_DIR 指向独立报告目录。Edge 验收附加设置 POKER_ENTRY 指向 APK 的 assets/index.html 解压路径。Android 命令需使用已开机、断网的专用 AVD，并替换对应序列号和名称。

Android 的 --baseline 用于初装 v2 或专用 AVD 已装 v2 时验证升级。已装 v3 时省略该参数即可重复 R1 界面测试。原项目 AVD 冷启动 12 分钟超时；改用独立 AVD，初次初始化 WebView 又分别触发 Activity Manager 等待超时和 CDP 连接超时。测试改为核查真实前台 Activity、等待指定 WebView 页面和首个 Worker 结果，最终整套通过。

PERFORMANCE.csv 的主机批次为生成器单次推进（通常处理 16 个对手）。浏览器耗时从点击计算到 DOM 完成更新，包括 Worker 启动、通信、列表绘制；最大帧间隔取任务期间的 requestAnimationFrame 间隔并包含首尾。取消时延从收到精确进度后发出取消，到 terminate 调用及取消界面更新返回。单位均为毫秒。

Node 五次独立进程的全范围转牌耗时为 25.4–53.1 ms，中位数 28.1 ms，最大单批 5.7 ms。Android 全范围无缓存单次为 359.8 ms，最大帧间隔 122 ms；点击取消至处理返回 0.9 ms。仅改两个权重虽命中 2/2，含新 Worker 启动的端到端耗时仍为 150 ms。模拟器应用主进程整套场景峰值 RSS 为 242,760 KiB，隔离的 WebView 渲染进程另计。尚无实体手机上的耗时、峰值内存或帧间隔数据。
