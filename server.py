#!/usr/bin/env python3
"""
Claude Dashboard Backend Server

提供 REST API 和 SSE 实时推送功能，用于监控 Teams、Tasks 和 Sessions。

API 端点:
- GET /api/teams - 获取所有团队配置
- GET /api/teams/{name}/messages - 获取指定团队的消息
- GET /api/tasks/{team_name} - 获取指定团队的任务
- GET /api/sessions - 获取历史会话列表
- GET /stream - SSE 实时推送端点

启动方式:
    python server.py
    或
    ./start.sh
"""

import os
import json
import time
from datetime import datetime
from pathlib import Path
from threading import Lock

from flask import Flask, jsonify, Response, request
from flask_cors import CORS
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ============ 配置 ============
PORT = 8765
HOST = "0.0.0.0"

# Claude 数据目录
CLAUDE_DIR = Path.home() / ".claude"
TEAMS_DIR = CLAUDE_DIR / "teams"
TASKS_DIR = CLAUDE_DIR / "tasks"
LOGS_DIR = CLAUDE_DIR / "logs" / "sessions"
PROJECTS_DIR = CLAUDE_DIR / "projects"

# Dashboard 配置目录和文件
DASHBOARD_DIR = CLAUDE_DIR / "dashboard"
DASHBOARD_CONFIG_FILE = DASHBOARD_DIR / "config.json"


