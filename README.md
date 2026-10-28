# 万物对战

本地启动、分工和协作流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 版本档案

每一版是什么、比上一版改了什么、远夏当时说过什么。最新在最上面。能玩的链接点开就能玩，不用登录（2026-10-28 用没登录过的浏览器逐个核过）。

代码链接在私有仓库里，要登录才能打开——用我们邀请过的那个 GitHub 账号（Chaezin）登录后再点。

> 说明：版本号只标我们对外交付过的页面。中间有一些只在内部验过的版本，没有单独交给他，并进了下一版那一行。

| 日期 | 这版是什么 | 比上一版改了什么 | 远夏当时的评价（原话） | 看代码 | 能玩 |
|---|---|---|---|---|---|
| 10-28 | **第 12 版**：开关放三个——俯视、慢三成、原速；慢三成除了擂台自转，把镜头跟着跑、拉近拉远也一起放慢 | 俯视方案没去掉，回到开关里，三个镜头并排；慢三成的镜头跟着跑和推拉也一起放慢；来回切镜头不会再在撞击后多抖一次。这版是照远夏 22:24 的原话做的：「我没有说俯视的方案要去掉呀 你理解错了 下一版放三个方案 俯视 晃动慢三成 晃动原速 蛮三成的那版 把跟着跑和拉近拉远也放慢」。中间内部审过一版第 11 版，修了切镜头多抖一下，没单独交给他。物理没动，这版只改镜头 | 还没说 | [demo-v12](https://github.com/LawrenceChiu95/wanwu-duizhan/tree/demo-v12) | [打开这一版](https://raft-artifacts.com/p/lawrence-workspace/wanwu-top-demo/v/12) |
| 10-28 | **第 10 版**：昨天的镜头转慢三成，只留手动，物理不动 | 镜头只剩「慢三成」「原速」两个开关；橙色光环从发光的大圈收成贴着核心的一圈细线，半透明、不发光；开打直接进手动，装配页还在 | 还没说 | [demo-v10](https://github.com/LawrenceChiu95/wanwu-duizhan/tree/demo-v10) | [打开这一版](https://raft-artifacts.com/p/lawrence-workspace/wanwu-top-demo/v/10) |
| 10-28 | **第 9 版**：镜头拉近框住两个球，慢慢跟、不转；你的球脚下橙色光环、头顶「你」箭头；冲和挡加了顿帧、火花和声音 | 陀螺放大到约 1.6 倍；镜头改成盯着两个球的中线慢慢跟，不甩也不转；自己那颗加了常亮标记，一开打就认得出；冲撞和挡下的顿帧、火花、音效补齐；另带一个开关能切回第 4 版那个镜头对照（这一版之后的小修复也并在这里） | 还没说 | [demo-v9](https://github.com/LawrenceChiu95/wanwu-duizhan/tree/demo-v9) | [打开这一版](https://raft-artifacts.com/p/lawrence-workspace/wanwu-top-demo/v/9) |
| 10-28 | **第 8 版**：冷却看得出还剩多少；撞击标注放大、抬到陀螺上方 | 按钮本色用 4.9 秒从左往右填满，冷却中点按会抖一下、不算按键；标注字从 19 加粗到 23 像素。中间两版（加「冲」「挡」按钮、把「挡住」改标「弹开」）只内部验过，并进这一行 | 「不知道是不是视角问题，这一版感觉不是很爽，而且我经常会找不到我的球在哪，微操的反馈不强」 | [demo-v8](https://github.com/LawrenceChiu95/wanwu-duizhan/tree/demo-v8) | [打开这一版](https://raft-artifacts.com/p/lawrence-workspace/wanwu-top-demo/v/8) |
| 10-28 | **第 5 版**：镜头焊死——开打后不跟、不转，只在碎件时轻轻震一下 | 针对「好晕」改的：镜头不再追着球跑。代价是画面退到看全场，陀螺跟着变小 | 还没说 | [demo-v5](https://github.com/LawrenceChiu95/wanwu-duizhan/tree/demo-v5) | [打开这一版](https://raft-artifacts.com/p/lawrence-workspace/wanwu-top-demo/v/5) |
| 10-27 | **第 4 版**：镜头追着两个球跑，结算时俯视赢家；第一个能自己开打的版本——挑两件、选装法、点开打，掉件、核碎即负 | 核心球装两件、自己转、伸出或贴着；刮蹭不重复扣、单下伤害有上限 | 「啊，这个版本好晕，我直接晕了。。」<br><br>「我现在觉得昨天那个视角是爽的」 | [demo-v4](https://github.com/LawrenceChiu95/wanwu-duizhan/tree/demo-v4) | [打开这一版](https://raft-artifacts.com/p/lawrence-workspace/wanwu-top-demo/v/4) |
| 10-27 | **外形小样**：三种黏法的外形对比（锅、台灯那些道具黏在球上的样子）——不是完整游戏，只摆样子看外形 | — | 「能不能直接做成可玩的 demo 呢？跟昨天那个一样」 | — | 需要登录（这一页现在只对 Raft 内部开放） |
| 10-27 | **给凡朔的样机页**：上面是我们对方案的七条意见，下面一个按钮点开就能玩样机 | 从「只有图和数据」变成一页能转给凡朔的、带可玩样机的页面 | 「我还想补充一点：我们昨天测了一波，生成速度其实并不快，游戏的形式只能说是在角色库里生成添加，等到好了才可以派出战」 | [demo-fanshuo](https://github.com/LawrenceChiu95/wanwu-duizhan/tree/demo-fanshuo) | [打开这一版](https://raft-artifacts.com/p/lawrence-workspace/wanwu-for-fanshuo) |
| 10-27 | **最早的擂台样机**：两件道具各打各的，在球形擂台里对撞——还没有核心球 | —（那时是另一套物理：每边一件直接撞，有圈外掉血、攻守判定、暴击） | 「但这个 demo 呢，我的感觉又不够好玩<br>碰撞那一下感觉还可以<br>但垃圾时间太多了」 | [demo-sphere-first](https://github.com/LawrenceChiu95/wanwu-duizhan/tree/demo-sphere-first) | 当时的可玩页面是本机地址，没留成页面；那阶段的模拟与数据报告现在只对 Raft 内部开放（需要登录） |
