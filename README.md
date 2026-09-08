# 纸鸢

纸鸢是一个以 TypeScript 编写的 Telegram 自动化运行时。它把触发器、动作、定时任务和常驻服务统一到一份 YAML 配置中，插件只通过能力名接入运行时。

## 快速开始

```bash
pnpm install
cp data/settings.example.yml data/settings.yml
cp data/flows.example.yml data/flows.yml
pnpm build
pnpm start init
pnpm start run
```

第一次使用某个 Telegram 会话时，运行时会在终端请求登录信息，并把会话保存到 `telegram.sessionsDir`。凭据、会话、日志和数据库都已加入忽略规则，不应提交到仓库。

## 插件边界

每个实际插件都是一个独立 workspace 项目，并且拥有自己的 `package.json` 与 `paperkite.plugin` manifest：

| 插件 | 能力 |
| --- | --- |
| `@paperkite/plugin-messages` | `messages.send` |
| `@paperkite/plugin-notify-bark` | `notify.bark` |
| `@paperkite/plugin-messages-watch` | `messages.watch`、`messages.poll` |
| `@paperkite/plugin-account-health` | `account.health` |
| `@paperkite/plugin-archive` | `archive.sync`、`archive.console` |
| `@paperkite/plugin-process-run` | `process.run` |
| `@paperkite/plugin-runtime-console` | `runtime.console` |

`@paperkite/sdk` 是共享库，不是插件，因此没有 `paperkite.plugin` 声明。归档存储属于消息归档插件内部实现。插件的第三方依赖写在插件自己的 manifest 中，安装和运行不会依赖根项目偶然提升的依赖。

## 插件安装

核心自带的内置插件（`paperkite.bundles`）随核心安装目录解析、默认可用；`plugin add` 可安装第三方插件，或安装同名包覆盖内置插件。

插件管理使用 profile 目录中的 `package.json` 保存依赖和启用清单：

```bash
paperkite plugin --profile default add <npm-package>
paperkite plugin --profile default remove <npm-package>
paperkite plugin --profile default update <npm-package>
```

`add`、`remove`、`update` 后面的参数由 pnpm 处理。只有带有 `paperkite.plugin` manifest 的依赖才会成为可加载插件；普通依赖仍然只是普通依赖。运行时仅加载当前 YAML 实际引用的能力，未使用的插件不会执行初始化代码。

## 配置约定

顶层分为 `triggers`、`commands`、`schedules`、`services` 四类。动作统一使用：

```yaml
run:
  capability: messages.send
  session: primary
  config:
    peer: "@someone"
    text: "hello"
```

触发器的 `actions` 会接收 `emission`，消息动作支持 `{{event.text}}`、`{{event.senderId}}` 等路径模板，也兼容 `{text}`、`{chat}` 等简写。动作可声明 `hook` 指向一个导出函数的 TypeScript 模块，用于在执行前转换或跳过本次 payload。

`messages.send` 支持个人会话和 Telegram Bot API 两种模式。个人会话使用 `session` 与 `peer`，Bot 模式使用 `mode: bot`、`botToken` 与 `chatId`。`notify.bark` 只负责 Bark 请求，不持有 Telegram 会话，这两个能力始终是两个插件：

```yaml
run:
  capability: notify.bark
  config:
    server: "https://api.day.app"   # 可省略，默认官方服务；自建部署时填自己的入口
    key: replace-with-your-bark-key
    title: "新消息"
    body: "{{event.text}}"
    method: post                    # 或 get；按 Bark 格式拼请求，title/body 支持模板
```

归档默认使用 Node 内置 SQLite，也支持 PostgreSQL：

```yaml
config:
  url: postgresql://user:password@host/database
```

归档台（`archive.console`）是消息归档插件的 Web 终端，面向拥有者本人翻查归档资料：检索消息、按会话浏览、查看同群上下文、预览与下载媒体。页面由 SvelteKit 静态 SPA 构成，构建产物输出到 `packages/archive/public`，与 API 由同一服务进程托管：

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

存储配置（`url`/`schema`）必须与要查的 `archive.sync` 指向同一数据库；`mediaDir` 是媒体相对路径的解析基准，未配置时相对进程工作目录解析。终端基于存储的只读接口组合数据：`searchStructured` 检索（关键词、会话、日期区间、包含/排除时间模式、分页）、`getMessageContext` 取同群上下文、`getMessageByRowId` 取完整消息（含媒体与相册行）、`getMediaFileById` 定位落盘媒体。媒体预览两路取源：已落盘文件直接流式返回（支持 Range 与附件下载），未落盘的经服务注入的 `session` 实时从 Telegram 取回；未配置会话时在线取回返回 503。JSON API 错误统一为 `{ error: string }`，4xx 为参数与不存在、503 为依赖不可用。界面为黑白灰双主题：进入控制台（无 hash 或 `#/`）与点击左上角品牌角标（桌面左栏、移动端抽屉与顶栏标题均可）落到总览页——归档消息/会话/屏蔽统计、最近活跃会话与「全部消息」入口；显式打开 `#/q`（含带条件的 `#/q?…`）或清空全部筛选条件则进入无过滤的全部消息列表，`#/m/:id` 打开单条消息；检索框输入按回车即空格拆词并入关键词条件（逐词成芯片、可单个移除），`/` 聚焦检索、`Esc` 关闭浮层，长列表分批加载，媒体点击才取图。

