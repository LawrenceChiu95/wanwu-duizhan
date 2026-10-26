# 模拟接口（schemaVersion 1）

`cd sim && npm ci`。只需固定的 `@dimforge/rapier3d-compat@0.21.0`，无运行时 CDN。Vite/打包器可从 `../sim/index.js` 导入。

```js
import {loadCatalog, simulate} from '../sim/index.js';
const items = await loadCatalog();
const core = item => ({parts:[{item,mount:'core',rot:[0,0,0]}]});
const replay = await simulate({fighters:[core('broom'),core('pot')],mode:'A',seed:1});
```

- 两个函数都是 async。首次初始化 WASM；随后调用复用初始化，**每局独立 World/RNG**，结束释放 World。
- 米、公斤、秒；Y 向上、Z 向前。`rot` 是 XYZ 弧度；四元数数组 `[x,y,z,w]`。
- GLB **已经居中并归一到米**，`scale=1`，不要再按包围盒统一大小。`glb` 是相对仓库根的地址；弱点和 hull 在该 GLB 局部坐标系。
- `winner` 是 `0` / `1`，平局 `null`。`reason` 是 ko / ringout / double-ko / timeout。10-26 Elara 裁决：60 秒 timeout 按剩血百分比高者判胜，恰好相同才平局；战报明确写到时判胜。
- `frames[].fighters[].parts[]` 的 pos/quat 是**世界坐标**，可直接给模型，不能再乘父 fighter 的变换。部件顺序与输入一致，另带 item/mount；fighter 的 pos/quat 给底座。hp 已截到 0，maxHp 另带。
- 30 FPS；若终局在奇数物理帧，最后补一帧精确终局，末尾可间隔 1/60 秒。
- `events` 有实际接触、伤害、世界接触点、attacker/target 索引。zone 的 attacker=null、item=null；KO/ringout damage=0。weak 表示接触点在弱点球内，multiplier=2；crit 表示单击 ≥20，都是实际扣血，没有随机特效暴击。弱点翻倍作用于原始伤害，最终仍受单击上限约束；caption明确说限幅，不能把已限幅的实际扣血说成翻倍。
- `decisive` 给最长 2.5 秒片段、caption、eventIndex。`finishType=contact|zone|ringout|timeout`，`finishEventIndex` 是使血量第一次归零的真实伤害事件（不拿延后汇总的圈伤冒充致死一击）。圈杀时慢放最大接触、caption 明说最后在圈外掉血输；到时判胜展示末尾。少于2.5秒的短局只能给整局片段。
- `meta.initial[]` 给质量、局部重心、初始变换，A/B 同 seed 完全相同；metadata 同时带 arenaRadius、engine、diagnostics。
- 目录只给 item 表；`loadRules()` 另给完整 catalog（前端可选，用来画场地/底座，不改值）。

## 拼装

单件只允许一个 core；拼装刚好 front/top/side 三个挂件，不能重复挂点。部件可重复选择。底座尺寸和挂点位置见 catalog.arena。每个挂件是独立凸包 Collider，和小底座共用一个 RigidBody；Rapier 累加真实体积质量和惯量，重心不手工固定在底座。每件弱点随各自 Collider 变换。

```js
const fighter={parts:[
 {item:'broom',mount:'front',rot:[0,0,0]},
 {item:'pot',mount:'top',rot:[0,Math.PI/2,0]},
 {item:'pillow',mount:'side',rot:[Math.PI/2,0,0]}
]};
```

## 参数与限制

A：`impulse × arena.impulseToDamage × sqrt(attacker.hardness / target.hardness)`；B：`max(0, attack × matchup − defense) × arena.statDamageScale`；弱点 ×2。B另乘同样的硬度比平方根（裁决10）。两者再乘攻方远端加成，弱点乘2后限幅；攻方收到的反震在限幅后另乘统一recoilDamageFraction。接触按回合计伤害，同一次整个刚体只取一个部件对，另有全局damageCooldown；物理反冲仍用独立contactCooldown，不按每帧连扣。事件另带 targetLocalPoint / weakDistance，用目标表面接触点判弱点。

