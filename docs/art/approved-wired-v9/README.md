# 已认可的生活物品改造方案：刀与锅

状态：2026-10-31 用户认可当前游戏内效果，要求保存提示词与两件模型。此分支仅保存资产，没有发起交接、PR 或合并。基础版本是 `sol/aholo-item-cli` 的 `2090910`，不是当前 main 的整合版本。

## 内容

- [prompt.txt](prompt.txt)：用户提供并用于两件物品的同一份通用提示词原文，不增加品类专用描述。
- [刀参考图](reference-images/knife.png)、[锅参考图](reference-images/pot.png)：Aholo 改图后的建模输入；原始私人照片不在本包中。
- [刀原始 GLB](source-models/knife.glb)、[锅原始 GLB](source-models/pot.glb)：G1-Turbo 原始下载结果，用于查看高细节及后续处理。
- [刀游戏版](../../../data/models/generated/knife-wired-v9.glb)、[锅游戏版](../../../data/models/generated/pot-wired-v9.glb)：经现有离线导入器规范化、减面和缩纹理后的资产。
- `data/catalog.json` 只新增 `knife-wired-v9` 与 `pot-wired-v9`；保留原有条目。
- [SHA256SUMS.txt](SHA256SUMS.txt)：提示词、参考图和四个模型的 SHA-256。

## 已验证流程

原始照片 → Aholo `multimodal-to-image` 改图 → 用户确认图片 → Aholo `img-to-3d` 建模 → 现有离线导入器处理 → 游戏内对战。

建模参数：`version=G1-Turbo`、`faceCount=100000`、`enablePbr=true`、`outputFormat=[zip, glb]`、`aiPredictSize=false`。不将平台网页“极速版”与 API 名称的对应关系作为本次验证结论。

| 项目 | 刀 | 锅 |
|---|---:|---:|
| 提交建模至成功观察 | 59.07 秒 | 52.81 秒 |
| 原始 GLB 字节数 | 15,205,148 | 13,772,312 |
| 游戏 GLB 字节数 | 1,771,804 | 1,756,824 |
| 游戏三角面数 | 11,960 | 14,890 |
| 纹理最长边 | 512 px | 512 px |
| 类别模板 | scissors | pot |
| 游戏最长边 | 0.20 m | 0.38 m |

上述建模时间不包含图片改造、图片上传和结果下载；包含轮询观察误差，不代表所有物品的固定耗时。尺寸与物理参数沿用品类模板，不是从原照片测量的真实尺寸。

本地已完成：离线导入、网页构建、390px 浏览器两模型同时加载、冲刺操作及一整局对战，无页面错误或模型加载失败。没有验证真实手机帧率，也没有单独验证青蓝灯的独立发光材质；图片中的细节可能在3D重建和压缩时变化。

本分支是在已验证目录之外整理的发布副本；发布副本额外核对两条catalog记录、模型字节一致性、GLB容器、文件哈希与相对链接，不宣称重新运行过一轮完整浏览器测试。

## 使用范围

来源为用户提供的物品照片，经 Aholo 生成。生成资产沿用项目的 `LicenseRef-UserProvided` 标记；本包没有另行授予照片或生成模型的公共许可证。没有 Key、Cookie、原始私人照片、签名下载 URL 或运行状态文件。

游戏页的查询参数可使用 `?mine=knife-wired-v9,out,pot-wired-v9,hug,e180` 同时选择两件资产。此处只保存这版提示词，没有替换现有照片入口或六个品类的默认提示词，也没有加入背景场景。
