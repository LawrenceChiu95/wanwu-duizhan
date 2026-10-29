# 跨平台 Aholo 生成与道具导入

来源：Elara dm:@Elara:eab8087e / ec5d065a（2026-10-29）；远夏 #万物对战:f95ce504 / 3fabe342。交付 2026-10-30 18:00 Asia/Taipei。PR #6 仅文档已获准合 main；本功能走分支、PR、CI、Claude 独立只读审查，未授权发布或合入功能代码。

## 目标与边界

Node.js 22 脚本，Windows / macOS / Linux 使用同一入口。两种用法：

```
node tools/import-item/cli.mjs photo --photo <照片> --category scissors --id wasteland-knife --name 废土刀
node tools/import-item/cli.mjs glb --glb <模型.glb> --category scissors --id wasteland-knife --name 废土刀
```

photo 只从 AHOLO_API_KEY 环境变量取密钥；glb 不需要密钥。生成费用由运行者承担。本轮只用假接口测试 photo，不使用真实 Aholo 或网页额度。

品类限现有 scissors / pot / broom / lamp / slipper / pillow。内置提示词逐类独立：复用凡朔刀与 Wren 锅、扫把；其余三类沿同一画风由 Iris 补，未经真实生成验收如实标注。允许 --prompt 显式指定文本，不把刀文本自动套给其他类别。

## 分工和文件所有权

- Sol（原生 gpt-6.1-sol）：tools/import-item/**、data/models/generated/**、data/catalog.json 的新增项、相关测试与 CI、给凡朔的 README。沿用已有写法；只增加 glTF/PBR 处理所必需依赖，不建服务、数据库、通用插件或配置框架。
- Iris（Raft，Claude Opus 5.5）：web/** 的 catalog 动态物品清单、GLB 读取和名称显示；提示词 lamp/slipper/pillow。不得改镜头、画风、布局、模拟、原六件素材或数值。Sol 不编辑 web 源码。双方各用副本，Iris 独立提交后由 Sol 整合。
- Elara 安排最终 Claude 只读审查；发现事项按阻塞/建议与不改后果交 Lead 裁决，不由 reviewer 改文件。

## 资产与网页契约

1. 新项追加到现有 catalog.items，不替换已有 ID；原8条（含两个比较底稿）、原模型、规则与 sim/** 保持原样。--id 为小写字母/数字/连字符，撞 ID 或目标文件时报错，不能覆盖原六件。
2. 由所选现有 category 的原件复制 tag/material/stats/mass/massBasis/standardLongSide；不是从外观自动推数值。新项记录 templateId、generated:true、name、category、来源哈希与处理参数；不设 comparisonBase，避免隐藏原物品。
3. glb 写 data/models/generated/<id>.glb；路径是仓库相对正斜线，GLB 自包含。保留材质/UV，512贴图，目标10K、允许约10–15K三角面；在误差约束下仍明显超预算则显式失败，不静默输出大模型。
4. 对减面后的最终网格等比例居中，最长轴映到游戏Z、薄轴到Y（若轴歧义保留确定的正交轴），按 category 统一最长边。以同一坐标系收26方向支撑点（最多64），Rapier 接受且体积为正后写入。
5. source 保存输入与最终GLB SHA、生成方式与来源说明，不放本机绝对路径、照片、Key、OUS凭证、供应商临时URL。状态和中间文件进根目录 .aholo/，忽略于git。
6. 网页只读 catalog：有 comparisonBase 替代的底稿不进入选择列表，其余项均可选，因此现有六件和顺序保留、新项追加。模型 glob 包含 data/models 下新增GLB，只加载当前装配需要的资源；缺失资源须显式错误，不能拿灰盒当入库成功。名称来自 catalog，所有DOM写入须用 textContent 或转义；对战HUD、掉件、结算不能出现 undefined 或把新刀叫剪刀。

## 网络与恢复

- photo：上传原照 → 改图 → 轮询成功 → G1-Turbo（100K、PBR、zip+glb、aiPredictSize:false）→ 轮询成功 → 下载本地 → 同一离线处理/入库函数。
- 保存运行标识、输入/提示词哈希、品类/ID/名称和阶段。使用独占运行锁；每次收费创建前先持久化 pending，拿到 taskid 后才清 pending。创建超时或返回无法确定结果就停止，提示核查；重跑遇 pending 不自动再建任务。已知 taskid 只继续查该任务。
- 下载或处理失败保留任务与下载状态，重跑不得重新生成。结果URL过期则明确停止并说明恢复位置；不自动收费重建。HTTP/业务失败输出安全阶段与状态码，不输出响应体、请求头、Key、OUS或临时URL。
- API固定官方HTTPS网关，不提供把真实密钥发往任意地址的开关。测试用依赖注入假接口，验证同一编排入口。外部GLB只接受自包含静态模型，拒绝外部文件/网络URI、动画/骨骼和不支持的压缩，而不是自动访问任意路径。
- 八个时间戳：upload_started、upload_finished、image_submit、image_success_observed、mesh_submit、mesh_success_observed、download_finished、inventory_ready。每个运行均有八键；glb模式不适用项为null。实际可用耗时截止inventory_ready，不宣称固定90秒。
- 仓库写入前在独占目录锁下重读catalog并验证ID；准备文件与最终模型使用独占目标，catalog经同目录临时文件rename。崩溃最多留下未引用模型，不覆盖旧项；失败位置明确，不静默删除用户文件。

## 验收

1. 刀（PR6 Turbo）、锅与扫把（Wren 本次结果）分别用 glb CLI 导入为独立新ID；原8条及原模型逐一核同。三件均满足尺寸、PBR/512、面数、凸包与Rapier检查。
2. photo 假接口覆盖成功、刷新续跑、未知创建结果、下载失败重试、任务失败、过期结果及日志脱敏；成功断言两次创建而非重复扣费，八个时间戳到位。glb 不设置密钥仍成功；外部URI、坏GLB、重复ID不改catalog和原模型。
3. 原第13版36项测试全过，保留旧剪刀的历史碰撞回放；资产测试从固定8条校验扩展到新项而非放松旧项约束。CI 在 Windows 与 Linux 跑工具离线/假接口测试，并纳入第13版13项；构建网页验证动态GLB打包。
4. 390宽拼装页真实打开选择器，三件均能选到、加载正确模型并各完成一局；原六件仍可选，自动与手动入口不回退。截图和回放归档，不把Mac手机宽当真机帧率。
5. README 给出 Node22、依赖安装、PowerShell/bash 环境变量、两种用法、恢复规则、无凭据的提交范围和分支→PR步骤。未实测的系统必须注明；Windows CI 结果是Windows自动验证证据。

## 分支与状态

实现基于第13版 a43931f，分支 sol/aholo-item-cli；PR先叠到 iris/v13，不把尚未获准合并的PR #5夹带进main。PR #6 独立合main，功能PR不会重复打包其30MB资料。任务 task #8；权威活状态仍为共享 HANDOFF.md「当前：Aholo生成与导入脚本」，不在本文件复制进度。
