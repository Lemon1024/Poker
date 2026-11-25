# 河牌手记 Android v4 · 翻前建议

`poker-strategy-android-v4.apk` · [教学范围表 1.0.0](../preflop/ranges.js) · [使用指南](../docs/USER_GUIDE.md#查看翻前建议)

首页入口提供 6 人现金桌、100BB、无前注及无 straddle 的 35 个局面。按位置查询 169 类起手牌，按行动和高低频筛选，选牌后显示建议、加注总额和理由。档位由项目编写，以定性教学为用途。翻前权益和河牌求解沿用现有入口。

| 交付信息 | 值 |
| --- | --- |
| 包名 / 版本 | `org.rivernotes.poker` / 4.0 / versionCode 4 |
| APK SHA-256 | `1620c66a63800f1f5c20f5d81423ab83d78a9c7c4effc265d489a0c3a6a5a321` |
| 教学范围表 SHA-256 | `25d910d01acf11aabd5dde44ab11d9202a664e19a4920997459d6516382d932a` |
| 源码基线 | Git `37ff810`，外加工作树中的本次改动 |
| 构建输入指纹 | `ad8e50537f1df63c3659a0e557906e5614527ba37fe55dcd50e0d62fa7ffae53` |

构建输入指纹包含[构建清单](android-build-strategy-v4.json)列出的源码与资产，以及构建时导入的 `tools/package_desktop.py`。将 20 项按相对路径升序排列，每项按“路径、Tab、小写 SHA-256、LF”拼成 UTF-8 并计算 SHA-256。APK 通过签名、4 字节对齐与 ZIP 校验，包内 15 份网页资产与源码一致。

## 验收

- Node 核心 19/19 通过，包含原有权益与河牌策略测试、新增 35 × 169 个局面的映射与档位检查，以及位置、挡牌和加注金额案例。
- 桌面断网验收各通过 14 项。Chrome 使用工作区页面，Edge 使用最终 APK 解出的网页资源。验证包含 360px 竖屏矩阵、手牌保持、3-bet 高频与低频切换、4-bet 金额及返回首页。 [Chrome 记录](preflop-browser/desktop-test.json) · [Edge 记录](preflop-browser/desktop-test-edge.json)
- Android 15（API 35）x86_64 断网模拟器 6/6 通过。先在 v3 保存局面并强停，再以原签名覆盖安装 v4。恢复后核对所存输入和概率。使用 WebView 触控点选矩阵，检查位置切换、行动分档和首页导航。设备安装包摘要与交付 APK 一致。 [设备记录](android-preflop-v4.json)

Android 9 为 manifest 最低版本。本轮运行验证使用 Android 15 模拟器，尚无实体手机验证。

## 复现

```powershell
node --test tests/*.test.cjs
python -B tools/build_android.py --sdk .work/toolchain/android-sdk --jdk .work/toolchain/jdk17.0.21_1 --edition strategy --version-code 4
node tests/android-emulator.cjs --preflop --serial emulator-5574 --avd RiverNotes_R1_API35 --baseline dist/poker-strategy-android-v3.apk --apk dist/poker-strategy-android-v4.apk --adb .work/toolchain/android-sdk/platform-tools/adb.exe
```

升级测试使用尚未安装 v4 的专用断网模拟器。已安装 v4 时可省略 `--baseline` 来重复界面检查。桌面验收命令和环境变量沿用 [R1 验证记录](VALIDATION.md#复现)。
