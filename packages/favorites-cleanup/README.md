# @paperkite/plugin-favorites-cleanup

收藏清理插件，提供 `favorites.cleanup` 动作能力。扫描当前会话用户收藏（Saved Messages）里转发的文件，探测已失效（文件源被删除或引用过期、无法再下载）的消息并删除。

```yaml
commands:
  - id: favorites-cleanup
    title: 清理失效的转发文件
    run:
      capability: favorites.cleanup
      session: primary
      config:
        maxMessages: 1000
```

动作仅处理收藏中带转发来源（fwdFrom）的图片与文件消息；探测时只下载首块数据即确认文件可用，不会拉取完整文件。同一条相册消息（分组）中任一成员失效时，会连同整组一起删除。

### 配置

| 键 | 说明 |
| --- | --- |
| `maxMessages` | 从最新开始扫描的收藏消息条数上限；默认 500，`0` 表示不限 |
| `dryRun` | 只统计并记录将删除的消息，不实际删除；默认 `false` |

### 失效判定

两类转发会被判定为失效：

1. **带图片/文件的转发**：发起媒体下载探测，数据开始返回视为有效；返回 `FILE_REFERENCE_EXPIRED`、`FILE_REFERENCES_EMPTY`、`MEDIA_EMPTY` 等引用过期错误视为失效。探测只取首块数据即中断，不会拉取完整文件。
2. **来源频道已不可访问的转发**：源频道被封禁后，Telegram 会剥离媒体，仅留下以 "This channel can't be displayed…" 开头的占位文案；此类转发直接判定失效。

网络等非引用类失败不会删除任何消息，仅记录告警后跳过。结束时输出 `scanned`、`forwarded`、`valid`、`expired`、`unavailable`、`failed`、`deleted` 等统计。