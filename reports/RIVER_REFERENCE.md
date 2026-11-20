# 受限河牌外部求解器对照

使用 b-inary 发布的单线程 Rust/WASM 求解器，在与本项目相同的河牌、范围、权重、底池、筹码和下注树上独立运行。两组基准各有 8 个公开决策节点、160 个手牌行动项。程序逐项核对根节点两方的具体手牌、权重和每个节点的合法动作。第三方文件缓存在工作目录的 `.work/river-oracle`，仅用于开发期验算。[外部项目](https://github.com/b-inary/wasm-postflop) · [Rust 内核](https://github.com/b-inary/postflop-solver)

| 基准（根底池为 100） | 本项目 OOP 根 EV | 外部 OOP 根 EV | 用本项目 BR 重算外部策略的可利用度，筹码 | 同策略高到达行动 EV 最大差，筹码 |
| --- | ---: | ---: | ---: | ---: |
| 等权 | 61.349089 | 61.342224 | 0.00031750 | 0.000300 |
| 非等权 | 62.235404 | 62.262737 | 0.00008147 | 0.000475 |

外部求解使用其 4,096 轮策略及公开接口导出的数据。本项目达到独立 BR 门槛时停止。根 EV 按兼容性修正后的手牌权重汇总。外部接口按剩余牌局计行动 EV，项目按河牌根节点计 EV，换算时扣除行动方在该节点之前已投入的筹码。外部接口已将每个手牌动作频率四舍五入，回放前按行重新归一化。

高到达定义为该手牌信息集的到达概率乘该动作频率至少 1%。回放**同一策略**时，等权和非等权分别有 55 和 44 个动作满足条件。再分别使用两个求解器**各自求出的策略**时，双方都满足条件的动作数为 52 和 41，平均行动 EV 绝对差为 0.6843 和 0.4918 筹码，最大绝对差为 3.2624 和 9.0023 筹码。不同策略的局部混合与条件范围可产生不同的节点行动值；全局比较采用每方单边改善量给出的 OOP 局值区间。两组区间均交叠。最差差异所在节点、手牌、动作及完整精度见[机器报告](river-reference.json)。

## 复跑

在项目根目录执行下列 PowerShell。第一次获取官方发布的 JS 绑定与 WASM，之后可断网重复运行。下载环境若需要代理，可先为当前 shell 设置已有的 `HTTPS_PROXY`。

```powershell
New-Item -ItemType Directory -Force '.work/river-oracle' | Out-Null
python -c "import urllib.request as u; u.urlretrieve('https://wasm-postflop.pages.dev/7a023623e45ca364f00b.js','.work/river-oracle/solver-single.js'); u.urlretrieve('https://wasm-postflop.pages.dev/7e7987ad18d75b6fce10.wasm','.work/river-oracle/solver-single.wasm')"
node tools/compare_river_reference.cjs --output reports/river-reference.json
```

脚本先核验两个文件的固定 SHA-256，随后运行外部求解、本地求解、独立最佳响应及收益对照。报告记录上游下载链接、文件哈希、测试数据哈希、Node 版本和单位。验收公差为同策略根 EV 及可利用度各 0.001 筹码，高到达动作 EV 0.01 筹码。同策略回放和两组根局值区间校验均为程序断言。[复跑工具](../tools/compare_river_reference.cjs) · [上游牌张编码](https://github.com/b-inary/postflop-solver/blob/main/src/card.rs) · [上游 EV 实现](https://github.com/b-inary/postflop-solver/blob/main/src/game/interpreter.rs)
