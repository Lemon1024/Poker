# 验证与手机交付证据

## 1 分级状态

每个平台分别记录：
- not_attempted：没有尝试；
- passed：已有对应证据；
- failed：实际执行失败；
- blocked：缺少明确前提，无法执行。

主机测试、平台编译、模拟器运行、真机运行分别列项。Android APK生成不等于已安装。iOS工程生成不等于已编译，未签名编译不等于可安装IPA。

## 2 最小环境检查

记录实际工具版本、主机OS和体系结构、项目已有状态。仅执行与当前平台相关的检查。

通用示例：
~~~text
python3 --version
cmake --version
flutter --version
dart --version
flutter doctor -v
~~~

编译器按平台检查可用的clang/gcc/MSVC。Android检查SDK/NDK、Java、可用设备。macOS检查Xcode、可用模拟器及实际项目所需依赖。

不要输出完整环境变量，不要把密钥、签名密码或令牌写进报告。

## 3 测试分层

### 快速层

卡牌解析、重复输入、范围过滤、空范围、牌型边界、缓存规范化、任务状态。

### 核心精确层

完整翻前固定牌金标、河牌完整990组合金标、转牌与翻牌规模及逐组合分母。至少在每个核心里程碑结束前执行一次必要完整案例；没有相关改动时不反复跑所有耗时测试。

### 独立差分

用独立五张牌评估器枚举最佳五张，不共享生产牌力函数。覆盖随机和精心选择的边界。对小范围、少量牌面比较两种枚举顺序。

### 原生生命周期

重复开始、有限step、取消、再次开始、错误输入、销毁。启用适合主机的内存检测工具时记录结果。确保字符串与句柄没有跨分配器释放、重复释放或释放后使用。

### Flutter

纯Dart模型/状态测试；widget窄屏和文字缩放测试；实际FFI集成；真实结果的端到端操作。测试替身可以验证状态机，但不能作为原生集成已通过的证据。

## 4 构建命令与证据

以下为常用命令示例，实际目录和工具版本以T00结果为准。命令失败应修复或明确记录，不假设成功。

主机：
~~~text
cmake -S native -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --config Release
ctest --test-dir build/native -C Release --output-on-failure
~~~

Flutter：
~~~text
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
~~~

Android运行前先确认连接的设备或模拟器，再按指定device执行安装/运行。性能需使用profile/release等适当模式并记录实际签名类型。

iOS仅在macOS/Xcode前提满足时：
~~~text
flutter build ios --simulator --debug
flutter build ios --release --no-codesign
~~~

两条命令用途不同：前者用于模拟器构建；后者证明无签名发布编译能力，不能据此宣称真机可安装。真机运行使用项目已有、已获授权的签名环境；缺失时列为blocked。

不要为通过构建擅自替换用户现有签名或发布设置。应用商店发布是另一个交付任务。

## 5 性能记录

reports/PERFORMANCE.csv至少包含：
date,platform,device,cpu_or_soc,os_version,build_mode,engine_version,scenario,opponent_combos,terminal_cases,elapsed_ms,peak_memory_mb,notes。

分别测：
- 翻前固定AsAh/KsKh；
- 翻牌完整范围；
- 转牌完整范围；
- 河牌完整范围；
- 取消响应时间；
- GTO受限树到达目标误差的时间与峰值内存。

没有真实测量就不填写性能值。目标和实测分开。不得用桌面速度推断手机速度。

## 6 最终交付报告

reports/DELIVERY.md建议结构：
1. M1/M2/M3分别完成了什么；
2. 可安装/可运行文件及适用平台；
3. 实际执行的测试与结果；
4. Android与iOS编译、模拟器、真机的独立状态；
5. 已测性能及测试环境；
6. 未验证或受阻项及恢复步骤；
7. 已知产品范围：单挑、具体花色、当前规则、GTO受限树。

保持状态诚实且可复现。没有手机验证条件时，交付完整可继续构建的源码和明确步骤，同时继续完成不依赖设备的任务。

## 7 最终构建版本对应

T08产生的是当时源码的移动构建。T10/T11后如原生核心、接口或界面变化，T12对受影响的平台重新构建并执行必要冒烟验证。记录构建对应的commit或源码指纹，以及实际包含M2还是M3。若缺少环境无法重建，旧APK保留M2标签，GTO源码与主机验证独立交付，不能把旧包标成包含新功能。
