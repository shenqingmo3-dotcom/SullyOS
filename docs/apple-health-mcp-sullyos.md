# Apple Health 以 MCP 接入 SullyOS

## 结论

推荐把 `Collar_watch` 作为**采集与数据层**，把本仓库的 `health-mcp/server.py`
作为**HTTP 边界层**。SullyOS 已有通用 MCP 客户端，不需要再写专用前端。

如果不想让电脑常开，单人使用现在更推荐本仓库的
[`worker/health-mcp`](../worker/health-mcp/README.md)：它把同一套链路实现为
Cloudflare Worker + D1，可直接使用免费的 `workers.dev` HTTPS 地址。Python
`health-mcp` 继续保留为本地调试和自托管方案。

```text
Apple Watch 原生 App（主） ─┐
                            ├─ HTTPS POST /api/health
Health Auto Export（备） ───┘          │
                                      ▼
                              Collar_watch health_store.py
                              JSON / JSONL 持久化文件
                                      │
                                      ▼
                            /mcp: health_now / health_detail
                                      │
                                      ▼
                                SullyOS 角色聊天
```

Apple Health/HealthKit 没有可供普通服务器直接读取的云端 API。授权与读取必须先发生
在 Apple 设备上，所以 MCP 位于采集链路之后，而不是直接连接 Apple Health。

## 三种可选入口

| 入口 | 适用 | 优点 | 代价 |
|---|---|---|---|
| Collar Watch App | 有 Apple Watch，想降低延迟 | 作者实测后台约 10–20 分钟一轮，失败不推进 anchor，可重传 | 需 Mac + Xcode 真机签名；watchOS 调度仍无 SLA |
| Health Auto Export | 不想维护 Watch App，或没有 Watch | 配置快，服务端已兼容其 REST payload | iPhone 锁定、低电量和后台预算可能造成延迟 |
| Vita/类似 Health Context App | 只想偶尔把摘要分享给 AI | 几乎不用维护后端 | 通常是人工复制的摘要，不是稳定、可按需查询的 MCP 数据源 |

对 SullyOS 的“角色随时查询”场景，前两种可以共用本适配层。Vita 更像人工导出的
上下文；除非产品提供稳定 API、自动化或 MCP，否则不建议把它当主链路。

## 1. 准备服务端

服务端必须持续在线且有持久化磁盘。可放在家里的常开 Mac/PC/NAS，
再使用自己的 HTTPS Tunnel；也可放在带持久化卷的 VPS。

不依赖常开电脑的 Cloudflare 路线不使用本节的 Python 文件存储，直接参照
[`worker/health-mcp/README.md`](../worker/health-mcp/README.md) 创建 D1、设置两把
Secret 并部署。部署后本节以下地址中的域名替换为 Worker 的 `workers.dev` 地址即可。

克隆 `Collar_watch`，然后设置：

```powershell
$env:HEALTH_COLLAR_ROOT = 'C:\path\to\Collar_watch'
$env:HEALTH_DATA_DIR = 'C:\path\to\private-health-data'
$env:HEALTH_TZ_OFFSET_HOURS = '12'
$env:HEALTH_INGEST_TOKEN = '<随机密钥 A，至少 24 字符>'
$env:MCP_ACCESS_TOKEN = '<随机密钥 B，至少 24 字符>'
py health-mcp\server.py
```

新西兰标准时为 `+12`、夏令时为 `+13`。上游当前使用固定 UTC 偏移，不识别
`Pacific/Auckland`，换季后需要调整并重启，否则“今天”和睡眠日期边界可能偏一小时。

两把密钥不要相同：

- `HEALTH_INGEST_TOKEN` 只给 Watch/HAE，用于写入；
- `MCP_ACCESS_TOKEN` 只给 SullyOS，用于只读查询。

## 2A. Apple Watch 采集

按上游 README 用 XcodeGen 生成并安装 Watch App：

1. `watch/Sources/Config.swift` 的 endpoint 改为
   `https://你的私有域名/api/health`；
2. `Config.local.swift` 的 token 填 `HEALTH_INGEST_TOKEN`；
3. 修改 Team ID 与 Bundle ID；
4. 真机安装并授权 HealthKit；
5. 把 Collar complication 放到常用表盘，提高后台刷新预算。

