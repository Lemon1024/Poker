# GTO训练营 v6

GTO训练营提供离线翻前训练、范围查询和单挑权益复盘。每轮练习 10 手，支持相同底牌的位置对照、错题复习和中断续练。翻前建议覆盖 6 人现金桌、100BB 的开池和再加注决策。权益页计算单挑的胜、平、负概率及底池权益，河牌策略页解释跟注需要多少权益、不同下注额的平均收益差，以及对手会用哪些牌继续。

## 开始使用

| 平台 | 打开方式 |
| --- | --- |
| 桌面 Chrome / Edge | 下载并解压仓库源码，在本地用浏览器打开根目录的 `index.html`。也可以直接打开[权益复盘](equity.html)或[河牌策略](strategy/index.html)。 |
| Android 9 及以上 | 按下方步骤构建 v6，将生成的 APK 复制到手机安装。 |

[用户手册](docs/USER_GUIDE.md)从第一轮训练讲起，并给出可自行复现的转牌和河牌示例。[产品规格](docs/SPECIFICATION.md)列出范围表覆盖的局面、各街计算方法、存储方式和验收结果。

## 项目目录

| 位置 | 用途 |
| --- | --- |
| `index.html`、`web/` | 训练工作台、`equity.html` 权益界面、牌力评估与后台计算 |
| `preflop/` | 6 人现金桌的翻前建议、起手牌矩阵和教学范围表 |
| `training/` | 单轮训练、评分、续练与错题复习 |
| `strategy/` | 河牌策略页面、求解器和独立最佳响应评估器 |
| `android/` | Android WebView 宿主与历史记录数据库 |
| `tests/`、`tools/` | 核心回归、界面验收、基准与打包工具 |
| `docs/` | 当前规格、用户指南和[早期总体方案](docs/plans/CODEX_EXECUTION_PLAN.md) |
| `poker_mobile_codex_plan/`、`poker_next_iteration/` | [初版计划包](poker_mobile_codex_plan/README.md)和[增量方案](poker_next_iteration/NEXT_ITERATION_PLAN.md)，包含测试依赖的样例与校验工具 |
| `reports/` | 各版本构建清单、截图和验证记录，当前版本见 [v6 交付报告](reports/GTO_CAMP_V6.md) |
| `.work/` | 本机工具链、模拟器、开发签名和临时文件，由 Git 忽略 |

## 测试与构建

在项目根目录使用 Node.js 运行核心回归，无需安装 npm 依赖。

```sh
node --test tests/*.test.cjs
```

构建 Android 策略版需准备 Python 3、JDK 17、Android SDK Platform 35 和 Build Tools 35.0.0。设置 `JAVA_HOME` 和 `ANDROID_HOME` 后，在独立工作副本中运行以下命令。脚本会写入同版本的 APK 和构建报告，首次构建会生成本地开发签名。

```sh
python tools/build_android.py --edition strategy --version-code 6
```

Android 输出为 `dist/poker-strategy-android-v6.apk`。分发电脑版时可运行 `python tools/package_desktop.py`，输出为 `dist/gto-training-camp-desktop-v6.zip`。

已配置项目专用 Windows 模拟器的开发者可双击 [Start-Poker-Android.cmd](Start-Poker-Android.cmd) 启动。浏览器及 Android 验收所需的额外工具、环境变量和命令见[验证记录](reports/VALIDATION.md)。
