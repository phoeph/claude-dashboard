# Auto-Logger Skill

自动记录所有用户输入和 AI 回复到本地文件的 Claude Code Skill。

## 功能特性

- 自动拦截并记录所有用户输入（user message）
- 自动拦截并记录所有 AI 回复（assistant message）
- 使用 JSON Lines 格式存储，便于后续分析处理
- 按日期自动组织日志文件
- 异步写入，不阻塞主流程
- 自动处理文件系统权限和目录创建

## 安装方法

### 1. 复制到 Skills 目录

将 `auto-logger` 目录复制到 Claude Code 的 skills 目录：

```bash
# 假设 Claude Code skills 目录在 ~/.claude/skills/
cp -r /path/to/claude-dashboard/skills/auto-logger ~/.claude/skills/
```

### 2. 启用 Skill

在 Claude Code 配置中启用 auto-logger skill：

```yaml
# ~/.claude/config.yaml
skills:
  - name: auto-logger
    enabled: true
```

或者使用命令行：

```bash
claude skill enable auto-logger
```

### 3. 编译 TypeScript（如需要）

如果 Claude Code 需要编译后的 JavaScript：

```bash
cd ~/.claude/skills/auto-logger
npm install -g typescript  # 如未安装
tsc index.ts --outDir dist --esModuleInterop --target ES2020
```

## 使用方法

启用后，skill 会自动工作，无需额外操作。

### 日志文件位置

日志文件存储在以下路径：

```
~/.claude/logs/sessions/YYYY-MM-DD/{sessionId}.jsonl
```

其中：
- `YYYY-MM-DD`：当前日期
- `sessionId`：唯一会话标识符

### 日志格式

每条记录为 JSON Lines 格式，包含以下字段：

```json
{
  "timestamp": "2024-01-15T08:30:00.000Z",
  "project": "my-project",
  "sessionId": "1705312200000-abc123",
  "role": "user",
  "content": "你好，请帮我写一段代码"
}
```

字段说明：
- `timestamp`：ISO 8601 格式的时间戳
- `project`：当前项目名称
- `sessionId`：会话唯一标识
- `role`：消息角色（`user` | `assistant` | `system`）
- `content`：消息内容

### 查看日志

使用命令行工具查看日志：

```bash
# 查看今天的所有会话日志
ls ~/.claude/logs/sessions/$(date +%Y-%m-%d)/

# 查看特定会话的日志
cat ~/.claude/logs/sessions/2024-01-15/1705312200000-abc123.jsonl

# 使用 jq 解析 JSON Lines
jq '.' ~/.claude/logs/sessions/2024-01-15/1705312200000-abc123.jsonl
```

## 配置选项

可以通过修改 `skill.yaml` 调整触发器配置：

```yaml
name: auto-logger
description: 自动记录所有会话到本地文件
version: 1.0.0
trigger:
  user_message:
    enabled: true      # 启用用户消息记录
  assistant_message:
    enabled: true      # 启用 AI 回复记录
  session_start:
    enabled: true      # 启用会话开始记录
```

## 故障排除

### 日志未生成

1. 检查 skill 是否已启用：`claude skill list`
2. 检查目录权限：`ls -la ~/.claude/logs/`
3. 查看 Claude Code 控制台输出是否有错误信息

### 权限错误

确保当前用户对 `~/.claude/logs/` 目录有读写权限：

```bash
mkdir -p ~/.claude/logs
chmod 755 ~/.claude/logs
```

### 磁盘空间

定期检查日志文件大小，避免占用过多磁盘空间：

```bash
# 查看日志目录总大小
du -sh ~/.claude/logs/

# 清理 30 天前的日志
find ~/.claude/logs/sessions/ -type f -mtime +30 -delete
```

## 版本历史

### v1.0.0
- 初始版本
- 支持用户消息和 AI 回复记录
- JSON Lines 格式存储
- 按日期自动组织日志文件

## License

MIT
