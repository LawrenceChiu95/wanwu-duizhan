# 拍一件：本机假生成后台

授权：task #50，Elara dc8538a9、bf5a8b54；接口沿 Iris 第2稿及母 thread #万物对战:2bbbd2ea。Sol负责本目录和模拟器物品登记；Iris负责web接线。无真生成、密钥、口令、每日上限、外网发布。先运行在127.0.0.1；手机接入与口令另轮。

- Node22原生HTTP、现有Sharp；不加依赖。API前缀/api/shoot，上传JPEG/PNG≤32MiB、解码≤64MP。默认仅同源；开发代理可显式允许一个精确的本地HTTP Origin，禁CORS，Host固定本机监听地址；不暴露仓库、任务状态文件或任意路径。
- jobs、clientKey摘要映射、items同一state.json原子替换；照片和模型先写，最后一次提交同时写item和job.itemId。默认状态在仓库忽略的.aholo/shoot，服务独占目录；同进程写操作串行。
- 幂等key先核摘要再核active：重发返回原job；不同照片/动作/fromJob报key-conflict；忙和再生成各用新的key。一次只排一件；结果不明保留原记录但不占active，新key可拍别件（69a1c60d）。
- 提交假生成前先存pending；返回后存providerId。启动时pending不再提交，变unknown-submit；已知providerId只续四步。retry只续下载或处理，绝不进入submit。重新生成只接受confirm=true、新clientKey与允许重新生成的失败。
- 假生成一次提交代表整个假生成流程，used记录假收费次数；不声称等同未来Aholo的两个真实付费阶段。固定认物和模型都来自内置锅，风格图是清理后的原图副本；source明确local-fake，不能冒充真认物/改图。
- 四步用实际startedAt/endedAt，origin仍photo/styled/model三段实际秒数。quota limit/remaining/resetsAt为null，保留used和activeJobId（71be6494）。
- 模拟器registerItems(items)先整批校验、再原子登记。内置id拒绝；运行时同id同完整数据可重入、不同数据拒绝。必需字段、枚举、有限几何和rating必须有效；调用rateItem重算并逐项核rating，战斗仍用同一分数，不改算法。loadCatalog/loadRules包含已登记件，返回副本。页面打开先登记/items由Iris接。

验收：真实HTTP十发同key只假收费一次；子进程SIGKILL重启续接且结果/文件持久；pending和unknown反复retry/重启不多交；免费处理/下载恢复、再生成幂等、busy明确未收费；成功原子可读并有rating/origin。相同完整物品写入隔离catalog和运行时登记，用同装法/种子逐字节比较回放。独立Claude只读完整diff和现有证据，交Elara逐条裁决后才合mvp/base。

## task #52：接前端前的三处收口

- 新件必须自带 `outEnd: -1 | 1`（模型最长轴哪一端朝外）。本轮固定锅复制 pan-lux3d 的规范化模型/几何，并从该品类样本的现有规则取 -1，随新 id 入库；登记时缺失、非 ±1 直接拒绝。装配优先用件上的 outEnd，旧内置件继续用原 id 表，规则文件/数值不动。未来换模型必须按品类样本把模型、凸包和弱点一起规范朝向，再给该字段，不能只换字母冒充转过模型。
- 请求级 `server` 的 retry 改为 same，表示可以重发原请求；建任务仍重用原 clientKey，不能新建一次付费操作。其余新增请求码和 clientKey 格式写入 README/接口补充，前端按码说白话，原 error.message 只进日志。
- 静态页面和资源允许查询串，API 仍拒绝未约定参数；不改 Host、Origin、路径和扩展名边界。README 给出 target 为 127.0.0.1、changeOrigin=true 的具体 Vite 代理配置。
- 验证：不同 id 的同一模型与原内置件，所有槽位/两种装法变换相同，同种子回放只替换物品身份后逐字节相同；缺朝向拒绝；真实 HTTP 核静态 query、API query、server retry、附加错误码。原 HTTP/runtime/历史回归和受影响完整检查复跑。五屏接线/真机画面仍由 Iris 另验。

## task #53：真生成收费前的持久性收口

仍只假生成，不启真接口。先接task52的固定版本；本轮不改web、物理或数值。

