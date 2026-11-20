# 河牌手记 R1（Android 3.0）

[安装包](../dist/poker-strategy-android-v3.apk) · [源码和测试快照](../dist/poker-r1-source.zip) · [分项状态](INCREMENTAL_STATUS.md) · [验收记录](VALIDATION.md) · [实测性能](PERFORMANCE.csv)

包名 `org.rivernotes.poker`，versionCode 3，最低 Android 9（API 28），目标 API 35。沿用策略版外壳、原签名及本地 HTTPS 源站。安装包同时提供原有的河牌策略入口。

| 校验项 | SHA-256 |
| --- | --- |
| APK | `a68123e6fbf5a76664cb56f89e9d38d77bd05101bd00ccfcf72b935315887c78` |
| 源码与测试 ZIP | `b6c58bce97dd754e4ade3b7c9b88437f79e49500d144734c526702df35826e30` |
| 构建输入源码指纹 | `3adc3fa61e0d213600e7ab9e4c5e2486e0bbdd990fc3e6200006b7fe6c91af8b` |
| 签名证书 | `9dfd897a34aa6e9247393a5e961d31b26179143edba8967c842a731bf29dbdf9` |

此工作目录没有 Git 提交号。源码指纹覆盖[签名构建清单](android-build-strategy-v3.json)的 sources、assets 以及构建时导入的 tools/package_desktop.py。按项目相对路径升序，把 16 个文件的“路径、Tab、文件 SHA-256 小写十六进制、LF”拼为 UTF-8 字节并计算 SHA-256。源码快照含这些构建输入和回归测试。签名材料保存在原工作区。

Android 15 / API 35 / x86_64 断网模拟器已覆盖安装并运行该 APK，安装后 SHA-256 与交付文件一致。v2 历史和 v3 命名范围均已恢复。当前交付为项目开发签名 APK；实体手机和 iOS 未实测。[设备记录](android-r1.json)

## 安装和恢复

在 Android 手机上打开 APK 并覆盖安装；也可在已连接的目标设备上执行以下命令。保留应用数据即可继续使用原有历史记录，新版会按历史记录实际使用的方法显示模拟或精确结果。

```powershell
adb -s <设备序列号> install -r dist/poker-strategy-android-v3.apk
```

进入「翻后范围」，选两张手牌、四张公牌，选择全部合法组合或编辑加权组合。点「开始计算」，完成后可筛选组合、展开终局计数。「保存范围」按名称保存完整配置，再次保存同名范围会更新其内容。载入到新局面时重新处理阻挡。切入后台取消活动任务，返回后点「开始计算」重算；「历史记录」可恢复最近完成的局面。跨进程保留完整结果需先点「保存局面」。

## 重建

```powershell
python -B tools/build_android.py --sdk .work/toolchain/android-sdk --jdk .work/toolchain/jdk17.0.21_1 --edition strategy --version-code 3
```

使用项目内的 JDK 17、Platform 35 与 Build Tools 35.0.0。覆盖原安装需要同一签名。首次在独立目录构建会生成该目录自己的开发签名。打包脚本校验 manifest、签名、ZIP 对齐及全部 11 份网页资产，生成版本独立的 APK 与构建记录。旧 v1/v2 制品在原目录。