Watch App 必须能访问该 HTTPS 域名。只监听 `127.0.0.1` 的地址对 Watch 不可见；
反向代理/Tunnel 负责 TLS，并转发到本机 `127.0.0.1:8766`。

## 2B. Health Auto Export 采集

在 HAE 的 REST Automation 中：

- URL：`https://你的私有域名/api/health`
- Method：`POST`
- Header：`X-Health-Token: <HEALTH_INGEST_TOKEN>`
- Body：使用 HAE 的 metrics REST payload

不要让 HAE 与 Watch 长期同时上报相同的步数、距离、能量等累计指标。
上游按样本求和，多来源的重叠区间可能造成重复累计。迁移时选一个主源，
另一个只作临时回填或备用。

## 3. SullyOS 配置

打开 SullyOS：

1. `设置 → MCP 工具服务器 → 配置 → + 添加`
2. 名称：`Apple Health`
3. 服务器 URL：
   - 同一台电脑测试：`http://127.0.0.1:8766/mcp`
   - 跨设备：`https://你的私有域名/mcp`
4. Bearer Token：填 `MCP_ACCESS_TOKEN`
5. 点击“测试连接”，应看到 `health_now`、`health_detail`
6. 绑定允许读取健康数据的角色/群聊，再开启服务器

Cloudflare 版本会看到三个工具：`health_now`、`health_detail`、`health_trends`。

如果 SullyOS 是 HTTPS 页面而 MCP 是本机 HTTP，浏览器可能拦截混合内容。使用：

```powershell
node scripts/mcp-proxy.mjs
```

然后在 MCP 配置中把代理 URL 填为 `http://localhost:18061`。跨设备场景应直接给
MCP 端点配置 HTTPS，不要依赖浏览器所在电脑的本地代理。

## 4. 验收

先检查服务进程：

```powershell
Invoke-RestMethod http://127.0.0.1:8766/healthz
```

再从 SullyOS 对已绑定角色说：

```text
先调用 health_now，只客观总结当前数据和每项数据的新鲜度，不做诊断。
```

细查示例：

```text
调用 health_detail 查看最近 2 小时心率，告诉我样本数、范围和平均值。
```

如果 `health_now` 返回 `connected, waiting for first samples`，MCP 已通，
只是尚未成功收到 Watch/HAE 数据。

## 5. 让角色在聊天中自然关心

这不需要额外的定时器。只要：

1. Apple Health MCP 已测试连接并启用；
2. 在服务器的“可用聊天”中绑定允许读取健康数据的角色；
3. 角色使用的模型或中转支持工具调用；不支持时 SullyOS 也会尝试文字兼容模式。

正常聊天时，角色可以根据语境自主调用 `health_now`。例如早晨问候、你提到疲惫、
熬夜、情绪或运动时，它可以先读取最新快照，再自然地说：

```text
昨晚好像只睡了六个小时，今天别太勉强自己。
```

这不是每轮自动上传健康数据给模型：只有角色决定调用工具时，SullyOS 才把该次
工具结果交给当前聊天。系统提示明确要求：

- 不要每轮监控或硬找理由谈健康；
- 只在数据够新、与对话相关或确实值得关心时自然带出；
- 不念 JSON，不把回复写成健康报告；
- 不把“睡得少”直接诊断为睡眠障碍、压力或疾病；
- 普通关心用 `health_now`，只有确实需要时才调用 `health_detail`。
- 需要判断连续变化时使用 `health_trends`，只和个人基线比较；

如果不想某个角色再看到健康数据，在 MCP 服务器的“可用聊天”里取消绑定，
或直接关闭该服务器即可。

## 隐私与边界

- 原始数据是普通 JSON/JSONL；启用磁盘加密，备份也应加密。
- 不要把 `/api/health` 或 `/mcp` 无鉴权暴露公网。
- 只把 MCP 绑定给真正需要健康上下文的聊天；SullyOS 的配置与 Token 保存在浏览器本机。
- `health_now`/`health_detail` 是健康记录摘要，不是医疗诊断。涉及症状、药物或紧急情况时，
  不应让角色据此替代专业医疗意见。
- Watch 只采集代码列出的 HealthKit 类型；iPhone 独有或未同步到 Watch 的样本可能缺失。
- watchOS 的 15 分钟刷新请求是“不得早于”，不是定时器或实时 SLA。
