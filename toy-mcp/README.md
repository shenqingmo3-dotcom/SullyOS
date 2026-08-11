# GALAKU 桃心 Pro（K134）MCP

这是面向 Windows 和 SullyOS 的本地 MCP 服务，目前按以下结构实现：

- 完整教程：[GALAKU K134 Windows MCP SullyOS 教程](../docs/GALAKU-K134-Windows-MCP-SullyOS-教程.md)；
- `仅吮吸`和`震动＋吮吸`两个板块；
- `温和、逗弄、奖励、强烈、惩罚`五种情景；
- 每个情景有五个不同变体，共 50 个变体；
- AI 只选择板块、情景、1～5 级力度和总时长，MCP 负责随机抽取具体节奏；
- 使用洗牌袋避免同组五个变体在一轮内重复；
- 同一情景持续播放时，每约 10～12 秒自动抽取下一种；
- `galaku_reroll`可以立即要求同组重抽；
- `galaku_stop`用于立即停止。
- 启动脚本首次运行时生成随机256位Bearer Token，所有`/mcp`请求必须携带该密钥。

## 当前阶段

协议向量、单通道、双通道、动态强弱变化、随机变体、重新抽取、中途停止和
SullyOS 经 Tailscale Serve 的端到端控制均已在 K134 上完成实际验证。
离线测试覆盖 50 个变体、洗牌袋、协议边界、MCP 工具结构和最终停止清理。

设备未运行时必须由用户本人明确发起；AI 只能提出或询问。用户明确开始且当前一轮
仍在运行时，AI 才能按对话情景自主选择与切换。任何停止或不适表达都应立即调用
`galaku_stop`。

## MCP 工具

- `galaku_mode_catalog`：查看全部模式，不连接设备。
- `galaku_play_scene`：由 AI 选择板块、情景、力度和持续时间，随机启动一个变体。
- `galaku_reroll`：保持当前情景和力度，切换到同组下一种变体。
- `galaku_status`：查看当前播放状态和变体。
- `galaku_stop`：停止当前控制。

服务只监听本机地址：

```text
http://127.0.0.1:8765/mcp
```

访问密钥保存在本机的`toy-mcp/.runtime/access-token.txt`，该目录不会提交到Git。
启动窗口也会显示同一密钥，供SullyOS的Token字段使用。`/health`保持无需密钥，
但所有MCP调用都需要正确的`Authorization: Bearer <token>`。

默认最高震动和吮吸均限制为 85%，可通过环境变量
`GALAKU_MAX_VIBRATION`和`GALAKU_MAX_SUCTION`进一步降低。