归档台内置两层屏蔽：全局屏蔽词与屏蔽用户。词表落库（`blockwords` 表）、用户名单落库（`blocked_users` 表，按 `sender_id` 精确匹配并附展示信息），`messages` 表物化 `blocked` 标志列，服务启动载入内存缓存（分别带版本号），读查询统一注入 `blocked = 0` 条件——检索、上下文、消息详情、聊天清单的计数与分页与可见集严格一致，名单数量不影响读路径成本。增删均走增量重算：置位只扫未屏蔽行，解锁只重算已屏蔽且命中被删实体（词或用户）的行，并核对剩余词与剩余用户，一方解除不误放另一方命中的行；部分索引让扫描只落在 blocked/unblocked 子集上，大库删词即时生效。命中屏蔽的整条消息隐身（含其媒体与相册成员），聊天标题等元数据不受影响，新落库行按当前名单即时判定。管理接口：`GET/POST /api/blockwords`、`DELETE /api/blockwords/:word`、`GET/POST /api/blockedusers`、`DELETE /api/blockedusers/:id`，`/api/state` 返回两侧的版本与数量。前端 Topbar 的盾牌按钮打开双页签屏蔽管理对话框；每条消息（含相册行）悬停出现操作按钮，点击弹出全屏消息操作浮层，三个固定选项：屏蔽此用户、选词屏蔽（在这条消息里像选普通文本一样拖选任意片段作为屏蔽词，超长时提示控制在 64 字内）、屏蔽此消息（整条文字入词，过长时自动提示改走选词）。消息文本直接渲染，选区由浏览器原生选择能力读取，不做服务端分词。

命令插件默认不经过 shell，只有明确设置 `shell: true` 才会启用 shell 解释。

运行控制台（`runtime.console`）是运行时自身的 Web 前端，通过服务注入的 `RuntimeControl` 契约取数、下发操作并订阅事件，页面由 SvelteKit + Bits UI 组成：

```yaml
services:
  - id: runtime-console
    capability: runtime.console
    config:
      host: 127.0.0.1
      port: 3378
```

提供总览（运行状态、执行中的动作、实时活动）、流程（查看与编辑 flows.yml、运行/重载/启停）、事件流（SSE 实时、类型筛选）、动作（临时按能力执行）、日志（跟随日志文件）与插件清单六个视图。构建产物输出到 `packages/runtime-console/public`，默认端口 3378。SPA 静态构建按路由拆包，事件流与轮询只在页面可见时刷新，日志与上下文列表采用虚拟化渲染。

## 控制平面

核心提供前端无关的运行控制契约（`RuntimeControl`），托盘、Web 控制台、CLI 等任何可视化前端都通过同一套接口取数与操作，具体渲染由前端自行实现。

- **快照**：`snapshot` 返回当前状态（`running`、`pid`、`uptimeSeconds`）、按类别的流 id 列表、`activeServices`、`activeActions`（正在执行的动作：`id`/`capability`/`session`/`flow`/`startedAt`）、`flows` 处理后的完整配置视图（每条流的 `kind`/`id`/`capability`/`title`/`symbol`/`enabled`/`active`/`session`/`autoStart`/`cron`/`intervalSeconds`/`maxRuns`/`config`/`actions`/`hook`/`logFile`/`startedAt`）以及 `logs` 日志文件索引。
- **操作**：`executeAction({ capability, config?, session?, hook?, label? })` 是执行原语，可临时执行任意 action；`runFlow(id)` 按 id 引用 flows 中已配置的 command/schedule action 执行一次，session 解析与定时触发一致（action 未声明时回落到 schedule 的 session）；`updateFlow(id, patch)` 按字段白名单修改并持久化写回 flows.yml（整条复检后生效，返回是否变更）；`reloadFlow(id)` 单独重载一条 flow（command 确认定义就绪、trigger/service/schedule 停止旧实例并按最新定义重启），组合即「改配置 + 立即生效」；`startService`/`stopService`、`listPlugins()`（已安装插件的 `name`/`version`/`capabilities`/`loaded` 全量清单）不变。
- **热重载**：`reload()` 停止现有流、重读 flows.yml 并按新配置重新启动，进程与会话池不退出；仅支持 flows 配置，settings.yml 仍需重启生效。
- **事件流**：`subscribe(listener)` 订阅任务流事件（`action.started`/`action.finished`、`service.started`/`service.stopped`、`flow.updated`、`flow.reloaded`、`flow.finished`、`schedule.fired`、`config.reloading`/`config.reloaded`），全部携带 `at` 时间戳；`action` 事件带 `flow`/`hook`/`ok`/`skipped`/`durationMs`/`effectivePayload`，`service` 事件带 `capability`/`session`/`reason`/`durationMs`，`flow.finished` 带 `kind`/`id`/`capability`/`ok`/`durationMs`；退订返回函数；事件只在进程内分发，传输层由消费方自备。日志不入事件，直接读取日志文件。
- **插件日志隔离**：每个插件注入以插件包名命名的子日志器，写入 `data/logs/<插件名>.log`，互不混用；快照的 `logs` 是外部读取这些文件的索引。

Unix 域套接字协议（`data/.paperkite/control.sock`）同步暴露上述契约：`snapshot`、`plugins`、`flow.run`、`action.run`、`flow.update`、`flow.reload`、`service.start|stop`、`runtime.reload`。

## 开发

```bash
pnpm typecheck
pnpm test
pnpm build
```

项目源码和插件源码全部使用 TypeScript；浏览器端 `packages/runtime-console/web/`（运行控制台）与 `packages/archive/web/`（归档台）为 SvelteKit + Bits UI 静态 SPA 源码（黑白灰主题），分别经 SvelteKit 静态适配器构建到各自的 `public/` 目录，构建产物不作为源码维护。
