# MVP规则：最终证据索引与六项补证

规则采用2.2m围栏、扫把0.8m、力量0.48／血量1.1。完整机制、旧30,000局及跨内核证据已交付；进度、验收和合并授权只认共享 HANDOFF「当前：MVP规则实施」及「当前：规则六项补证与认物接口摸底」。本文是静态证据说明，不是另一份进度表。

## 最终参数的完整批次

| 批次（目录可直接读压缩全行） | 行数 | 结果与限制 |
|---|---:|---|
| [三模式与择时](results-primary-r2/summary.json) | 3,000 | A/手动乱按局长中位30.967/27.654s；B为35.133s，超35s线0.133s，Elara接受例外，不能记为过线。三模式>45s分别0/0/0.167%。全部首伤≤0.4s。 |
| [镜像](results-fair-r2/summary.json) | 2,400 | 六格玩家身份得分48.25–52.50%，均在45–55%；交换成对AI随机流，不是400份独立种子。 |
| [装法](results-layout-r2/summary.json) | 2,400 | 六场景×100种子×四条件，18个差值绝对值中位6.5点；包括翻第二件，部分单格不足5点。 |
| [单件强弱](results-strength-r2/summary.json) | 16,800 | 六类等权、对手两朝向等权、取自身较强朝向。台灯64.75%临界，扫把伸出62.396%、贴着31.354%为接受短板。 |
| [双件选择](results-combos-r2/summary.json)／[独立抽查](results-combo-check-r2/summary.json) | 3,600 + 1,800 | 先5种子选装法，后独立1000–1019种子复核；四组>65%标记保留。新默认角色前不继续复测，不能拿小样本当完整平衡验收。 |

以上共30,000行。各目录 `manifest.json` 记录当时源码与输入SHA，`rounds.ndjson.gz` 是完整逐局，`summary.json` 是当时分析器的原摘要，本次不覆盖。早期 `results-primary/`、`results-strength/`、`results-pilot/` 等另存，不与最终r2混算。当前分析器可直接读取 gzip；例如仓库根目录运行：

```sh
MVP_OUT=./results-primary-r2/ node test/mvp/analyze.mjs
```

这会在该目录重写分析摘要；要保留原摘要，先把 manifest 和压缩全行复制到一个新的绝对目录，再用 `MVP_OUT=file:///绝对路径/` 分析。不要用新脚本续跑旧批次；batch会核源码指纹并拒绝。

## task #17 六项结果

- S1：分析器新增按半径的 `timingSummary`。必须六个唯一场景、每场完整成对种子、整批行数相符，才判中位≥15点。最终六格为8/15/24/16/38/15点，中位15.5，通过；最低8点和距线仅0.5点同时保留。pilot只标初筛信号，不冒充正式结果。
- S2：两件先碎再KO夹具去掉2.4m常量，沿当前半径，从实际winner推loser；核两件都在KO前碎、原因列出实际败者的两件、末次致命核心hit索引。受控核心500/挂件1只用于机制回归，不是新平衡数据。
- S4：逐一核当前全部3个generated件的材料、标签、stats、品类挂件血量和B伤害，并核每件归一化后的朝外端。未统一品类朝向，未改资产。
- S5：guard夹具明确断言生效期间实际撞墙反弹且无伤、无玩家接触/命中；长扫把夹具逐物理步量存活凸包。批量新行增加 `wall`：用世界pos/quat变换存活凸包，对64面墙内侧平面求最大穿出。30局单种子短烟测采样穿出0m，见 [量测证据](wall-smoke-proof.json)；默认每4步采一帧，不能保证中间步，也不把旧30,000行缺量测记成0。
- S6：所有阶段新增 `opening`，报告半径、检查/缺失数、超出数、最大开局扫过包围圆。旧最终30,000行逐项复算：缺失0、超出0，最大2.031741m（2.2m围栏）。这是保守圆包围筛查，不等于凸包穿墙的精确判断；旧2.0m pilot也不能代替fair/强弱等装法的开局验收。
- S7：本页替换阶段性旧结论、失效引用与交付过程；原完整过程保留在共享开发归档。progress.md已在早前提交移除，本次不重建。复算输入SHA、各阶段开局统计及六格中位在 [补证汇总](followups-proof.json)。

## 接触轨迹与新事件分开核

[contact对照](contact-comparison.json)比较b60d50a与a13ba36的同一受控持续接触夹具：原5个contact/recoil事件逐字相同、诊断逐字相同，新版只多t=0 start及t=2 result两事件。两边原本都有rules快照；变化为围栏半径、扫把力量/血量和伸出/贴着倍率，不能说只是新加了rules字段。墙未扰动这条隔离轨迹，不代表其他装法的胜负不变。

完整60秒真实接触终局另见 [timeout-proof](timeout-proof.json) 和 `timeout-replay.json.gz`：仅提高核心HP保住60秒，比较最终比例，result/why/caption/最终帧一致，无伪造KO；用于接线检查，不当发布平衡。

## 复核范围与保留缺口

现有43项加分析器/墙量测4项，共47项。命令与CI一致：

```sh
node --test --test-concurrency=1 test/prototype/sim.test.mjs test/v3/sim.test.mjs test/v3-top/v13/timing.test.mjs test/mvp/rules.test.mjs test/mvp/analyze.test.mjs test/mvp/walls.test.mjs
```

本次不改sim/、data/、web/及规则值。原Node/Chrome/WebKit相同输入完整JSON10/10、390整局证据继续有效；没有重复浏览器或真机测试。最终旧画面WebKit390双方扫过直径中位214.031/110.112px，对手未达150目标，留画面合并验；未因CI通过宣称产品体验已过。

完整历史表、截图、全部行与原始审查见[规则交付报告](https://raft-artifacts.com/p/lawrence-workspace/wanwu-mvp-rule-review)，共享开发归档/MVP规则实施保存原始产物；本次报告与独立复核另随task #17交付。
