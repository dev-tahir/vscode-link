<?php
// VS Code Remote Chat Control - PHP Hosted Version
// Upload this file to your PHP server (e.g., farooqk.sg-host.com)
// Access from browser, it will connect to your local VS Code at localhost:3847

// Configuration - change this if your VS Code server runs on different port
$vscode_host = isset($_GET['host']) ? htmlspecialchars($_GET['host']) : 'localhost';
$vscode_port = isset($_GET['port']) ? intval($_GET['port']) : 3847;
$ws_port = isset($_GET['wsport']) ? intval($_GET['wsport']) : 3848;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>VS Code Remote Chat Control</title>
    <style>
        :root {
            --bg-primary: #FFFFFF;
            --bg-secondary: #F9FAFB;
            --bg-card: #FFFFFF;
            --text-primary: #000000;
            --text-secondary: #4B5563;
            --border-color: rgba(0,0,0,0.1);
            --border-focus: #000000;
            --btn-primary-bg: #000000;
            --btn-primary-text: #FFFFFF;
            --accent: #000000;
            --hover-bg: #F3F4F6;
            --user-msg-bg: #F3F4F6;
            --assistant-msg-bg: #FFFFFF;
            --thinking-bg: #F9FAFB;
            --pending-bg: #FEF3C7;
            --pending-border: #F59E0B;
            --success-bg: #D1FAE5;
            --error-bg: #FEE2E2;
        }

        .dark {
            --bg-primary: #000000;
            --bg-secondary: #111111;
            --bg-card: #111111;
            --text-primary: #FFFFFF;
            --text-secondary: #9CA3AF;
            --border-color: rgba(255,255,255,0.1);
            --border-focus: #FFFFFF;
            --btn-primary-bg: #FFFFFF;
            --btn-primary-text: #000000;
            --accent: #FFFFFF;
            --hover-bg: #1F1F1F;
            --user-msg-bg: #1F1F1F;
            --assistant-msg-bg: #111111;
            --thinking-bg: #1F1F1F;
            --pending-bg: #422006;
            --pending-border: #F59E0B;
            --success-bg: #064E3B;
            --error-bg: #7F1D1D;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        ::-webkit-scrollbar {
            width: 12px;
            height: 12px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--text-primary);
            border-radius: 6px;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            font-size: 14px;
            -webkit-font-smoothing: antialiased;
        }

        .header {
            background: var(--bg-card);
            border-bottom: 1px solid var(--border-color);
            padding: 4px 12px;
            position: sticky;
            top: 0;
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .logo {
            font-weight: 500;
            font-size: 11px;
            display: flex;
            align-items: center;
            gap: 4px;
            color: var(--text-secondary);
        }

        .header-actions {
            display: flex;
            gap: 6px;
            align-items: center;
        }

        .icon-btn {
            background: transparent;
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 14px;
        }

        .icon-btn:hover {
            background: var(--hover-bg);
            border-color: var(--border-focus);
        }

        .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #22C55E;
        }

        .status-dot.offline {
            background: #EF4444;
        }

        .instances-tabs {
            display: flex;
            gap: 4px;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            flex: 1;
            min-width: 0;
        }

        .instances-tabs::-webkit-scrollbar {
            display: none;
        }

        .instance-tab {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            padding: 4px 10px;
            font-size: 11px;
            white-space: nowrap;
            cursor: pointer;
            flex-shrink: 0;
            color: var(--text-secondary);
        }

        .instance-tab.active {
            background: var(--btn-primary-bg);
            color: var(--btn-primary-text);
            border-color: var(--btn-primary-bg);
        }

        .nav-tabs {
            display: flex;
            background: var(--bg-card);
            border-bottom: 1px solid var(--border-color);
            position: sticky;
            top: 36px;
            z-index: 99;
        }

        .nav-tab {
            flex: 1;
            padding: 8px 4px;
            text-align: center;
            font-size: 10px;
            font-weight: 500;
            color: var(--text-secondary);
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: center;
            gap: 4px;
        }

        .nav-tab .icon {
            font-size: 14px;
        }

        .nav-tab.active {
            color: var(--text-primary);
            border-bottom-color: var(--accent);
        }

        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .tab-content {
            display: none;
            flex: 1;
            flex-direction: column;
            overflow: hidden;
        }

        .tab-content.active {
            display: flex;
        }

        .chat-container {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        .chat-header {
            background: var(--bg-card);
            border-bottom: 1px solid var(--border-color);
            padding: 8px 12px;
        }

        .chat-header-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .chat-title {
            font-weight: 500;
            font-size: 13px;
            flex: 1;
            text-align: center;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .back-btn {
            background: transparent;
            border: none;
            color: var(--text-primary);
            padding: 4px 8px;
            cursor: pointer;
            font-size: 16px;
            display: none;
            min-width: 32px;
        }

        .back-btn:hover {
            background: var(--hover-bg);
        }

        .back-btn.visible {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .new-chat-btn {
            background: transparent;
            color: var(--text-primary);
            border: none;
            padding: 4px 8px;
            font-size: 16px;
            cursor: pointer;
            min-width: 32px;
        }

        .new-chat-btn:hover {
            background: var(--hover-bg);
        }

        .sessions-view {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }

        .session-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            padding: 12px;
            margin-bottom: 8px;
            cursor: pointer;
        }

        .session-card:hover {
            border-color: var(--border-focus);
        }

        .session-card.active {
            border-color: var(--accent);
            border-width: 2px;
        }

        .session-title {
            font-weight: 500;
            font-size: 13px;
            margin-bottom: 4px;
        }

        .session-meta {
            font-size: 11px;
            color: var(--text-secondary);
            display: flex;
            gap: 12px;
        }

        .session-preview {
            font-size: 12px;
            color: var(--text-secondary);
            margin-top: 8px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .messages-view {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            display: none;
            flex-direction: column;
        }

        .messages-view.active {
            display: flex;
        }
        
        .messages-wrapper {
            margin-top: auto;
        }

        .message {
            margin-bottom: 12px;
            padding: 12px;
            border: 1px solid var(--border-color);
        }

        .message.user {
            background: var(--user-msg-bg);
            border-left: 3px solid var(--accent);
        }

        .message.assistant {
            background: var(--assistant-msg-bg);
        }
        
        .message.pending-msg {
            opacity: 0.8;
        }
        
        .message-status {
            font-size: 10px;
            color: var(--text-secondary);
            font-style: italic;
        }

        .message-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .message-role {
            font-size: 11px;
            font-weight: 500;
            text-transform: uppercase;
            color: var(--text-secondary);
        }

        .message-model {
            font-size: 10px;
            color: var(--text-secondary);
        }

        .message-content {
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .thinking-box {
            background: var(--thinking-bg);
            border: 1px solid var(--border-color);
            margin-bottom: 8px;
        }

        .thinking-header {
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--text-secondary);
        }

        .thinking-header:hover {
            background: var(--hover-bg);
        }

        .thinking-arrow {
            font-size: 10px;
            transition: transform 0.2s;
        }

        .thinking-arrow.expanded {
            transform: rotate(90deg);
        }

        .thinking-content {
            display: none;
            padding: 12px;
            border-top: 1px solid var(--border-color);
            font-size: 12px;
            color: var(--text-secondary);
            white-space: pre-wrap;
        }

        .thinking-content.show {
            display: block;
        }

        .pending-command {
            background: var(--pending-bg);
            border: 1px solid var(--pending-border);
            padding: 12px;
            margin-top: 12px;
        }

        .pending-command-title {
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 8px;
            color: var(--pending-border);
        }

        .pending-command-code {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            padding: 8px;
            font-family: monospace;
            font-size: 12px;
            margin-bottom: 8px;
            word-break: break-all;
        }

        .pending-actions {
            display: flex;
            gap: 8px;
        }

        .btn-approve {
            background: #22C55E;
            color: white;
            border: none;
            padding: 8px 16px;
            font-size: 12px;
            cursor: pointer;
        }

        .btn-skip {
            background: var(--text-secondary);
            color: white;
            border: none;
            padding: 8px 16px;
            font-size: 12px;
            cursor: pointer;
        }

        .inbox-status {
            padding: 8px 12px;
            font-size: 11px;
            color: var(--text-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .inbox-status .status-indicator {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #22C55E;
        }

        .inbox-status .status-indicator.working {
            background: #F59E0B;
            animation: pulse 1s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .chat-input-container {
            background: var(--bg-card);
            border-top: 1px solid var(--border-color);
            padding: 8px 12px 12px 12px;
        }

        .chat-input-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border-color);
        }

        .chat-input-header .back-btn,
        .chat-input-header .new-chat-btn {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .chat-input-header .chat-title {
            flex: 1;
            text-align: center;
            font-size: 12px;
        }

        .model-select-row {
            display: none;
        }

        .chat-input-row {
            display: flex;
            gap: 8px;
        }

        .chat-input {
            flex: 1;
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 12px;
            font-size: 14px;
            resize: none;
            min-height: 44px;
            max-height: 120px;
        }

        .chat-input:focus {
            outline: none;
            border-color: var(--border-focus);
        }

        .chat-input::placeholder {
            color: var(--text-secondary);
        }

        .send-btn {
            background: var(--btn-primary-bg);
            color: var(--btn-primary-text);
            border: none;
            padding: 12px 20px;
            font-size: 14px;
            cursor: pointer;
            font-weight: 500;
        }

        .send-btn:hover {
            opacity: 0.9;
        }

        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .placeholder-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--text-secondary);
            padding: 40px;
        }

        .placeholder-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .placeholder-title {
            font-size: 18px;
            font-weight: 500;
            margin-bottom: 8px;
        }

        .placeholder-text {
            font-size: 14px;
            text-align: center;
        }

        .toast {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--btn-primary-bg);
            color: var(--btn-primary-text);
            padding: 12px 24px;
            font-size: 14px;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.3s;
            pointer-events: none;
        }

        .toast.show {
            opacity: 1;
        }

        .loading-indicator {
            display: none;
            padding: 12px;
            text-align: center;
            color: var(--text-secondary);
        }

        .loading-indicator.show {
            display: block;
        }

        .connection-banner {
            background: var(--error-bg);
            color: var(--text-primary);
            padding: 8px 12px;
            font-size: 12px;
            text-align: center;
            display: none;
        }

        .connection-banner.show {
            display: block;
        }

        .file-link {
            color: var(--accent);
            cursor: pointer;
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <!-- Connection Banner -->
    <div class="connection-banner" id="connectionBanner">
        ⚠️ Cannot connect to VS Code server. Make sure VS Code is running with the extension active.
    </div>

    <!-- Header -->
    <header class="header">
        <div class="header-left">
            <div class="logo">
                <span>◇</span>
                <span>Remote</span>
            </div>
            <div class="status-dot" id="statusDot" title="Server Status"></div>
        </div>
        <div class="instances-tabs" id="instancesTabs">
            <div class="instance-tab active">Connecting...</div>
        </div>
        <div class="header-actions">
            <button class="icon-btn" onclick="toggleTheme()" title="Toggle Theme">◐</button>
        </div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="nav-tabs">
        <button class="nav-tab active" data-tab="chat" onclick="switchTab('chat')">
            <span class="icon">💬</span>
            <span>Chat</span>
        </button>
        <button class="nav-tab" data-tab="terminal" onclick="switchTab('terminal')">
            <span class="icon">⌨</span>
            <span>Terminal</span>
        </button>
        <button class="nav-tab" data-tab="files" onclick="switchTab('files')">
            <span class="icon">📁</span>
            <span>Files</span>
        </button>
        <button class="nav-tab" data-tab="git" onclick="switchTab('git')">
            <span class="icon">⎇</span>
            <span>Git</span>
        </button>
    </nav>

    <!-- Main Content -->
    <main class="main-content">
        <!-- Chat Tab -->
        <div class="tab-content active" id="tab-chat">
            <div class="chat-container">
                <div class="chat-header">
                    <div class="chat-header-row">
                        <button class="back-btn" id="backBtn" onclick="showSessionsList()">←</button>
                        <div class="chat-title" id="chatTitle">Sessions</div>
                        <button class="new-chat-btn" onclick="startNewChat()" title="New Chat">+</button>
                    </div>
                </div>

                <div class="inbox-status">
                    <div class="status-indicator" id="inboxStatus"></div>
                    <span id="inboxStatusText">Connecting to VS Code...</span>
                </div>

                <div class="sessions-view" id="sessionsView">
                    <div class="placeholder-content">
                        <div class="placeholder-icon">🔌</div>
                        <div class="placeholder-title">Connecting...</div>
                        <div class="placeholder-text">Waiting for VS Code server at localhost:<?php echo $vscode_port; ?></div>
                    </div>
                </div>

                <div class="messages-view" id="messagesView"></div>

                <div class="chat-input-container">
                    <div class="chat-input-header" id="chatInputHeader">
                        <button class="back-btn visible" onclick="showSessionsList()">←</button>
                        <div class="chat-title" id="chatTitleBottom">Sessions</div>
                        <button class="new-chat-btn" onclick="startNewChat()" title="New Chat">+</button>
                    </div>
                    <div class="chat-input-row">
                        <textarea class="chat-input" id="chatInput" placeholder="Type a message..." rows="1"></textarea>
                        <button class="send-btn" id="sendBtn" onclick="sendMessage()">Send</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Other Tabs -->
        <div class="tab-content" id="tab-terminal">
            <div class="placeholder-content">
                <div class="placeholder-icon">⌨</div>
                <div class="placeholder-title">Terminal</div>
                <div class="placeholder-text">Terminal functionality coming soon</div>
            </div>
        </div>

        <div class="tab-content" id="tab-files">
            <div class="placeholder-content">
                <div class="placeholder-icon">📁</div>
                <div class="placeholder-title">Files</div>
                <div class="placeholder-text">File browser coming soon</div>
            </div>
        </div>

        <div class="tab-content" id="tab-git">
            <div class="placeholder-content">
                <div class="placeholder-icon">⎇</div>
                <div class="placeholder-title">Git</div>
                <div class="placeholder-text">Git integration coming soon</div>
            </div>
        </div>
    </main>

    <!-- Toast -->
    <div class="toast" id="toast"></div>

    <script>
        // Configuration - connects to your local VS Code
        const API = 'http://<?php echo $vscode_host; ?>:<?php echo $vscode_port; ?>';
        const WS_URL = 'ws://<?php echo $vscode_host; ?>:<?php echo $ws_port; ?>';
        
        // State
        let ws = null;
        let currentInbox = null;
        let selectedSessionIndex = -1;
        let isInMessagesView = false;
        let waitingForReply = false;
        let pendingMessages = [];
        let connectionRetries = 0;
        const MAX_RETRIES = 5;

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            initTheme();
            connectToVSCode();
            setupInputHandlers();
        });

        function initTheme() {
            const saved = localStorage.getItem('theme');
            if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.body.classList.add('dark');
            }
        }

        function toggleTheme() {
            document.body.classList.toggle('dark');
            localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
        }

        async function connectToVSCode() {
            updateInboxStatus('working', 'Connecting to VS Code...');
            
            try {
                const r = await fetch(API + '/api/status', { 
                    method: 'GET',
                    mode: 'cors'
                });
                const d = await r.json();
                
                if (d.status === 'ok') {
                    document.getElementById('statusDot').classList.remove('offline');
                    document.getElementById('connectionBanner').classList.remove('show');
                    connectionRetries = 0;
                    
                    // Connected! Load inbox
                    connectWebSocket();
                    loadInbox();
                }
            } catch (e) {
                console.error('Connection failed:', e);
                document.getElementById('statusDot').classList.add('offline');
                document.getElementById('connectionBanner').classList.add('show');
                updateInboxStatus('offline', 'Cannot connect to VS Code');
                
                document.getElementById('sessionsView').innerHTML = `
                    <div class="placeholder-content">
                        <div class="placeholder-icon">🔌</div>
                        <div class="placeholder-title">Connection Failed</div>
                        <div class="placeholder-text">
                            Cannot connect to VS Code server at ${API}<br><br>
                            Make sure:<br>
                            1. VS Code is running<br>
                            2. Remote Chat Control extension is active<br>
                            3. Server is started (check extension output)<br><br>
                            <button onclick="connectToVSCode()" style="padding: 8px 16px; cursor: pointer;">Retry Connection</button>
                        </div>
                    </div>
                `;
                
                // Retry connection
                if (connectionRetries < MAX_RETRIES) {
                    connectionRetries++;
                    setTimeout(connectToVSCode, 3000);
                }
            }
        }

        function connectWebSocket() {
            try {
                ws = new WebSocket(WS_URL);
                
                ws.onopen = () => {
                    console.log('WebSocket connected');
                };
                
                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        handleWebSocketMessage(msg);
                    } catch (e) {
                        console.error('WS message error:', e);
                    }
                };
                
                ws.onclose = () => {
                    console.log('WebSocket closed, reconnecting...');
                    setTimeout(connectWebSocket, 2000);
                };
                
                ws.onerror = (err) => {
                    console.error('WebSocket error:', err);
                };
            } catch (e) {
                console.error('WebSocket connection failed:', e);
            }
        }

        function handleWebSocketMessage(msg) {
            if (msg.type === 'inbox_update' && msg.data && !msg.data.error) {
                const oldInbox = currentInbox;
                currentInbox = msg.data;
                
                if (isInMessagesView && selectedSessionIndex >= 0 && waitingForReply) {
                    const newSession = currentInbox.sessions?.[selectedSessionIndex];
                    const oldSession = oldInbox?.sessions?.[selectedSessionIndex];
                    
                    const newMsgCount = newSession?.messages?.length || 0;
                    const oldMsgCount = oldSession?.messages?.length || 0;
                    
                    if (newMsgCount > oldMsgCount) {
                        const lastMsg = newSession.messages[newSession.messages.length - 1];
                        if (lastMsg && lastMsg.role === 'assistant') {
                            waitingForReply = false;
                            hideLoadingIndicator();
                            clearPendingMessages();
                            renderMessages(newSession);
                            updateInboxStatus('online', 'Reply received');
                            showToast('New reply received!');
                            return;
                        }
                    }
                }
                
                renderSessions();
                updateSessionSelect();
                
                if (isInMessagesView && selectedSessionIndex >= 0 && !waitingForReply) {
                    const session = currentInbox.sessions?.[selectedSessionIndex];
                    if (session) {
                        renderMessages(session);
                    }
                }
            }
        }

        function switchTab(tabName) {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
            document.getElementById('tab-' + tabName).classList.add('active');
        }

        async function loadInbox() {
            try {
                const wsRes = await fetch(API + '/api/inbox/current-workspace');
                const wsData = await wsRes.json();
                
                if (!wsData.workspaceHash) {
                    updateInboxStatus('offline', 'Workspace not detected');
                    return;
                }
                
                updateInstances([{ 
                    id: wsData.workspaceHash, 
                    workspaceName: wsData.workspaceName || 'VS Code',
                    isActive: true 
                }]);
                
                const r = await fetch(API + '/api/inbox/messages');
                currentInbox = await r.json();
                
                if (currentInbox.error) {
                    document.getElementById('sessionsView').innerHTML = '<div class="placeholder-content"><div class="placeholder-text">' + escapeHtml(currentInbox.error) + '</div></div>';
                    return;
                }
                
                updateInboxStatus('online', 'Connected • ' + currentInbox.sessions.length + ' sessions');
                renderSessions();
                updateSessionSelect();
                
            } catch (e) {
                updateInboxStatus('offline', 'Error: ' + e.message);
            }
        }

        function updateInboxStatus(status, text) {
            const indicator = document.getElementById('inboxStatus');
            const statusText = document.getElementById('inboxStatusText');
            indicator.classList.remove('working');
            if (status === 'working') {
                indicator.classList.add('working');
            }
            statusText.textContent = text;
        }

        function updateInstances(instances) {
            const container = document.getElementById('instancesTabs');
            container.innerHTML = instances.map((inst, i) => 
                '<div class="instance-tab' + (inst.isActive ? ' active' : '') + '">' + 
                escapeHtml(inst.workspaceName || inst.id) + 
                '</div>'
            ).join('');
        }

        function renderSessions() {
            const container = document.getElementById('sessionsView');
            
            if (!currentInbox || !currentInbox.sessions || currentInbox.sessions.length === 0) {
                container.innerHTML = '<div class="placeholder-content"><div class="placeholder-icon">💬</div><div class="placeholder-title">No Sessions</div><div class="placeholder-text">Start a new chat to begin</div></div>';
                return;
            }
            
            container.innerHTML = currentInbox.sessions.map((s, i) => {
                const date = new Date(s.lastMessageAt).toLocaleString();
                const preview = s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1].text.substring(0, 60) + '...' : '';
                return '<div class="session-card' + (i === selectedSessionIndex ? ' active' : '') + '" onclick="selectSession(' + i + ')">' +
                    '<div class="session-title">' + escapeHtml(s.title || 'Untitled Session') + '</div>' +
                    '<div class="session-meta"><span>' + (s.messageCount || 0) + ' messages</span><span>' + date + '</span></div>' +
                    '<div class="session-preview">' + escapeHtml(preview) + '</div>' +
                '</div>';
            }).join('');
        }

        function updateSessionSelect() {
            // Hidden but still needs to track selected session
        }

        function selectSession(index) {
            selectedSessionIndex = index;
            isInMessagesView = true;
            
            document.getElementById('sessionsView').style.display = 'none';
            document.getElementById('messagesView').classList.add('active');
            document.getElementById('backBtn').classList.add('visible');
            
            const session = currentInbox.sessions[index];
            const title = session.title || 'Untitled Session';
            document.getElementById('chatTitle').textContent = title;
            document.getElementById('chatTitleBottom').textContent = title;
            
            renderMessages(session);
            
            requestAnimationFrame(() => {
                const container = document.getElementById('messagesView');
                container.scrollTop = container.scrollHeight;
            });
        }

        function showSessionsList() {
            isInMessagesView = false;
            selectedSessionIndex = -1;
            
            document.getElementById('messagesView').classList.remove('active');
            document.getElementById('sessionsView').style.display = 'block';
            document.getElementById('backBtn').classList.remove('visible');
            document.getElementById('chatTitle').textContent = 'Sessions';
            document.getElementById('chatTitleBottom').textContent = 'Sessions';
        }

        function renderMessages(session) {
            const container = document.getElementById('messagesView');
            
            if (!session.messages || session.messages.length === 0) {
                container.innerHTML = '<div class="placeholder-content"><div class="placeholder-text">No messages in this session</div></div>';
                return;
            }
            
            const messagesHtml = session.messages.map((m, i) => {
                let html = '<div class="message ' + m.role + '">';
                html += '<div class="message-header">';
                html += '<span class="message-role">' + (m.role === 'user' ? '👤 You' : '🤖 Assistant') + '</span>';
                if (m.model) html += '<span class="message-model">' + escapeHtml(m.model.replace('copilot/', '')) + '</span>';
                html += '</div>';
                
                if (m.thinking && m.thinking.content) {
                    const thinkingId = 'thinking-' + i;
                    html += '<div class="thinking-box">';
                    html += '<div class="thinking-header" onclick="toggleThinking(\'' + thinkingId + '\')">';
                    html += '<span class="thinking-arrow" id="arrow-' + thinkingId + '">▶</span>';
                    html += '<span>💭 ' + escapeHtml(m.thinking.title) + '</span>';
                    html += '</div>';
                    html += '<div class="thinking-content" id="' + thinkingId + '">' + escapeHtml(m.thinking.content) + '</div>';
                    html += '</div>';
                }
                
                html += '<div class="message-content">' + linkifyFiles(escapeHtml(m.text)) + '</div>';
                
                if (m.pendingCommand && m.pendingCommand.command) {
                    html += '<div class="pending-command">';
                    html += '<div class="pending-command-title">⏳ Command awaiting approval</div>';
                    html += '<div class="pending-command-code">' + escapeHtml(m.pendingCommand.command) + '</div>';
                    html += '<div class="pending-actions">';
                    html += '<button class="btn-approve" onclick="approveCommand(\'approve\')">✓ Approve</button>';
                    html += '<button class="btn-skip" onclick="approveCommand(\'skip\')">✕ Skip</button>';
                    html += '</div></div>';
                }
                
                html += '</div>';
                return html;
            }).join('');
            
            container.innerHTML = '<div class="messages-wrapper">' + messagesHtml + '</div>';
            
            requestAnimationFrame(() => {
                container.scrollTop = container.scrollHeight;
            });
        }

        function toggleThinking(id) {
            const content = document.getElementById(id);
            const arrow = document.getElementById('arrow-' + id);
            content.classList.toggle('show');
            arrow.classList.toggle('expanded');
        }

        function startNewChat() {
            showToast('Ready to start new chat');
            document.getElementById('chatInput').focus();
        }

        async function sendMessage() {
            const input = document.getElementById('chatInput');
            const msg = input.value.trim();
            if (!msg) return;
            
            const sendBtn = document.getElementById('sendBtn');
            sendBtn.disabled = true;
            sendBtn.textContent = '...';
            
            input.value = '';
            
            const msgElement = appendMessageToView('user', msg);
            
            updateInboxStatus('working', 'Sending message...');
            
            try {
                const body = { message: msg, sessionMode: 'current', maxWait: 60000 };
                
                showLoadingIndicator();
                waitingForReply = true;
                
                const r = await fetch(API + '/api/inbox/send-and-wait', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                
                const d = await r.json();
                
                if (d.success) {
                    markMessagesSent();
                    updateInboxStatus('online', 'Reply received');
                    hideLoadingIndicator();
                    waitingForReply = false;
                    clearPendingMessages();
                    
                    const currentSessionIdx = selectedSessionIndex;
                    const currentSessionId = currentInbox?.sessions?.[currentSessionIdx]?.sessionId;
                    const wasInMessagesView = isInMessagesView;
                    
                    await loadInbox();
                    
                    if (wasInMessagesView && currentInbox?.sessions?.length > 0) {
                        let newIndex = -1;
                        if (currentSessionId) {
                            newIndex = currentInbox.sessions.findIndex(s => s.sessionId === currentSessionId);
                        }
                        if (newIndex < 0) newIndex = 0;
                        
                        if (currentInbox.sessions[newIndex]?.messages?.length > 0) {
                            selectSession(newIndex);
                        }
                    }
                } else {
                    showToast('Error: ' + (d.error || 'Failed to get reply'));
                    updateInboxStatus('online', 'Inbox ready');
                    hideLoadingIndicator();
                    waitingForReply = false;
                    if (msgElement) msgElement.remove();
                    clearPendingMessages();
                }
            } catch (e) {
                showToast('Error: ' + e.message);
                updateInboxStatus('online', 'Connection error');
                hideLoadingIndicator();
                waitingForReply = false;
                if (msgElement) msgElement.remove();
                clearPendingMessages();
            } finally {
                sendBtn.disabled = false;
                sendBtn.textContent = 'Send';
            }
        }

        function appendMessageToView(role, text) {
            const container = document.getElementById('messagesView');
            if (!container || !container.classList.contains('active')) {
                return null;
            }
            
            const placeholder = container.querySelector('.placeholder-content');
            if (placeholder) placeholder.remove();
            
            hideLoadingIndicator();
            
            let wrapper = container.querySelector('.messages-wrapper');
            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.className = 'messages-wrapper';
                container.appendChild(wrapper);
            }
            
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message ' + role + ' pending-msg';
            msgDiv.innerHTML = 
                '<div class="message-header">' +
                '<span class="message-role">' + (role === 'user' ? '👤 You' : '🤖 Assistant') + '</span>' +
                '<span class="message-status">sending...</span>' +
                '</div>' +
                '<div class="message-content">' + escapeHtml(text) + '</div>';
            
            wrapper.appendChild(msgDiv);
            container.scrollTop = container.scrollHeight;
            
            pendingMessages.push({ role, text, element: msgDiv });
            
            return msgDiv;
        }
        
        function markMessagesSent() {
            pendingMessages.forEach(pm => {
                if (pm.element) {
                    pm.element.classList.remove('pending-msg');
                    const status = pm.element.querySelector('.message-status');
                    if (status) status.textContent = 'sent';
                }
            });
        }

        function clearPendingMessages() {
            pendingMessages = [];
        }

        function showLoadingIndicator() {
            // Could add a loading indicator to the messages view
        }

        function hideLoadingIndicator() {
            // Remove loading indicator
        }

        async function approveCommand(action) {
            try {
                const r = await fetch(API + '/api/command-action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action })
                });
                const d = await r.json();
                showToast(action === 'approve' ? 'Command approved' : 'Command skipped');
                setTimeout(() => loadInbox(), 1000);
            } catch (e) {
                showToast('Error: ' + e.message);
            }
        }

        function linkifyFiles(text) {
            return text.replace(/\[\[FILE\|([^|]+)\|([^\]]+)\]\]/g, 
                (match, fullPath, fileName) => {
                    return '<span class="file-link">📄 ' + fileName + '</span>';
                }
            );
        }

        function escapeHtml(text) {
            if (!text) return '';
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function showToast(msg) {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        function setupInputHandlers() {
            const input = document.getElementById('chatInput');
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });
            
            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            });
        }
    </script>
</body>
</html>
