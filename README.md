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
| `@paperkite/plugin-telegram-messages` | `messages.send` |
| `@paperkite/plugin-bark` | `notifications.bark` |
| `@paperkite/plugin-conversation-watch` | `watch.group`、`watch.poll` |
| `@paperkite/plugin-account-watch` | `watch.session` |
| `@paperkite/plugin-message-archive` | `archive.sync`、`archive.console_web` |
| `@paperkite/plugin-process-command` | `system.command` |

`@paperkite/sdk` 是共享库，不是插件，因此没有 `paperkite.plugin` 声明。归档存储与控制台都属于消息归档插件内部实现。插件的第三方依赖写在插件自己的 manifest 中，安装和运行不会依赖根项目偶然提升的依赖。

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

`messages.send` 支持个人会话和 Telegram Bot API 两种模式。个人会话使用 `session` 与 `peer`，Bot 模式使用 `mode: bot`、`botToken` 与 `chatId`。`notifications.bark` 只负责 Bark 请求，不持有 Telegram 会话，这两个能力始终是两个插件。

归档默认使用 Node 内置 SQLite，也支持 PostgreSQL：

```yaml
config:
  backend: postgres
  url: postgresql://user:password@host/database
```

Web 控制台默认只监听 `127.0.0.1`；需要局域网访问时显式设置 `host`。媒体预览复用归档服务声明的 `session`，从 Telegram 实时取图；归档落盘的媒体文件经 `/api/media-files/{id}` 提供。命令插件默认不经过 shell，只有明确设置 `shell: true` 才会启用 shell 解释。

## 控制平面

核心提供前端无关的运行控制契约（`RuntimeControl`），托盘、Web 控制台、CLI 等任何可视化前端都通过同一套接口取数与操作，具体渲染由前端自行实现。

- **快照**：`snapshot` 返回运行时状态（`running`、`pid`、`uptimeSeconds`）、按类别的流 id 列表、`flows` 明细（每条流的 `kind`/`capability`/`enabled`/`active`/`session`/`autoStart`/`schedule`）以及 `logs` 日志作用域清单。
- **操作**：`executeAction({ capability, config?, session?, hook?, label? })` 是执行原语，可临时执行任意 action；`runFlow(id)` 按 id 引用 flows 中已配置的 command/schedule action 执行一次；`runCommand`、`startService`/`stopService`/`restartService`、`setFlowEnabled`（持久化写回 flows.yml）不变。
- **热重载**：`reload()` 停止现有流、重读 flows.yml 并按新配置重新启动，进程与会话池不退出；仅支持 flows 配置，settings.yml 仍需重启生效。
- **事件流**：`subscribe(listener)` 订阅细粒度事件（`action.started`/`action.finished`、`service.started`/`service.stopped`、`flow.enabled`、`config.reloading`/`config.reloaded`、插件日志行 `log`），退订返回函数；事件只在进程内分发，传输层由消费方自备。
- **插件日志隔离**：每个插件注入以插件包名命名的子日志器，写入 `data/logs/<插件名>.log`，互不混用；快照的 `logs` 可直接浏览。

Unix 域套接字协议（`data/.paperkite/control.sock`）同步暴露上述契约：`snapshot`、`command.run`、`flow.run`、`action.run`、`service.start|stop|restart`、`flow.enabled`、`runtime.reload`。

## 开发

```bash
pnpm typecheck
pnpm test
pnpm build
```

项目源码和插件源码全部使用 TypeScript；浏览器端的 `packages/message-archive/public/app.js` 是构建产物，不作为源码维护。
