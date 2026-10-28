# 验证回执

- **输入冻结**：main `d08a698f7bc8c710279afc6929418bf5858448ed` 的 sim/web/data 共96个文件，批量前后逐文件SHA256相同；`git diff --exit-code d08a698 -- sim web data` 通过。无规则、物品、默认对手或网页更改。
- **批量完整**：4,800局、48格，每格种子1–100且不重复；胜/负/平计数等于100，总到时0。nice20单进程，Node v25.5.0、Rapier 0.21.0，9.99分钟。每格电脑对电脑双方都确实触发冲和挡；自动动作数为0。
- **统计口径**：4项 `node --test test/v3-top/loadout-compare/compare.test.mjs` 通过。覆盖核心主攻/反震区分、同时碎件、无碎件、Wilson区间、平局分母、并列共同最优与种子缺口。finish.mjs从逐局数据重算全部48格，和summary.json逐字段相同。
- **复放一致**：48条小样的完整回放SHA与正式批次相同；6条录屏样本另起模拟后SHA也相同。原始回执 `finish-output.txt`，完整样本在samples/。
- **页面能重现**：使用已有本机4330预览，Chrome 156.0.8078.4、390×844视口；真实读取URL并点击“开打”，6条完整JSON逐字节SHA与Node/批量相同，页面异常0。见 [browser-verification.json](samples/browser-verification.json)。未构建、起新服务、发布或更改已有服务；浏览器已关闭。
- **边界**：这次没有录屏、做视觉因果判断或手机实机体验。浏览器回放一致只证明样本地址与计算结果能复现，Wren/Elara仍需看出“哪件打中谁”。100种子的胜率、从八格里挑出的极值是描述统计，不是留出样本的显著性结论；自动台灯＋拖鞋21点只比约定线多1点。

逐局数据SHA256：`8979daf4f228f6ca2de81934a87c44ef89ec9cabfa59cf026ecbbcc7e65a3fb1`。输入总SHA256见results/inputs.json；逐格Wilson95%区间及同种子翻转计数见AUDIT.md。Elara 550a8a30已接受当前数值边界，剪刀＋枕头冲挡14点仍明记未过，留MVP平衡，本轮不调。

## 复跑入口

```sh
nice -n 20 node test/v3-top/loadout-compare/run.mjs 100 <新的输出目录>
nice -n 20 node test/v3-top/loadout-compare/finish.mjs
nice -n 20 node test/v3-top/loadout-compare/verify-browser.mjs /Users/lawrence/Projects/wanwu-duizhan/web/node_modules/playwright/index.mjs
```

run.mjs禁止覆盖已有rounds.ndjson；finish.mjs固定复核本次results（与smoke比完整SHA），生成样本与报告。浏览器脚本使用仓库现有Playwright依赖及既有4330页面，不装依赖；没有这个预览会直接失败，不另找旧包冒充。目录内只有测试工具、证据和说明；最终提交范围另以git暂存清单核验。
