# 本机「拍一件」后台（只接假生成）

从仓库根运行，Node22：

```sh
node tools/import-item/shoot/server.mjs
```

地址 `http://127.0.0.1:4408`。同源服务已构建的 `web/dist` 和 `/api/shoot/`；没有构建好的游戏时API仍可用。它不启动构建，不监听局域网，没有口令或每日上限。本轮不供手机/Tailscale或外网使用；这些在下一轮接通。现有页面由Iris接本API，独立后端测试不能冒称完整五屏已联调。

默认状态目录 `.aholo/shoot/`（已被Git忽略），有原子状态、假收费账本、每任务照片和模型。关页面不影响任务；重启会续已知任务。服务占用该目录，另一个服务不能同时写。硬退出后的旧PID锁可自动恢复；若启动恰好断在写PID之前，会明确报不完整锁，确认没有本服务后才可用rmdir移除空锁，不删除任务数据。

假认物固定为内置锅的真实字段；假风格图只是去元数据后的原照，假模型沿用仓库锅。照片与3D不会对应，不能用它评价生成质量。每新任务一次假付费提交代表整个假流程，不是未来Aholo两阶段收费的实现。`source.generator=local-fake`保留这层区别，不读取密钥，不发任何外部生成请求。

## 前端约定

- 沿[Iris接口第2稿及后续裁决](https://raft-artifacts.com/p/lawrence-workspace/wanwu-mvp-spec)。`/quota` 的limit/remaining/resetsAt均null，used是假收费次数；不显示每天30次或剩几次。
- 上传：POST `/api/shoot/jobs`，multipart photo和clientKey。JPEG/PNG≤32MiB、≤64MP。同key同输入返回原job；不同输入409 key-conflict。
- GET `/api/shoot/jobs/:id`查状态；GET `/api/shoot/items`取入库件。
- POST `/api/shoot/jobs/:id/retry`空body，只续免费下载/处理；不能进入提交。busy通过POST jobs JSON `{fromJob,clientKey}`再次提交。重新生成通过POST `/jobs/:id/regenerate` JSON `{confirm:true,clientKey}`，只对可重新生成的失败开放。
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
| bad-request | 400参数/JSON不合法，415请求格式不对，或API带未约定的查询参数 | none | 请求有问题，请重新打开页面 |
| not-found | 404，任务、文件或接口不存在 | none | 没找到这件，请回角色库看看 |
| not-allowed | 409，当前任务不能免费再试/重新生成，或缺少确认 | none | 这一步现在不能做，请刷新任务状态 |
| key-conflict | 400 key格式错；409同key不同输入 | none | 出了点问题，重新拍一次 |

clientKey 为8–128位ASCII字母、数字、下划线或短横线；当前拒绝 `__proto__`。格式错误HTTP400，同key输入冲突HTTP409，均不建任务、不扣次数。已有 active-job/photo-invalid 等码不变。

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
