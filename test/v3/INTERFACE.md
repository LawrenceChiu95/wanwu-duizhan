# v3 前端接入（显式 schemaVersion=3）

```js
import {simulateV3, loadCatalog, loadV3Rules, mountTransform, mountExtents} from '../../sim/v3.js';
// 陀螺版（2026-10-27）：两件装在核心赤道上，mount 是赤道挂点 e0/e45/…/e315（度数在 rules.top.slots），
// orient 是 'out'（长的一头沿半径朝外，薄的方向沿转轴）或 'hug'（长的方向沿转轴竖着贴核）。
const fighter = item => ({parts:[
 {item,mount:'e0',orient:'out'},
 {item:item==='slipper'?'pot':'slipper',mount:'e180',orient:'hug'}
]});
const replay=await simulateV3({fighters:[fighter('broom'),fighter('pot')],mode:'A',seed:1});
```

- 米/公斤/秒；Y上Z前；XYZ弧度；quat=[x,y,z,w]。Rapier依赖/GLB/CREDITS沿v1，品类等比尺寸不再缩放。新入口和规则不覆盖v1。
- `parts`开局正常两件，允许一件/零件用于裸核测试；挂点是赤道上 45° 一格的方向（`rules.top.slots`），挂点和物品id都不重复。`out` 时朝外的是哪一头由 `rules.top.outEnd[item]`（±1）定；件的内侧端埋进核心 `rules.top.embed`。`mountTransform(item,mount,orient,rules)` 给出件在球核坐标里的偏移和朝向，`mountExtents` 给出画拖影用的角度、半径、高度范围。读取真实回放世界坐标画。
- 陀螺：核心绕自身朝上的轴自转（`rules.top.spinRate`，限扭矩 `spinTorque` 维持，`uprightTau/uprightRate` 自扶正），被中心吸、在转动平面上收拢（`planeAttraction/planeDamping`），追击时压掉横向速度（`tangentialDamping`）不让绕圈空转。前端可从 `angularVelocity·up` 读出转速画拖影。
- `meta.schemaVersion=3`, `initial`为初始完整fighter状态及输入definition，`rules.core.radius`画球核，`arenaRadius`仅显示场地，无圈伤/圈外判负。无地面、底盘、zoneRadius。
- `frames[] {t,fighters:[...]}` 30FPS，最后精确终局。
- 每个fighter：`pos/quat`是球核中心变换；`hp/maxHp`是核血别名；`core {id:'core',item:null,mount:'core',pos,quat,hp,maxHp,alive}`；`parts[] {id:'part-0'|'part-1', item, mount, pos,quat,hp,maxHp,alive}`。core/parts位置全部世界坐标，**不再乘fighter变换**。`velocity/angularVelocity`为质心线速度/角速度，`mass/centerOfMass`供调试。
- parts顺序与id全局不变，掉件仍在列表，`alive=false,hp=0`；其pos/quat冻结为破碎一刻，前端应隐藏原件、用break事件播碎片，不能把它继续连在球核。core归零时alive=false。
- `events hit/weak`只来自真实Collider接触：`attacker/target`为战士索引，`part/targetPart`为核或件id，`item/targetItem`中核写`__core`（不在模型表），`point`世界目标表面点，`damage, hpAfter, tier(0..3), score, rawDamage,damageCap,role`；`weak=true`才真暴击。普通30%、真暴击40%是**挨打部件自己的maxHp**，不串伤。`caption`为短句，审查数据不放玩家界面。
- 同一次碰撞双向伤害用相同t，只选实际冲量最大的部件对；按t去重，`hit+weak`数撞击。`contact`另记接触开始（有实际冲量），不扣血；`recoil`是原有分离脉冲证据，不算额外伤害。
- `hit/weak` 另有 `orient/targetOrient`（伸出/贴着/core）、`closingSpeed`（接触点沿法线的相对速度，含预判接触那一步）、`ramp`（前松后紧倍率）。`contact` 另有 `closingSpeed`、`orients`。
- `break {t,target,targetPart,item,mount,orient,pose:{pos,quat},velocity,angularVelocity,massBefore,massAfter,...}`。`velocity`是破碎件中心点速度；碎片是纯前端效果，不要加入战斗物理。移除件后主体线速度已按新COM修正，不要额外推一把。
- 只有核归零结束：`reason='ko'|'double-ko'|'timeout'`, `winner=0|1|null`；到60秒核都在就是timeout平局，不按剩血判胜。同一步两颗核都碎（`double-ko`）：碎核那一下超出所需的伤害少的一方赢，完全相等为平局（`winner=null`），不按左右；`ko` 事件带 `targets`（碎了的各方）、`overkill`（两边各自超出的伤害）。`why` 一律从判定出的输家来，平局没有 `why`。核心可在挂件尚存时被实际接触打碎；件全掉不是失败。`decisive {t0,t1,eventIndex,finishType,caption,why}`沿回放时间播放；`why {attacker,attackerPart,attackerItem(核为null),attackerOrient,target,targetPart,targetItem,targetOrient,weak,loserBroken:[{item,orient,t}],loserPartsLeft}` 供前端写一句白话原因（见 web/src/reason.js）。
- `meta.rules`是这一局参数快照；A/B共用开局RNG；弱点独立种子流。完整输出可JSON序列化，同一输入/参数完全复现；sim/v3.js 只用加减乘除和 Math.sqrt（Chrome 156 与 Node 的 Math.exp/pow 末位会不同），Chrome 与 Node 逐字节一致（`test/v3-top/cross-engine.mjs`）。

