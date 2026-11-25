# GTO训练营 Android v5 交付记录

2026-11-25。v5 在现有 v4 工作树上加入深色工作台、离线训练和位置对照。Android 应用名称及桌面启动入口均为「GTO训练营」。首页按需进入权益复盘、河牌求解或训练。

查表与答题采用同一套教学分档。以 BTN 持 `99` 为例，面对 UTG 开池 2.5BB 首选跟注，面对 CO 开池 2.5BB 首选 3-bet 到 7.5BB。两侧都可直接开始对应的专项训练。答题后可查看范围、返回原题，或在本轮结束后按位置重练错题。[360px 工作台](v5-browser/desktop-test-home.png) · [位置对照](v5-browser/desktop-test-comparison.png) · [训练反馈](v5-browser/desktop-test-training-feedback.png)

| 交付文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `poker-strategy-android-v5.apk` | 83,894 B | `60e3ca90ef1c5a480e4bf3b5f12c8a8b84420e6bfde2b0808c80e1835e3070cb` |
| `poker-strategy-android-v5-wechat.zip` | 73,391 B | `8eaca1813e6035375787d4c071a495b85d7b990394bbc3ecdbe6daf01a9d50a9` |
| `gto-training-camp-desktop-v5.zip` | 61,014 B | `627239226e1b9b2db16f01deb23088aac600fcee0220e949faef8f374b0d8a71` |

微信 ZIP 中只有原始 APK。已解压到新目录并验证 APK 摘要与签名。两种平台的 23 份网页资产均与工作树逐字节一致，桌面包解压后从 `index.html` 开始。

## 源码与构建

- 源码基线为 Git `37ff810cd533d170824b2de076272255f25403b7`，交付包含该基线上的未提交工作树。教学范围表沿用 1.0.0。
- 29 个构建输入的 SHA-256 汇总为 `69fc3f9e49e37b318e1c7af9bbce3ebad649a4d89b8e5c5624d85ffa89054ff3`。计算时合并 `sources` 和 `assets`，按相对路径排序，将每项拼成「路径、Tab、该文件的小写 SHA-256、LF」，按 UTF-8 取 SHA-256。[逐文件构建清单](android-build-strategy-v5.json)
- 包名为 `org.rivernotes.poker`，versionName 5.0，versionCode 5，最低 Android 9（API 28），目标 API 35。SDK 35 的 `aapt` 和 `aapt2` 均校验应用及启动 Activity 的标签。v4 与 v5 的开发签名证书 SHA-256 同为 `9dfd897a34aa6e9247393a5e961d31b26179143edba8967c842a731bf29dbdf9`。

## 实际验收

| 环境 | 结果 | 验证内容 |
| --- | --- | --- |
| Node | 25/25 | 权益、转牌精确枚举、河牌 CFR 与检查点回归。另检查 35 × 169 项查表与评分的一致性、不可达手牌、金额、连续答题、错题筛选与恢复。 |
| [Chrome 158](v5-browser/desktop-test.json) | 18/18 | 源码在断网浏览器运行。360px 宽度点矩阵底行，比较 BTN 的 99 对 UTG/CO，分别练习并返回，完成 10 手、恢复进度、按局面复练。 |
| [Edge 158](v5-browser/desktop-test-edge.json) | 18/18 | 从最终 APK 解出资源后运行相同回归。两款浏览器均核查河牌行动频率与 EV，外部请求、控制台问题、JS 异常和本地资源加载失败均为 0。 |
| [Android 15 API 35](android-camp-v5.json) | 8/8 | x86_64 断网模拟器，360 × 728 CSS 像素。完成 17 次可信触控，验证系统返回、强停续练、错题和专项训练。安装前后设备均无默认网络。 |

**覆盖升级。** 在 v4 界面保存了一手牌、一条带有 0.75 和 0.25 两个组合权重的命名范围，以及运行了 57 次迭代的河牌检查点。覆盖安装 v5 后复核了手牌、胜平负与权益、两个组合及权重，并在求解页载入了摘要相同的检查点。[设备安装前后摘要](android-upgrade-v5.json) · [恢复结果](android-camp-v5.json)

## 性能

| 平台 | 首页进入训练至首题可见 | 10 次答题反馈中位数 | 反馈最短–最长 |
| --- | ---: | ---: | ---: |
| Chrome 158 | 935 ms | 63.5 ms | 49–75 ms |
| Edge 158 | 928 ms | 61 ms | 48–72 ms |
| Android 15 模拟器 | 327 ms | 33 ms | 21–69 ms |

桌面计时从 Playwright 发起触控开始，到内容可见并经过两次动画帧。Android 的首题测于 480 × 728 视口，从首页可信点击到新一轮首手 AKo 与三个合法按钮全在视口中，再等待两帧，包含 CDP 观测延迟。10 次答题反馈测于 360 × 728，从页面收到点击事件开始，到反馈进入绘制帧。数据来自本次测试机，实体手机和微信客户端实发未验。[Android 首题计时记录](android-training-timing-v5.json)

## 复现

```powershell
node --test tests/*.test.cjs
python -B tools/package_desktop.py
python -B tools/build_android.py --sdk .work/toolchain/android-sdk --jdk .work/toolchain/jdk17.0.21_1 --edition strategy --version-code 5
node tests/desktop.cjs
node tests/android-emulator.cjs --prepare-camp --serial emulator-5574 --avd RiverNotes_R1_API35 --apk dist/poker-strategy-android-v4.apk --adb .work/toolchain/android-sdk/platform-tools/adb.exe
node tests/android-emulator.cjs --camp --serial emulator-5574 --avd RiverNotes_R1_API35 --apk dist/poker-strategy-android-v5.apk --adb .work/toolchain/android-sdk/platform-tools/adb.exe
```

桌面运行需本机 Playwright 与 Chrome/Edge，可用 `POKER_PLAYWRIGHT`、`POKER_BROWSER` 指定路径。设置 `POKER_ENTRY` 可从最终 APK 解出的 `assets/index.html` 启动，并使用 `POKER_TEST_EDGE=1` 生成独立 Edge 记录。两段 Android 命令使用同一专用断网 AVD，从 v4 开始验证覆盖升级。
