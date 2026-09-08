# @paperkite/plugin-notify-bark

Bark 推送插件，提供 `notify.bark` 动作能力。只负责 Bark 请求，不持有 Telegram 会话。

## notify.bark

```yaml
run:
  capability: notify.bark
  config:
    server: "https://api.day.app"   # 可省略，默认官方服务；自建部署时填自己的入口
    key: replace-with-your-bark-key
    title: "新消息"
    body: "{{event.text}}"
    method: post                    # 或 get；title/body 支持模板
```

### 配置

| 键 | 说明 |
| --- | --- |
| `server` | Bark 服务入口，默认 `https://api.day.app` |
| `key` | 设备 key（必填） |
| `title` | 通知标题，默认 `Paperkite`，支持模板 |
| `body` | 通知内容，POST 模式必填，支持模板 |
| `group` | 通知分组 |
| `level` | 通知级别 |
| `icon` | 通知图标 |
| `click` | 点击通知后跳转的 URL |
| `copy` | 长按通知可复制的文本 |
| `method` | `post`（默认）或 `get` |
| `timeoutMs` | 请求超时，默认 15000，取值在 1000–120000 之间 |

按 Bark 格式拼接请求：POST 模式以 JSON 请求体发送，GET 模式把参数放进路径与查询串。
