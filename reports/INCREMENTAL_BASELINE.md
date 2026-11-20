# R1 增量基线

用户报告已有翻前固定手牌 all-in 和河牌组合分析。本次在修改前运行 `node --test tests/equity.test.cjs tests/strategy.test.cjs`，12/12 通过。工作目录没有 Git 元数据，沿用目录内源码、签名、历史数据和已有制品。

| 入口 | 修改前查实 | R1 处理 |
| --- | --- | --- |
| web/equity.js | 固定翻前及翻牌、转牌使用抽样。河牌用共享评估器精确比较，990 行的独立参考回归通过。 | 保留评估器与翻前、翻牌行为，为转牌枚举 44 张合法河牌。 |
| range / rangeText | 具体两张牌、可选权重，牌序归一去重，过滤阻挡和零权重，无有效组合时报错。原有测试覆盖极小权重与河牌带权汇总。 | 沿用请求格式，补全精确行计数和按局面复用已完成行。 |
| web/runner.js / web/app.js | 每个任务有 Blob Worker 和 requestId，取消调用 terminate，页面丢弃非活动回调。列表筛选与概率汇总独立。 | 增加精确批次、启动前校验与完成后缓存，验证取消、后台恢复与竞态。 |
| Android WebView / HistoryStore | 原生 onPause 已取消权益任务。已有选牌、逐行编辑、胜平负及权益、历史恢复。没有独立保存命名范围的入口。 | 复用手机入口、本地存储源站和历史格式，新增命名范围与原始计数。 |
| tools/build_android.py | API 35 / JDK 17 的离线 Android 外壳，最新策略版同时含权益页。 | 在同包名与签名下发布递增版本，保留旧 APK。 |

修改前 equity.js 的 SHA-256 为 `bc8f539979053c257298e984ceb966f529fc8b1cd18891960d863de6b65191a2`。历史平台测试见 STATUS.md，本轮执行结果另见 VALIDATION.md。
