# @paperkite/plugin-messages-watch

会话消息监听插件，提供 `messages.watch` 与 `messages.poll` 两种触发器能力。两者都需要 `session`。

## 配置

| 键 | 说明 |
| --- | --- |
| `chat` / `chats` | 监听的会话（用户名或 ID），两者至少其一 |
| `fromUsers` | 只看来自这些用户的消息 |
| `keywords` | 消息文本包含任一关键词即触发 |
| `match` / `matchFlags` | 正则匹配消息文本 |
| `incoming` / `outgoing` | 是否包含收到的消息 / 发出的消息 |
| `forwards` | 是否包含转发消息 |
| `intervalSeconds` | `messages.poll` 轮询间隔，默认 30 |
| `maxMessages` | `messages.poll` 每轮拉取条数，默认 100 |
| `afterMessageId` | `messages.poll` 从该消息之后开始拉取 |

## messages.watch

实时监听，消息到达即触发。

```yaml
triggers:
  - id: important-message
    capability: messages.watch
    session: primary
    config:
      chats: ["@example"]
      keywords: ["提醒"]
    actions:
      - capability: notify.bark
        config:
          key: replace-with-your-bark-key
          title: 新消息
          body: "{{event.text}}"
```

## messages.poll

按间隔轮询拉取新消息。

```yaml
triggers:
  - id: poll-messages
    capability: messages.poll
    session: primary
    config:
      chats: ["@example"]
      intervalSeconds: 60
    actions:
      - capability: notify.bark
        config:
          key: replace-with-your-bark-key
          title: 新消息
          body: "{{event.text}}"
```
