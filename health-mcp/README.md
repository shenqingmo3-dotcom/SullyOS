# Apple Health / Collar_watch → SullyOS MCP

这是 [KKarsyline/Collar_watch](https://github.com/KKarsyline/Collar_watch)
的薄适配层，不复制也不修改上游数据逻辑。

上游提供 Apple Watch / Health Auto Export（HAE）数据归一化、文件存储，
以及 `health_now`、`health_detail` 两个 stdio MCP 工具；本目录补齐：

- `POST /api/health`：带 `X-Health-Token` 的 Watch / HAE 上传入口；
- `POST /mcp`：SullyOS 可用的无状态 Streamable HTTP JSON-RPC；
- 浏览器 CORS；
- 独立的 ingest 与 MCP Bearer 密钥。

完整部署决策与 SullyOS 配置见
[Apple Health 接入说明](../docs/apple-health-mcp-sullyos.md)。

## 快速启动

先克隆上游：

```powershell
git clone https://github.com/KKarsyline/Collar_watch.git C:\path\to\Collar_watch
```

设置环境变量。数据目录必须是持久化目录：

```powershell
$env:HEALTH_COLLAR_ROOT = 'C:\path\to\Collar_watch'
$env:HEALTH_DATA_DIR = 'C:\path\to\private-health-data'
$env:HEALTH_TZ_OFFSET_HOURS = '12'
$env:HEALTH_INGEST_TOKEN = '<至少 24 字符的随机密钥 A>'
$env:MCP_ACCESS_TOKEN = '<至少 24 字符的随机密钥 B>'
py health-mcp\server.py
```

可参考 [`.env.example`](./.env.example)，但服务本身不会自动读取 env 文件；
请用系统环境变量、进程管理器或容器 secret 注入真实密钥，不要提交密钥文件。

默认只监听 `127.0.0.1:8766`：

- MCP：`http://127.0.0.1:8766/mcp`
- 上传：`http://127.0.0.1:8766/api/health`
- 存活检查：`http://127.0.0.1:8766/healthz`

本机 SullyOS 可直接添加 MCP；HTTPS 页面遇到混合内容/CORS 时，使用仓库现有的
`node scripts/mcp-proxy.mjs`。跨设备使用应通过自己的 HTTPS 反向代理或 Tunnel，
不要把明文 HTTP 和无鉴权端口直接暴露公网。

## 离线测试

```powershell
py -m unittest discover -s health-mcp -p "test_*.py" -v
```
