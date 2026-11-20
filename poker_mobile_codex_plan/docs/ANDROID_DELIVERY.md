# Android 离线版规格

电脑版通过 H4 后，将同次验收的 HTML、CSS 和 JS 随 APK 打包。在 WebView 内以固定应用资源源站加载首页与子资源，允许本地脚本、Blob Worker 与 DOM 存储。应用可断网冷启动，禁用外部导航，打包发布不申请网络权限。固定 application ID 和本地存储源，第二版升级后继续读取权益版历史。

| 版本 | 输入与界面 | 验收证据 |
| --- | --- | --- |
| 1 权益复盘 | 复用桌面页的固定对局、范围编辑、组合筛选、保存与恢复 | 已签名开发 APK、文件 SHA-256、实际内置资源与桌面版的对照、模拟器安装、断网冷启动和操作记录 |
| 2 河牌策略 | 保留第一版入口，增加通过主机独立验算的策略模型 | 同 application ID 和签名、更高版本号，覆盖安装，读取原记录，离线求解等权及非等权基准，展示实际误差 |

模拟器记录 Android API、WebView 版本、主机、输入、运行时间及结果。真机性能只填实测数据。开发用签名保存在构建环境，不随源码或 ZIP 分发。运行资源不依赖 CPU 专用本地库；在交付报告说明 APK 中包含的代码和实际验证的架构。

## 构建与安装

使用 JDK 17、Android SDK Platform 35 和 Build Tools 35.0.0。将环境变量 `JAVA_HOME` 和 `ANDROID_HOME` 指向各自的根目录，或直接向脚本传入路径。运行以下命令。

```text
python tools/build_android.py --jdk .work/toolchain/jdk17.0.21_1 --sdk .work/toolchain/android-sdk --edition equity
python tools/build_android.py --jdk .work/toolchain/jdk17.0.21_1 --sdk .work/toolchain/android-sdk --edition strategy
```

构建过程使用 SDK 的 aapt2、D8、zipalign 和 apksigner，核对签名与包内所有页面资源。开发 APK 输出到 `dist/poker-equity-android-v1.apk`，构建记录输出到 `reports/android-build.json`。本地调试签名位于 `.work/android-build/development-signing/`，覆盖安装时复用原签名。模拟器运行结果单列。工具下载和源站设计参考 [Android 开发工具](https://developer.android.com/studio#command-line-tools-only) 与 [应用内资源加载](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)。

策略版输出到 `dist/poker-strategy-android-v2.apk`。两版均为当前项目的开发签名，包名为 `org.rivernotes.poker`，minSdk 28，targetSdk 35。APK 内含 Java 编译的 DEX 与离线网页资源。首次安装可直接选 v2，已有 v1 请在同一 Android 用户下覆盖安装。权益复盘使用应用私有 SQLite 数据库，每次保存提交一条含输入、结果与时间的记录。历史列表同时读取旧版 WebView 中已保存的记录。清除应用数据会清除复盘和检查点。旧系统上的 WebView 版本可单独更新。

### 复现断网升级验收

日常使用时，从 Windows 文件资源管理器双击项目根目录的 [Start-Poker-Android.cmd](../../Start-Poker-Android.cmd)。该入口会显示模拟器窗口并打开已安装的「河牌手记」。以下后台启动命令用于自动化验收。

在 Windows 项目根目录检查 API 35 x86_64 模拟器的 CPU 加速状态。

```powershell
& .\.work\toolchain\android-sdk\emulator\emulator-check.exe accel
```

输出中的状态码 `0` 表示加速可用。若提示缺少 hypervisor，在**管理员 PowerShell** 启用 Windows 虚拟机监控程序平台（WHPX），然后保存工作并重启 Windows。

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All -NoRestart
```

重启后再检查一次。在项目根目录的普通 PowerShell 启动专用 AVD。以下命令仅为本次 Windows PowerShell 进程指定 `RemoteSigned`。模拟器默认在后台运行，脚本核对设备身份、打开飞行模式并关闭 Wi-Fi，确认没有默认网络后输出 `Ready`。调试参数 `-SoftwareCpu` 在本机的两个模拟器版本上均于开机前崩溃。[Android 官方加速配置说明](https://developer.android.com/studio/run/emulator-acceleration#vm-windows)

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\tests\android-start-emulator.ps1
```

模拟器就绪后，可在另一终端直接安装并启动 v2。

```powershell
$adb = '.\.work\toolchain\android-sdk\platform-tools\adb.exe'
& $adb -s emulator-5562 install -r .\dist\poker-strategy-android-v2.apk
& $adb -s emulator-5562 shell am start -W -n org.rivernotes.poker/.MainActivity
```

要复验 v1 覆盖升级流程，请在尚未安装 v2 的专用 AVD 上运行以下命令。

```powershell
node tests/android-emulator.cjs --serial emulator-5562 --avd RiverNotes_API35_offline --adb .work/toolchain/android-sdk/platform-tools/adb.exe --apk dist/poker-equity-android-v1.apk --upgrade dist/poker-strategy-android-v2.apk
```
