# 好友对撞房间服务

实现范围见共享工作包「实时对撞-20261119」与执行帖 #万物对战:7b81148e（消息 1bed91b2、aa9b6393、46bf6c4e）。房间内的一切对战计算由浏览器完成。

## 本机开发

```sh
npm --prefix tools/netplay ci
npm --prefix tools/netplay test
# 网页要带好友对撞入口（WANWU_NETPLAY=1；不带就是评委版，不会去问房间服务）
(cd web && WANWU_NETPLAY=1 WANWU_COMBAT=position npx vite build --mode judge --outDir dist-judge-position && node ../tools/import-item/pack-web-models.mjs dist-judge-position)
PORT=7860 NETPLAY_WEB_ROOT="$PWD/web/dist-judge-position" npm --prefix tools/netplay start
```

`NETPLAY_ORIGIN` 默认为 `http://127.0.0.1:<port>`。用同一个地址打开前端。`SHOOT_UPSTREAM` 可指定一个确切的 HTTPS 源或本机假接口。未配置时仅可使用内置件。`NETPLAY_TRACE_DIR` 指向 web 根目录外的私有目录。目录里最多保存 256 条对账记录，按局号和座位查找。

## 浏览器协议

连接同源 `/api/netplay/ws`。每帧为一个 JSON 对象，操作在 `t`。消息上限 64 KiB。服务端发 `{t:'error',code}` 时客户端可以按对应动作重试或提示用户。

发往房间服务的消息如下。

| t | 字段 | 行为 |
|---|---|---|
| create | version | 开房，座位 0 |
| join | code, version | 加入等待中的房间，座位 1 |
| resume | code, token, version（可省）, active（可省） | 重新接回原座位。重载后还原本局时带 false，完成后发 presence true |
| ping | n（整数） | 立即回 `{t:'pong',n,s}`，s 为服务端 Unix 毫秒 |
| signal / relay | d, matchId（可省） | 转给对方 `{t,from,d,matchId?}`，按键只在倒计时、对局和暂停中转发 |
| ready | matchId, parts, shootSession（选拍照件时） | parts 为至多两条 `{item,mount,orient}`，校验所选拍照件归属 |
| assetsReady | matchId, hash | 确认收到并验证两边完整配装且模型就绪 |
| presence | active | 切到后台时发 false，回来发 true |
| result | matchId, winner, hash | 两边赢家与散列相同后结束，赢家按座位 0/1 或 null。hash 可为模拟的 uint32 |
| desync | matchId, step, log | 停局，每座位写一份最多 48 KiB 的对账记录 |
| rematch | matchId | 两边都确认后进下一局配装 |
| leave | | 主动退房并作废座位 token |

开房、加入和接回会先单独回 `{t:'session',code,seat,token}`，座位凭证只在这条消息中出现。房间快照里每个座位的布尔值表示服务器已收到该动作。按同一局号补发准备、资源就绪、结果或再赛时，服务器保留已经接受的状态。连接恢复时会重发房间快照。

```js
{
  t: 'state', code, phase, matchId, version, seed, seats: [{connected, ready, assetsReady, resultReady, rematchReady}, /* … */],
  prepare, startAt, resumeAt, pausedSeat, deadline, winner, reason
}
```

空座和暂未进入的字段是 null。服务端下发的所有时刻都为 Unix 毫秒。phase 为 `waiting → loadout → preparing → countdown → playing → finished`。第二个座位入房后首个可配装的 matchId 生效，之后每次重开都发新的局号和 uint32 seed。两边对齐后 `startAt` 为现有 1.5 秒准备动画的起始时间。倒计时或开打后，隐藏页面或连接消失会进入 `paused`，保留 15 秒。回来后回到暂停前状态，继续已开打的局时下发新的 `resumeAt`。超过时间以在线的一方胜，两边都不在线时赢家为 null。结束原因 `complete`、`disconnect`、`desync`。开打前允许双方离开再接回，直到 10 分钟没有房间活动。对方可以在房主不在线时加入，收到 `seats[0].connected: false` 时显示「等房主回来」。

两边都准备后，`prepare` 为 `{loadouts:[{parts,items:[{item,hash,model}]}],hash}`。loadouts 按座位排列，items 按 parts 顺序排列。每件对 `item` 算 SHA-256 小写十六进制，输入是 `sim/runtime-items.js` 的 `itemSignature(item)`。整局 hash 的输入为 `itemSignature({version,matchId,seed,loadouts:[{parts,itemHashes}]})`。内置件用本地模型，回包中 model 是 null。拍照件的 model 是同域路径，请加 `X-Netplay-Seat: <房间 token>` 取 GLB。路径与这场对局绑定。选中的件仅分享战斗数据与模型。原图、改图、整个角色库和拍照身份凭证不会随房间状态发出。

## 独立地址

容器内端口 7860，`NETPLAY_HOST=0.0.0.0`。使用与评委空间不同的新 Docker 空间，`NETPLAY_ORIGIN` 填它的 HTTPS 地址。前端文件打包后与后端一同发布。确认升级请求抵达该容器后才在新地址走完整局。部署降低到不运行新容器即可关闭新地址，原评委链接和隧道服务不参与切换。

两个 HTTP 路径分别承担不同权限。`/api/netplay/models/…` 按房间和当前局只读，给同房两方下载所选模型。`/api/shoot/…` 给新站自己的浏览器转发原拍照接口，原有额度和身份校验继续由 4331 执行。服务器校验浏览器来源后才转发；只转发固定方法和路径。现有评委浏览器身份留在原域名。测试使用假接口，公网验证只查询健康和额度。

私有对账记录位于 `NETPLAY_TRACE_DIR`，与静态文件分开；容器更新前导出所需记录。室内状态存在内存中，容器重启时玩家要重新开房。
