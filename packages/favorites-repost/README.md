# @paperkite/plugin-favorites-repost

收藏重发插件，提供 `favorites.repost` 动作能力。扫描当前会话用户收藏（Saved Messages）里携带发送者的转发，按原有先后顺序重发为隐藏发送者的转发，重发成功后删除原消息。

```yaml
commands:
  - id: favorites-repost
    title: 隐藏收藏转发里的发送者
    run:
      capability: favorites.repost
      session: primary
      config:
        scope: forwards
        maxMessages: 0
```

重发走 `forwardMessages` 的 `dropAuthor`，与客户端「隐藏发送者姓名」转发是同一条协议。每条重发结果都会核对转发头：发送者姓名仍在的消息会连同新建副本一起回滚，原消息保留。相册按组处理，同组只要有一条需要重发，整组一起重发，收藏里的相册分组得以保留。

### 配置

| 键 | 说明 |
| --- | --- |
| `scope` | `forwards` 只重发带发送者姓名的转发；`tail` 从收藏里最旧的那条带姓名转发起，把之后的收藏整体按序重发一遍，未受影响的前缀留在原位。默认 `forwards` |
| `maxMessages` | 从最新开始扫描的收藏消息条数上限；默认 500，`0` 表示不限。`scope: tail` 需要整段收藏参与排序，该键不生效 |
| `deleteOriginal` | 重发成功后删除原消息；默认 `true` |
| `dryRun` | 只统计并记录将要重发的消息，不发起转发与删除；默认 `false`，此时的 `converted` 表示将要重发的条数 |
| `adoptCopies` | 复用收藏末尾已有的隐藏副本，只删除原消息；默认 `false`，用法见下节 |

### 复用已有副本

收藏里已经存在本插件追加的隐藏副本、原消息还在时，用 `adoptCopies` 收尾：

```yaml
config:
  adoptCopies: true
```

该模式扫描整个收藏，取最新的一批消息与识别到的转发原消息逐条核对内容（媒体文件 ID 或文本）。核对一致、且副本不再显示发送者时，只删除原消息，不再重发；核对不一致时直接报错退出，不删除任何消息。副本仍在显示发送者的那几条会保留原消息。结束时输出 `scanned`、`candidates`、`adopted`、`kept`、`deleted`。该模式忽略 `scope`、`maxMessages`、`deleteOriginal`，只认 `dryRun`。

### 顺序

收藏中消息的位置由发送时分配的消息 ID 决定，Telegram 未开放修改已有消息转发头的接口，重发得到的消息只能排到收藏末尾。插件据此给出两档顺序保证：

- `scope: forwards`：被重发的消息之间保持原有先后顺序，收藏里未受影响的其它消息留在原位；
- `scope: tail`：从最旧受影响消息起的整段收藏按原顺序重发，整段收藏的先后关系保持原样，代价是这段消息的消息 ID 与时间戳全部更新，段内的回复、置顶、表态不随重发保留。

扫描按消息 ID 升序执行，重发过程不会颠倒顺序。

### 统计

结束时输出 `scanned`、`candidates`、`converted`、`blocked`、`failed`、`deleted`。`blocked` 表示重发结果里转发头仍带发送者，这类消息保持原样；`failed` 表示转发请求失败，消息保持原样。两类都不中断后续消息，重跑会继续处理剩余条目。
