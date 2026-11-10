# 远夏 · 独立厨房预览交接

日期：2026-10-31。用户已认可当前效果，要求保存独立版本并准备对齐；本说明不代表已合并或已通知对方。

## 版本关系

- 今天已上传的资产：[assets/approved-wired-v9-20261031](https://github.com/LawrenceChiu95/wanwu-duizhan/tree/assets/approved-wired-v9-20261031/docs/art/approved-wired-v9)，提交`0b10f9bf412254a444346ef48a822387804c4b01`。含通用提示词、刀锅改图输入、原始GLB、游戏GLB与哈希。
- 本次保存：本地分支`preview/kitchen-terminal-20261031`，以以上提交为基础。新增部分尚未推送GitHub；请用交接ZIP查看完整源码，用同目录PATCH看本轮差异。
- 更早的API接入包：[sol/aholo-item-cli/tools/import-item/README.md](https://github.com/LawrenceChiu95/wanwu-duizhan/blob/sol/aholo-item-cli/tools/import-item/README.md)。本次未重做照片生成流水线。
- 资产分支的父提交为`2090910`，并非当前main的整合版本。不要用本包整目录覆盖远夏当前开发目录；先在独立目录验收，再讨论移植范围和冲突。

## 当前实际效果

1. 厨房：默认使用图2的局部画面作为世界空间图片平面，随真实镜头推拉。是2.5D，不是完整房间网格，没有家具真实深度或碰撞。
2. 镜头：初始近景；双方靠近/碰撞推近，分离拉远。距离、相对速度与真实碰撞事件驱动，临界阻尼平滑跟随。已删除固定周期缩放，不保证时间上强行50/50。
3. 显示：整台显示倍率1.2705；核心局部倍率0.7；装备模型局部倍率1.5。是视觉调节，碰撞体、伤害和血量规则未变，整合时需关注视觉轮廓与碰撞体的差异。
4. 打击：普通/重击/冲刺粒子与冲击环加强，短促闪光；碰撞声音改为更干脆的起音、金属泛音和短爆裂，保留原静音与限幅。
5. UI：按第二张“底层赛博终端”方向，使用真实金属外框、灰白按键、暗黄开打键；覆盖组装、HUD、冲挡、选物和结算。所有文字、血条、按钮仍为实际HTML状态。
6. 物品卡：从当前选中的已入库用户GLB渲染缩略图，复用主WebGLRenderer；换物后名称、规格、缩略图、上场模型同步。不是固定占位图。本包未新增用户上传入口。
7. 3DGS：保留`background=3d`对照模式与Aholo SPZ，但存在模糊/不可靠遮挡，不作为默认或最终验收效果。

## 独立运行

建议Node 22。完整ZIP解压到新目录，在根目录执行：

```powershell
npm ci --prefix sim
npm ci --prefix web
npm run dev --prefix web
```

打开：http://127.0.0.1:4335/?mine=knife-wired-v9,out,pot-wired-v9,out,e180&cam=new 。这只是本机地址，不能直接发给其他人远程访问。

默认离线资产对战不需要Aholo密钥，不会提交生成任务。端口4335/4336仅用于独立预览。新增依赖仅`@sparkjsdev/spark@2.4.0`，用于保留的3DGS对照；默认图片模式不下载SPZ。不要把任何密钥放进前端或交接包。

## 改动位置

| 内容 | 文件 |
|---|---|
| 厨房、镜头、碰撞反馈接入 | `web/src/kitchen.js`、`photo-kitchen.js`、`stage.js`、`main.js` |
| UI与缩略图 | `web/index.html`、`web/src/terminal.css`、`style.css`、`models.js` |
| 音效 | `web/src/sfx.js` |
| 本地素材 | `data/scenes/kitchen/`、`web/src/assets/terminal/` |
| 依赖与端口 | `web/package.json`及lock |
| 当前验收 | `web/scripts/terminal-ui-acceptance.py` |

`KITCHEN-PREVIEW.md`包含详细调试历史；其中旧缩放比例/旧界面描述已被后续版本替代，当前以本文件为准。其余kitchen测试脚本是早期实验，不能用来宣称当前版本通过全部镜头验收。

## 已做验证与限制

- `npm run build --prefix web`、`git diff --check`通过。未修改`sim/`物理代码。
- 浏览器320/390/1280宽布局、换装、阵型/朝向切换、冲挡、静音、完整一局、结算返回通过，无页面错误。
- 真实切换枕头再恢复刀：缩略图变化，卡片与战斗部件itemId一致。当前刀锅路径见[evidence/ui-receipt.json](docs/handoff/kitchen-terminal-20261031/evidence/ui-receipt.json)。
- 静态近/远/再靠近镜头测试，确认不会自行周期往返；音效实际离线渲染非零、有限、无削波，结束释放声部。
- 完整对战自动验收使用6倍模拟速度；不能据此宣称普通实时性能或手机性能合格。真实手机帧率、显存、材质下载与新物品端到端上传尚待验收。
- 截图与回执在[证据目录](docs/handoff/kitchen-terminal-20261031/evidence/)。原4330工作目录与服务没有被本分支覆盖。

## 需要远夏对齐

1. 确认接收端基线，先在独立目录查看，不自动合main。
2. 确认2.5D背景与战况镜头、核心/装备比例是否沿用；视觉比例大于碰撞体，需要共同判断。
3. 确认旧终端UI素材、缩略图、音效与原玩法接口的移植方式；图片较大，正式发布前可另做资源优化。
4. 确认普通速度/真机表现和新物品从上传到入库的流程，完成后再定合并范围。

回退：本轮只在独立分支；不采用即可保留共同版本。若远夏自行移植，请先在自己的独立分支提交，再按自己的提交回退，不运行hard reset或覆盖他人工作。
