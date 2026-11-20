# 实施参考资料

核验日期：2026-11-19。实施时重新读取适用于当前工具链的官方说明，锁定实际依赖版本。

## Flutter与原生计算

- 原生FFI集成：https://docs.flutter.dev/interop/bind-native-code
- FFI内存与同步调用：https://docs.flutter.dev/interop/dart-ffi
- isolate与计算线程：https://docs.flutter.dev/perf/isolates

FFI调用在调用线程同步执行，重计算需要后台isolate及明确取消机制。本方案的分块job接口是工程设计建议，不是官方提供的现成扑克API。

## 牌型评估

- PH Evaluator：https://github.com/HenryRLee/PokerHandEvaluator
- 文档：https://henryrlee.github.io/PokerHandEvaluator/

仓库提供牌型评估，不等于完整权益或GTO产品。采用代码时保留对应许可证与版权信息，并固定版本。初步核验的仓库许可证为Apache-2.0。

## GTO算法与验证

- CFR原论文：https://proceedings.neurips.cc/paper/2007/file/08d98638c6fcd194a4b1e6992063e944-Paper.pdf
- DCFR论文：https://arxiv.org/abs/1809.04040
- OpenSpiel CFR实现：https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/python/algorithms/cfr.py
- OpenSpiel exploitability实现：https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/python/algorithms/exploitability.py
- Pio数值口径：https://piosolver.com/docs/viewer/numbers_in_piosolver/

## 可用作对照的翻后项目

- Rust参考：https://github.com/b-inary/postflop-solver
- C++参考：https://github.com/bupticybee/TexasSolver

两者仓库标注AGPL-3.0系列许可；b-inary项目公开说明暂停开发。它们可以作为算法与输出对照，实际复用代码按对应许可处理。不要将历史性能表当作本项目实测结果。

## 本包测试数据

fixtures中的两组精确计数在本次对话中通过枚举得到。它们是验收参考，开发时仍须用独立实现交叉验证，不能在生产逻辑中硬编码。规模表来自组合计数公式，不是设备性能测试。
