# 首页示范件：奶锅

评委版首页（judge-intro.html、potview.js）上能转的那口锅，也是假后台「锅」一类的改图。

- `photo.webp`：凡朔 11-07 界面预览里的原照，没换（Elara 615e1aa1）。
- `model.glb`、`styled.webp`：11-18 Sol 用已批的新提示词拿同一张原照重做的「奶锅」（敞口、无盖，Elara 57985b8b），替换掉旧提示词那版不锈钢汤锅。GLB 是后台处理后的原件（sha256 b92a301381f9be2f687c94df4277d0cbd2e634358b385241f944be08a1c7e395），11,974 面；改图从 1024 缩到 640 转 WebP。
- `fight.webp`：首页「上场对撞」那格（远夏 49c5d19e、Elara 52077e70）。把上面这份 `model.glb` 用 `tools/import-item/cli.mjs glb --category pot` 导成件，在隔离副本里装到 1P 伸出位（另一位是鼠标贴着），对莽牛实打一局，开局约 4 秒贴上对手时 390 宽三倍图截下，裁 540×540 转 WebP。导成的件没进角色库。
