# @paperkite/plugin-archive

消息归档插件，提供 `archive.sync` 动作与 `archive.console` 服务两种能力。

## 存储

归档默认使用 Node 内置 SQLite（如 `sqlite:data/archive.db`），也支持 PostgreSQL：

```yaml
config:
  url: postgresql://user:password@host/database
```

## archive.sync

把指定会话的消息归档入库。需要 `session`。

```yaml
schedules:
  - id: archive-hourly
    intervalSeconds: 3600
    session: primary
    run:
      capability: archive.sync
      config:
        url: sqlite:data/archive.db
        chats: ["@example"]
        maxMessages: 500
```

### 配置

| 键 | 说明 |
| --- | --- |
| `url` | 存储地址（SQLite 或 PostgreSQL） |
| `schema` | 可选 schema |
| `chat` / `chats` | 归档目标会话（必填） |
| `daysBack` | 回捞天数，默认 30 |
| `maxMessages` | 每会话最多条数，默认 1000 |
| `downloadMedia` | 是否下载媒体，默认 true |
| `resume` | 是否断点续跑，默认 true |
| `batchSize` | 每批处理条数，默认 50 |
| `mediaDir` | 媒体落盘目录，默认 `data/downloads` |

`chats` 内的每一项可单独覆盖 `daysBack`、`maxMessages`、`downloadMedia`、`resume`。

## archive.console

归档台，消息归档插件的 Web 终端：检索消息、按会话浏览、查看同群上下文、预览与下载媒体。默认端口 3379，黑白灰双主题。

```yaml
services:
  - id: archive-console
    capability: archive.console
    session: primary        # 可选；配置后可从 Telegram 在线取回未落盘媒体
    config:
      host: 127.0.0.1
      port: 3379
      url: sqlite:data/archive.db  # 与 archive.sync 指向同一数据库
      mediaDir: data/downloads   # 落盘媒体的解析根目录
```

### 配置

| 键 | 说明 |
| --- | --- |
| `url` / `schema` | 存储地址，必须与要查的 `archive.sync` 指向同一数据库 |
| `mediaDir` | 媒体相对路径的解析基准，默认相对进程工作目录解析 |
| `host` / `port` | 监听地址，默认 `127.0.0.1:3379` |
| `session` | 可选；配置后可从 Telegram 在线取回未落盘媒体 |

### 界面

- **总览页**：归档消息、会话、屏蔽统计，最近活跃会话与「全部消息」入口
- **检索**：关键词、会话、日期区间、分页；检索框输入按回车即拆词并入关键词条件（逐词成芯片、可单个移除）
- **消息详情**：`#/m/:id` 打开单条消息，含媒体与相册行
- **媒体**：已落盘文件直接流式返回（支持 Range 与附件下载），未落盘的经 `session` 实时从 Telegram 取回

### 屏蔽

内置两层屏蔽：全局屏蔽词与屏蔽用户，命中屏蔽的整条消息隐身（含其媒体与相册成员）。顶栏盾牌按钮打开屏蔽管理对话框；每条消息悬停出现操作按钮，可屏蔽此用户、选词屏蔽、屏蔽此消息。也可通过 HTTP 接口管理：`/api/blockwords` 与 `/api/blockedusers` 提供查询、新增、删除，`/api/state` 返回两侧的版本与数量。
