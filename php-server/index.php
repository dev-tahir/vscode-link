<?php
/**
 * VS Code Remote Chat Control - Browser UI
 * 
 * This is the interface users open in their browser to control VS Code remotely.
 * Upload this along with api.php to your PHP server.
 */

// Prevent caching
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Cache-Control: post-check=0, pre-check=0', false);
header('Pragma: no-cache');
header('Expires: 0');

// Get the API URL (same directory)
$apiUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http') . 
          '://' . $_SERVER['HTTP_HOST'] . dirname($_SERVER['REQUEST_URI']) . '/api.php';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>VS Code Remote Control</title>
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

        * { box-sizing: border-box; margin: 0; padding: 0; }

        ::-webkit-scrollbar { width: 12px; height: 12px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--text-primary); border-radius: 6px; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            font-size: 14px;
        }

        .header {
            background: var(--bg-card);
            border-bottom: 1px solid var(--border-color);
            padding: 4px 12px;
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

        .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #22C55E;
        }

        .status-dot.offline { background: #EF4444; }
        .status-dot.connecting { background: #F59E0B; animation: pulse 1s infinite; }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .instances-tabs {
            display: flex;
            gap: 4px;
            overflow-x: auto;
            flex: 1;
            min-width: 0;
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
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .instance-tab.active {
            background: var(--btn-primary-bg);
            color: var(--btn-primary-text);
            border-color: var(--btn-primary-bg);
        }

        .instance-tab .status-indicator {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #22C55E;
        }

        .instance-tab .status-indicator.offline { background: #EF4444; }

        .header-actions {
            display: flex;
            gap: 6px;
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

        .nav-tabs {
            display: flex;
            background: var(--bg-card);
            border-bottom: 1px solid var(--border-color);
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

        .nav-tab .icon { font-size: 14px; }
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

        .tab-content.active { display: flex; }

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

        .back-btn, .new-chat-btn {
            background: transparent;
            border: none;
            color: var(--text-primary);
            padding: 4px 8px;
            cursor: pointer;
            font-size: 16px;
            min-width: 32px;
        }

        .back-btn { display: none; }
        .back-btn.visible { display: flex; align-items: center; justify-content: center; }
        .back-btn:hover, .new-chat-btn:hover { background: var(--hover-bg); }

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

        .session-card:hover { border-color: var(--border-focus); }
        .session-card.active { border-color: var(--accent); border-width: 2px; }

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

        .messages-view.active { display: flex; }
        .messages-wrapper { margin-top: auto; }

        .message {
            margin-bottom: 12px;
            padding: 12px;
            border: 1px solid var(--border-color);
        }

        .message.user {
            background: var(--user-msg-bg);
            border-left: 3px solid var(--accent);
        }

        .message.assistant { background: var(--assistant-msg-bg); }
        .message.pending-msg { opacity: 0.8; }

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

        .thinking-header:hover { background: var(--hover-bg); }

        .thinking-arrow {
            font-size: 10px;
            transition: transform 0.2s;
        }

        .thinking-arrow.expanded { transform: rotate(90deg); }

        .thinking-content {
            display: none;
            padding: 12px;
            border-top: 1px solid var(--border-color);
            font-size: 12px;
            color: var(--text-secondary);
            white-space: pre-wrap;
        }

        .thinking-content.show { display: block; }

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

        .pending-actions { display: flex; gap: 8px; }

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

        .chat-input-row { display: flex; gap: 8px; }

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

        .chat-input::placeholder { color: var(--text-secondary); }

        .send-btn {
            background: var(--btn-primary-bg);
            color: var(--btn-primary-text);
            border: none;
            padding: 12px 20px;
            font-size: 14px;
            cursor: pointer;
            font-weight: 500;
        }

        .send-btn:hover { opacity: 0.9; }
        .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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

        .toast.show { opacity: 1; }

        .no-instances {
            text-align: center;
            padding: 60px 20px;
        }

        .no-instances h2 {
            margin-bottom: 16px;
            font-size: 20px;
        }

        .no-instances p {
            color: var(--text-secondary);
            margin-bottom: 8px;
        }

        .no-instances code {
            background: var(--bg-secondary);
            padding: 2px 6px;
            font-size: 12px;
        }

        /* File Modal */
        .file-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 300;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .file-modal.open {
            display: flex;
        }

        .file-modal-content {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            width: 100%;
            max-width: 600px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
        }

        .file-modal-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .file-modal-title {
            font-weight: 500;
            font-size: 13px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .file-modal-body {
            flex: 1;
            overflow: auto;
            padding: 16px;
        }

        .file-content {
            font-family: monospace;
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-word;
            margin: 0;
        }

        .file-link {
            color: var(--accent);
            text-decoration: underline;
            cursor: pointer;
        }

        .file-link:hover {
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <header class="header">
        <div class="header-left">
            <div class="logo">
                <span>◇</span>
                <span>Remote</span>
            </div>
            <div class="status-dot connecting" id="statusDot" title="Server Status"></div>
        </div>
        <div class="instances-tabs" id="instancesTabs">
            <div class="instance-tab">Scanning...</div>
        </div>
        <div class="header-actions">
            <button class="icon-btn" onclick="loadInstances()" title="Refresh">⟳</button>
            <button class="icon-btn" onclick="toggleTheme()" title="Toggle Theme">◐</button>
        </div>
    </header>

    <nav class="nav-tabs">
        <button class="nav-tab active" data-tab="chat" onclick="switchTab('chat')">
            <span class="icon">💬</span><span>Chat</span>
        </button>
        <button class="nav-tab" data-tab="terminal" onclick="switchTab('terminal')">
            <span class="icon">⌨</span><span>Terminal</span>
        </button>
        <button class="nav-tab" data-tab="files" onclick="switchTab('files')">
            <span class="icon">📁</span><span>Files</span>
        </button>
        <button class="nav-tab" data-tab="git" onclick="switchTab('git')">
            <span class="icon">⎇</span><span>Git</span>
        </button>
    </nav>

    <main class="main-content">
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
                    <span id="inboxStatusText">Connecting...</span>
                </div>

                <div class="sessions-view" id="sessionsView">
                    <div class="placeholder-content">
                        <div class="placeholder-icon">🔍</div>
                        <div class="placeholder-title">Searching for VS Code...</div>
                        <div class="placeholder-text">Looking for connected VS Code instances</div>
                    </div>
                </div>

                <div class="messages-view" id="messagesView"></div>

                <div class="chat-input-container">
                    <div class="chat-input-header">
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

        <div class="tab-content" id="tab-terminal">
            <div class="placeholder-content">
                <div class="placeholder-icon">⌨</div>
                <div class="placeholder-title">Terminal</div>
                <div class="placeholder-text">Terminal coming soon</div>
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

    <!-- File Modal -->
    <div class="file-modal" id="fileModal" onclick="if(event.target.id==='fileModal') closeFileModal()">
        <div class="file-modal-content">
            <div class="file-modal-header">
                <span class="file-modal-title" id="fileModalTitle">File</span>
                <button class="icon-btn" onclick="closeFileModal()">✕</button>
            </div>
            <div class="file-modal-body">
                <pre class="file-content" id="fileModalContent">Loading...</pre>
            </div>
        </div>
    </div>

    <div class="toast" id="toast"></div>

    <script>
        const API = '<?php echo $apiUrl; ?>';
        
        let instances = [];
        let selectedInstance = null;
        let currentInbox = null;
        let selectedSessionIndex = -1;
        let isInMessagesView = false;
        let pollInterval = null;

        document.addEventListener('DOMContentLoaded', () => {
            initTheme();
            loadInstances();
            setupInputHandlers();
            
            // Poll for updates every 3 seconds
            pollInterval = setInterval(() => {
                if (selectedInstance) {
                    loadInbox();
                }
            }, 3000);
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

        async function loadInstances() {
            try {
                document.getElementById('statusDot').className = 'status-dot connecting';
                
                const r = await fetch(API + '?action=instances');
                const d = await r.json();
                
                if (d.success) {
                    instances = d.instances || [];
                    document.getElementById('statusDot').className = 'status-dot';
                    renderInstances();
                    
                    if (instances.length > 0 && !selectedInstance) {
                        const online = instances.find(i => i.status === 'online');
                        if (online) selectInstance(online.key);
                    }
                }
            } catch (e) {
                console.error('Failed to load instances:', e);
                document.getElementById('statusDot').className = 'status-dot offline';
                showNoInstances();
            }
        }

        function renderInstances() {
            const container = document.getElementById('instancesTabs');
            
            if (instances.length === 0) {
                container.innerHTML = '<div class="instance-tab">No VS Code connected</div>';
                showNoInstances();
                return;
            }
            
            container.innerHTML = instances.map(inst => 
                `<div class="instance-tab${inst.key === selectedInstance ? ' active' : ''}" onclick="selectInstance('${inst.key}')">
                    <span class="status-indicator ${inst.status === 'online' ? '' : 'offline'}"></span>
                    ${escapeHtml(inst.workspaceName || inst.key)}
                </div>`
            ).join('');
        }

        function showNoInstances() {
            document.getElementById('sessionsView').innerHTML = `
                <div class="no-instances">
                    <h2>🔌 No VS Code Connected</h2>
                    <p>To connect VS Code to this remote control:</p>
                    <p>1. Open VS Code with the Remote Chat Control extension</p>
                    <p>2. Set the remote server URL in extension settings:</p>
                    <p><code>${API}</code></p>
                    <p>3. Run command: <code>Remote Chat: Connect to Server</code></p>
                    <br>
                    <button onclick="loadInstances()" style="padding: 8px 16px; cursor: pointer;">⟳ Refresh</button>
                </div>
            `;
        }

        function selectInstance(key) {
            selectedInstance = key;
            renderInstances();
            loadInbox();
        }

        async function loadInbox() {
            if (!selectedInstance) return;
            
            try {
                updateInboxStatus('working', 'Loading...');
                
                const r = await fetch(API + '?action=inbox&key=' + selectedInstance);
                const d = await r.json();
                
                console.log('Inbox response:', d);
                
                if (d.success) {
                    // Show debug info
                    if (d.debug) {
                        console.log('Inbox debug:', d.debug);
                    }
                    
                    if (d.inbox && d.inbox.sessions && d.inbox.sessions.length > 0) {
                        currentInbox = d.inbox;
                        updateInboxStatus('online', d.status + ' • ' + (currentInbox.sessions?.length || 0) + ' sessions');
                        renderSessions();
                        
                        if (isInMessagesView && selectedSessionIndex >= 0) {
                            const session = currentInbox.sessions?.[selectedSessionIndex];
                            if (session) renderMessages(session);
                        }
                    } else {
                        currentInbox = null;
                        const statusText = d.status === 'online' 
                            ? 'VS Code online - No chat sessions found' 
                            : 'VS Code offline';
                        updateInboxStatus(d.status === 'online' ? 'online' : 'offline', statusText);
                        renderSessions();
                    }
                } else {
                    updateInboxStatus('offline', d.error || 'Error loading');
                }
            } catch (e) {
                console.error('Inbox error:', e);
                updateInboxStatus('offline', 'Error loading inbox');
            }
        }

        function updateInboxStatus(status, text) {
            const indicator = document.getElementById('inboxStatus');
            indicator.className = 'status-indicator' + (status === 'working' ? ' working' : '');
            document.getElementById('inboxStatusText').textContent = text;
        }

        function switchTab(tabName) {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
            document.getElementById('tab-' + tabName).classList.add('active');
        }

        function renderSessions() {
            const container = document.getElementById('sessionsView');
            
            if (!currentInbox?.sessions?.length) {
                container.innerHTML = '<div class="placeholder-content"><div class="placeholder-icon">💬</div><div class="placeholder-title">No Sessions</div><div class="placeholder-text">Start a new chat to begin</div></div>';
                return;
            }
            
            container.innerHTML = currentInbox.sessions.map((s, i) => {
                const date = new Date(s.lastMessageAt).toLocaleString();
                const preview = s.messages?.length ? s.messages[s.messages.length - 1].text.substring(0, 60) + '...' : '';
                return `<div class="session-card${i === selectedSessionIndex ? ' active' : ''}" onclick="selectSession(${i})">
                    <div class="session-title">${escapeHtml(s.title || 'Untitled')}</div>
                    <div class="session-meta"><span>${s.messageCount || 0} messages</span><span>${date}</span></div>
                    <div class="session-preview">${escapeHtml(preview)}</div>
                </div>`;
            }).join('');
        }

        function selectSession(index) {
            selectedSessionIndex = index;
            isInMessagesView = true;
            
            document.getElementById('sessionsView').style.display = 'none';
            document.getElementById('messagesView').classList.add('active');
            document.getElementById('backBtn').classList.add('visible');
            
            const session = currentInbox.sessions[index];
            const title = session?.title || 'Untitled';
            document.getElementById('chatTitle').textContent = title;
            document.getElementById('chatTitleBottom').textContent = title;
            
            renderMessages(session);
            
            requestAnimationFrame(() => {
                document.getElementById('messagesView').scrollTop = document.getElementById('messagesView').scrollHeight;
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
            
            if (!session?.messages?.length) {
                container.innerHTML = '<div class="placeholder-content"><div class="placeholder-text">No messages</div></div>';
                return;
            }
            
            const messagesHtml = session.messages.map((m, i) => {
                let html = `<div class="message ${m.role}">`;
                html += `<div class="message-header">`;
                html += `<span class="message-role">${m.role === 'user' ? '👤 You' : '🤖 Assistant'}</span>`;
                if (m.model) html += `<span class="message-model">${escapeHtml(m.model.replace('copilot/', ''))}</span>`;
                html += `</div>`;
                
                if (m.thinking?.content) {
                    const tid = 'thinking-' + i;
                    html += `<div class="thinking-box">
                        <div class="thinking-header" onclick="toggleThinking('${tid}')">
                            <span class="thinking-arrow" id="arrow-${tid}">▶</span>
                            <span>💭 ${escapeHtml(m.thinking.title)}</span>
                        </div>
                        <div class="thinking-content" id="${tid}">${escapeHtml(m.thinking.content)}</div>
                    </div>`;
                }
                
                html += `<div class="message-content">${linkifyFiles(m.text)}</div>`;
                
                if (m.pendingCommand?.command) {
                    html += `<div class="pending-command">
                        <div class="pending-command-title">⏳ Command awaiting approval</div>
                        <div class="pending-command-code">${escapeHtml(m.pendingCommand.command)}</div>
                        <div class="pending-actions">
                            <button class="btn-approve" onclick="approveCommand('approve')">✓ Approve</button>
                            <button class="btn-skip" onclick="approveCommand('skip')">✕ Skip</button>
                        </div>
                    </div>`;
                }
                
                html += `</div>`;
                return html;
            }).join('');
            
            container.innerHTML = `<div class="messages-wrapper">${messagesHtml}</div>`;
            
            requestAnimationFrame(() => {
                container.scrollTop = container.scrollHeight;
            });
        }

        function toggleThinking(id) {
            document.getElementById(id).classList.toggle('show');
            document.getElementById('arrow-' + id).classList.toggle('expanded');
        }

        function startNewChat() {
            showToast('Ready to start new chat');
            document.getElementById('chatInput').focus();
        }

        async function sendMessage() {
            if (!selectedInstance) {
                showToast('No VS Code instance selected');
                return;
            }
            
            const input = document.getElementById('chatInput');
            const msg = input.value.trim();
            if (!msg) return;
            
            const sendBtn = document.getElementById('sendBtn');
            sendBtn.disabled = true;
            sendBtn.textContent = '...';
            input.value = '';
            
            updateInboxStatus('working', 'Sending to VS Code...');
            
            try {
                // Send message to server
                const r = await fetch(API + '?action=send&key=' + selectedInstance, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: msg, sessionMode: 'current' })
                });
                
                const d = await r.json();
                
                if (d.success) {
                    showToast('Message sent to VS Code');
                    updateInboxStatus('working', 'Waiting for VS Code to process...');
                    
                    // Wait for reply (long polling)
                    const waitR = await fetch(API + '?action=wait-reply&key=' + selectedInstance + '&messageId=' + d.messageId + '&timeout=45');
                    const waitD = await waitR.json();
                    
                    if (waitD.status === 'replied') {
                        showToast('Reply received!');
                    }
                    
                    await loadInbox();
                } else {
                    showToast('Error: ' + (d.error || 'Failed to send'));
                }
            } catch (e) {
                showToast('Error: ' + e.message);
            } finally {
                sendBtn.disabled = false;
                sendBtn.textContent = 'Send';
                updateInboxStatus('online', 'Ready');
            }
        }

        async function approveCommand(action) {
            if (!selectedInstance) return;
            
            try {
                await fetch(API + '?action=command-action&key=' + selectedInstance, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action })
                });
                showToast(action === 'approve' ? 'Command approved' : 'Command skipped');
                setTimeout(loadInbox, 1000);
            } catch (e) {
                showToast('Error: ' + e.message);
            }
        }

        function escapeHtml(text) {
            if (!text) return '';
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        // File handling - convert [[FILE|path|name]] to clickable links
        function linkifyFiles(text) {
            if (!text) return '';
            // First escape HTML, then convert file markers to links
            let escaped = escapeHtml(text);
            // Match [[FILE|path|name]] pattern
            return escaped.replace(/\[\[FILE\|([^|]+)\|([^\]]+)\]\]/g, (match, filepath, filename) => {
                const encoded = btoa(filepath);
                return `<span class="file-link" onclick="openFile('${encoded}')">${filename}</span>`;
            });
        }

        async function openFile(encodedPath) {
            if (!selectedInstance) {
                showToast('No VS Code instance selected');
                return;
            }
            
            const filepath = atob(encodedPath);
            const filename = filepath.split(/[/\\]/).pop() || filepath;
            document.getElementById('fileModalTitle').textContent = filename;
            document.getElementById('fileModalContent').textContent = 'Loading file from VS Code...';
            document.getElementById('fileModal').classList.add('open');
            
            try {
                // Request file from VS Code via PHP server
                const reqRes = await fetch(API + '?action=request-file&key=' + selectedInstance, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filepath })
                });
                const reqData = await reqRes.json();
                
                if (!reqData.success) {
                    document.getElementById('fileModalContent').textContent = 'Error: ' + (reqData.error || 'Failed to request file');
                    return;
                }
                
                // Poll for file content
                const contentRes = await fetch(API + '?action=get-file-content&key=' + selectedInstance + '&requestId=' + reqData.requestId + '&timeout=15');
                const contentData = await contentRes.json();
                
                if (contentData.status === 'completed') {
                    if (contentData.content !== null) {
                        document.getElementById('fileModalContent').textContent = contentData.content;
                    } else {
                        document.getElementById('fileModalContent').textContent = 'Error: ' + (contentData.error || 'Unknown error');
                    }
                } else {
                    document.getElementById('fileModalContent').textContent = 'Timeout: VS Code did not respond in time.\n\nMake sure VS Code is connected to the remote server.';
                }
            } catch (e) {
                document.getElementById('fileModalContent').textContent = 'Error: ' + e.message;
            }
        }

        function closeFileModal() {
            document.getElementById('fileModal').classList.remove('open');
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
