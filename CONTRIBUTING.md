# 凡朔上手说明

这是当前能玩的战斗陀螺样机：核心球挂两件东西，真实碰撞、部件掉落，支持自动对战和手动「冲 / 挡」。

## 谁改哪里

- **凡朔：画面**。场地、核心外形、材质、灯光、镜头、特效和 UI，主要在 `web/`。视觉模型可以换，碰撞粗外形、尺寸、挂位和扣血规则不要跟着改。
- **我们：规则与工具**。Sol 负责 `sim/` 的物理与判胜、Lux3D 模型处理和测试；Elara 定方向、验画面。素材来源记在 [data/CREDITS.md](data/CREDITS.md)。需要改变碰撞或规则，先和 Elara、Sol 对齐。

## 本地开起来

装 Node.js 22，在仓库根目录运行：

```sh
npm ci --prefix sim
npm ci --prefix web
npm --prefix web run dev
```

打开 <http://127.0.0.1:4330/>，可选装法、自动 / 手动对战。手动按「冲 / 挡」；冷却没好时按了不会发动。端口被占用会直接报错，先关自己的旧服务。

## 画面读什么

当前规格见 [v3-top](test/v3-top/SPEC.md) 和 [v3](test/v3/SPEC.md)。接口真源是 [sim/v3.js](sim/v3.js)，完整字段见 [test/v3/INTERFACE.md](test/v3/INTERFACE.md)。`frames` 的 `pos/quat` 已是世界坐标；米 / 秒，Y 向上。按回放时间画，不用动画时间改物理。每个事件都有 `type, t`：

| 事件 | 画面用的字段 |
|---|---|
| `contact` 接触开始 | `point, rightPoint, normal, closingSpeed, parts, items, attacker` |
| `hit / weak` 扣血 / 暴击 | `attacker, target, part, targetPart, point, damage, hpAfter, role`；手动另有 `dash, shield, parry` |
| `break` 掉件 | `target, targetPart, item, pose:{pos,quat}, velocity, angularVelocity` |
| `recoil` 弹开 | `normal, velocityBefore, velocityAfter`，不是另一次扣血 |
| `press / dash / block / parry` 冲挡 | `press:{side,action,source}`；`dash:{side,phase,until?,dir?,outcome?,point?}`；`block:{side,until}`；`parry:{attacker,target,point}` |
| `ko` 终局 | `targets, winner, overkill`；最终胜负读 `meta.winner/reason`，原因读 `decisive.why` |

同一碰撞的攻方与反震伤害同 `t`，靠 `role` 区分，别播成两次撞击。掉件后原件隐藏，碎片只做视觉效果，别再参与碰撞。手动输入用 `createV3Match().press()` 排到下一固定步，别直接改血或速度。

## 提交与验收

从 `main` 开分支 → 提 PR → Node tests 通过 → Sol 审代码、Elara 验画面 → 合并。CI 只跑 Node，不跑浏览器；本地同一命令：

```sh
node --test --test-concurrency=1 test/prototype/sim.test.mjs test/v3/sim.test.mjs
```

**镜头硬线**：Wren 实测平均移动 ≤40 px/秒、最差一秒 ≤150 px、上下反向 ≤5%，单帧移动 >30 px 的累计时长 ≤0.3 秒；全程看得见场地四角和双方陀螺。改了镜头的合并请求，由 Elara 叫 Wren 实测，过了才合；手机和电脑画面都要看。
