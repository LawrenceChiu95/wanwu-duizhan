# 接入契约

## 后台调用

国际账号网关：https://api.aholo.ai/global 。鉴权 Header：Authorization: <API key>，无 Bearer。密钥仅置于服务端，前端不得持有。

1. Asset 上传获取 URL，参考 run_turbo.py 的 upload。照片按原样上传；产品需要向玩家明确说明。
2. POST /lux3d/v1/generate/multimodal-to-image/task/create，输入 img 与 prompt。
3. GET /lux3d/v1/generate/task/get?taskid=<ID>，直到 d.status=3。
4. 改图输出 d.outputs[0].content 作为下一步 img。
5. POST /lux3d/v1/generate/img-to-3d/task/create，使用本包下述请求体。
6. 相同查询接口检测成功，先记录生成完成时间，再下载输出；本次请求 zip/glb，GLB为 outputs[1].content。
7. GLB保存自己的资产存储，再准备游戏尺寸、碰撞体和物品记录。

请求体是JSON，不是可直接执行代码：

```json
{"img":"<废土图URL>","version":"G1-Turbo","faceCount":100000,"enablePbr":true,"outputFormat":["zip","glb"],"aiPredictSize":false}
```

官方依据：https://labs.aholo.ai/api-docs/en/openapi.json ，https://labs.aholo.ai/api-docs/en/sdk/python 。服务端当前配置与账号权限仍以实际调用为准。

## 状态与错误

API业务 c=0 才是请求成功；生成完成还需 d.status=3。0初始化、1运行中、3成功、4失败、6取消。运行中可能有部分 outputs，不能据此标记成品完成。

前端建议显示：上传照片 → 改造外观 → 生成模型 → 准备入库 → 可使用。下载/优化失败显示准备失败，可以重试准备，不得重建模型。生成失败由用户主动重试，不自动新建收费任务。创建请求超时可能已成功创建，应先核查现有任务。

API Key、OUS凭证、临时资源URL不能放入前端、公共日志或交接仓库。生成结果URL约两小时有效，及时保存到自有存储。原始测试 state.json 含临时URL，本包不包含。

## 计时定义

同时记录 upload_started、upload_finished、image_submit、image_success_observed、mesh_submit、mesh_success_observed、download_finished、inventory_ready。用户本次要求的端到端生成时间=mesh_success_observed-upload_started；建模时间=mesh_success_observed-mesh_submit；下载另计。正式产品真正可用等待时间还需测 inventory_ready-upload_started。

## 游戏侧

保持物体自身长宽高比例，对整个对象统一缩放；尺寸由游戏规则决定，暂不锁定具体数值。aiPredictSize=false 不等于已经归一化。显示模型与碰撞体分开，使用简单碰撞体或凸包，不直接用约10万面视觉网格做实时动态碰撞。

首先沿用现有场景类别、核心+两件道具、每件独立血条机制。生成模型按一个道具整体处理。物品类别、材质克制、数值属性由规则配置，不能把模型外观当作可靠分类。

后续提示词方向：固定废土色彩与修补语言；保留原物类别、主体比例、标志性结构与材质身份；清除人体与杂物；避免过多细碎悬垂结构。对刀/锅之外类别尚未完成提示词验收。
