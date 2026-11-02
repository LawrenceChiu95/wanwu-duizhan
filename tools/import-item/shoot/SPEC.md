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
