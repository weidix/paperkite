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
| `@paperkite/plugin-favorites-repost` | `favorites.repost` | [README](packages/favorites-repost/README.md) |
| `@paperkite/plugin-runtime-console` | `runtime.console` | [README](packages/runtime-console/README.md) |

`@paperkite/sdk` 是共享库，不属于插件，没有 `paperkite.plugin` 声明。

### SDK 与 ABI

插件在 `dependencies`、`devDependencies` 或 `peerDependencies` 中声明 `@paperkite/sdk` 版本，即可表达所需的 SDK / ABI 契约，SDK 的 major 号即 ABI 代际。Core 在发现阶段读取这些声明：声明了明确的版本约束且当前 Core 不满足时拒绝加载；插件所需的 ABI 高于 Core 时输出警告并继续加载；未引入 SDK、`*`、`latest` 与无法解析的声明都不构成约束。插件运行期从上下文的 `abi` 字段取得当前 ABI。

### 插件安装

Core 的依赖面只有引擎自身，插件代码全部装在 profile 目录里。内置插件的集合与版本范围由清单包 `@paperkite/bundles` 声明，Core 读它的 packument 得到 name → range，并按 ABI 选出范围内满足条件的最高稳定版，以精确版本写入 profile 的 `package.json`，lockfile 固定。

`paperkite init` 与每次 `run` / `once` / `service run` 启动前都会做一次幂等 sync；`plugins.autoInstall` 关闭后启动不再联网。sync 只安装缺失的插件，已固定的版本不会被静默升级，也不会改动用户安装的插件；清单里下线的插件输出警告并转为用户插件，卸载由用户显式执行。清单读取带 TTL 与 ETag 缓存，命中缓存不联网；网络不可用时回退到随 Core 发布的 `bundles.json` 快照。

```bash
paperkite plugin list                 # 来源（清单/用户）、安装版本、可用版本与 ABI verdict
paperkite plugin sync [--refresh]     # 按清单安装缺失插件；--offline 只用缓存与快照
paperkite plugin sync --check         # 只报告将要发生的变更
paperkite plugin update <package>     # 重算并前进到最新的兼容版本
```

`plugin add` / `remove` 的其余参数由 pnpm 处理，写入 profile 的依赖属于用户插件，sync 不会覆盖：

```bash
paperkite plugin --profile default add <npm-package>
paperkite plugin --profile default remove <npm-package>
```

只有带 `paperkite.plugin` 声明的依赖才会成为可加载插件。同名插件在 profile 中优先于 Core 安装根，开发工作区里未被 profile 安装的内置插件仍从 Core 根解析。

清单来源、scope 与缓存策略见 `settings.yml` 的 `plugins` 段：

```yaml
plugins:
  manifest: "@paperkite/bundles"      # 清单包名，或返回清单 JSON 的 http(s) 地址
  registry: "https://registry.npmjs.org"
  autoInstall: true                   # 启动前自动 sync
  manifestTtlHours: 24
  scopes:                             # 清单只接受这些 scope 的条目
    - "@paperkite/"
```

## 开发

```bash
pnpm typecheck
pnpm test
pnpm build
```