def load_dashboard_config():
    """加载 Dashboard 配置。"""
    default_config = {
        "defaultCwd": str(Path.home()),
        "updatedAt": datetime.now().isoformat()
    }

    try:
        if DASHBOARD_CONFIG_FILE.exists():
            with open(DASHBOARD_CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                # 确保有默认字段
                if 'defaultCwd' not in config:
                    config['defaultCwd'] = default_config['defaultCwd']
                return config
    except Exception as e:
        print(f"[Config] Error loading config: {e}")

    return default_config


def save_dashboard_config(config):
    """保存 Dashboard 配置。"""
    try:
        DASHBOARD_DIR.mkdir(parents=True, exist_ok=True)
        config['updatedAt'] = datetime.now().isoformat()
        with open(DASHBOARD_CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[Config] Error saving config: {e}")
        return False

# ============ Flask 应用 ============
# 获取项目目录
PROJECT_DIR = Path(__file__).parent.absolute()

app = Flask(__name__, static_folder=str(PROJECT_DIR / 'dashboard'), static_url_path='/dashboard')

# 启用 CORS，允许前端访问
CORS(app, resources={
    r"/api/*": {
        "origins": ["*", "http://localhost:8888", "http://127.0.0.1:8888"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    },
    r"/stream": {
        "origins": ["*", "http://localhost:8888", "http://127.0.0.1:8888"]
    }
})


@app.route('/')
def index():
    """根路径重定向到 dashboard"""
    return app.send_static_file('index.html')

# SSE 客户端队列
sse_clients = []
sse_clients_lock = Lock()

# 文件缓存
_file_cache = {}
_file_cache_lock = Lock()
CACHE_TTL_SECONDS = 2  # 缓存有效期


def read_json_file(filepath, use_cache=True):
    """安全地读取 JSON 文件，处理各种错误情况，支持缓存。"""
    filepath_str = str(filepath)

    # 检查缓存
    if use_cache:
        with _file_cache_lock:
            cached = _file_cache.get(filepath_str)
            if cached:
                mtime, data, cached_time = cached
                # 检查文件是否修改或缓存是否过期
                try:
                    current_mtime = os.path.getmtime(filepath_str)
                    if current_mtime == mtime and time.time() - cached_time < CACHE_TTL_SECONDS:
                        return data
                except OSError:
                    pass

    # 读取文件
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # 更新缓存
        if use_cache:
            try:
                mtime = os.path.getmtime(filepath_str)
                with _file_cache_lock:
                    _file_cache[filepath_str] = (mtime, data, time.time())
            except OSError:
                pass

        return data
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {str(e)}", "path": filepath_str}
    except Exception as e:
        return {"error": str(e), "path": filepath_str}


def read_jsonl_file(filepath):
    """读取 JSON Lines 文件，返回记录列表。"""
    records = []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # 跳过无效行
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
    return records


def get_all_teams():
    """获取所有团队配置。"""
    teams = []

    if not TEAMS_DIR.exists():
        return teams

    for team_dir in TEAMS_DIR.iterdir():
        if not team_dir.is_dir():
            continue

        config_path = team_dir / "config.json"
        config = read_json_file(config_path)

        if config and "error" not in config:
            # 简化数据，只返回必要字段
            members = config.get("members", [])
            # 从第一个成员的 cwd 推断项目路径
            project_path = members[0].get("cwd", "") if members else ""

            teams.append({
                "name": config.get("name", team_dir.name),
                "description": config.get("description", ""),
                "leadAgentId": config.get("leadAgentId", ""),
                "project": project_path,
                "status": "active",  # 简化处理，默认 active
                "members": [
                    {
                        "name": m.get("name", ""),
                        "agentType": m.get("agentType", ""),
                        "model": m.get("model", ""),
                        "color": m.get("color", "blue")
                    }
                    for m in members
                ],
                "memberCount": len(members),
                "createdAt": config.get("createdAt", 0)
            })

    return teams


def get_team_messages(team_name):
    """获取指定团队的所有消息。"""
    messages = []

    inbox_dir = TEAMS_DIR / team_name / "inboxes"
    if not inbox_dir.exists():
        return messages

    for msg_file in inbox_dir.glob("*.json"):
        data = read_json_file(msg_file)
        if data and "error" not in data:
            # 文件内容可能是列表或单个消息
            if isinstance(data, list):
                for msg in data:
                    msg["_source"] = msg_file.stem
                    messages.append(msg)
            else:
                data["_source"] = msg_file.stem
                messages.append(data)

    # 按时间戳排序（最新的在前）
    messages.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return messages


def get_team_tasks(team_name):
    """获取指定团队的所有任务。"""
    tasks = []

    team_tasks_dir = TASKS_DIR / team_name
    if not team_tasks_dir.exists():
        return tasks

    for task_file in team_tasks_dir.glob("*.json"):
        # 跳过锁文件
        if task_file.name == ".lock":
            continue

        data = read_json_file(task_file)
        if data and "error" not in data:
            tasks.append(data)

    # 按 ID 排序
    tasks.sort(key=lambda x: int(x.get("id", 0)))
    return tasks


# 会话缓存
_sessions_cache = {"data": [], "mtime": 0, "dir_mtime": 0}

def _get_dir_mtime(dir_path):
    """获取目录的最新修改时间。"""
    try:
        return os.path.getmtime(str(dir_path))
    except OSError:
        return 0

def get_all_sessions():
    """获取所有历史会话（从 projects 目录读取）。"""
    sessions = []

    if not PROJECTS_DIR.exists():
        return sessions

    # 遍历 projects 目录下的所有 jsonl 文件
    for project_dir in PROJECTS_DIR.iterdir():
        if not project_dir.is_dir():
            continue

        for session_file in project_dir.glob("*.jsonl"):
            records = read_jsonl_file(session_file)

            if records:
                # 提取会话信息
                first_record = records[0]
                last_record = records[-1] if records else first_record

                # 从 cwd 提取项目路径
                project_path = first_record.get("cwd", "")
                # 从文件路径提取日期（文件名通常是 UUID，使用文件修改时间）
                try:
                    mtime = session_file.stat().st_mtime
                    date_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")
                except:
                    date_str = "unknown"

                # 查找第一条有效的用户输入或输出来作为预览
                preview = ""
                for record in records:
                    # 尝试从 data 中提取内容
                    data = record.get("data", {})
                    if isinstance(data, dict):
                        content = data.get("content") or data.get("text") or ""
                        if content and len(content) > 5:
                            preview = content[:150] + "..." if len(content) > 150 else content
                            break
                    # 尝试从顶级字段提取
                    content = record.get("content") or record.get("text") or ""
                    if content and len(content) > 5:
                        preview = content[:150] + "..." if len(content) > 150 else content
                        break

                # 如果没有找到内容，使用记录类型作为预览
                if not preview:
                    for record in records[:3]:
                        record_type = record.get("type", "unknown")
                        if record_type != "progress":
                            preview = f"[{record_type}]"
                            break
                    if not preview:
                        preview = "[Session started]"

                sessions.append({
                    "sessionId": first_record.get("sessionId", session_file.stem),
                    "date": date_str,
                    "project": project_path,
                    "messageCount": len(records),
                    "firstMessage": first_record.get("timestamp", ""),
                    "lastMessage": last_record.get("timestamp", ""),
                    "preview": preview or "[无内容预览]"
                })

    # 按日期降序排序（最新的在前）
    sessions.sort(key=lambda x: x.get("date", ""), reverse=True)

    return sessions


# ============ API 路由 ============

@app.route("/api/teams")
def api_teams():
    """获取所有团队列表。"""
    teams = get_all_teams()
    return jsonify({
        "success": True,
        "teams": teams,
        "count": len(teams)
    })


@app.route("/api/teams/<name>/messages")
def api_team_messages(name):
    """获取指定团队的消息。"""
    messages = get_team_messages(name)
    return jsonify({
        "success": True,
        "team": name,
        "messages": messages,
        "count": len(messages)
    })


@app.route("/api/tasks/<team_name>")
def api_team_tasks(team_name):
    """获取指定团队的任务。"""
    tasks = get_team_tasks(team_name)
    return jsonify({
        "success": True,
        "team": team_name,
        "tasks": tasks,
        "count": len(tasks)
    })


def get_agent_inboxes(team_name):
    """获取团队中每个 agent 的 inbox 内容。"""
    team_dir = TEAMS_DIR / team_name / "inboxes"
    if not team_dir.exists():
        return {}

    inboxes = {}
    for inbox_file in team_dir.glob("*.json"):
        agent_name = inbox_file.stem
        try:
            with open(inbox_file, 'r', encoding='utf-8') as f:
                messages = json.load(f)
                inboxes[agent_name] = messages
        except Exception:
            inboxes[agent_name] = []
    return inboxes


@app.route("/api/teams/<team_name>/inboxes")
def api_team_inboxes(team_name):
    """获取指定团队中所有 agent 的 inbox。"""
    inboxes = get_agent_inboxes(team_name)
    return jsonify({
        "success": True,
        "team": team_name,
        "inboxes": inboxes,
        "count": len(inboxes)
    })


@app.route("/api/sessions")
def api_sessions():
    """获取所有历史会话。"""
    sessions = get_all_sessions()
    return jsonify({
        "success": True,
        "sessions": sessions,
        "count": len(sessions)
    })


@app.route("/api/sessions/<session_id>")
def api_session_detail(session_id):
    """获取单个会话的详细记录（从 jsonl 文件读取）。"""
    records = []

    if not PROJECTS_DIR.exists():
        return jsonify({"success": False, "error": "Projects directory not found"}), 404

    # 遍历查找匹配的 session 文件
    for project_dir in PROJECTS_DIR.iterdir():
        if not project_dir.is_dir():
            continue

        for session_file in project_dir.glob("*.jsonl"):
            if session_file.stem == session_id:
                # 找到匹配的文件，读取所有记录
                records = read_jsonl_file(session_file)

                # 提取会话基本信息
                first_record = records[0] if records else {}

                return jsonify({
                    "success": True,
                    "sessionId": session_id,
                    "project": first_record.get("cwd", ""),
                    "records": records,
                    "count": len(records)
                })

    return jsonify({"success": False, "error": "Session not found"}), 404


@app.route("/api/config", methods=["GET"])
def api_get_config():
    """获取 Dashboard 配置。"""
    config = load_dashboard_config()
    return jsonify({
        "success": True,
        "config": config
    })


@app.route("/api/config", methods=["POST"])
def api_save_config():
    """保存 Dashboard 配置。"""
    try:
        new_config = request.get_json()
        if not new_config:
            return jsonify({"success": False, "error": "Invalid JSON"}), 400

        # 加载现有配置并合并
        config = load_dashboard_config()
        config.update(new_config)

        if save_dashboard_config(config):
            return jsonify({"success": True, "config": config})
        else:
            return jsonify({"success": False, "error": "Failed to save config"}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/health")
def api_health():
    """健康检查端点。"""
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    })


# ============ SSE 实现 ============

class SSEClient:
    """SSE 客户端连接管理。"""

    def __init__(self):
        self.queue = []
        self.lock = Lock()

    def send(self, event_type, data):
        """发送事件到客户端队列。"""
        with self.lock:
            self.queue.append({
                "event": event_type,
                "data": json.dumps(data)
            })

    def get_messages(self):
        """获取并清空消息队列。"""
        with self.lock:
            messages = self.queue.copy()
            self.queue.clear()
            return messages


def broadcast_event(event_type, data):
    """广播事件到所有连接的 SSE 客户端。"""
    # 复制客户端列表，避免在遍历时持有锁
    with sse_clients_lock:
        clients_copy = sse_clients.copy()

    for client in clients_copy:
        client.send(event_type, data)


@app.route("/stream")
def stream():
    """SSE 实时推送端点。"""
    client = SSEClient()

    with sse_clients_lock:
        sse_clients.append(client)

    def generate():
        try:
            # 发送初始连接成功事件
            yield f"event: connected\ndata: {json.dumps({'message': 'SSE connected', 'time': datetime.now().isoformat()})}\n\n"

            while True:
                # 获取客户端的消息
                messages = client.get_messages()
                for msg in messages:
                    yield f"event: {msg['event']}\ndata: {msg['data']}\n\n"

                # 如果没有消息，发送心跳保持连接
                if not messages:
                    yield f"event: ping\ndata: {json.dumps({'time': datetime.now().isoformat()})}\n\n"

                time.sleep(1)

        except GeneratorExit:
            # 客户端断开连接
            with sse_clients_lock:
                if client in sse_clients:
                    sse_clients.remove(client)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"  # 禁用 Nginx 缓冲
        }
    )


