# 交付与实测状态

| 交付项 | 当前阶段 | 依据 |
| --- | --- | --- |
| H0 产品与计算接口 | 已冻结 | [本地产品规格](../poker_mobile_codex_plan/docs/LOCAL_PRODUCT.md) |
| H1–H4 桌面权益版 | 已通过，已打包 | [桌面 ZIP](../dist/poker-equity-desktop-v1.zip)、[数学测试](desktop-test-core.txt)、[Chrome 验收](desktop-test.json)、[截图](desktop-test-desktop.png) |
| Android 权益 APK | Android 15 断网冷启动、计算、保存后立即强停与恢复通过 | [权益版 APK](../dist/poker-equity-android-v1.apk) · [构建记录](android-build.json) |
| 河牌 GTO 内核 | Kuhn 理论值及两个受限河牌基准通过独立最佳响应检验 | [主机数值和耗时](river-validation.json) · [独立测试](../tests/strategy.test.cjs) |
| Android 策略升级版 | 覆盖安装、旧历史恢复、990 组合持久化、策略求解与暂停续算均在模拟器通过 | [策略版 APK](../dist/poker-strategy-android-v2.apk) · [设备验收](android-test.json) |

## 桌面验证与复现

- `node --test tests/equity.test.cjs`，6 组均通过。独立五张牌参考函数、固定种子 1/42/2026、翻牌/转牌全范围、逐行与加权和均已核对。
- `node tests/desktop.cjs`，需要本机 Chrome 与 Playwright。可用 `POKER_PLAYWRIGHT` 指定已安装的 Playwright 路径，`POKER_BROWSER` 指定浏览器。Chrome 157.0.8103.79 在断网和 file:// 条件下通过计算、筛选、取消、改牌、浏览器重启后恢复、窄屏及存储拒绝。记录中外部请求、页面异常及本地资源失败均为 0。
- `python tools/package_desktop.py` 生成可解压的 ZIP，并逐文件核对内容。点选版 SHA-256 为 `141fe004a3c0a4be4498481c64694852c4fdcf143ae41f52685d7b15af0ba741`。点击已有牌位和目标牌即可替换，点击空牌位可添加，自定义范围组合也使用同一副牌选择器。
- Chrome 157 从工作区入口、Edge 157 从解压后的交付包分别完成全套断网验收。已逐槽验证替换、关闭时保留原牌、禁选重复牌、重新计算与历史恢复。[Edge 记录](desktop-test-edge.json) · [鼠标选牌截图](desktop-test-picker.png)

## Android 环境

构建使用项目内的 Amazon Corretto JDK 17、Android SDK Platform 35 和 Build Tools 35.0.0。两版均未申请网络权限，权益页与策略页使用同一应用本地源站。两个 APK 的编译、签名、版本、资产指纹和工具来源见[工具链记录](android-build-toolchain.json)、[策略版构建记录](android-build-strategy.json)与[复现步骤](../poker_mobile_codex_plan/docs/ANDROID_DELIVERY.md)。

在桌面 Chrome 157 上直接读取 v2 APK 内的网页文件，以同一本地 HTTPS 源站和原生外壳中的 Content Security Policy 回放，完成了权益计算与保存、两个策略基准求解、返回首页读取历史。运行中外部请求和页面错误均为 0。360 像素宽度的触控选牌和暂停续算也已通过。[浏览器验收](android-build-strategy-ui.log) · [窄屏截图](android-build-strategy-narrow.png)

2026-11-20 启用 Windows Hypervisor Platform 并重启后，SDK 加速检查返回 `0`。Windows PowerShell 5.1 已成功启动 Android 15（API 35，x86_64）。脚本等待设备网络服务就绪，开启飞行模式并关闭 Wi-Fi。v1、v2 均在断网状态下完成安装和冷启动，包内 SHA-256 与安装制品相符。[启动步骤](../poker_mobile_codex_plan/docs/ANDROID_DELIVERY.md#复现断网升级验收) · [主机与开机记录](android-test-host.json) · [v2 首页实测截图](android-emulator-v2.png)

旧版 v1、v2 都出现过提示保存成功后立即强停丢失最新记录。修复版按条写入应用私有 SQLite 数据库，提交成功后才显示保存提示，历史列表同时读取原 WebView 中的旧记录。[旧 v1 失败记录](android-test-legacy-v1-immediate.json) · [旧 v2 复现记录](android-test-legacy-v2.json)

修复后的两个 APK 在同一个断网 Android 15 模拟器上通过 17 项验收。v1 固定手牌与 v2 河牌全范围在保存提示后立即执行强停，再次冷启动时均恢复了原输入与四项概率。全范围的 990 行结果跨页逐格核对一致。旧 v2 直接覆盖到修复版 v2 后，原本已持久化的历史仍能打开；修复版 v1 保存的记录在覆盖升级到 v2 后也能恢复。策略页支持触控选牌，两组基准含一次暂停、重载与续算，最终误差分别为 0.0820% 和 0.0958%。本次设备验证使用模拟器，尚无实体手机实测。[修复版模拟器记录](android-test.json) · [签名与源码指纹](android-build-upgrade.json)

## 河牌求解器

`node --test tests/equity.test.cjs tests/strategy.test.cjs` 已通过 12 组测试，覆盖牌力、范围权重、Kuhn 解析纳什策略、独立最佳响应、不可达节点、检查点续算、花色置换与金额同比缩放。两个河牌基准的根底池均为 100，各有 60 个合法私牌配对。测得的可利用度为 NashConv 的一半。

| 河牌基准 | 迭代轮数 | OOP 根 EV（筹码） | 可利用度 / 根底池 |
| --- | ---: | ---: | ---: |
| 等权 | 16,384 | 61.3491 | 0.08197% |
| 非等权 | 12,288 | 62.2354 | 0.09215% |

使用单独的 Rust/WASM 开源求解器在同一下注树上复算，两个模型的 OOP 根 EV 差分别为 0.00687、0.02733 筹码。再把外部策略交给本项目独立估值，在有足够到达概率的动作上，最大行动 EV 差均低于 0.0005 筹码。[对照方法与复现](RIVER_REFERENCE.md) · [逐项数据](river-reference.json)

应用支持已发出五张公共牌的两人、相同有效筹码、无抽水模型。每方最多 64 个有效具体组合，允许一至两个首注尺度，每个首注至多一个加注尺度，每条路径最多一次加注。准确度与耗时应结合模型、迭代预算和实际设备解读。
