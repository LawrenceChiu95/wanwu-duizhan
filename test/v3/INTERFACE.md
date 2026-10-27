# v3 前端接入（显式 schemaVersion=3）

```js
import {simulateV3, loadCatalog, loadV3Rules, ANCHORS} from '../../sim/v3.js';
const fighter = item => ({parts:[
 {item,mount:'front',rot:[0,0,0]},
 {item:item==='slipper'?'pot':'slipper',mount:'back',rot:[0,0,0]}
]});
const replay=await simulateV3({fighters:[fighter('broom'),fighter('pot')],mode:'A',seed:1});
```

- 米/公斤/秒；Y上Z前；XYZ弧度；quat=[x,y,z,w]。Rapier依赖/GLB/CREDITS沿v1，品类等比尺寸不再缩放。新入口和规则不覆盖v1。
- `parts`开局正常两件，允许一件/零件用于裸核测试；六固定锚点为front/back/left/right/top/bottom，挂位和物品id都不重复（本轮不做重复件）。锚点是方向，偏移由旋转后凸包内侧支撑面算出贴核外，不能拿旧front/top/side坐标。读取真实回放世界坐标画。
- `meta.schemaVersion=3`, `initial`为初始完整fighter状态及输入definition，`rules.core.radius`画球核，`arenaRadius`仅显示场地，无圈伤/圈外判负。无地面、底盘、zoneRadius。
- `frames[] {t,fighters:[...]}` 30FPS，最后精确终局。
- 每个fighter：`pos/quat`是球核中心变换；`hp/maxHp`是核血别名；`core {id:'core',item:null,mount:'core',pos,quat,hp,maxHp,alive}`；`parts[] {id:'part-0'|'part-1', item, mount, pos,quat,hp,maxHp,alive}`。core/parts位置全部世界坐标，**不再乘fighter变换**。`velocity/angularVelocity`为质心线速度/角速度，`mass/centerOfMass`供调试。
- parts顺序与id全局不变，掉件仍在列表，`alive=false,hp=0`；其pos/quat冻结为破碎一刻，前端应隐藏原件、用break事件播碎片，不能把它继续连在球核。core归零时alive=false。
- `events hit/weak`只来自真实Collider接触：`attacker/target`为战士索引，`part/targetPart`为核或件id，`item/targetItem`中核写`__core`（不在模型表），`point`世界目标表面点，`damage, hpAfter, tier(0..3), score, rawDamage,damageCap,role`；`weak=true`才真暴击。普通30%、真暴击40%是**挨打部件自己的maxHp**，不串伤。`caption`为短句，审查数据不放玩家界面。
- 同一次碰撞双向伤害用相同t，只选实际冲量最大的部件对；按t去重，`hit+weak`数撞击。`contact`另记接触开始（有实际冲量），不扣血；`recoil`是原有分离脉冲证据，不算额外伤害。
- `break {t,target,targetPart,item,mount,pose:{pos,quat},velocity,angularVelocity,massBefore,massAfter,...}`。`velocity`是破碎件中心点速度；碎片是纯前端效果，不要加入战斗物理。移除件后主体线速度已按新COM修正，不要额外推一把。
- 只有核归零结束：`reason='ko'|'double-ko'|'timeout'`, `winner=0|1|null`；到60秒核都在就是timeout平局，不按剩血判胜。核心可在挂件尚存时被实际接触打碎；件全掉不是失败。`decisive {t0,t1,eventIndex,finishType,caption}`沿回放时间播放。
- `meta.rules`是这一局参数快照；A/B共用开局RNG；弱点独立种子流。完整输出可JSON序列化，同一运行时输入/参数固定完全复现。

持续接触达到0.1秒的段另报`meta.diagnostics.scrapeEpisodes/scrapeCount/scrapeDuration/maxScrapeDuration`，持续段中的重复冲量不重复计有效撞击；有力度的初次接近仍是一撞。

三个可直接播放的完整回放见 `samples/index.json`、`samples/ordinary.json`、`samples/breaks.json`、`samples/weak.json`；每份都有完整输入及参数快照。重新生成：`nice -n 20 node test/v3/samples.mjs`。旧版/新版同种子对照另存 `replays/`，目前尚未收齐。
