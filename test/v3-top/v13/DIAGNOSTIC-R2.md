# 第二批固定规则：偏差与撞感诊断

本页只解释规则57ad67f的第二批，不冒充新半圈版本的验收。源SHA为 `7366f02a14d6dd309998ec66451afb613c063dd610ef83df6a0a1a9dcd150db8`；原8700局和固定座位公平结果在 results-r2/，已入69cd3bb。后续整场半圈由Elara9456bc75批准，生产增量53a9b50；新8700局另存results-r3/。

## 偏差来自哪里

初始化六场景：真实碰撞外形、质量、质心、角速度及马达惯性在整场Y半圈下等价；凸包坐标最大误差2.06e-8米，世界逆惯性相对误差不超过8.18e-7。geometry.json由真实Rapier getter和世界变换量出，不靠模型边界盒。后续碰撞/转动使用引擎Float32，微小方向误差会在长时间非线性碰撞中放大；不能称世界坐标旋转后逐步数值完全等价。

960局固定对照：20种子×2反应流排列×6场景×创建正/反序×整场原向/半圈。未改物品、伤害、AI或形状。240条原向正序完整回放SHA逐条与第二批相同；只反序不能去掉主要偏差。原回执在 fairness-diagnostic-r2/order-proof.json，初帧、首碰、反应流和24条完整示例也保留。

| 场景 | 反序创建 | 整场半圈 | 局数 | 角色0得分率 | 相对原向换赢家局数 |
|---|---|---|---:|---:|---:|
| pan-broom/out-out-e180 | False | False | 40 | 25.00% | 0 |
| pan-broom/out-out-e180 | False | True | 40 | 75.00% | 22 |
| pan-broom/out-out-e180 | True | False | 40 | 15.00% | 12 |
| pan-broom/out-out-e180 | True | True | 40 | 87.50% | 35 |
| pan-broom/hug-hug-e90 | False | False | 40 | 50.00% | 0 |
| pan-broom/hug-hug-e90 | False | True | 40 | 52.50% | 17 |
| pan-broom/hug-hug-e90 | True | False | 40 | 55.00% | 20 |
| pan-broom/hug-hug-e90 | True | True | 40 | 67.50% | 21 |
| scissors-pillow/out-out-e180 | False | False | 40 | 62.50% | 0 |
| scissors-pillow/out-out-e180 | False | True | 40 | 47.50% | 22 |
| scissors-pillow/out-out-e180 | True | False | 40 | 47.50% | 24 |
| scissors-pillow/out-out-e180 | True | True | 40 | 50.00% | 25 |
| scissors-pillow/hug-hug-e90 | False | False | 40 | 60.00% | 0 |
| scissors-pillow/hug-hug-e90 | False | True | 40 | 45.00% | 16 |
| scissors-pillow/hug-hug-e90 | True | False | 40 | 52.50% | 19 |
| scissors-pillow/hug-hug-e90 | True | True | 40 | 60.00% | 20 |
| lamp-slipper/out-out-e180 | False | False | 40 | 42.50% | 0 |
| lamp-slipper/out-out-e180 | False | True | 40 | 47.50% | 22 |
| lamp-slipper/out-out-e180 | True | False | 40 | 50.00% | 19 |
| lamp-slipper/out-out-e180 | True | True | 40 | 45.00% | 29 |
| lamp-slipper/hug-hug-e90 | False | False | 40 | 50.00% | 0 |
| lamp-slipper/hug-hug-e90 | False | True | 40 | 50.00% | 16 |
| lamp-slipper/hug-hug-e90 | True | False | 40 | 50.00% | 20 |
| lamp-slipper/hug-hug-e90 | True | True | 40 | 42.50% | 15 |

锅扫把伸出：原25%、仅反序15%、半圈75%、反序且半圈87.5%。所以不采用仅随机创建顺序，采用独立种子整场半圈分摊给角色。**这是分摊座位偏差，不是消除引擎数值偏差**。新完整200对仍须另跑；角色0（同一操作归属）和物理左侧分别报告。

## 撞感是否由短挡窗和锁方向造成

480局：每场景20种子×挡窗0.25/1秒×锁向/恢复冲途中追踪。四种实验均保留新满冲点积0.90、当前AI和其他参数，只有明确列出的两个轴变化，不冒充完整旧规则。原回执 feel-diagnostic-r2/proof.json。

