# Claude Dashboard

Claude Code 的 Agent Teams 监控和 Session 历史查看工具。

![Dashboard Preview](https://raw.githubusercontent.com/phoeph/claude-dashboard/main/docs/screenshot.png)

## 功能特性

- **Agent Teams 监控**: 实时查看所有 Agent Teams 的状态、成员、消息流
- **任务进度追踪**: 可视化任务进度条，状态自动更新
- **Session History**: 按日期分组的历史会话，支持搜索和详情查看
- **实时推送**: SSE 连接，文件变化时自动刷新界面
- **暗色主题**: 科技感暗色界面，霓虹色强调
- **设置页面**: 配置 Claude 默认工作目录

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/phoeph/claude-dashboard.git
cd claude-dashboard
```

### 2. 启动 Dashboard

```bash
./start.sh
```

脚本会自动：
- 创建 Python 虚拟环境
- 安装依赖
- 启动后端服务器（端口 8765）
- 打开浏览器访问 Dashboard

### 3. 安装 Auto-Logger Skill（可选）

```bash
# 复制 skill 到 Claude Code skills 目录
cp -r skills/auto-logger ~/.claude/skills/

# 然后重启 Claude Code 或在设置中启用 skill
```

## 使用说明

### Dashboard 访问

- Dashboard: http://localhost:8765/
- API 文档: http://localhost:8765/api/teams
- SSE 流: http://localhost:8765/stream

### 界面导航

- **Teams**: 查看所有 Agent Teams 的实时状态、消息流和任务进度
- **Session History**: 浏览历史会话记录，支持搜索、筛选和详情查看
- **设置**: 配置 Claude 默认工作目录

### Session History 功能

- **时间筛选**: 最近1小时/今天/昨天/最近7天
- **类型筛选**: 用户消息/AI回复/系统消息/工具调用
- **虚拟滚动**: 流畅浏览大量会话记录
- **完整时间显示**: 开始时间、结束时间、会话时长

## 项目结构

```
claude-dashboard/
├── start.sh                    # 一键启动脚本
├── server.py                   # Python 后端 (Flask + SSE)
├── requirements.txt            # Python 依赖
├── README.md                   # 项目说明
├── .gitignore                  # Git 忽略规则
├── dashboard/
│   ├── index.html             # 前端主页面
│   ├── app.js                 # Alpine.js 应用逻辑
│   └── style.css              # 暗色科技感样式
└── skills/auto-logger/        # Claude Code Skill（可选）
    ├── skill.yaml
    ├── index.ts
    └── README.md
```

## API 端点

| 端点 | 描述 |
|------|------|
| `GET /api/teams` | 获取所有 teams 配置 |
| `GET /api/teams/{name}/messages` | 获取 team 消息 |
| `GET /api/tasks/{team_name}` | 获取 team 任务 |
| `GET /api/sessions` | 获取历史会话列表 |
| `GET /api/sessions/{id}` | 获取单个会话详情 |
| `GET /api/config` | 获取 Dashboard 配置 |
| `POST /api/config` | 保存 Dashboard 配置 |
| `GET /stream` | SSE 实时流 |

## 数据存储

```
~/.claude/
├── teams/{team-name}/
│   ├── config.json          # 团队配置
│   └── inboxes/*.json       # 消息记录
├── tasks/{team-name}/*.json # 任务记录
├── projects/                # Session 历史记录
│   └── {project-name}/
│       └── {sessionId}.jsonl
└── dashboard/
    └── config.json          # Dashboard 配置
```

## 技术栈

- **后端**: Python + Flask + Flask-CORS + Watchdog
- **前端**: Alpine.js + Tailwind CSS + Lucide Icons
- **实时通信**: Server-Sent Events (SSE)
- **Skill**: TypeScript

## 手动启动（可选）

如果不想使用脚本，可以手动启动：

```bash
# 1. 创建并激活虚拟环境
python3 -m venv venv
source venv/bin/activate

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动服务器
python server.py

# 4. 浏览器访问 http://localhost:8765
```

## 开发

### 添加新功能

1. 后端 API 修改 `server.py`
2. 前端逻辑修改 `dashboard/app.js`
3. 界面修改 `dashboard/index.html`
4. 样式修改 `dashboard/style.css`

### 调试

```bash
# 查看服务器日志
tail -f /tmp/server.log

# 测试 API
curl http://localhost:8765/api/health
```

## 贡献

欢迎提交 Issue 和 PR！

## 许可证

MIT License

## 作者

[@phoeph](https://github.com/phoeph)
