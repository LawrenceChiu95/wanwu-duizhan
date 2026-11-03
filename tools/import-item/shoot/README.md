# 本机「拍一件」后台

从仓库根运行，Node22：

```sh
node tools/import-item/shoot/server.mjs
```

地址 `http://127.0.0.1:4408`。同源服务已构建的 `web/dist` 和 `/api/shoot/`；没有构建好的游戏时API仍可用。它不启动构建，不监听局域网，没有口令或每日上限。本轮不供手机/Tailscale或外网使用；这些在下一轮接通。现有页面由Iris接本API，独立后端测试不能冒称完整五屏已联调。

默认状态目录 `.aholo/shoot/`（已被Git忽略），有原子状态、假收费账本、每任务照片和模型。关页面不影响任务；重启会续已知任务。服务占用该目录，另一个服务不能同时写。只有旧PID明确不存在（ESRCH）时才自动回收空锁。PID被别的进程复用、无权限探测或锁记录不完整时，启动会拒绝，不承诺自动恢复。手动处理前先核对进程命令和数据目录，确认原服务已经退出；不要因为PID存在就停别人的进程。确认无本服务后，只用rmdir移除这份状态目录下对应的空 `.owner/<PID>` 和 `.owner`（不完整锁按实际空目录处理），不删除任务、账本或照片。

假认物固定为内置锅的真实字段；假风格图只是去元数据后的原照，假模型沿用仓库锅。照片与3D不会对应，不能用它评价生成质量。每新任务一次假付费提交代表整个假流程，不是未来Aholo两阶段收费的实现。`source.generator=local-fake`保留这层区别，不读取密钥，不发任何外部生成请求。

## 前端约定