# ============ 文件监听 ============

class ClaudeFileHandler(FileSystemEventHandler):
    """监听 Claude 数据文件变化并推送 SSE 事件。"""

    def __init__(self):
        self.last_event_time = {}
        self.debounce_seconds = 0.5  # 防抖时间

    def should_process(self, path):
        """检查是否应该处理该事件（防抖）。"""
        now = time.time()
        last = self.last_event_time.get(path, 0)

        if now - last < self.debounce_seconds:
            return False

        self.last_event_time[path] = now
        return True

    def on_modified(self, event):
        """文件修改事件。"""
        if event.is_directory:
            return

        if not self.should_process(str(event.src_path)):
            return

        path = Path(event.src_path)

        # 根据文件类型发送不同的事件
        if "inboxes" in str(path):
            # 团队消息更新
            team_name = path.parent.parent.name
            broadcast_event("message_updated", {
                "team": team_name,
                "file": path.name,
                "timestamp": datetime.now().isoformat()
            })

        elif path.name == "config.json":
            # 团队配置更新
            team_name = path.parent.name
            broadcast_event("team_updated", {
                "team": team_name,
                "timestamp": datetime.now().isoformat()
            })

        elif ".claude/tasks" in str(path) and path.suffix == ".json":
            # 任务更新
            team_name = path.parent.name
            broadcast_event("task_updated", {
                "team": team_name,
                "file": path.name,
                "timestamp": datetime.now().isoformat()
            })

        elif path.suffix == ".jsonl":
            # 会话日志更新
            broadcast_event("session_updated", {
                "file": path.name,
                "timestamp": datetime.now().isoformat()
            })

    def on_created(self, event):
        """文件创建事件。"""
        if event.is_directory:
            return

        path = Path(event.src_path)

        if ".claude/tasks" in str(path) and path.suffix == ".json":
            team_name = path.parent.name
            broadcast_event("task_created", {
                "team": team_name,
                "file": path.name,
                "timestamp": datetime.now().isoformat()
            })

        elif path.suffix == ".jsonl":
            broadcast_event("session_created", {
                "file": path.name,
                "timestamp": datetime.now().isoformat()
            })

    def on_deleted(self, event):
        """文件删除事件。"""
        if event.is_directory:
            return

        path = Path(event.src_path)

        if ".claude/tasks" in str(path) and path.suffix == ".json":
            team_name = path.parent.name
            broadcast_event("task_deleted", {
                "team": team_name,
                "file": path.name,
                "timestamp": datetime.now().isoformat()
            })