- busy/fromJob与可再生成父任务只可产生一个子任务，消耗记录与新job/key在同一原子存盘里提交。同key重发先返回原子任务；换key再用父任务报not-allowed，不能再收费。
- jobs/keys从JSON读出后转为无原型字典；新建同样无原型，允许格式合法的__proto__/constructor/toString等key，不靠逐个黑名单。回归直接核存盘keys里的那条记录与job/id/收费。
- runner始终收住内部拒绝并锁住后续请求（503），close在finally释放目录锁；磁盘修好后正常重启续已知任务，不在损坏存储上继续提交。用实际保存路径故障证明不挂死、可释放重开。
- 两个真实子进程硬退出检查点：pending已落盘但尚未假记账；假记账已落盘但providerId尚未返回/保存。父测试确认磁盘检查点后SIGKILL，重启都转unknown-submit，假账分别0/1且不增加。
- HTTP补过大照片、超像素、坏multipart/重复photo；静态服务补编码穿越、目录符号链接越界。临时目录、合成照片、随机本机端口，不占正式数据。
- README明确PID复用/权限不足/不完整锁不能自动恢复；只核实本服务不在后移除对应空锁，不停同事进程、不删任务文件。
- 完整导入及runtime检查串行nice20；独立Claude只读最新完整diff，交Elara裁决后才能合base。

- Elara6fe0eb01并入第8–11条：启动拒绝缺outEnd的旧入库件并释放锁、不隐式补字段；README写升级前归档并清空旧假数据。存盘503须先修存储重启，接口约定同server连续三次失败改提示后台问题（界面归Iris task56）；JSON超限及retry带body为bad-request；回放对照替换前明确核新id出现且原回放无此id。新增HTTP限流读取保留错误响应连接，不改鉴权/来源限制。

## task #57：HTTP、旧状态与跨平台检查点

- 读取超限停止缓存但继续消费完整请求，再回413；JSON与照片读取边界分别bad-request/photo-invalid。照片文件超过32MiB且总请求尚未越界为400。真实HTTP验证完整消费和及时响应。
- 子任务保存fromJob；启动依fromJob/regenerateOf回填缺失的父usedBy。已有幂等键顺序不变，不能再建第二子任务。
- 所有state存盘失败第一次起均503 server，保持阻断后续操作与修盘重启恢复。
- 硬退出回归异常清理用SIGKILL，Windows超时先留子进程/状态诊断再按实因修，不延长等待，不重复提交。

- Windows硬重启主验收：子进程在state原子替换完成后通知并暂停写入；父进程仍直接核磁盘providerId/pending，SIGKILL后再核一次，再正常重启续接、核一次假收费。通知只改变读取时机，不替代磁盘断言。

## task #64：本机真认物与生成

- 默认假生成保留；明确 `--provider real` 使用独立 `.aholo/shoot-real/`。只读环境 GEMINI_API_KEY/AHOLO_API_KEY，缺哪个启动报哪个；同目录不能混用真、假 provider，不把供应商ID/URL/密钥放进公开任务或物品。
- Gemini 3.5 Flash-Lite Interactions：固定提示、照片JPEG1600、store=false、结构化JSON；clear和recognizable两标志都为true才接受物品字段，否则物品字段允许null并拒答、不进Aholo。清楚的六类之外物品归最近类并inSix=false。物理范围1–300cm、0.001–100kg，五材质、新旧三档及unknown；越界/拒答/超时不进Aholo。每任务发出前记录recognitionPending，响应确认时与recognition一起落盘，未知认物不再发；显式子任务继承认物结果。
- 复用Aholo上传/改图/G1-Turbo 100K PBR/GLB客户端下载，按四步更新时间。每阶段付费提交前pending、确认ID后清pending；任一创建结果未知转unknown-submit。并发满只在官方明确拒绝且无任何阶段ID时作busy，已有改图收费、模型拒绝不能报未收费。
- /retry只续已有ID、下载、处理，禁止创建任何收费请求。已知失败但尚无模型ID仅能显式确认重新生成，原改图费用可能已发生；结果不明没有重生成入口。原付费结果先完整写source.glb.part再原子改名，之后才替换model.glb；未完成临时副本不影响原模型，重启免费续处理。已有源副本损坏时，仅从下载哈希仍相符的原模型恢复。未知任务不占活动位。
- 本件长度/重量/材质/新旧给prepareMesh和现有rateItem；三项和总等级仍由现有算式决定。模型、凸包、弱点位置一起规范，弱点半径按本件长边/模板长边同比缩放，outEnd=+1；成功资产全部就绪后一次入库/完成提交。模拟器复算登记不变。
- task60四小补同时落实：旧fromJob缺字段当null；诊断quota请求2秒限时；EISDIR日志一次断言；runner收费查询等意外失败只记录原错误码一次并503封住进程，不重试存盘。
- 这轮只离线契约，备单件真实验收脚本；真实密钥和费用启用另交Elara，task62前端收费边界先验收。本机之外、真照片质量/时延/账单不由契约测试宣称已通过。