- 沿[Iris接口第2稿及后续裁决](https://raft-artifacts.com/p/lawrence-workspace/wanwu-mvp-spec)。`/quota` 的limit/remaining/resetsAt均null，used是假收费次数；不显示每天30次或剩几次。
- 上传：POST `/api/shoot/jobs`，multipart photo和clientKey。JPEG/PNG≤32MiB、≤64MP。同key同输入返回原job；不同输入409 key-conflict。
- GET `/api/shoot/jobs/:id`查状态；GET `/api/shoot/items`取入库件。
- 公开 job 的 `fromJob` 是 busy 再提交的父任务 ID；普通新拍和重新生成时为 null；旧记录可能没有 fromJob，前端按 null 处理，重新生成的父任务另在 `regenerateOf`。同 key 重发返回同一个子任务及相同父关系。
- POST `/api/shoot/jobs/:id/retry`空body，续查已有阶段、下载或处理；真模式也可补该单从未提交过的阶段；无ID且无pending才允许首次提交（见下文）。busy通过POST jobs JSON `{fromJob,clientKey}`再次提交。每个busy或可重新生成的父任务只能产生一个子任务；原key重发仍返回该子任务，换key再用同一父任务409 not-allowed，重启后也一样。重新生成通过POST `/jobs/:id/regenerate` JSON `{confirm:true,clientKey}`，只对可重新生成的失败开放。
- unknown-submit保留原记录、永不自动再提交；retry和regenerate均拒绝。它不占active位，新的clientKey可以拍另一件。活动任务冲突409 active-job并带activeJobId。
- 成功一次原子提交同时公开itemId和/items。文件URL是根路径 `/api/shoot/files/<itemId>/model.glb`、photo.jpg、styled.jpg。只有入库文件可读。origin三段真实秒数，steps四步时间戳。
- 新件必填 `outEnd: -1 | 1`：模型最长轴哪一端朝外。本轮假锅沿用锅样本 pan-lux3d 的规范化模型、凸包、弱点和 `outEnd=-1`；换 id 不换装向。未来生成模型要先按品类样本把三者一起规范朝向，不能只改字段。登记入口缺字段/非±1直接报错，旧内置件仍沿原 id 表。
- 页面启动先GET items、`await registerItems(items)`（sim/index.js），然后再显示/装配/回放；同样在任务成功后登记新件。返回的评分须与rateItem逐项一致，登记入口拒绝篡改、不替无效数据补分。内置id拒绝，同运行时id同数据可重复登记、不同数据报错。
- 不接受跨源请求；Host固定127.0.0.1加实际端口，不开CORS。开发接入使用同源代理或本服务的已构建页面，不把服务改成裸露的0.0.0.0。Vite代理需changeOrigin=true，后台通过 `--frontend-origin http://localhost:5173` 显式允许实际开发页的精确Origin（按实际端口填）；只允许本地HTTP来源，仍不开CORS，不改写或信任任意外部Origin。

验收边界和状态写入顺序见[SPEC.md](SPEC.md)。运行 `node --test tools/import-item/test/shoot.test.mjs test/item-rating/runtime.test.mjs`，使用临时目录、合成照片、假模型和随机本地端口；会测试子进程硬退出恢复，不使用外部服务。完整导入工具检查仍用 `npm test --prefix tools/import-item`。

## 请求错误补充（接口第2稿的后续约定）

任务内的 download/process 等失败继续沿原表。请求级错误也返回 `{error:{code,message,retry,charged}}`；message 只进日志，界面按 code 显示下面的句子。本机本轮不用口令或每日上限，因此不产生 pass/quota。

| code | HTTP / 条件 | retry | 界面说 |
|---|---|---|---|
| server | 500意外错误、503服务关闭或存盘失败后拒绝新操作 | same | 出了点问题，再试一次 |
| forbidden | 403，Host或Origin不是约定的本机来源 | none | 页面和后台的地址对不上，请从游戏入口打开 |
| bad-request | 400参数/JSON不合法，413非照片请求过大（JSON或retry带body），415请求格式不对，或API带未约定的查询参数 | none | 请求有问题，请重新打开页面 |
| not-found | 404，任务、文件或接口不存在 | none | 没找到这件，请回角色库看看 |
| not-allowed | 409，当前任务不能免费再试/重新生成，或缺少确认 | none | 这一步现在不能做，请刷新任务状态 |
| key-conflict | 400 key格式错；409同key不同输入 | none | 出了点问题，重新拍一次 |

clientKey 为8–128位ASCII字母、数字、下划线或短横线；包括格式合法的 `__proto__`、`constructor`、`toString`；映射无原型，重启后仍按同key幂等。格式错误HTTP400，同key输入冲突HTTP409，均不建任务、不扣次数。已有 active-job/photo-invalid 等码不变。

**请求级 same 是重发刚才的请求**，不是自动调用 `/retry`；POST建任务或重新生成时须沿用原 clientKey 和原参数。它的 charged=false 只指这个被拒绝的请求没发起付费提交；已有任务是否付过费，以查回来的 job.error/任务状态为准。不得因此换key重拍。任务内 retry=same 才走免费的 `/jobs/:id/retry`。

## 开发代理和带参数入口

静态入口 `/?shoot=fake`、`/?shoot=real&seed=7` 及资源缓存查询串均可打开；API路径不接受未约定的查询参数。静态服务仍只读构建目录内允许扩展名的文件。

Vite沿用已有配置，把同源API转给精确的IPv4监听地址（按实际端口填）：

```js
server: {
  proxy: {
    '/api/shoot': {target: 'http://127.0.0.1:4408', changeOrigin: true}
  }
}
```

启动后台时显式允许浏览器开发页的Origin，例如 `node tools/import-item/shoot/server.mjs --frontend-origin http://localhost:5173`。若页面实际是127.0.0.1或其他端口，要照实际值填；不设通配、不用localhost作代理target、不开放CORS。生产构建由同源服务直接提供时不需要代理。


## 升级与存储故障

升级前先停止自己的本机后台，把旧 `.aholo/shoot/` 整目录归档，再清空该工作目录（本机用trash移到废纸篓；不要硬删除），重新启动。早期假件没有outEnd，启动会明确报出旧件ID和缺少字段并释放锁；不会替旧件猜朝向，也不改写原状态。需要保留历史时把整份目录留在归档中，本轮不迁移它。已有合法朝向的旧状态若保留了regenerateOf（或新记录的fromJob），启动会据此回填缺失的父任务已用标记；早期未记录fromJob的busy关系无法反推，仍按上述归档清空。

任何state.json存盘失败，从第一次失败的请求起就返回503 server，本进程也拒绝后续任务操作；内部失败不会留下未处理的拒绝，正常关闭仍释放自己的目录锁。必须先修复磁盘/权限或占位路径并重启，才能恢复已知任务；反复按再试不能修好存储。请求级retry:same只允许沿用原请求和key，不保证当前进程内立即成功。任务是否已付费仍查原记录，不能据503的charged:false换key重拍。

给Iris的界面约定：同一server错误连续失败三次后，停止给「再试」，显示「后台出了问题，稍后再来」，留「回角色库」；保留原任务/key，不能以界面退出表示撤销任务。具体接口稿已同步这一条，界面实现归task #56。

本机后台当前只在 macOS 使用。Windows 上如果另一个程序正打开 state.json，替换文件可能报 EPERM，后台会转成503并等待修复存储后重启；这轮不做 Windows 产品兼容或自动存盘重试。Windows CI 的硬重启测试由子进程存盘完成后通知，父进程再读盘核实，避免高频读文件干扰写入。


## 真生成（本机，需另获准使用密钥与付费）

默认命令仍使用假provider。真模式显式运行：

```sh
node tools/import-item/shoot/start-real.mjs
```

启动器用 `security find-generic-password -s <服务名> -w` 读取钥匙串的 `wanwu-gemini-api-key`、`wanwu-aholo-api-key`，只在内存里放入后台子进程的 `GEMINI_API_KEY`、`AHOLO_API_KEY` 环境；参数和日志不含密钥，缺哪项只报服务名并退出。已经通过安全途径准备好环境的运行者，也可直接运行 `node tools/import-item/shoot/server.mjs --provider real`；缺环境会点名报错，不回退假生成。不要把密钥写在命令、仓库或日志里。真模式独立保存 `.aholo/shoot-real/`，同一盘不可混真/假任务。网页 `?shoot=real` 只选择HTTP后台，不代表后台开了付费模式；`?shoot=fake` 仍为离线页面假后台。

认物用 Gemini 3.5 Flash-Lite 的 Interactions（固定提示+JSON schema，store=false）；同任务一次请求，失败或崩溃不自动重认。供应商回包的clear、recognizable都必须为true才接受物品字段；拒答仍符合schema，物品字段填null，报photo-unclear、不建Aholo收费任务。清楚的单件东西即使不是日常物品或属于六类以外，也按最接近的六类之一算，inSix=false，不当成拒答；只有不清楚、无主体或多件主体不明确才拒答。物理数据是照片估计，不是测量；长边1–300cm、重量0.001–100kg，输出越界同样拒绝。子任务继承既有认物。

Aholo 两阶段：先 multimodal-to-image 改画风，再 G1-Turbo 100K/PBR 建GLB；每阶段先落pending，收到任务ID才继续。未知结果不重提。官方明确并发满且没有已付费阶段时返回busy；每单改图和建模各最多一次被接受的创建。免费「再试」续查已有ID；该阶段从未被接受且无pending时，允许补原单的第一次提交，包括上传失败后第一次改图、改图完成后第一次建模，这仍是原单费用的一部分。不新增确认接口或按钮。已有模型ID只查询和下载；有 pending 或创建结果不明时不补提。查询失败最多退避重试三次（1、2、4秒），仍失败就保留原ID供免费续查。单次404/403、未知业务码或旧签名URL失效都不证明任务过期；当前官方文档没有明确的任务过期码，不据此显示 expired 或引导再付费。供应商明确失败/取消才用 step-failed；将来核到明确任务过期契约后才能用 expired。

quota 新增 provider 字段（real/fake），供单件验收先确认后台模式；现有页面可忽略。真quota的limit/remaining/resetsAt仍null，used是可能已创建收费阶段的本地任务数，**不是余额、金额或两个阶段的账单次数**。任务charged=true包含尚不能确定是否扣费的pending窗口。Gemini看图单独按token计费，不在该标记里。后台不设置付费预算，必须先由Lead确认单件真实验收和账号费用范围，再启真模式。

压缩、碰撞与朝向沿用导入工具：本件照片估计的长度、重量、材质和新旧供现有评分；模型凸包弱点一起规范，朝外为+Z，弱点半径按本件长边相对品类模板长边同比缩放。原付费GLB先完整拷到source.glb.part、再原子改名为source.glb，之后才替换网页model.glb；中途硬退出保留完整原模型，重启覆盖未完成临时件、免费续处理。已有源副本哈希不符时，只有原模型仍与下载哈希一致才恢复副本。磁盘读写失败可免费重做处理。两份原件都哈希不符时报 process-corrupt、超过64MiB时报 process-too-large，均不开放反复免费处理或重新付费；先人工修复本机原件。大小先 stat 再读文件/算哈希。完整且校验一致但格式不支持的模型仍报 process-unfixable。朝向：剪刀/锅/扫把沿原尖端/宽端规则；台灯/拖鞋依实际模板最长轴安装端的宽窄，枕头等两端判不清时用最长轴并在私有任务和物品 normalization.orientation 中记下回退原因。这里验证进程中断后的恢复；未加 fsync，不承诺断电持久性。正常关闭取消 Aholo 查询和等待，不等四十分钟；已发出的收费创建不挂关闭信号，只保留120秒请求超时，先收ID落盘，关闭后不再发新创建。重复SIGINT/SIGTERM只收尾一次，启动器照旧转发。关闭期间已经收到的认物仍先保存，重启不再认一次。供应商ID和签名URL只留本机私有状态，不返回前端。

单件验收：`node tools/import-item/shoot/check-real.mjs --photo /absolute/photo.jpg --key stable-test-key --allow-paid`。只向当前本机后台建一次任务，重复同照片和同key取原任务；失败只报结果，不自动再生成；再执行仍沿用原key。必须给绝对照片路径；没有 --allow-paid 时拒绝建任务。观察45分钟超时只表示脚本停止观察，不是任务失败：原任务和原key保留，用同照片、同key再执行只取原任务。脚本本身不读取密钥，须先启动获准的真后台；它不能证明页面五屏或真机手感。

### 真模式任务错误（接口第2稿补充）

这些码的 retry 都为 none，不自动重认照片。photo-unclear 只用于合法拒答。界面须按 code 给准确原因，不能把后台配置故障说成照片不清。

| code | 原因 | 处理 |
|---|---|---|
| recognition-auth | 认物接口401/403 | 后台检查认物配置 |
| recognition-limit | 认物接口429 | 稍后再拍 |
| recognition-network | 认物网络失败或超时 | 保留原任务，不自动再调用 |
| recognition-service | 认物接口其他HTTP失败 | 后台服务异常 |
| recognition-invalid | 回包不是合法JSON、字段或数值不合约 | 后台检查供应商回包 |
| recognition-interrupted | 发出认物后中断，未存到确认结果 | 结果不明，不能自动重认 |
| process-corrupt | 原模型和源副本都无法校验 | 人工恢复本机原件，不提示再付费 |
| process-too-large | 本机原模型超过64MiB | 人工减小/离线导入，不反复免费处理 |

诊断只记固定错误分类和HTTP状态，不记供应商原始消息、响应体、URL或凭据。认物请求可能已经花费 token，charged 仍只代表 Aholo 阶段，不能据 charged=false 说认物没花钱。

官方契约：[Gemini Interactions](https://aistudio.google.com/api-reference/interactions-api)、[结构化输出](https://aistudio.google.com/docs/structured-output)、[Aholo OpenAPI](https://labs.aholo.ai/api-docs/en/openapi.json)。这次实现与离线通过不等于供应商实测，真实照片、账单和生成质量仍待密钥授权后验收。
