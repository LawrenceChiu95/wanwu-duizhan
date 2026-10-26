# 生成回执

两个模型都是 2026-10-26 在 Aholo Lux3D 网页端（`https://www.aholo3d.cn/lux3d/editor`）用
单张照片生成的。账号：光栅中的发明者（夏 档案里的 Ego 浏览器）。

| | 铸铁煎锅 | 艺术台灯 |
| --- | --- | --- |
| 生成任务编号 | `lux3d_g1_26997` | `lux3d_g1_27029` |
| 开始时间（UTC） | 2026-10-26T13:55Z 前后 | 2026-10-26T14:22:18Z |
| 用时 | 约 258 秒 | 329 秒 |
| 设置 | 标准版 · 网格模型 · 300K 面 · 开 PBR | 同左 |
| 源图 | `imgs/pan-2.jpg`（Openverse，`Frying pan` by kevin dooley，CC-BY） | `imgs/lamp-5.jpg`（Openverse，`Art Deco Mica Table Lamp` by Artdecodude，CC-BY） |
| 原始导出 | `models/pan/lux3d_g1_26997.glb`，20,108,228 字节<br>sha256 `0bb96cdac5351e4c7b0825f9e72e30ac94b43dbbd0201641f5ac9075cb7adf6c` | `models/lamp/lux3d_g1_27029.glb`，17,186,888 字节<br>sha256 `da321870bfa4f00fad1aa6d43ab017da811646d00605f35459ac9087f5b651e9` |
| 原始顶点 / 三角面 | 224,493 / 约 29.5 万 | 211,683 / 约 29.1 万 |

原始导出和高模版只在根节点上差一个变换矩阵（居中 + 缩放到米），网格和贴图完全没动。

## 原始文件在哪

太大没进仓库，在本机 Wren 的工作区：

```
/Users/lawrence/.slock/agents/7786aa12-7844-4bb6-aa41-2c30762a0aa5/work/hackathon-1026/models/pan/lux3d_g1_26997.glb
/Users/lawrence/.slock/agents/7786aa12-7844-4bb6-aa41-2c30762a0aa5/work/hackathon-1026/models/lamp/lux3d_g1_27029.glb
```

Sol 需要的话在同一台机器上直接读；要进仓库再说一声，两个加起来 37 MB。

## 生成时的截图

`work/hackathon-1026/shots/pan-model.png`、`lamp-model.png`，是生成完在 Lux3D 预览里的样子。
