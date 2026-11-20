# 数据接口与原生任务生命周期

## 1 契约权威

schemas目录的JSON Schema约束结构；本文件约束JSON Schema难以表达的语义。发现冲突先统一两者，再写实现。分析模块schema_version为1，method只允许exact。

输入卡牌采用规范大小写：As、Td、2c等。UI可以接受并规范化用户输入，核心严格校验。组合内部按card_id排序；范围中重复的无序两张组合必须拒绝。

## 2 两种请求

### preflop_fixed

- hero：恰好两张不同牌；
- villain：恰好两张不同牌；
- board：空数组；
- 四张牌全局互不重复；
- 不混用对手范围输入。

### combo_analysis

- hero：恰好两张不同牌；
- board：恰好3、4或5张；
- hero与board全局互不重复；
- range.kind=uniform，或weighted且提供combos；
- weighted每项cards为两张不同牌，weight在[0,1]；
- 按先blocked后zero的顺序过滤，记录排除数；
- 重复具体组合在过滤前拒绝，即使该组合被阻挡或权重为0；
- 过滤后没有正权重合法组合返回EMPTY_EFFECTIVE_RANGE。

## 3 输出语义

已完成结果遵守analysis_result.schema.json：
- status=completed，method=exact；
- 概率和equity使用0到1，不使用0到100；
- 计数为非负整数，C++内部用uint64_t；
- 当前版本规模处于JSON安全整数范围，后续扩大必须评估跨语言精度；
- preflop提供hero和villain统计，不提供current_relation；
- combo rows提供current_relation与各行概率；
- aggregate是按范围权重汇总的概率，不是“加权整数胜场”；
- current_relation_counts统计行数，不按权重乘成分数；
- rows覆盖全部实际评估的组合，每行唯一，顺序确定。

unfinished消息遵守analysis_progress.schema.json，只有进度、状态或错误，不包含胜率。fixture中的expected_summary只是摘要，不能当成完整响应。

精确统计以整数为准；概率断言建议绝对误差1e-12，较长加权聚合可放宽到1e-10并记录原因。显示四舍五入后的百分比不要求逐项相加视觉上绝对等于100.00%。

## 4 错误与拒绝请求

固定错误码：
- INVALID_REQUEST：JSON、字段、卡牌语法、同一数组重复牌、board长度、非法权重、未知模式等结构错误；
- DUPLICATE_KNOWN_CARD：结构合法，但hero/villain/board之间有重复牌；
- DUPLICATE_RANGE_COMBO：范围中存在顺序无关的重复两张组合；
- EMPTY_EFFECTIVE_RANGE：排除阻挡与零权重后有效范围为空；
- NATIVE_INTERNAL_ERROR：无法归类的原生错误。

结构校验失败时，create返回空句柄和analysis_error.schema.json定义的rejected信封。已有可识别任务在语义校验或计算中失败时，使用progress中的failed信封；两种通道使用相同错误码。错误消息不暴露敏感环境信息。

取消使用cancelled，不伪装为completed。失败后可以新建请求。

uniform模式的excluded_blocked_combo_count和excluded_zero_weight_combo_count均为0；这两项只统计weighted模式显式输入中被排除的组合。uniform直接从合法剩余牌生成。

输出rows中的cards按card_id升序；完整rows数组按这两个card_id组成的元组升序。selected_rows fixture仅用来按组合匹配，不代表完整响应顺序。

## 5 默认C ABI

以下是实施时需要落实的接口草案；T01冻结后头文件、Dart绑定和测试保持一致。对外只暴露C兼容类型，不暴露std::string、std::vector或C++异常。

~~~c
typedef struct poker_job poker_job;

uint32_t poker_abi_version(void);
poker_job* poker_job_create(const char* request_json, char** error_json);
int32_t poker_job_step(poker_job* job, uint32_t work_budget);
char* poker_job_snapshot_json(poker_job* job);
void poker_job_cancel(poker_job* job);
void poker_job_destroy(poker_job* job);
void poker_string_free(char* text);
~~~

职责：
- create复制请求并完成结构校验。成功返回句柄、error_json为空；拒绝请求时返回空句柄和由核心分配的rejected JSON字符串。范围准备等语义校验可在第一个有限step完成，其失败通过failed快照返回。
- step执行最多work_budget个终局工作单元或等价有限批次，不无界阻塞。返回码固定为0=queued、1=running、2=completed、3=cancelled、4=failed；调用方不得把返回码当作胜负结果。work_budget必须大于0。
- snapshot返回进度或完整结果的JSON副本。未完成时不含概率。完成结果可较大，仅在需要时提取。
- cancel在任务拥有线程调用，将任务标记取消并使后续step停止。
- destroy仅在没有正在执行step时调用，释放全部任务资源。
- 所有核心返回的字符串都由poker_string_free释放；Dart不能用自己的free猜测分配器。
- 所有函数在边界捕获异常并转换成错误；不得让异常越过C ABI。
- 默认句柄不是线程安全对象，只归属于一个后台isolate的调用序列。

不使用原生后台线程也可以满足首版需求。采用其他生命周期方案时，必须提供同等取消与所有权保证并更新绑定和测试。

## 6 Flutter任务状态机

idle → queued → running → completed
running → cancelled
queued/running → failed

新请求产生新的request_id与内部input_fingerprint。主isolate只接受当前request_id的更新。

后台长生命周期isolate：
1. 接收start消息并创建原生job。
2. 在有限step之间让出事件队列，处理cancel或新任务。
3. 分批发送进度。
4. 完成后发送结果，按缓存策略保存。
5. 释放字符串与句柄。

单纯丢弃Future不会停止原生计算。一个超长同步FFI调用期间，该isolate也不能及时处理普通取消消息，因此必须采用有限step或另一个经过验证的原生取消机制。

退出页面的策略必须明确：默认取消未完成任务；完成缓存与历史可保留。应用进后台默认暂停或取消长计算并保留输入，恢复时重新发起；不要假设移动系统允许无限后台计算。

## 7 缓存

分两层：
- 数学结果缓存：规范化输入、范围与引擎版本；
- UI任务信封：当前request_id与当前页面状态。

缓存命中要重新绑定当前request_id。缓存不能绕过输入校验。原始输入顺序和展示牌序可以保存，但规范化数学配置需确定性。

若复用逐组合结果重新加权，只能使用同一hero、board、规则和引擎版本下已经完成的那些行。缺失行应补算或判定不命中。

## 8 第三方与编码

将第三方牌编码、分值大小方向和牌型分类封装在单一适配器里。52张牌全量往返测试，牌型排序差分测试。

锁定依赖版本或commit并保存许可。不要把参考项目中用于展示的示例概率当作引擎逻辑。

## 9 指标与详情展示

v1完成结果schema只保存计算统计。需要显示最佳五张牌与牌型说明时，可由同一牌力模块提供独立详情接口或在已完成输入上重新评估；不要向additionalProperties=false的响应随意追加字段。新增字段先升级schema与绑定。

缓存/任务内部的input_fingerprint是控制器元数据，不擅自混入v1完成结果。engine_version使用实际引擎和评估器版本，不能在生产中沿用fixture的oracle-fixture-v1。

## 10 GTO专用接口

本文件的analysis_* schema只涵盖权益分析。GTO任务在T09/T10冻结自己的请求、进度、结果和ABI命名空间，由T11接入；不得让river_gto请求违反既有analysis_request的闭合枚举后又依赖隐式解析。
