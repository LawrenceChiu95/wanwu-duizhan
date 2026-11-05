# 魔搭免费接线验证

授权：Elara dm:@Elara:28ad1af8 04fd7140；远夏 671c03a4、40e3cd9b。Sol 后端与传输，Iris 独立只读审查；现有 Fanshuo 4330/Funnel 不动。

## 路线与边界
- 单 Docker 仅开放 7860：同源网页和 /api/shoot，Mac 使用官方 frp v0.72.0 的 WSS 主动连接。云端 frps 内部端口和转发端口只绑定 loopback，allowPorts 只准固定一个转发端口；外层网关只升级固定 /~!frp 路径或平台实测编码后的 /~%21frp；统一转成字面路径给frps，不接受参数/后缀或任意目的地。
- frp 共享密钥只放 ModelScope Secret 和本机钥匙串，不进 Git、命令参数或日志。供应商密钥、身份、原照、角色、额度和幂等任务全部保留 Mac；本轮只有隔离假供应商。
- HTTP 透明转发，不自动重放写请求、不缓存私件、不改 cookie/Origin。禁止任意外部代理；仅 /api/shoot 路由到固定 loopback 转发端口。实际 ModelScope 的 Host/Origin 在隔离后台显式列白名单。
- 网关超时和断线返回失败，Mac 已接受任务照常继续；客户端拿同一身份及 clientKey 重试，去重与扣额只由已有 jobs 层负责。
- 免费 CPU 实际 2核8GB；收费配置不选。休眠/唤醒和到12-31可用性实测与官方未承诺部分分开记。无新付费生成/账号充值/常驻系统变更。

## 验收
1. 本机 TLS+WSS、目标魔搭同一 HTTPS 端口的连接、断线重连；主动停启代替自然休眠时明确注明。
2. 119–283KB 代表照片和约1.74MB 模型完整传输，逐 SHA 对齐，不把小 JSON 当大文件验证。
3. Mac 已接受 POST 后丢响应；同一身份 clientKey 重试仍是同一个任务，假供应商调用不翻倍、额度不重扣。
4. 两个浏览器身份独立，各自上传/取件和额度正确，串读任务/照片/模型均404。

先做无供应商私有 Docker 探针和本地隔离测试；传输实现全 diff 稳定后交 Iris 只读独立审查，再启用公开假供应商端到端验证。正式游戏部署、真人和手机体验分层报告，不以 Running 代替验收。

## 网页打包阶段（Elara edd90212）
- 比赛和试玩交直接应用域名。Studio 介绍放「开始玩」链接；原定嵌套时拍照另开窗口；已被下方嵌套页身份裁决替代。现成角色仍在嵌套内玩。
- 镜像只带已审的静态构建。启动时读取不可变构建、异步压缩一次，接请求前完成；不在请求中压缩或读私件。按实际输出字节生成 ETag（gzip 与原文分开），HTML no-store，带构建hash的JS/CSS/wasm长期immutable，模型/贴图及其他文件no-cache强制回源验证。保留同名模型在下次构建更换内容时能取得新字节。
- 网页入镜像和以上缓存完成、增量只读复核及公开假验证通过前，不交可玩链接；现有4330/Funnel不变。

## 先交静态版本（Elara 3bf42525）
- main 47e357f 的 `web/npm run build:judge` 构建九件现成角色，关闭真实拍照；复制构建出的 dist（含现有 pack-web-models 处理）作为 Docker 上下文 web/。不从本分支较旧的 web 构建，不把私有仓库源码整份上传公开空间。
- Studio 介绍页加「开始玩」链接。Iris复核镜像/缓存增量后部署，Wren按iPhone Safari UA测大陆、390宽打一局，Elara看截图亲测后交用户链接。
- 静态链接先交，Mac连接继续查。匿名浏览器UA的health已200；工具默认UA403不是隐私设置，管理页与OpenAPI均已核公开，尚不能据此断言平台不支持WebSocket。

## 嵌套页身份（Elara 67271212、24b57d1e，替代新窗口方案）
- Wren ffd7dff5 实测导航均回 Studio 外框。专用魔搭后台 `headerIdentity: true`，配置端口固定4331、独立任务目录；既有 Fanshuo 4330 不启用，仍用 cookie。
- 页面先 POST `/api/shoot/session`（空正文、无旧令牌）取 `{token}`，存入 localStorage 并回读成功才允许拍照。此后所有 API/私件请求携带 `X-Shoot-Session`。沿用 Mac 既有签名身份与持久 sessionSecret，不发供应商密钥。
- 会话模式下缺失/错误令牌返回401/session，不降级到 cookie、不重发身份、不自动重放提交。页面保留原 token/job/clientKey，先去打现成角色；存储失效不能以新身份悄悄重试付费。
- 照片、改图及 GLB 带头 fetch 转 Blob URL，令牌不进 URL、日志或截图。Mac owner 校验、幂等及额度沿用；云网关透明传递请求头。
- 先用假供应商验证令牌隔离、掉线丢回包同任务、重启后同身份重取及私件串读拒绝，再交 Iris 独立审查。上线仍需创空间内 iPhone Safari 真点拍照/相册、生成中刷新续接验证；UA模拟不代替实体手机。
