# @paperkite/plugin-messages

消息发送插件，提供 `messages.send` 动作能力。

## messages.send

支持个人会话与 Telegram Bot API 两种模式。

个人会话使用 `session` 与 `peer`：

```yaml
run:
  capability: messages.send
  session: primary
  config:
    peer: "@someone"
    text: "hello"
```

Bot 模式使用 `mode: bot`、`botToken` 与 `chatId`：

```yaml
run:
  capability: messages.send
  config:
    mode: bot
    botToken: replace-with-your-bot-token
    chatId: "@channel"
    text: "hello"
```

### 配置

| 键 | 说明 |
| --- | --- |
| `mode` | `bot` 启用 Bot 模式；省略即为个人会话模式 |
| `peer` | 个人会话的接收方（用户名或 ID） |
| `botToken` / `chatId` | Bot 模式的凭据与接收方 |
| `text` | 消息文本，支持模板 |
| `file` | 发送文件（本地路径），附带 `caption`，支持模板 |
| `replyTo` | 回复的消息 ID |
| `replyToEvent` | 回复触发本动作的消息 |
| `silent` | 静默发送 |
| `parseMode` | 消息解析模式（如 Markdown / HTML） |
| `linkPreview` | 链接预览开关 |
| `sendAt` | 定时发送：ISO 时间戳或 `HH:mm:ss.SSS` |
| `delaySeconds` | 延迟发送的秒数 |

个人会话模式需要 `peer` 与 `session`；Bot 模式需要 `botToken` 与 `chatId`。`text` 与 `file` 至少提供其一。

### 模板

`text` 与 `caption` 支持路径模板与简写：

| 简写 | 路径 |
| --- | --- |
| `{text}` | `{{event.text}}` |
| `{sender}` | `{{event.senderId}}` |
| `{sender_name}` | `{{event.senderName}}` |
| `{chat}` | `{{event.chatId}}` |
| `{chat_title}` | `{{event.chatTitle}}` |
| `{id}` | `{{event.id}}` |
| `{date}` | `{{event.date}}` |
| `{source_id}` | `{{source.id}}` |
| `{source_capability}` | `{{source.capability}}` |
