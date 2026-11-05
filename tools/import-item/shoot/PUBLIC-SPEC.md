# Mac 评委拍照后台规格（task30）

授权：Elara dm28ad1af8、ec07953d；系统入口 Naomi 6d6df0be、c1c9925f。原 PR77/78 的等方案选择条件已解除。后端 Sol，静态页面 Iris，隧道/电源/外部健康通知 Naomi。

## 不变量
- 从 main d31688d 整合已审 PR77，不丢 PR80 的Y向上、低面模型、认物重试/禁底座，以及 PR81 的卡片朝向。Sol 不写产品 web。
- 仅127.0.0.1:4330，公网443固定Funnel转发；公网模式只提供 /api/shoot 路由。密钥只由现有钥匙串启动器读入内存，不进配置/日志/前端。
- 浏览器仍同源 /api/shoot；静态站反代至Funnel，避免Safari第三方cookie。公开入口显式HTTPS origin/host白名单，HttpOnly Secure SameSite=Strict cookie，所有响应no-store；照片/模型仍校owner。
- 费用与名额串行持久预占。浏览器每日生成2、认物5；全站每日生成20、认物400，Asia/Taipei零点恢复。阶段费用配置 {stage,limit} 仅计此服务接收的任务，当前验证39分；每个新任务保守预占13分，首次付费前取消/认物失败释放，付费开始/未知提交不退。免费续查不重复预占；换阶段必须Lead明确另给数，重启不重置历史。
- 预算不足不调用供应商，503 budget；quota新增budget:{limit,remaining,available}，available表示还能预占一件。每日名额仍429 quota/kind/scope。静态页面离线和预算停拍都能打九个现成角色。
- 状态目录0700，签名密钥所在state及临时写入0600。假/真状态目录分开；不开放任意文件、静态仓库或其他本机端口。

## 落地顺序
1. 合并旧多人后台到最新main，规格先提交；补公网配置、预算、权限、健康检查与Mac启动说明。
2. nice20离线/真实HTTP假供应商验证：双cookie隔离、越额/并发/重启预算、重拍退款、旧任务续查、Origin/Host拒绝、只露API、状态权限。受影响完整工具回归和网页构建；长重活先问Dash/Lyra。
3. 完整diff稳定后交Iris独立只读审查，结论及Elara裁决放新PR thread。假服务到4330后Naomi开Funnel；首次HTTPS/Funnel启用及系统更新控制需本人操作，不绕过。
4. 固定外网地址经静态站反代核Safari cookie、双人和断网；不把本地反代当Netlify实测。Wren大陆实测由Elara派。
5. 在真实费用硬上限39内拍最多3件，逐笔核账；照片→模型→卡→装上战斗截图及耗时。无新租赁/充值。
6. 自己LaunchAgent RunAtLoad+KeepAlive，进程异常退出恢复和注销后登录启动有证据；FileVault整机重启仍须本人登录，已被Lead接受，不擅自重启Mac。外部健康检查由Naomi负责，避免Mac停机时提醒也停机。

## 交付
公开API/静态页面地址、原始假/真验证、每笔账、可恢复配置、只露443→4330证据、GitHub PR和只读审查。共享HANDOFF「Mac评委拍照后台」唯一状态入口；证据在开发归档/评委拍照Mac。不把配置已写、进程拉起或本地绿称为公网/手机/整机重启通过。

依据：[Netlify反代文档](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/)说明200重写从CDN转发，单请求26秒；任务异步创建/轮询，不等待生成结束。上传与cookie仍须用真实静态域名验收。

## 插入优先项：本人手机尾网真拍（328dfdf6、b3ea9345）

先于公网做。Naomi056f9203确认原有 http://100.75.234.81:4330 尾网映射，无公网，无HTTPS；只有Lawrence本人三台尾网设备。privateOrigin只允许精确的100.64/10 HTTP origin，保留同源静态游戏（main现有五屏）且不设Secure cookie；不把这套HTTP配置用于公网Funnel。独立owner状态、stage owner-trial-20261105、总260分，含自测最多20件；private limits生成20/认物100，不套评委每日2件。当前公网39配置另存且未启用。main游戏前端不改。

手机需先连Tailscale，会顶掉其他VPN；传照片的几百毫秒尾网中转由Naomi说明，实际自测记录只代表自测环境。390宽从上传到打完一局后直接回原#万物对战:cb4d7e27，带可点链接、真实计时和照片不清的结果，不等Lead再批准。整机不重启；公网继续后置。

## 11-05 最新改向（Elara 902f20d2）

远夏不需要手机尾网入口；先录390宽的一件真实流程，等待可加速但标真实时长。自测只允许一件13分，计入原260分。随后凡朔公开试玩独立目录/阶段最多10件130分（也计入260，合计143以内），带随机256位暗码，打开时换成HttpOnly Secure访问cookie并跳到无暗码的游戏地址；不同浏览器继续各自持有owner cookie，不用共享访问暗码当owner。没暗码不能调用拍照或读照片/任务。预览暂时同源提供main网页，撤掉previewAccessCode后恢复评委API-only模式。评委公网验证39分仍单列，不挪用。Funnel/HTTPS只由Naomi开启，国内访问由Wren验，未测通不交公开链接。
