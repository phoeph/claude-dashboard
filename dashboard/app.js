// Claude Dashboard - Alpine.js App
// =================================

// 定义全局 dashboardApp 函数供 x-data 使用
function dashboardApp() {
    return {
        // 状态
        currentView: 'teams',
        loading: false,
        sseConnected: false,
        selectedTeam: null,
        sessionSearch: '',
        showSessionModal: false,
        selectedSession: null,
        selectedSessionRecords: [],
        selectedSessionLoading: false,

        // Session 详情筛选
        sessionRecordFilter: 'all', // all, user, assistant, system, tool, other
        sessionTimeFilter: 'all', // all, today, yesterday, week, hour

        // 虚拟滚动
        sessionVisibleStart: 0,
        sessionVisibleCount: 50,
        sessionItemHeight: 100, // 估算每条记录高度

        // 缓存
        _filteredRecordsCache: null,
        _lastFilterKey: '',

        // 数据
        teams: [],
        messages: {},
        tasks: {},
        sessions: [],
        toasts: [],
        agentInboxes: {},
        messageFilterAgent: null,
        selectedTask: null,
        showTaskModal: false,

        // 配置
        config: {
            defaultCwd: '',
            updatedAt: null
        },
        newCwd: '',
        saving: false,
        configMessage: '',
        configSuccess: false,

        // SSE
        eventSource: null,
        reconnectAttempts: 0,
        maxReconnectAttempts: 10,
        reconnectDelay: 1000,

        // Caching & Performance
        _todayMessageCount: 0,
        _lastMessageCountUpdate: 0,
        _iconRefreshTimeout: null,
        MAX_MESSAGES_PER_TEAM: 100,

        // Agent 颜色映射
        agentColors: {
            'user': 'blue',
            'assistant': 'purple',
            'system': 'gray',
            'team-lead': 'indigo',
            'researcher': 'emerald',
            'developer': 'amber',
            'tester': 'rose',
            'default': 'slate'
        },

        // 初始化
        async init() {
            // 初始化 Lucide icons
            this.refreshIcons();

            // 加载初始数据
            await this.refreshTeams();

            // 如果选中了团队，立即加载数据
            if (this.selectedTeam) {
                await this.loadTeamData(this.selectedTeam);
            }

            // 预加载所有团队的消息数量
            await this.preloadAllTeamMessages();

            await this.refreshSessions();

            // 连接 SSE
            this.connectSSE();

            // 监听视图变化，重新渲染图标
            this.$watch('currentView', () => {
                this.refreshIcons();
            });

            // 监听筛选变化，清除缓存
            this.$watch('sessionRecordFilter', () => {
                this._filteredRecordsCache = null;
                this.sessionVisibleStart = 0;
            });
            this.$watch('sessionTimeFilter', () => {
                this._filteredRecordsCache = null;
                this.sessionVisibleStart = 0;
            });

            // 监听选中团队变化
            this.$watch('selectedTeam', (teamName) => {
                if (teamName) {
                    this.loadTeamData(teamName);
                    // 重置过滤器
                    this.messageFilterAgent = null;
                }
            });

            // 加载配置
            this.loadConfig();
        },

        // ==================== API 调用 ====================

        async apiGet(endpoint) {
            try {
                const response = await fetch(`http://localhost:8765${endpoint}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json();
            } catch (error) {
                console.error(`API Error: ${endpoint}`, error);
                this.showToast(`请求失败: ${error.message}`, 'error');
                throw error;
            }
        },

        async refreshTeams() {
            this.loading = true;
            try {
                const data = await this.apiGet('/api/teams');
                this.teams = data.teams || [];

                // 如果没有选中团队，默认选中第一个
                if (!this.selectedTeam && this.teams.length > 0) {
                    this.selectedTeam = this.teams[0].name;
                }
            } catch (error) {
                // 使用模拟数据
                this.teams = [
                    { name: 'team-alpha', status: 'active', members: ['agent1', 'agent2'], project: '/project/alpha' },
                    { name: 'team-beta', status: 'idle', members: ['agent3'], project: '/project/beta' }
                ];
            } finally {
                this.loading = false;
                this.refreshIcons();
            }
        },

        async loadTeamData(teamName) {
            if (!teamName) return;

            // 加载消息
            try {
                const msgData = await this.apiGet(`/api/teams/${teamName}/messages`);
                this.messages[teamName] = msgData.messages || [];
            } catch (error) {
                this.messages[teamName] = [];
            }

            // 加载任务并初始化展开状态
            try {
                const taskData = await this.apiGet(`/api/tasks/${teamName}`);
                // 为每个任务初始化 _expanded 属性
                this.tasks[teamName] = (taskData.tasks || []).map(task => ({
                    ...task,
                    _expanded: false
                }));
            } catch (error) {
                this.tasks[teamName] = [];
            }

            this.refreshIcons();
            this.scrollToBottom();

            // 自动加载 agent inboxes (用于群聊显示)
            this.loadAgentInboxes(teamName);
        },

        async refreshSessions() {
            try {
                const data = await this.apiGet('/api/sessions');
                this.sessions = data.sessions || [];
            } catch (error) {
                // 模拟数据
                this.sessions = [];
            }
            this.refreshIcons();
        },

        async loadAgentInboxes(teamName) {
            if (!teamName) return;
            try {
                const data = await this.apiGet(`/api/teams/${teamName}/inboxes`);
                this.agentInboxes = data.inboxes || {};
            } catch (error) {
                this.agentInboxes = {};
            }
        },

        // ==================== SSE 连接 ====================

        connectSSE() {
            if (this.eventSource) {
                this.eventSource.close();
            }

            try {
                this.eventSource = new EventSource('http://localhost:8765/stream');

                this.eventSource.onopen = () => {
                    this.sseConnected = true;
                    this.reconnectAttempts = 0;
                    this.showToast('实时连接已建立');
                };

                this.eventSource.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleSSEMessage(data);
                    } catch (error) {
                        console.error('SSE parse error:', error);
                    }
                };

                this.eventSource.onerror = () => {
                    this.sseConnected = false;
                    this.eventSource.close();
                    this.attemptReconnect();
                };

            } catch (error) {
                this.sseConnected = false;
                this.attemptReconnect();
            }
        },

        attemptReconnect() {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.showToast('连接失败，请刷新页面重试', 'error');
                return;
            }

            this.reconnectAttempts++;
            const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

            setTimeout(() => this.connectSSE(), delay);
        },

        handleSSEMessage(data) {
            switch (data.type) {
                case 'message':
                    this.handleNewMessage(data);
                    break;
                case 'task_update':
                    this.handleTaskUpdate(data);
                    break;
                case 'team_update':
                    this.handleTeamUpdate(data);
                    break;
                case 'session_update':
                    this.handleSessionUpdate(data);
                    break;
            }
        },

        handleNewMessage(data) {
            const teamName = data.team_name;
            if (!this.messages[teamName]) {
                this.messages[teamName] = [];
            }
            this.messages[teamName].push(data.message);

            // 限制消息数量 - 移除旧消息保持数组大小
            if (this.messages[teamName].length > this.MAX_MESSAGES_PER_TEAM) {
                this.messages[teamName] = this.messages[teamName].slice(-this.MAX_MESSAGES_PER_TEAM);
            }

            // 更新今日消息计数缓存
            this._updateTodayMessageCount();

            // 如果是当前选中的团队，滚动到底部
            if (this.selectedTeam === teamName) {
                this.$nextTick(() => {
                    this.scrollToBottom();
                    this.refreshIcons();
                });
            }
        },

        handleTaskUpdate(data) {
            const teamName = data.team_name;
            if (!this.tasks[teamName]) {
                this.tasks[teamName] = [];
            }

            const existingIndex = this.tasks[teamName].findIndex(t => t.id === data.task.id);
            if (existingIndex >= 0) {
                this.tasks[teamName][existingIndex] = { ...this.tasks[teamName][existingIndex], ...data.task };
            } else {
                this.tasks[teamName].push(data.task);
            }

            this.refreshIcons();
        },

        handleTeamUpdate(data) {
            const existingIndex = this.teams.findIndex(t => t.name === data.team.name);
            if (existingIndex >= 0) {
                this.teams[existingIndex] = { ...this.teams[existingIndex], ...data.team };
            } else {
                this.teams.push(data.team);
            }
        },

        handleSessionUpdate(data) {
            this.refreshSessions();
        },

        // ==================== 计算属性 ====================

        get teamAgents() {
            const team = this.teams.find(t => t.name === this.selectedTeam);
            return team ? (team.members || []).map(m => m.name) : [];
        },

        get currentMessages() {
            // 合并所有 agent inbox 中的消息，形成群聊时间线
            const allMessages = [];

            // 从所有 agent 的 inbox 收集消息
            Object.entries(this.agentInboxes || {}).forEach(([inboxOwner, messages]) => {
                (messages || []).forEach(msg => {
                    // 添加收件人信息到消息中
                    allMessages.push({
                        ...msg,
                        _inboxOwner: inboxOwner,
                        _isToMe: inboxOwner === this.messageFilterAgent,
                        _isFromMe: msg.from === this.messageFilterAgent
                    });
                });
            });

            // 去重：基于 timestamp + from + text 的哈希
            const seen = new Set();
            const uniqueMessages = allMessages.filter(msg => {
                const key = `${msg.timestamp}_${msg.from}_${msg.text?.slice(0, 50)}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            // 按时间正序排列（从早到晚）
            let sorted = uniqueMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            // 如果有过滤器，只显示相关消息
            if (this.messageFilterAgent) {
                sorted = sorted.filter(msg =>
                    msg.from === this.messageFilterAgent ||
                    msg._inboxOwner === this.messageFilterAgent
                );
            }

            return sorted;
        },

        get currentTasks() {
            return this.tasks[this.selectedTeam] || [];
        },

        get filteredSessions() {
            if (!this.sessionSearch) return this.sessions;

            const search = this.sessionSearch.toLowerCase();
            return this.sessions.filter(s =>
                (s.project || '').toLowerCase().includes(search) ||
                (s.preview || '').toLowerCase().includes(search)
            );
        },

        get groupedSessions() {
            const groups = {};

            this.filteredSessions.forEach(session => {
                // 使用结束时间（lastMessage）作为分组依据
                const date = this.getDateKey(session.lastMessage);
                if (!groups[date]) {
                    groups[date] = { date, sessions: [] };
                }
                groups[date].sessions.push(session);
            });

            // 按日期降序排列
            return Object.values(groups).sort((a, b) =>
                new Date(b.date) - new Date(a.date)
            );
        },

        // 判断记录是否是真正的用户消息（排除 tool_result）
        _isRealUserMessage(record) {
            if (record.type !== 'user') return false;
            const content = record.message?.content;
            // 如果 content 是数组且包含 tool_result，则不是真正的用户消息
            if (Array.isArray(content)) {
                return !content.some(c => c.type === 'tool_result' || c.type === 'tool_use');
            }
            return true;
        },

        // 判断记录是否是 tool_result（被包装成 user 类型）
        _isToolResult(record) {
            if (record.type !== 'user') return false;
            const content = record.message?.content;
            if (Array.isArray(content)) {
                return content.some(c => c.type === 'tool_result');
            }
            return false;
        },

        // 筛选缓存键
        _getFilterCacheKey() {
            return `${this.sessionRecordFilter}|${this.sessionTimeFilter}|${this.selectedSessionRecords?.length}`;
        },

        get filteredSessionRecords() {
            if (!this.selectedSessionRecords) return [];

            const cacheKey = this._getFilterCacheKey();
            if (this._filteredRecordsCache && this._lastFilterKey === cacheKey) {
                return this._filteredRecordsCache;
            }

            const result = this.selectedSessionRecords.filter(record => {
                // 类型筛选
                if (this.sessionRecordFilter !== 'all') {
                    const type = record.type || 'unknown';
                    const dataType = record.data?.type || '';

                    switch (this.sessionRecordFilter) {
                        case 'user':
                            if (!this._isRealUserMessage(record)) return false;
                            break;
                        case 'tool':
                            const isToolUse = dataType === 'tool_use' || dataType === 'tool_result';
                            const isToolResultInUser = this._isToolResult(record);
                            const isToolUseInAssistant = type === 'assistant' && record.message?.content &&
                                Array.isArray(record.message.content) &&
                                record.message.content.some(c => c.type === 'tool_use' || c.type === 'tool_result');
                            if (!isToolUse && !isToolResultInUser && !isToolUseInAssistant) return false;
                            break;
                        case 'assistant':
                            if (type !== 'assistant') return false;
                            break;
                        case 'system':
                            if (type !== 'system') return false;
                            break;
                        case 'other':
                            if (['user', 'assistant', 'system', 'progress', 'file-history-snapshot'].includes(type)) return false;
                            break;
                    }
                }

                // 时间筛选
                if (this.sessionTimeFilter !== 'all' && record.timestamp) {
                    const recordDate = new Date(record.timestamp);
                    const now = new Date();
                    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);

                    switch (this.sessionTimeFilter) {
                        case 'hour':
                            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
                            if (recordDate < oneHourAgo) return false;
                            break;
                        case 'today':
                            if (recordDate < today) return false;
                            break;
                        case 'yesterday':
                            if (recordDate < yesterday || recordDate >= today) return false;
                            break;
                        case 'week':
                            const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                            if (recordDate < oneWeekAgo) return false;
                            break;
                    }
                }

                return true;
            });

            // 缓存结果
            this._filteredRecordsCache = result;
            this._lastFilterKey = cacheKey;

            // 重置虚拟滚动位置
            this.sessionVisibleStart = 0;

            return result;
        },

        // 虚拟滚动：只返回可见区域的记录
        get visibleSessionRecords() {
            const filtered = this.filteredSessionRecords;
            return filtered.slice(this.sessionVisibleStart, this.sessionVisibleStart + this.sessionVisibleCount);
        },

        // 虚拟滚动容器高度
        get sessionScrollHeight() {
            return this.filteredSessionRecords.length * this.sessionItemHeight;
        },

        get todayMessageCount() {
            // 如果缓存是新的（1秒内），返回缓存值
            const now = Date.now();
            if (now - this._lastMessageCountUpdate < 1000) {
                return this._todayMessageCount;
            }
            return this._calculateTodayMessageCount();
        },

        _calculateTodayMessageCount() {
            const today = new Date().toDateString();
            let count = 0;

            Object.values(this.messages).forEach(msgs => {
                count += msgs.filter(m =>
                    new Date(m.timestamp).toDateString() === today
                ).length;
            });

            this._todayMessageCount = count;
            this._lastMessageCountUpdate = Date.now();
            return count;
        },

        _updateTodayMessageCount() {
            // 增量更新缓存
            this._todayMessageCount = this._calculateTodayMessageCount();
            this._lastMessageCountUpdate = Date.now();
        },

        get activeTaskCount() {
            let count = 0;
            Object.values(this.tasks).forEach(taskList => {
                count += taskList.filter(t =>
                    t.status === 'in_progress' || t.status === 'pending'
                ).length;
            });
            return count;
        },

        // ==================== 辅助方法 ====================

        selectTeam(teamName) {
            this.selectedTeam = teamName;
        },

        async openSessionDetail(session) {
            this.selectedSession = session;
            this.selectedSessionRecords = [];
            this.selectedSessionLoading = true;
            this.showSessionModal = true;
            // 重置筛选条件和虚拟滚动
            this.sessionRecordFilter = 'all';
            this.sessionTimeFilter = 'all';
            this.sessionVisibleStart = 0;
            this._filteredRecordsCache = null;
            this._lastFilterKey = '';
            this.refreshIcons();

            // 加载详细记录
            try {
                const data = await this.apiGet(`/api/sessions/${session.sessionId}`);
                if (data.success) {
                    // 大数据量优化：分批处理避免阻塞 UI
                    const records = data.records || [];
                    if (records.length > 1000) {
                        // 先加载前 100 条快速显示
                        this.selectedSessionRecords = records.slice(0, 100);
                        this.selectedSessionLoading = false;
                        // 使用 requestIdleCallback 加载剩余数据
                        if ('requestIdleCallback' in window) {
                            window.requestIdleCallback(() => {
                                this.selectedSessionRecords = records;
                            }, { timeout: 1000 });
                        } else {
                            setTimeout(() => {
                                this.selectedSessionRecords = records;
                            }, 100);
                        }
                    } else {
                        this.selectedSessionRecords = records;
                    }
                }
            } catch (e) {
                console.error('Failed to load session details:', e);
            } finally {
                if (this.selectedSessionRecords.length <= 1000) {
                    this.selectedSessionLoading = false;
                }
            }
        },

        openTaskDetail(task) {
            this.selectedTask = task;
            this.showTaskModal = true;
            this.refreshIcons();
        },

        // 虚拟滚动处理
        handleSessionScroll(e) {
            const scrollTop = e.target.scrollTop;
            this.sessionVisibleStart = Math.floor(scrollTop / this.sessionItemHeight);
        },

        // 计算会话时长
        getSessionDuration(startTime, endTime) {
            if (!startTime || !endTime) return '-';
            const start = new Date(startTime);
            const end = new Date(endTime);
            const diffMs = end - start;

            if (diffMs < 0) return '-';

            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

            if (hours > 0) {
                return `${hours}小时${minutes}分钟`;
            } else if (minutes > 0) {
                return `${minutes}分钟${seconds}秒`;
            } else {
                return `${seconds}秒`;
            }
        },

        // ==================== 配置管理 ====================

        async loadConfig() {
            try {
                const data = await this.apiGet('/api/config');
                if (data.success) {
                    this.config = data.config;
                    this.newCwd = data.config.defaultCwd || '';
                }
            } catch (e) {
                console.error('Failed to load config:', e);
            }
        },

        async saveConfig() {
            if (!this.newCwd) return;

            this.saving = true;
            this.configMessage = '';

            try {
                const response = await fetch('http://localhost:8765/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ defaultCwd: this.newCwd })
                });

                const data = await response.json();

                if (data.success) {
                    this.config = data.config;
                    this.configMessage = '设置已保存';
                    this.configSuccess = true;
                } else {
                    this.configMessage = data.error || '保存失败';
                    this.configSuccess = false;
                }
            } catch (e) {
                this.configMessage = '网络错误: ' + e.message;
                this.configSuccess = false;
            } finally {
                this.saving = false;
                setTimeout(() => { this.configMessage = ''; }, 3000);
            }
        },

        resetConfig() {
            this.newCwd = this.config.defaultCwd || '';
            this.configMessage = '';
        },

        selectDirectory() {
            // 由于浏览器安全限制，无法直接访问文件系统
            // 提示用户手动输入路径
            const path = prompt('请输入目录的绝对路径:');
            if (path) {
                this.newCwd = path.trim();
            }
        },

        // 预计算记录属性（避免模板中重复计算）
        getRecordDisplayProps(record) {
            const type = record.type || 'unknown';
            const isToolResult = type === 'user' &&
                Array.isArray(record.message?.content) &&
                record.message.content.some(c => c.type === 'tool_result');

            return {
                type: isToolResult ? 'tool' : type,
                isToolResult,
                displayType: isToolResult ? 'tool' : (type || 'unknown'),
                tagClass: this._getRecordTagClass(type, isToolResult)
            };
        },

        _getRecordTagClass(type, isToolResult) {
            if (type === 'user' && !isToolResult) return 'bg-blue-500/20 text-blue-400';
            if (type === 'assistant' || isToolResult) return 'bg-emerald-500/20 text-emerald-400';
            if (type === 'system') return 'bg-yellow-500/20 text-yellow-400';
            return 'bg-slate-500/20 text-slate-400';
        },

        getTaskPreview(description) {
            if (!description || typeof description !== 'string') return '[无描述]';
            // 移除 Markdown 标记，提取纯文本预览
            const plainText = description
                .replace(/#+ /g, '')
                .replace(/\*\*/g, '')
                .replace(/\*/g, '')
                .replace(/`{3}[\s\S]*?`{3}/g, '[代码]')
                .replace(/`([^`]+)`/g, '$1')
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .replace(/\n+/g, ' ')
                .trim();

            return plainText.length > 100 ? plainText.substring(0, 100) + '...' : plainText;
        },

        getTeamMessageCount(teamName) {
            // 从 agentInboxes 计算消息数量
            const inboxes = this.agentInboxes || {};
            // 这里需要获取特定团队的 inbox，但 agentInboxes 是当前选中团队的
            // 所以使用 messages 缓存
            return (this.messages[teamName] || []).length;
        },

        // 预加载所有团队的消息数量
        async preloadAllTeamMessages() {
            for (const team of this.teams) {
                try {
                    const data = await this.apiGet(`/api/teams/${team.name}/inboxes`);
                    const inboxes = data.inboxes || {};
                    // 合并所有 inbox 消息并去重
                    const allMessages = [];
                    const seen = new Set();
                    Object.entries(inboxes).forEach(([inboxOwner, messages]) => {
                        (messages || []).forEach(msg => {
                            const key = `${msg.timestamp}_${msg.from}_${msg.text?.slice(0, 50)}`;
                            if (!seen.has(key)) {
                                seen.add(key);
                                allMessages.push(msg);
                            }
                        });
                    });
                    this.messages[team.name] = allMessages;
                } catch (error) {
                    this.messages[team.name] = [];
                }
            }
            this.refreshIcons();
        },

        getTeamGradient(teamName) {
            const gradients = [
                'from-indigo-500 to-purple-600',
                'from-emerald-500 to-teal-600',
                'from-amber-500 to-orange-600',
                'from-rose-500 to-pink-600',
                'from-cyan-500 to-blue-600',
                'from-violet-500 to-fuchsia-600'
            ];
            const index = teamName.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
            return gradients[index % gradients.length];
        },

        getAgentColor(agentName) {
            const name = (agentName || '').toLowerCase();
            for (const [key, color] of Object.entries(this.agentColors)) {
                if (name.includes(key)) return color;
            }
            return this.agentColors.default;
        },

        getAgentBadgeClass(agentName) {
            const color = this.getAgentColor(agentName);
            const classes = {
                blue: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
                purple: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
                indigo: 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30',
                emerald: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
                amber: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
                rose: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
                gray: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
                slate: 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
            };
            return classes[color] || classes.slate;
        },

        getAgentInitial(agentName) {
            if (!agentName) return '?';
            return agentName.charAt(0).toUpperCase();
        },

        getTaskStatusClass(status) {
            const classes = {
                pending: 'bg-amber-500/20 text-amber-400',
                in_progress: 'bg-blue-500/20 text-blue-400',
                completed: 'bg-green-500/20 text-green-400',
                failed: 'bg-red-500/20 text-red-400',
                cancelled: 'bg-gray-500/20 text-gray-400'
            };
            return classes[status] || classes.pending;
        },

        getProgressColor(progress) {
            if (progress >= 100) return 'bg-green-500';
            if (progress >= 70) return 'bg-emerald-500';
            if (progress >= 40) return 'bg-blue-500';
            if (progress >= 20) return 'bg-amber-500';
            return 'bg-rose-500';
        },

        formatTime(timestamp) {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            return date.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        },

        formatDate(timestamp) {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            if (date.toDateString() === today.toDateString()) {
                return '今天';
            } else if (date.toDateString() === yesterday.toDateString()) {
                return '昨天';
            } else {
                return date.toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long'
                });
            }
        },

        formatDateTime(timestamp) {
            if (!timestamp) return '';
            return new Date(timestamp).toLocaleString('zh-CN');
        },

        formatDuration(seconds) {
            if (!seconds) return '0 秒';
            if (seconds < 60) return `${seconds} 秒`;
            if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
            return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`;
        },

        getDateKey(timestamp) {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            return date.toISOString().split('T')[0];
        },

        scrollToBottom() {
            const el = this.$refs.messageStream;
            if (el) {
                el.scrollTop = el.scrollHeight;
            }
        },

        // 判断消息是否为纯文本（长对话）
        isPlainTextMessage(msg) {
            const text = msg.text || msg.content || '';
            try {
                const data = JSON.parse(text);
                // permission_request 且包含文件内容，按纯文本显示
                if (data.type === 'permission_request' && data.input?.content) {
                    return true;
                }
                return false; // 是JSON，系统消息
            } catch {
                return true; // 不是JSON，纯文本对话
            }
        },

        // 检测内容是否为 Markdown
        // 只检测明确的 Markdown 格式（标题、代码块、表格、粗体等）
        // 忽略简单的数字列表，因为它们可能只是普通文本
        isMarkdownContent(text) {
            if (!text || typeof text !== 'string') return false;

            // 明确的 Markdown 特征（出现任意一个就算）
            const explicitPatterns = [
                /^```/m,                    // 代码块
                /^#+\s+\S/m,                // 标题（# 后跟内容）
                /^\|[^|]+\|[^|]+\|/m,         // 表格（至少两列）
                /\*\*[^*]+\*\*/,            // 粗体
                /`[^`]+`/,                  // 行内代码
                /\[([^\]]+)\]\(([^)]+)\)/,   // 链接
                /^>/m,                      // 引用
                /^---$/m,                   // 分隔线
                /^\s*[-*+]\s+\S/m           // 无序列表（- * +）
            ];

            // 检查是否包含至少一个明确的 Markdown 特征
            return explicitPatterns.some(pattern => pattern.test(text));
        },

        // 渲染 Markdown
        renderMarkdown(text) {
            if (!text || typeof text !== 'string') return '';
            if (typeof marked === 'undefined') {
                // marked 未加载，返回纯文本
                return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
            try {
                return marked.parse(text, { breaks: true });
            } catch (e) {
                return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
        },

        // 渲染消息内容 - 返回完整 HTML
        renderMessageContent(msg) {
            const content = this.formatMessageContent(msg);
            if (!content) return '<span class="text-slate-500">[无内容]</span>';

            // 检测是否为 Markdown
            if (this.isMarkdownContent(content)) {
                return `<div class="prose prose-invert prose-sm max-w-none">${this.renderMarkdown(content)}</div>`;
            }

            // 纯文本 - 使用 pre 标签保留换行
            const escapedContent = content
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            return `<pre class="whitespace-pre-wrap font-sans m-0">${escapedContent}</pre>`;
        },

        // 格式化消息内容 - 解析JSON消息提取可读文本
        formatMessageContent(msg) {
            const text = msg.text || msg.content || '';
            if (!text) return '[无内容]';

            // 尝试解析JSON消息
            try {
                const data = JSON.parse(text);

                // 根据消息类型格式化
                switch (data.type) {
                    case 'message':
                        return data.content || data.text || JSON.stringify(data);
                    case 'task_assignment':
                        return `📋 分配任务: ${data.subject || (data.description ? data.description.substring(0, 100) + '...' : 'New task')}`;
                    case 'task_completed':
                        return `✅ 完成任务: ${data.subject || 'Task done'}`;
                    case 'task_update':
                        return `📝 更新任务: ${(data.task && data.task.title) ? data.task.title : 'Task updated'}`;
                    case 'shutdown_request':
                        return `🛑 请求关闭: ${data.content || data.reason || 'Shutdown requested'}`;
                    case 'shutdown_approved':
                        return `✓ 关闭已批准`;
                    case 'shutdown_response':
                        return data.approve ? '✓ 关闭请求已批准' : '✗ 关闭请求被拒绝';
                    case 'idle_notification':
                        return `💤 ${data.from || 'Agent'} 空闲`;
                    case 'plan_approval_request':
                        return `📋 计划待审批: ${data.plan ? data.plan.substring(0, 100) + '...' : 'Plan approval needed'}`;
                    case 'plan_approval_response':
                        return data.approve ? '✓ 计划已批准' : '✗ 计划被拒绝';
                    case 'broadcast':
                        return `📢 ${data.content || 'Broadcast message'}`;
                    case 'task_assignment_response':
                        return `📋 任务分配: ${data.subject || 'New task assigned'}`;
                    case 'permission_request':
                        // 处理权限请求消息，提取其中的内容
                        const input = data.input || {};
                        const filePath = input.file_path || '';
                        const fileContent = input.content || '';

                        if (filePath && fileContent) {
                            // 这是一个写入文件的请求，显示文件路径和内容摘要
                            const isMarkdown = filePath.endsWith('.md');
                            const isCode = /\.(js|ts|jsx|tsx|py|java|go|rs|c|cpp|h|hpp)$/i.test(filePath);

                            if (isMarkdown || isCode) {
                                // 返回完整内容，但限制长度
                                const maxLength = 2000;
                                const content = fileContent.length > maxLength
                                    ? fileContent.substring(0, maxLength) + '\n\n[...内容已截断，完整内容请查看文件...]'
                                    : fileContent;
                                return `📝 写入文件: ${filePath}\n\n${content}`;
                            } else {
                                return `💾 请求写入文件: ${filePath} (${fileContent.length} 字符)`;
                            }
                        }
                        return `🔐 权限请求: ${data.tool_name || data.description || 'Permission request'}`;
                    default:
                        // 如果有summary字段优先使用
                        if (data.summary) return data.summary;
                        // 如果有text字段
                        if (data.text) return data.text;
                        // 如果有content字段
                        if (data.content) return data.content;
                        // 返回类型和简要信息
                        return `[${data.type}] ${data.from || ''}`;
                }
            } catch (e) {
                // 不是JSON，返回原文本（纯文本对话保留换行）
                return text;
            }
        },

        showToast(message, type = 'success') {
            const id = Date.now();
            this.toasts.push({ id, message, type });

            setTimeout(() => {
                this.toasts = this.toasts.filter(t => t.id !== id);
            }, 3000);
        },

        toggleTheme() {
            // 主题切换（当前仅支持暗色）
            this.showToast('主题切换功能开发中...');
        },


        // 渲染 Markdown 预览（截断版本）
        renderMarkdownPreview(text) {
            if (!text || typeof text !== 'string') return '<span class="text-slate-500">[无描述]</span>';

            // 取前 200 字符作为预览
            const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;

            if (typeof marked === 'undefined') {
                return preview.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            }

            try {
                // 渲染 Markdown 但限制显示区域
                return marked.parse(preview, { breaks: true });
            } catch (e) {
                return preview.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            }
        },

        // 渲染完整 Markdown
        renderMarkdownFull(text) {
            if (!text || typeof text !== 'string') return '<span class="text-slate-500">[无描述]</span>';

            if (typeof marked === 'undefined') {
                return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            }

            try {
                return marked.parse(text, { breaks: true });
            } catch (e) {
                return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            }
        },

        // Debounced icon refresh
        refreshIcons() {
            if (this._iconRefreshTimeout) {
                clearTimeout(this._iconRefreshTimeout);
            }
            this._iconRefreshTimeout = setTimeout(() => {
                this.$nextTick(() => {
                    if (typeof lucide !== 'undefined') {
                        lucide.createIcons();
                    }
                });
            }, 50);
        }
    };
}

// 页面加载完成后初始化 Lucide
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    } else {
        // 如果 lucide 还没加载，等待它加载
        window.addEventListener('load', () => {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        });
    }
});