def start_file_watcher():
    """启动文件监听。"""
    observer = Observer()
    handler = ClaudeFileHandler()

    # 监听团队目录
    if TEAMS_DIR.exists():
        observer.schedule(handler, str(TEAMS_DIR), recursive=True)
        print(f"[Watcher] Watching: {TEAMS_DIR}")

    # 监听任务目录
    if TASKS_DIR.exists():
        observer.schedule(handler, str(TASKS_DIR), recursive=True)
        print(f"[Watcher] Watching: {TASKS_DIR}")

    # 监听日志目录
    if LOGS_DIR.exists():
        observer.schedule(handler, str(LOGS_DIR), recursive=True)
        print(f"[Watcher] Watching: {LOGS_DIR}")

    observer.start()
    return observer


# ============ 主程序 ============

if __name__ == "__main__":
    print("=" * 50)
    print("Claude Dashboard Backend Server")
    print("=" * 50)
    print(f"Dashboard:    http://localhost:{PORT}/")
    print(f"API Base URL: http://localhost:{PORT}")
    print(f"SSE Stream:   http://localhost:{PORT}/stream")
    print("-" * 50)

    # 确保数据目录存在
    TEAMS_DIR.mkdir(parents=True, exist_ok=True)
    TASKS_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    # 启动文件监听
    observer = start_file_watcher()

    try:
        # 启动 Flask 服务器
        # 使用 threaded=True 支持多客户端
        app.run(
            host=HOST,
            port=PORT,
            threaded=True,
            debug=False,
            use_reloader=False  # 禁用重载器，避免与 watchdog 冲突
        )
    except KeyboardInterrupt:
        print("\n[Server] Shutting down...")
    finally:
        observer.stop()
        observer.join()
        print("[Server] Stopped.")
