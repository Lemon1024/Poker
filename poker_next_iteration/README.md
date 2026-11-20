# 德州扑克手机 App 增量执行包

本包承接已完成的翻前固定手牌 all-in 与河牌组合分析。它是开发计划和验收参考，不是已编译 App。

1. 阅读 NEXT_ITERATION_PLAN.md。
2. 将 START_NEXT_ITERATION.txt 交给 Codex，在现有仓库执行默认 R1。
3. NEXT_TASKS.json 提供 R1、R2、G1 的任务与依赖。
4. fixtures 提供新增数学参考与继承的河牌 GTO 基准。
5. 运行 python3 tools/verify_incremental_fixtures.py 可验证参考数据和依赖；这不验证实际 App。

R1：范围 + 转牌 + 可取消后台任务。
R2：翻牌 + 下一张牌影响 + 组合探索与历史。
G1：受限河牌 GTO，可与权益分析路线分开推进。
