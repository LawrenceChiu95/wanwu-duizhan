# MVP规则验证记录：2.4m初值

本记录只说明这份初值diff已有的证据；最终进度、资源窗口和授权只认共享HANDOFF「当前：MVP规则实施」。尚无新批量结论，不是完整MVP验收。

## 已有检查

- 原36机制检查加6项MVP规则，42/42。命令：`node --test --test-concurrency=1 test/prototype/sim.test.mjs test/v3/sim.test.mjs test/v3-top/v13/timing.test.mjs test/mvp/rules.test.mjs`。
- 导入工具15/15（含实际GLB/凸包/弱点/尺寸/贴图检查），`npm test --prefix tools/import-item`。
- `npm run build --prefix web`通过；无新增依赖。
- 原V1固定轨迹保留原有八件几何单独重放当前V1引擎，当前catalog另验；V3两件先碎再KO改受控实碰夹具，原同一步双KO断言不动。原因见SPEC.md。没有更新老统计表来冒充新批量。

## 390×844页面整局

现有画面、慢三成镜头、种子37：我方锅伸出+扫把伸出，对手锅伸出+扫把贴着，均对面装。双方初始扫过直径1.856741m/1.010000m，碎件后量尺不变。

| 引擎 | 局长s | 首伤s | 我方/对手直径中位CSS px | 我方/对手每米像素中位 | Node完整JSON |
|---|---:|---:|---|---|---|
| Chrome156 | 35.350 | 0.383 | 227.5 / 123.2 | 122.5 / 122.0 | 相等 |
| Playwright WebKit | 23.867 | 0.383 | 197.5 / 105.3 | 106.4 / 104.3 | 相等 |

Chrome按键接受步107冲/141挡；WebKit55冲/132挡，实际点击时刻不同，所以不把两局时长差当引擎差异。各自均用页面实际接受输入重算Node、完整JSON SHA相等。无页面报错，完整对打后能返回拼装。WebKit只是Safari内核预检，非真机。截图均已目视核过。

对手本身直径只有我方54.4%，两者局内像素/米近似；不足150px同时包含短装法事实与镜头尺度。是否调整150口径交Elara，后端未改镜头或验收线。实体未出画；完整镜头运动验收仍待Wren。现有结果屏尚未接超时新措辞，已把why事实口子交Iris。

完整原始截图、每帧尺寸、整局JSON和日志已留共享开发归档/MVP规则实施/phone-2.4m；当前目录的原始输出不进入git。跨引擎固定输入模块工具browser.mjs与成对批量工具batch/analyze已写，等23:00窗口再跑；2.2/2.0选点、择时/镜像/节奏/强弱表和Claude独立只读审查尚未完成。

## 复测工具

所有重活用`nice -n 20`，先鲜读资源窗口。`MVP_STAGE=pilot node test/mvp/batch.mjs`依次比较2.4/2.2/2.0；analyze.mjs读取同一MVP_OUT。脚本按输入和源码SHA阻止跨版本续跑。完整方案在SPEC.md。结果产物与日志另存共享归档。
