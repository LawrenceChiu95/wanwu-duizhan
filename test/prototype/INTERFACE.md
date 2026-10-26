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
- `winner` 是 `0` / `1`，平局 `null`。`reason` 是 ko / ringout / double-ko / timeout。timeout 不按剩血硬判胜负。
- `frames[].fighters[].parts[]` 的 pos/quat 是**世界坐标**，可直接给模型，不能再乘父 fighter 的变换。部件顺序与输入一致，另带 item/mount；fighter 的 pos/quat 给底座。hp 已截到 0，maxHp 另带。
- 30 FPS；若终局在奇数物理帧，最后补一帧精确终局，末尾可间隔 1/60 秒。
- `events` 有实际接触、伤害、世界接触点、attacker/target 索引。zone 的 attacker=null、item=null；KO/ringout damage=0。weak 表示接触点在弱点球内，multiplier=2；crit 表示单击 ≥20，都是实际扣血，没有随机特效暴击。
- `decisive` 给 2.5 秒片段、caption、eventIndex。优先 KO 的最后扣血原因；否则选最大暴击（没有暴击则最大接触），**不把圈伤编成形状优势**。
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

A：`impulse × arena.impulseToDamage × sqrt(attacker.hardness / target.hardness)`；B：`max(0, attack × matchup − defense)`；弱点 ×2。接触按各部件接触回合计一次伤害，不按每帧连扣。缩圈逐固定步扣血，0.5秒聚合事件。

游戏反冲：真实接触后，在双方质心连线上施加 `mass × recoilSpeed` 的相反冲量，并暂缓追击 0.6 秒；它解决持续贴碰，是明确的游戏推力，**A 的伤害取此反冲前的物理碰撞冲量**。未做空气/空腔/软体变形；锅的凸包按实心体积计算，质量夸大，CREDITS 有说明。

模型许可见 `data/CREDITS.md`（5 件 CC BY 3.0、1 件 CC0）；前端应保留可见的署名入口。
