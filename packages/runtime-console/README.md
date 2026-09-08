# @paperkite/plugin-runtime-console

运行控制台插件，提供 `runtime.console` 服务能力。是运行时自身的 Web 前端，提供总览、流程、事件流、动作、日志与插件清单六个视图。默认端口 3378。

```yaml
services:
  - id: runtime-console
    capability: runtime.console
    config:
      host: 127.0.0.1
      port: 3378
```

### 配置

| 键 | 说明 |
| --- | --- |
| `host` / `port` | 监听地址，默认 `127.0.0.1:3378` |
| `publicDir` | 前端静态文件目录，默认插件自带构建产物 |

### 视图

- **总览**：运行状态、执行中的动作、实时活动
- **流程**：查看与编辑 flows.yml、运行 / 重载 / 启停
- **事件流**：SSE 实时事件，按类型筛选
- **动作**：临时按能力执行动作
- **日志**：跟随日志文件
- **插件清单**：已安装插件的名称、版本、能力与加载状态
