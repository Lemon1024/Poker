# 德州扑克复盘工具执行包

当前路线、任务分工和验收标准见 [v1.2 执行计划](LOCAL_HTML_PLAN.md)。后续启动实施时使用 START_CODEX.txt，从本地 HTML 开始。下文保留 v1.0 执行包和参考数据的说明。

## 历史包说明 v1.0

本包是面向代码仓库的开发规格、任务依赖和测试数据，不是已经编译的 App。目标是让 Codex 从现有或空白项目持续推进到可验证的手机应用。

## 使用方法

1. 解压到准备开发的工作目录，例如 poker_mobile_codex_plan。
2. 在 Codex 中打开这个工作目录，或把该目录作为附件放进已有项目。
3. 复制 START_CODEX.txt 全部内容作为第一条开发任务。
4. Codex 先阅读 CODEX_EXECUTION_PLAN.md，再阅读接口、验证与 GTO 规格；通过阶段关卡后自动推进。
5. 新项目默认在工作目录的 poker_study_mobile 子目录创建源码。已有项目沿用既有布局，不覆盖原有 AGENTS.md、配置、签名文件或用户改动。

## 三个不同的交付目标

- M1：正确的精确计算核心和命令行验证。
- M2：接入真实核心的 Android/iOS Flutter App，以及分别有证据的构建和运行状态。
- M3：真正的受限单挑河牌 GTO 求解器，含平均策略、独立最佳响应与可利用度。

完成权益计算不能标记为完成 GTO；生成 iOS 工程不能标记为已在 iPhone 运行。本轮交付的是执行包；上述源码、构建物及设备报告由后续 Codex 实施产生。

## 文件索引

| 文件或目录 | 用途 |
| --- | --- |
| START_CODEX.txt | 可直接粘贴的启动任务 |
| CODEX_EXECUTION_PLAN.md | 总规格、默认决策、阶段关卡 |
| TASKS.json | 机器可读的任务依赖和验收条件，初始状态均为 planned |
| docs/API_AND_FFI.md | 数据语义、C ABI、任务生命周期 |
| docs/VERIFICATION_AND_RELEASE.md | 数学验证、平台构建、证据分级 |
| docs/GTO_RIVER_SPEC.md | 真正河牌策略求解的独立规格 |
| docs/SOURCES.md | 官方资料与论文索引 |
| schemas/ | 请求、已完成结果、进度消息与请求拒绝的 JSON Schema |
| fixtures/ | 已核验的精确计数和规模案例 |
| tools/check_plan_bundle.py | 执行包结构、JSON 和计数关系检查 |

开发中的需求变化先更新总规格、schema 与测试，再修改各模块。已有项目约束和实际执行环境中的更高优先级指令始终优先。

## 检查执行包

在项目虚拟环境安装 tools/requirements-validation.txt 后运行：

~~~text
python tools/check_plan_bundle.py
~~~

该检查只验证执行包结构、数据一致性、任务依赖和河牌参考结果，不代表手机应用或GTO引擎已构建。verification/plan_bundle_checks.json记录本包生成时的检查结果。
