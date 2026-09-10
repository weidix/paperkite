# @paperkite/plugin-messages-watch

会话消息监听插件，提供 `messages.watch` 与 `messages.poll` 两种触发器能力。两者都需要 `session`。

## 配置

| 键 | 说明 |
| --- | --- |
| `chat` / `chats` | 监听的会话（数字 ID、`@用户名`、`t.me/用户名` 或邀请链接），两者至少其一 |
| `fromUsers` | 只看来自这些用户的消息 |
| `keywords` | 消息文本包含任一关键词即触发 |
| `match` / `matchFlags` | 正则匹配消息文本 |
| `incoming` / `outgoing` | 是否包含收到的消息 / 发出的消息 |
| `forwards` | 是否包含转发消息 |
| `intervalSeconds` | `messages.poll` 轮询间隔，默认 30 |
| `maxMessages` | `messages.poll` 每轮拉取条数，默认 100 |
| `afterMessageId` | `messages.poll` 从该消息之后开始拉取 |

私有群支持 `https://t.me/+hash` 与 `t.me/joinchat/hash` 邀请链接：触发器启动时经 `CheckChatInvite` 换取 chatId，账号需先通过链接入群，未入群时以「未加入群…」启动失败并显示在控制台流程行。数字 ID、`@用户名`、`t.me/用户名` 沿用 gramJS 既有解析。

配置错误（乱填的引用）由插件声明的 `validateConfig` 报出，控制台流程行显示「需注意」徽标与警告文本。

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
