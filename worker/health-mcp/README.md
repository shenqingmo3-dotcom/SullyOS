# Apple Health → SullyOS HTTP MCP（Cloudflare 免费单人版）

这是 `Collar_watch` 的 Cloudflare Worker + D1 实现，不需要电脑常开。

```text
Apple Watch / Health Auto Export
        ↓ HTTPS POST /api/health
Cloudflare Worker
        ↓
Cloudflare D1
        ↓ POST /mcp
SullyOS 角色聊天
```

## 包含内容

HTTP 入口：

- `POST /api/health`：Watch / HAE 上传，使用 `X-Health-Token`；
- `POST /mcp`：SullyOS 的无状态 HTTP MCP，使用 Bearer Token；
- `GET /healthz`：存活检查，不返回健康数据。

MCP 工具：

1. `health_now`：当前快照、昨晚睡眠和今日活动；
2. `health_detail`：心率/HRV/呼吸的两小时详情，或指定日期睡眠；
3. `health_trends`：最近 7/14/30 天的个人趋势。

这里的 HTTP 入口不是 AI 工具。SullyOS 只会把上面三个 MCP 工具提供给角色。

## 数据保留

- 原始样本默认 35 天；
- 每日趋势和睡眠汇总默认 120 天；
- 每天由 Cron 自动清理。

这些值可以在 `wrangler.toml` 中调整。时区使用 IANA 名称，
默认 `Pacific/Auckland`，会自动处理新西兰夏令时。

## 第一次部署

以下命令均在本目录执行：

```powershell
cd C:\Users\86130\Documents\sullyos\worker\health-mcp
```

### 1. 登录 Cloudflare

```powershell
pnpm exec wrangler login
```

浏览器会打开 Cloudflare 授权页。

### 2. 创建免费 D1 数据库

```powershell
pnpm exec wrangler d1 create sullyos-health
```

命令会返回 `database_id`。复制它，替换 `wrangler.toml` 中：

```toml
database_id = "REPLACE_WITH_YOUR_D1_ID"
```

表结构会在 Worker 第一次请求时自动创建。如需提前创建：

```powershell
pnpm exec wrangler d1 execute sullyos-health --file schema.sql --remote
```

### 3. 生成两把不同密钥

```powershell
$ingestToken = [Convert]::ToHexString(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
).ToLower()

$mcpToken = [Convert]::ToHexString(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
).ToLower()

$ingestToken
$mcpToken
```

把两把密钥保存到密码管理器。不要提交到 Git。

### 4. 写入 Cloudflare Secrets

```powershell
pnpm exec wrangler secret put HEALTH_INGEST_TOKEN
pnpm exec wrangler secret put MCP_ACCESS_TOKEN
```

每条命令出现提示时，分别粘贴对应密钥。

### 5. 部署

```powershell
pnpm exec wrangler deploy
```

成功后会得到类似：

```text
https://sullyos-health-mcp.<你的子域>.workers.dev
```

检查：

```powershell
Invoke-RestMethod https://sullyos-health-mcp.<你的子域>.workers.dev/healthz
```

## 配置 Health Auto Export

在 HAE 的 REST Automation 中填写：

- URL：`https://你的-worker.workers.dev/api/health`
- Method：`POST`
- Header：`X-Health-Token: <HEALTH_INGEST_TOKEN>`
- Body：HAE metrics REST payload

这是没有 Mac 时最简单的采集方式。它上传的是 iPhone Apple Health 中已经同步到的
Watch 数据。

## 配置 Collar Watch

使用作者项目的数据上传功能。

`watch/Sources/Config.swift`：

```swift
static let endpoint = URL(
    string: "https://你的-worker.workers.dev/api/health"
)!
```

`Config.local.swift`：

```swift
static let token = "<HEALTH_INGEST_TOKEN>"
```

Watch 普通上传走 `/api/health`。本版本刻意没有接入作者新加的远程实时测量指令，
因此 `/command` 和 `/command/result` 不存在，AI 也不会看到或误调用该能力。

## 配置 SullyOS

打开：

```text
设置 → MCP 工具服务器 → 配置 → 添加
```

填写：

- 名称：`Apple Health`
- URL：`https://你的-worker.workers.dev/mcp`
- Bearer Token：`MCP_ACCESS_TOKEN`
- 可用聊天：只绑定允许读取健康数据的角色

点击“测试连接”，应该看到：

```text
health_now
health_detail
health_trends
```

## 验收

先让角色调用：

```text
调用 health_now，只客观告诉我数据新鲜度，不做诊断。
```

趋势：

```text
调用 health_trends 看最近 7 天，只比较我自己的变化。
```

## 隐私和安全

- 上传 Token 与 MCP Token 必须不同；
- 不在日志中打印请求体或 Token；
- 只把 MCP Token 配置到自己的 SullyOS；
- D1 中是敏感健康数据，不要把数据库分享给别人；
- 所有结果只用于日常参考，不能代替医疗诊断。
