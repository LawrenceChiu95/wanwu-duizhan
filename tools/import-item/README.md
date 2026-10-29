# 把照片或 GLB 变成可拼装道具

在自己的电脑上跑；游戏仍是静态网页，不需要服务器。**照片模式会用运行者自己的 Aholo 额度，至少创建一次改图任务和一次建模任务。** 密钥只读当前终端的 `AHOLO_API_KEY` 环境变量，不读取 `.env`，也不保存密钥。已有 GLB 模式完全离线，不要密钥。

## 安装

安装 [Node.js 22](https://nodejs.org/en/download)，确认 `node --version` 为 `v22…`，以及 Git。从仓库根目录运行。Windows PowerShell 用 `npm.cmd`，避免默认执行策略拦住 `npm.ps1`，不用修改系统执行策略：

```powershell
npm.cmd ci --prefix tools/import-item
```

macOS / Linux：

```sh
npm ci --prefix tools/import-item
```

依赖都是 npm 固定版本（含锁文件）。Sharp 和 Rapier 使用预编译组件，不需要 Blender、Python 或本机编译器。[Sharp 的系统支持说明](https://sharp.pixelplumbing.com/install/)列出支持的 CPU/系统；遇到安装错误先保留完整错误，不要用跳过依赖来冒充安装成功。Windows、Linux 的离线与假接口测试由本 PR 的 CI 验证；真实 Aholo 付费调用留给凡朔，作者本轮没有用任何真实额度。

## 已有模型：不需要密钥

在仓库根目录用新 ID；中文路径加引号：

```sh
node tools/import-item/cli.mjs glb --glb "C:/models/刀.glb" --category scissors --id my-knife --name 我的刀
```

Mac/Linux 将路径改成实际文件，例如 `/Users/me/models/刀.glb`。品类限下面六种；刀沿用游戏现有的 `scissors` 锐器品类，物理数值继承该类原件，不从模型外观猜数值。

| 参数 | 游戏品类 | 最长边 | 质量 |
|---|---|---:|---:|
| scissors | 剪刀/刀 | 0.20 m | 0.15 kg |
| pot | 锅 | 0.38 m | 2.50 kg |
| broom | 扫把 | 1.20 m | 0.60 kg |
| lamp | 台灯 | 0.45 m | 1.50 kg |
| slipper | 拖鞋 | 0.28 m | 0.25 kg |
| pillow | 枕头 | 0.60 m | 0.60 kg |

ID 用小写字母开头，只能含小写字母、数字和连字符，最多48字；名字最多40字。已经存在的 ID 不覆盖，原来六件不替换。输入须是 ≤64 MiB 的自包含、静态、普通 GLB 2.0；不接受外部 URI、骨骼、动画、变形或扩展/压缩（先从建模工具导出普通 GLB）。不会读取 GLB 指定的外部文件或网址。

处理会保留 UV 和 PBR，贴图缩到最长边512，目标约10–15K三角面；UV 接缝多的模型使用带 UV/法线误差权重的减面。仍超过15K就报错，不偷偷交大模型。几何过薄、空模型、坏索引或 Rapier 不接受的凸包也会失败。原输入文件不改。朝向沿用当前品类模板：刀/剪刀的窄端朝外，锅身/扫帚头的宽端朝外；最终凸包和弱点同向。

## 从照片起跑：使用自己的密钥

使用 Aholo **国际站** API Key；当前固定连接官方 `https://api.aholo.ai/global`，不会把这个 Key 发给上传/结果存储服务。不要把密钥写进命令参数、配置文件、PR 或聊天。

Windows PowerShell，在当前终端里隐藏输入：

```powershell
$aholoSecret = Read-Host 'Aholo API Key' -AsSecureString
$env:AHOLO_API_KEY = [System.Net.NetworkCredential]::new('', $aholoSecret).Password
node tools/import-item/cli.mjs photo --photo "C:/photos/锅.png" --category pot --id my-pot --name 我的锅
Remove-Item Env:AHOLO_API_KEY
```

macOS / Linux 的 **Bash**（默认是 zsh 时先输入 `bash`）：

```bash
read -r -s -p 'Aholo API Key: ' AHOLO_API_KEY
export AHOLO_API_KEY
node tools/import-item/cli.mjs photo --photo "/path/to/锅.png" --category pot --id my-pot --name 我的锅
unset AHOLO_API_KEY
```

**照片放在仓库目录外**，例如 `C:/photos/锅.png` 或用户图片目录；不要放进准备提交的项目文件夹。照片限 JPEG/PNG、32 MiB、6400万像素以内。照片上传后，按该品类的 `prompts/<category>.txt` 改图，再以 G1-Turbo、100K、PBR、GLB+ZIP 建模，等成功、下载 GLB，然后走与离线模式完全相同的处理。可用 `--prompt "我的提示词.txt"` 明确替换提示词。刀、锅、扫把是已有实测原文；**台灯、拖鞋、枕头是未实测的起点稿，画风最终由凡朔定**，来源见[提示词说明](prompts/README.md)。CLI 去掉文件首尾空白后发送。

这条链不是固定90秒。成功后终端只打印 ID、面数、大小、哈希等处理结果，不打印 Key、上传凭据或带签名的网址。

## 失败后怎么继续，避免重复扣费

照片模式默认按照片内容、提示词、品类计算稳定的 `photo-<指纹>` 运行名，记录在 `.aholo/runs/<运行名>/state.json`；成功输出与生成错误会带这个运行名。**改名字或ID不改变付费任务身份**，不带 `--run` 重跑就会找到同一份付费结果。GLB模式默认运行名仍是ID。

指定过 `--run` 就继续使用那个值；旧稿以ID作为运行名时，用 `--run <旧运行名>` 续接。相同运行名只要求照片/模型、提示词和品类一致；照片模式的名字、ID可改，已经入库的同ID改名会只更新自己的生成物名字，换新ID会复用下载结果追加另一条，保留旧条目。**只有有意重新付费生成才换新的运行名**。`.aholo/` 已被 git 忽略，里面的照片 URL、下载、任务状态只留本机，不随 PR 提交。

- **普通查询、下载或处理失败**：重复原命令即可；已知任务只继续查原 taskid，下载失败只重试下载，不重建模型。已入库的同一运行只核对原文件，不重复追加。
- **创建任务结果不明（pending）**：立即停止，重跑也不会再次提交。去 Aholo 控制台按时间、照片和提示词确认任务。确实找到同一任务时，可把控制台 taskid 填入 `tasks` 对应的 `multimodal-to-image` 或 `img-to-3d` 键，再移除 `pending` 字段，保存后重复原命令。**没有查清就不能清 pending 重跑**。遇到明确拒绝（例如 `GENERATION_CONCURRENCY_LIMIT_EXCEEDED`）时会显示错误码；在控制台确认那一步确实没有建成任务后，**只移除 `pending` 字段，保留整份运行记录、`tasks`、已成功的改图taskid与原运行名**，再执行原命令。不要为重试建模换运行名，否则会丢掉已付费改图的续跑记录。只有确实要从头再付费生成时才另开运行。
- **任务失败/取消、结果过期或没有可识别 GLB 链接**：停下核查控制台；不会自动再花额度。还能手动下载 GLB 时，另用离线入口和新 ID 导入。API 返回的 GLB 链接须在路径带 `.glb` 或明确标注格式，不能靠结果数组的第几个猜。
- **锁目录存在**：先确认没有另一个导入进程。同一运行的 `lock` 或 `.aholo/catalog-lock` 是空目录，异常退出可能留下；确认无人写入后只删除该空目录，再重复原命令。不要删状态、不要同时跑同一 ID。
- **目标 GLB 已存在而内容不同**：不覆盖，选新 ID，或先人工核对它属于哪次导入。程序崩溃可能留下没有 catalog 引用的模型，保留供排查。

八个时间戳均用 UTC ISO 字符串保存在状态文件：`upload_started`、`upload_finished`、`image_submit`、`image_success_observed`、`mesh_submit`、`mesh_success_observed`、`download_finished`、`inventory_ready`。成功观察时间包含轮询间隔，不等于供应商内部完成时间。GLB 模式只有最后一项有值，其他为 null。实际可用耗时到 `inventory_ready` 为止。

## 跑完提交什么

成功后新增 `data/models/generated/<id>.glb` 与 `data/catalog.json` 条目；新项进入拼装选择器，原六件仍在。最长轴统一到游戏 Z、薄轴到 Y，26方向支撑点组成凸包（最多64点），以最终网格坐标通过 Rapier 的体积检查。条目记录模板品类、哈希、面数、贴图尺寸，不记录照片、Key、绝对路径或临时下载地址。

1. 在自己的功能分支上提交**压小后的 GLB、catalog 新条目**。提交前先用 `git status --short` 核对，再精确暂存本次两个输出：`git add data/catalog.json data/models/generated/<id>.glb`（把 `<id>` 换成实际ID）。例如：

```sh
git status --short
git add data/catalog.json data/models/generated/my-pot.glb
git status --short
git diff --cached --stat
```

确认暂存区只有预期文件、没有原照片/密钥/中间产物后再提交。如调整了提示词，也逐个指定相应文本，说明来源和授权。生成模型标记 `LicenseRef-UserProvided`，不是作者替你授予素材许可；上传照片和使用生成结果须有相应权利。
2. 不提交原图、100K 原始模型、ZIP、`.aholo/`、`node_modules/`、Key 或 `.env`。
3. 本机检查（Windows PowerShell 把下面所有 `npm` 写成 `npm.cmd`；`node` 命令相同）：

```sh
npm test --prefix tools/import-item
npm ci --prefix sim
node --test --test-concurrency=1 test/prototype/sim.test.mjs test/v3/sim.test.mjs test/v3-top/v13/timing.test.mjs
npm ci --prefix web
npm run build --prefix web
```

4. 浏览器在390宽的拼装页选到新模型，打一整局，确认名字/材质正确，没有缺模型提示。提交分支并向当前开发目标开 PR，写清输入来源、品类、三角面数/文件大小和截图，等 Lead 验收；脚本不会自动发布或合主线。本次功能 PR 叠在 `iris/v13`，不代替仍待授权的第13版整合。

测试全用合成照片、假接口和离线 GLB，不读取真实 Key，也不请求真实 API。更多边界见[SPEC](SPEC.md)。
