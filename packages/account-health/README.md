# @paperkite/plugin-account-health

会话健康插件，提供 `account.health` 触发器能力。监测各 Telegram 会话的连接状态，会话进入异常状态（等待登录、断连等）时触发。

```yaml
triggers:
  - id: account-health
    capability: account.health
    config:
      notifyOnRecovery: true
    actions:
      - capability: notify.bark
        config:
          key: replace-with-your-bark-key
          title: 会话异常
          body: "{{event.session}} {{event.state}}"
```

启动时对尚未连接的会话各触发一次；运行期间会话状态变化时触发。

### 配置

| 键 | 说明 |
| --- | --- |
| `notifyOnRecovery` | 会话恢复连接（connected）时也触发；默认只在异常状态触发 |

### 事件

| 模板 | 说明 |
| --- | --- |
| `{{event.session}}` | 会话名 |
| `{{event.state}}` | 会话状态 |
| `{{event.reason}}` | 状态说明；等待登录时携带需要执行的登录命令 |
