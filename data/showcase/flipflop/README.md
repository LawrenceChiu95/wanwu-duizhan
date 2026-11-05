# 拍一件示例：人字拖

评委版（task #4）在开场卡和角色库「拍一件示例」里重放的那一次真实生成：Sol 在 task 26 真跑的 j_a3187a76（11-04），用一张公开的真照片走完认物、改图、建模这三步。它不在 catalog 里，也不能装上去打。

- `model.glb`：后台处理后的游戏件，原样拷贝（sha256 4e50ae78219421d96b2afe2bb00e24ce2361bb008a556d35d95cc80ac64fba0d，和 item.json 里的 source.normalizedSha256 一致）。
- `photo.webp`、`styled.webp`：这次的原照和改图，从后台产物缩到 1000 宽再转成 WebP。
- `still.webp`：开场卡上的 3D 图，用 `web/scripts/make-showcase-still.mjs` 出（卡片机位，从正面再转 0.7 弧度）。
- `item.json`：后台产物 final-item.json，只改了三处：id、文件路径、`origin.steps`。用时改成 Sol 378c66c6 的分步数，分别是认物 15 秒、改图 45 秒、建模和导入 96 秒，原记录里的 252 秒含约 155 秒人工停手核账。
- 原照：[Flip-flops / Michal Osmenda](https://commons.wikimedia.org/wiki/File:Flip-flops_(3409558121).jpg)，[CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/)。已裁切、改图并建模，署名在评委版的这一屏和「素材署名」里。
