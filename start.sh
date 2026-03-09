#!/bin/bash
#
# Claude Dashboard 启动脚本
# 一键启动后端服务器并打开浏览器
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
PORT=8765
HOST="localhost"
SERVER_URL="http://${HOST}:${PORT}"
DASHBOARD_URL="${SERVER_URL}/"

# 项目目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Claude Dashboard 启动脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}错误: 未找到 Python3${NC}"
    echo "请先安装 Python 3.8+"
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo -e "${GREEN}✓ Python 版本: $PYTHON_VERSION${NC}"

# 检查 pip
if ! command -v pip3 &> /dev/null; then
    echo -e "${RED}错误: 未找到 pip3${NC}"
    exit 1
fi

echo -e "${GREEN}✓ pip3 已安装${NC}"

# 创建虚拟环境
echo ""
echo -e "${YELLOW}→ 检查虚拟环境...${NC}"
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}  创建虚拟环境...${NC}"
    python3 -m venv venv
fi

# 激活虚拟环境
source venv/bin/activate
echo -e "${GREEN}✓ 虚拟环境已激活${NC}"

# 安装依赖
echo ""
echo -e "${YELLOW}→ 检查依赖...${NC}"

if [ -f "requirements.txt" ]; then
    pip install -q -r requirements.txt
    echo -e "${GREEN}✓ 依赖已安装/更新${NC}"
else
    echo -e "${YELLOW}⚠ 未找到 requirements.txt，尝试安装基本依赖...${NC}"
    pip install -q flask flask-cors watchdog
    echo -e "${GREEN}✓ 基本依赖已安装${NC}"
fi

# 检查端口是否被占用
echo ""
echo -e "${YELLOW}→ 检查端口 $PORT...${NC}"

if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ 端口 $PORT 已被占用，尝试关闭现有进程...${NC}"
    lsof -Pi :$PORT -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
    sleep 1
fi

echo -e "${GREEN}✓ 端口 $PORT 可用${NC}"

# 创建日志目录
echo ""
echo -e "${YELLOW}→ 检查数据目录...${NC}"
mkdir -p ~/.claude/logs/sessions
mkdir -p ~/.claude/teams
mkdir -p ~/.claude/tasks
echo -e "${GREEN}✓ 数据目录已就绪${NC}"

# 启动服务器
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}  启动服务器...${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 在后台启动服务器
python3 server.py &
SERVER_PID=$!

# 等待服务器启动
echo -e "${YELLOW}→ 等待服务器启动...${NC}"
sleep 2

# 检查服务器是否成功启动
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo -e "${RED}错误: 服务器启动失败${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 服务器已启动 (PID: $SERVER_PID)${NC}"
echo ""
echo -e "  ${BLUE}API 地址:${NC}   ${SERVER_URL}"
echo -e "  ${BLUE}健康检查:${NC} ${SERVER_URL}/api/health"
echo -e "  ${BLUE}SSE 流:${NC}    ${SERVER_URL}/stream"
echo ""

# 打开浏览器
echo -e "${YELLOW}→ 正在打开浏览器...${NC}"

# 根据操作系统打开浏览器
case "$(uname -s)" in
    Darwin*)    # macOS
        open "$DASHBOARD_URL" 2>/dev/null || open "$SERVER_URL" 2>/dev/null || true
        ;;
    Linux*)     # Linux
        xdg-open "$DASHBOARD_URL" 2>/dev/null || xdg-open "$SERVER_URL" 2>/dev/null || true
        ;;
    CYGWIN*|MINGW*|MSYS*)  # Windows
        start "$DASHBOARD_URL" 2>/dev/null || start "$SERVER_URL" 2>/dev/null || true
        ;;
    *)
        echo -e "${YELLOW}⚠ 请手动打开浏览器访问: $DASHBOARD_URL${NC}"
        ;;
esac

echo ""
echo -e "${GREEN}✓ Dashboard 已启动！${NC}"
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "按 Ctrl+C 停止服务器"
echo -e "${BLUE}========================================${NC}"
echo ""

# 等待服务器进程
wait $SERVER_PID