持续接触达到0.1秒的段另报`meta.diagnostics.scrapeEpisodes/scrapeCount/scrapeDuration/maxScrapeDuration`，持续段中的重复冲量不重复计有效撞击；有力度的初次接近仍是一撞。

三个可直接播放的完整回放见 `samples/index.json`、`samples/ordinary.json`、`samples/breaks.json`、`samples/weak.json`；每份都有完整输入及参数快照。重新生成：`nice -n 20 node test/v3/samples.mjs`。旧版/新版同种子对照另存 `replays/`，目前尚未收齐。

## 手动模式（冲 / 挡，10-27 晚）

- 入口：`simulateV3({fighters,mode,seed,manual})` 整局算完；`createV3Match({...同上})` 一步一步走（网页实时打用它）：`m.advance()` 走一个物理步（1/120 秒），`m.press(side,'dash'|'block')` 排队、下一步开头生效（冷却中按了不算、不记），`m.control(side)` 给按钮状态（`dashIn/blockIn` 还要几秒、`charging/dashing/shield`），`m.done` 后 `m.result()` 就是和 `simulateV3` 一样的回放。
- `manual={sides:[a,b],inputs}`：每边 `'input'`（玩家按键，或回放时按 `inputs=[{step,side,action}]` 在第 step 步开头按）或 `'ai'`（电脑：每 0.1 秒看一次，对面在蓄力/冲时有一定概率挡，距离合适时有一定概率冲；独立种子流，同种子结果固定）。回放 `meta.manual={sides,inputs}` 记下玩家实际生效的按键；拿它重算逐字节一致（`sim.test.mjs`、`cross-engine.mjs` 都覆盖）。不传 `manual` 时上面这些一概不跑，`meta.rules` 也不带 `manual` 段，自动版回放和加手动模式之前逐字节相同。
- 参数在 `v3-rules.json` 的 `manual`：冲＝蓄力 0.3 秒（刹住、不追）→ 以 5 m/s 扑向对方核心 0.45 秒（不受中心吸、速度上限 5.5）→ 冷却 4.5 秒；扑中的那一下算冲的一方出手（哪件碰到哪件仍由物理定），伤害 ×1.25（在单击封顶之后乘，单击最多 37.5%、弱点最多 50%）、对方击退 ×1.6，不受伤害和反冲冷却限制。挡＝护盾 1 秒，期间受到的伤害 ×0.3、击退 ×0.3，冷却 5 秒；冲撞上护盾＝被弹开（冲的一方击退 ×2.6）。
- 事件：`press {side,action,source}`；`dash {side,phase:'charge'|'go'|'end',until?,dir?,outcome?:'hit'|'blocked'|'miss',point?}`；`block {side,until}`；`parry {attacker,target,point}`（冲被挡住）；`hit/weak` 另有 `dash`（冲的这一下）、`shield`（目标举着盾）、`parry`；`recoil` 另有 `recoilScale:[左,右]`。`decisive.why` 另有 `dash`（决定胜负那一下是不是冲出来的）。
