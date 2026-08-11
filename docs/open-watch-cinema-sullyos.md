# Open Watch Cinema 与 SullyOS

电影始终在 Open Watch Cinema 自己的网页里观看。SullyOS 不保存影片、不提供播放器，也不需要额外的影院跳转页；它只负责让角色通过 MCP 进入房间，并把观影会话回流到记忆。

## 本地连接

Open Watch Cinema 官方适配器是 stdio MCP，浏览器不能直接启动它。先启动 Open Watch Cinema，再在 SullyOS 项目目录运行：

```powershell
$env:OPEN_WATCH_CINEMA_MCP='C:\你的路径\open-watch-cinema\mcp\server.mjs'
pnpm run cinema:mcp-bridge
```

然后在 SullyOS「设置 → MCP」添加：

- 名称：`Open Watch Cinema`
- URL：`http://127.0.0.1:4190/mcp`
- 绑定角色：选择要一起看电影的角色

桥接器只监听 `127.0.0.1`，把 SullyOS 的 Streamable HTTP MCP 请求原样转给官方 stdio 适配器，不接触影片文件。

## 会话与记忆

- `cinema_open_room` 成功后，SullyOS 记录房间 ID、角色在影院里的固定名字和游标。
- 后续 `open_watch_cinema_tick` 必须沿用同一个房间、名字和上次游标。
- `cinema_post_message` 和 tick 返回的房间消息会进入本次共看记录。
- 用户在影院结束房间后，下一次 tick 读到结束状态时，或 `cinema_end_room` 成功时，SullyOS 会立即生成包含用时、播放位置和讨论内容的记忆节点，并加入后端同步队列。
- 只有用户明确要求结束时，角色才可以调用 `cinema_end_room`。