圈伤前20秒为零，随后每秒扣总血量的比例线性增加，到60秒达 `zoneDamageMaxFraction`（当前1.4%/秒）。逐固定步扣血，0.5秒聚合事件；撞击已致死后不再补扣同一步圈伤。

游戏反冲：真实接触后，沿接触法线施加 `mass × recoilSpeed` 的相反冲量，并暂缓追击 0.6 秒；它解决持续贴碰，是明确的游戏推力，**A 的伤害取此反冲前的物理碰撞冲量**。未做空气/空腔/软体变形；锅的凸包按实心体积计算，质量夸大，CREDITS 有说明。

模型许可见 `data/CREDITS.md`（5 件 CC BY 3.0、1 件 CC0）；前端应保留可见的署名入口。

目录还包含 `pan-lux3d` / `lamp-lux3d` 两件真实生成变体，`comparisonBase` 指向原同类。接口与原六件一致，默认是带底色与金属/粗糙度贴图的手机GLB（1.46/1.36MB，贴图1024），不需要meshopt解码器；高模只留证。`loadCatalog()` 返回8件；基础批量仍是原6件150局，再用相同对手、左右位置、种子比较生成变体100局。

## 批量入口

`node sim/batch.js` → `test/prototype/batch/{rounds.csv,summary.json,lux3d-comparison.csv}`，另保存三组指定对局各A/B回放。网页无画面模式可导入 `sim/batch.js` 的 `runBatch({onResult})`；返回150行，不依赖 DOM。

`node sim/layouts.js broom,pot,pillow` → 162装法 × A/B × 3种子共972局，固定同一对手，输出表、汇总及 `reversal-win.json` / `reversal-loss.json`。`enumerateLayouts`、`runLayouts` 可直接从页面调用；实际模拟始终走同一个 simulate。

命令均在仓库根运行；本机重活加 `nice -n 20`。`test/prototype/tune-current.mjs` 在agent-copies.noindex临时隔离目录校准，不改共享catalog；试完把目录移废纸篓。旧的共享目录试参脚本已移废纸篓。

## 裁决10–13新增规则

- 所有战士的maxHp固定为arena.fighterHp（140），不随挂件数量或旧item.stats.hp相加。旧stats.hp仅留作原表记录，前端血条以Replay给的maxHp为准。
- 开局3秒不扣血。接触前记录两刚体的线速度、角速度及质心，以接触点速度沿法线的迎击分量判攻方；远离模型中心的接触按tipBonus加分。几乎完全同分时按seed奇偶打破，不用Math.random。
- 两个方向都产真实伤害事件，但role分别为attack、recoil；反震比例在限幅后乘，避免大质量把反震也顶到完整上限。新增strikeAttacker、normalSpeeds、attackScores、tipRatios、tipMultiplier、roleMultiplier、rawDamage、damageCap，供核因果。
- 同一步双方HP归零且双方都是该次接触致死：按这次攻方判胜，reason仍为double-ko，meta.simultaneousKo=true、resolvedByAttacker=true，caption明确判法；混合接触/圈伤或双方圈伤归零不会借用上一撞的攻方。统计分别报双归零次数与最终平局数。
- 新批量须连同旧目标核：平局及到时判胜各≤10%，双方同次归零<5%，15对至少5对有一方≥65%胜率，无一件全胜或全败；拼装最好/最差装法胜率差≥40百分点。没有通过结果前不能拿上一版回执给新规则背书。

## 碰撞精度修正

Rapier仍以60Hz求解速度与真实碰撞冲量；每步求解后用实际凸包距离做位置约束校正，包含底座与所有挂件。按对方质量占比把双方分开，保持两者整体质心；不加速度、不发伤害、不直接改判胜负；会通过轨迹改变实际碰撞与结果。最多8次约束迭代，停止目标重叠≤0.5毫米；复杂拼装可能未收敛，当前实测全物理步最大3.3毫米，见AUDIT。`diagnostics`的`maxPenetration`是求解器接触流形原值（可能滞后），另有`maxGeometricPenetration`（校正前实际距离）、`maxResidualPenetration`（校正后全物理步最大剩余重叠）、`maxPositionCorrection`、`correctionSteps`。回放取校正后的世界坐标。它是游戏物理的约束修正，不等于真实物品物理已验证。