| 场景 | 挡窗 | 冲的运动方向 | 时长中位(秒) | 节奏过/20 | 撞前接近速度 | 撞后分离速度 |
|---|---:|---|---:|---:|---:|---:|
| pan-broom/out-out-e180 | 0.25 | locked | 30.012 | 18 | 5.558 | 3.746 |
| pan-broom/out-out-e180 | 0.25 | follow-motion | 32.504 | 17 | 6.072 | 3.981 |
| pan-broom/out-out-e180 | 1 | locked | 34.354 | 14 | 6.017 | 4.002 |
| pan-broom/out-out-e180 | 1 | follow-motion | 32.933 | 16 | 5.708 | 3.897 |
| pan-broom/hug-hug-e90 | 0.25 | locked | 32.271 | 20 | 5.879 | 3.428 |
| pan-broom/hug-hug-e90 | 0.25 | follow-motion | 31.971 | 20 | 5.678 | 3.226 |
| pan-broom/hug-hug-e90 | 1 | locked | 35.504 | 17 | 5.758 | 3.487 |
| pan-broom/hug-hug-e90 | 1 | follow-motion | 34.796 | 16 | 5.691 | 3.030 |
| scissors-pillow/out-out-e180 | 0.25 | locked | 31.337 | 20 | 5.446 | 2.883 |
| scissors-pillow/out-out-e180 | 0.25 | follow-motion | 31.188 | 20 | 5.519 | 3.151 |
| scissors-pillow/out-out-e180 | 1 | locked | 35.321 | 16 | 5.059 | 3.160 |
| scissors-pillow/out-out-e180 | 1 | follow-motion | 30.312 | 18 | 5.427 | 2.925 |
| scissors-pillow/hug-hug-e90 | 0.25 | locked | 30.729 | 20 | 5.834 | 3.124 |
| scissors-pillow/hug-hug-e90 | 0.25 | follow-motion | 29.587 | 20 | 5.700 | 3.196 |
| scissors-pillow/hug-hug-e90 | 1 | locked | 34.321 | 18 | 5.661 | 2.927 |
| scissors-pillow/hug-hug-e90 | 1 | follow-motion | 31.363 | 18 | 5.628 | 3.030 |
| lamp-slipper/out-out-e180 | 0.25 | locked | 29.504 | 20 | 6.036 | 3.908 |
| lamp-slipper/out-out-e180 | 0.25 | follow-motion | 31.033 | 20 | 6.047 | 3.651 |
| lamp-slipper/out-out-e180 | 1 | locked | 34.362 | 19 | 5.549 | 3.677 |
| lamp-slipper/out-out-e180 | 1 | follow-motion | 32.288 | 18 | 5.596 | 3.608 |
| lamp-slipper/hug-hug-e90 | 0.25 | locked | 30.829 | 19 | 5.861 | 3.553 |
| lamp-slipper/hug-hug-e90 | 0.25 | follow-motion | 29.487 | 20 | 6.119 | 3.632 |
| lamp-slipper/hug-hug-e90 | 1 | locked | 34.600 | 19 | 5.707 | 3.631 |
| lamp-slipper/hug-hug-e90 | 1 | follow-motion | 30.146 | 19 | 5.830 | 3.788 |

0.25改回1秒、保持锁向时，六场景时长中位都增加约3–5秒，不能把偏长归因于短挡窗。冲途中追踪的影响有正有负，不能单凭20种子说锁向必然削弱撞感。更直接的代码证据：自动B的manual为null，不执行挡或冲逻辑，因此自动B三场景超过40秒不是这两个手动条件的直接效果；新旧开局、对撞等其他变化仍在，未定位唯一根因，也未调参。撞前速度按接触段首步、求解前的法向相对速度；分离按撞后0.05–0.25秒质心距离变化。

## 第二批跨端

Chrome 156.0.8078.49，11/11完整回放JSON逐字节等于Node，页面异常0。覆盖自动A/B、两种视口的三个挡窗和独立AI种子；原回执 browser-r2/proof.json及压缩完整回放。不覆盖53a9b50新半圈，待browser-r3；更不代表游戏画面、真机或Safari通过。浏览器和本地服务已在finally关闭。
