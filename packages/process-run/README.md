# @paperkite/plugin-process-run

进程执行插件，提供 `process.run` 动作能力。默认不经过 shell，只有明确设置 `shell: true` 才会启用 shell 解释。

```yaml
run:
  capability: process.run
  config:
    command: "echo hello"
```

```yaml
run:
  capability: process.run
  config:
    program: ls
    args: ["-la"]
    cwd: "/path/to/dir"
```

### 配置

| 键 | 说明 |
| --- | --- |
| `program` / `args` | 直接执行程序与参数 |
| `command` | 一条命令字符串，默认拆词执行 |
| `shell` | 设为 `true` 时以 shell 解释 `command` |
| `cwd` | 工作目录，默认进程工作目录 |
| `env` | 附加环境变量 |
| `timeoutMs` | 超时时间，默认 60000 |
| `maxOutputBytes` | 捕获输出的上限，默认 64KB |

`program` 与 `command` 至少其一。命令以非零退出码结束时动作失败。
