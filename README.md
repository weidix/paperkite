# 纸鸢

纸鸢是一个以 TypeScript 编写的 Telegram 自动化运行时。触发器、动作、定时任务与常驻服务统一写在一份 YAML 配置里，插件只通过能力名接入运行时。

## 快速开始

```bash
pnpm install
cp data/settings.example.yml data/settings.yml
cp data/flows.example.yml data/flows.yml
pnpm build
pnpm start init
pnpm start run
```

首次运行前先用 `paperkite session login <会话名>` 登录，在终端按提示输入电话号、验证码即可。凭据、会话、日志和数据库都已加入忽略规则，不应提交到仓库。

## 框架

运行时把自动化分成四类，统一写在 `data/flows.yml`：

| 类别 | 说明 |
| --- | --- |
| `triggers` | 事件驱动，收到消息、会话状态变化时执行动作 |
| `commands` | 手动命令，通过控制台或 CLI 触发 |
| `schedules` | 定时任务 |
| `services` | 常驻服务（Web 终端等） |

动作统一为 `capability + session + config`：

```yaml
run:
  capability: messages.send
  session: primary
  config:
    peer: "@someone"
    text: "hello"
```

运行时只加载配置实际用到的能力。会话由运行时统一持有，插件只以会话名访问。动作文本支持 `{{event.text}}`、`{{event.senderId}}` 等路径模板，也兼容 `{text}`、`{chat}` 等简写。动作可以挂 `hook` 指向一个 TypeScript 模块，在执行前转换或跳过本次 config。

重载会停止现有流、重读 flows.yml 并按新配置重启，进程与会话池不退出；settings.yml 仍需重启生效。CLI、Web 控制台等前端都通过同一份运行时控制契约取数、下发操作、订阅事件。

## 插件

插件是独立的 workspace 项目，有自己的 `package.json` 与 `paperkite.plugin` 声明。配置与用法见各插件包内的 README。

| 插件 | 能力 | 文档 |
| --- | --- | --- |
| `@paperkite/plugin-messages` | `messages.send` | [README](packages/messages/README.md) |
| `@paperkite/plugin-notify-bark` | `notify.bark` | [README](packages/notify-bark/README.md) |
| `@paperkite/plugin-messages-watch` | `messages.watch`、`messages.poll` | [README](packages/messages-watch/README.md) |
| `@paperkite/plugin-account-health` | `account.health` | [README](packages/account-health/README.md) |
| `@paperkite/plugin-archive` | `archive.sync`、`archive.console` | [README](packages/archive/README.md) |
| `@paperkite/plugin-process-run` | `process.run` | [README](packages/process-run/README.md) |
| `@paperkite/plugin-favorites-cleanup` | `favorites.cleanup` | [README](packages/favorites-cleanup/README.md) |
| `@paperkite/plugin-runtime-console` | `runtime.console` | [README](packages/runtime-console/README.md) |

`@paperkite/sdk` 是共享库，不属于插件，没有 `paperkite.plugin` 声明。

### 插件安装

内置插件（`paperkite.bundles`）随核心安装目录解析，默认可用；`plugin add` 可安装第三方插件，或安装同名包覆盖内置插件。

插件管理用 profile 目录中的 `package.json` 保存依赖和启用清单：

```bash
paperkite plugin --profile default add <npm-package>
paperkite plugin --profile default remove <npm-package>
paperkite plugin --profile default update <npm-package>
```

`add`、`remove`、`update` 后面的参数由 pnpm 处理。只有带 `paperkite.plugin` 声明的依赖才会成为可加载插件。

## 开发

```bash
pnpm typecheck
pnpm test
pnpm build
```
