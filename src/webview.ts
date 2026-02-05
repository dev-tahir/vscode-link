// Mobile-friendly WebView with Minimalist Black & White Design
// Features: Chat, Terminal, Files, Git tabs with dark mode support

export function getWebViewHTML(): string {
    return `<!DOCTYPE html>
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

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        /* Custom Scrollbar */
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

        /* Header with VS Code instances tabs */
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

        /* VS Code Instances Tabs - inline */
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

        /* Main Navigation Tabs */
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

        /* Main Content Area */
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

        /* Chat Tab Styles */
        .chat-container {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        /* Chat Header with sessions list */
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

        /* Sessions List View */
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

        /* Messages View */
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
        
        .message.loading {
            opacity: 0.7;
        }
        
        .loading-dots span {
            animation: blink 1.4s infinite;
        }
        
        .loading-dots span:nth-child(1) { animation-delay: 0s; }
        .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
        
        @keyframes blink {
            0%, 20% { opacity: 0; }
            50% { opacity: 1; }
            100% { opacity: 0; }
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

        /* Thinking Box */
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

        /* Pending Command */
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

        /* Inbox Status */
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

        /* Chat Input */
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

        /* Model/session selects - hidden for cleaner UI
        .model-select-row {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }
        */
        .model-select-row {
            display: none;
        }

        .model-select {
            flex: 1;
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 8px 12px;
            font-size: 12px;
            cursor: pointer;
        }

        .model-select:focus {
            outline: none;
            border-color: var(--border-focus);
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

        /* Placeholder tabs */
        .placeholder-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            text-align: center;
        }

        .placeholder-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .placeholder-title {
            font-weight: bold;
            font-size: 16px;
            margin-bottom: 8px;
        }

        .placeholder-text {
            color: var(--text-secondary);
            font-size: 13px;
        }

        /* Settings Panel */
        .settings-panel {
            position: fixed;
            top: 0;
            right: -100%;
            width: 280px;
            max-width: 100%;
            height: 100%;
            background: var(--bg-card);
            border-left: 1px solid var(--border-color);
            z-index: 200;
            transition: right 0.3s ease;
            display: flex;
            flex-direction: column;
        }

        .settings-panel.open {
            right: 0;
        }

        .settings-header {
            padding: 16px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .settings-title {
            font-weight: bold;
            font-size: 14px;
        }

        .settings-body {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
        }

        .settings-item {
            margin-bottom: 16px;
        }

        .settings-label {
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 8px;
            display: block;
        }

        .settings-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .toggle-switch {
            width: 44px;
            height: 24px;
            background: var(--border-color);
            border-radius: 12px;
            position: relative;
            cursor: pointer;
        }

        .toggle-switch.active {
            background: var(--accent);
        }

        .toggle-switch::after {
            content: '';
            position: absolute;
            width: 20px;
            height: 20px;
            background: white;
            border-radius: 50%;
            top: 2px;
            left: 2px;
            transition: left 0.2s;
        }

        .toggle-switch.active::after {
            left: 22px;
        }

        /* Overlay */
        .overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 150;
            display: none;
        }

        .overlay.visible {
            display: block;
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
        }

        /* File Link */
        .file-link {
            color: var(--accent);
            text-decoration: underline;
            cursor: pointer;
        }

        /* Toast notification */
        .toast {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--btn-primary-bg);
            color: var(--btn-primary-text);
            padding: 12px 20px;
            font-size: 13px;
            z-index: 400;
            opacity: 0;
            transition: opacity 0.3s;
        }

        .toast.visible {
            opacity: 1;
        }

        /* Loading spinner */
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px;
        }

        .spinner {
            width: 24px;
            height: 24px;
            border: 2px solid var(--border-color);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar {
            width: 4px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--border-color);
        }

        /* Safe area for mobile */
        @supports (padding-bottom: env(safe-area-inset-bottom)) {
            .chat-input-container {
                padding-bottom: calc(12px + env(safe-area-inset-bottom));
            }
        }
    </style>
</head>
<body>
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
            <div class="instance-tab active">Loading...</div>
        </div>
        <div class="header-actions">
            <button class="icon-btn" onclick="toggleTheme()" title="Toggle Theme">◐</button>
            <button class="icon-btn" onclick="openSettings()" title="Settings">☰</button>
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
                <!-- Chat Header -->
                <div class="chat-header">
                    <div class="chat-header-row">
                        <button class="back-btn" id="backBtn" onclick="showSessionsList()">←</button>
                        <div class="chat-title" id="chatTitle">Sessions</div>
                        <button class="new-chat-btn" onclick="startNewChat()" title="New Chat">+</button>
                    </div>
                </div>

                <!-- Inbox Status -->
                <div class="inbox-status">
                    <div class="status-indicator" id="inboxStatus"></div>
                    <span id="inboxStatusText">Checking inbox...</span>
                </div>

                <!-- Sessions List View -->
                <div class="sessions-view" id="sessionsView">
                    <div class="loading"><div class="spinner"></div></div>
                </div>

                <!-- Messages View -->
                <div class="messages-view" id="messagesView"></div>

                <!-- Chat Input -->
                <div class="chat-input-container">
                    <div class="chat-input-header" id="chatInputHeader">
                        <button class="back-btn visible" onclick="showSessionsList()">←</button>
                        <div class="chat-title" id="chatTitleBottom">Sessions</div>
                        <button class="new-chat-btn" onclick="startNewChat()" title="New Chat">+</button>
                    </div>
                    <div class="model-select-row">
                        <select class="model-select" id="sessionSelect">
                            <option value="new">🆕 New Chat</option>
                            <option value="current">📌 Current Session</option>
                        </select>
                        <select class="model-select" id="modelSelect">
                            <option value="">Default Model</option>
                            <option value="copilot/gpt-4o">GPT-4o</option>
                            <option value="copilot/claude-sonnet-4">Claude Sonnet 4</option>
                            <option value="copilot/claude-sonnet-4.5">Claude Sonnet 4.5</option>
                            <option value="copilot/claude-opus-4.5">Claude Opus 4.5</option>
                            <option value="copilot/o1">o1</option>
                            <option value="copilot/o3-mini">o3-mini</option>
                            <option value="copilot/gemini-2.0-flash">Gemini 2.0 Flash</option>
                        </select>
                    </div>
                    <div class="chat-input-row">
                        <textarea class="chat-input" id="chatInput" placeholder="Type a message..." rows="1"></textarea>
                        <button class="send-btn" id="sendBtn" onclick="sendMessage()">Send</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Terminal Tab (Placeholder) -->
        <div class="tab-content" id="tab-terminal">
            <div class="placeholder-content">
                <div class="placeholder-icon">⌨</div>
                <div class="placeholder-title">Terminal</div>
                <div class="placeholder-text">Terminal functionality coming soon</div>
            </div>
        </div>

        <!-- Files Tab (Placeholder) -->
        <div class="tab-content" id="tab-files">
            <div class="placeholder-content">
                <div class="placeholder-icon">📁</div>
                <div class="placeholder-title">Files</div>
                <div class="placeholder-text">File browser coming soon</div>
            </div>
        </div>

        <!-- Git Tab (Placeholder) -->
        <div class="tab-content" id="tab-git">
            <div class="placeholder-content">
                <div class="placeholder-icon">⎇</div>
                <div class="placeholder-title">Git</div>
                <div class="placeholder-text">Git integration coming soon</div>
            </div>
        </div>
    </main>

    <!-- Settings Panel -->
    <div class="overlay" id="overlay" onclick="closeSettings()"></div>
    <div class="settings-panel" id="settingsPanel">
        <div class="settings-header">
            <span class="settings-title">Settings</span>
            <button class="icon-btn" onclick="closeSettings()">✕</button>
        </div>
        <div class="settings-body">
            <div class="settings-item">
                <label class="settings-label">Local Server</label>
                <div class="settings-toggle">
                    <span>Enable server</span>
                    <div class="toggle-switch active" id="serverToggle" onclick="toggleServer()"></div>
                </div>
            </div>
            <div class="settings-item">
                <label class="settings-label">Server Port</label>
                <input type="number" class="model-select" id="serverPort" value="3847" style="width: 100%;">
            </div>
            <div class="settings-item">
                <label class="settings-label">WebSocket Port</label>
                <input type="number" class="model-select" id="wsPort" value="3848" style="width: 100%;">
            </div>
            <div class="settings-item">
                <label class="settings-label">Theme</label>
                <div class="settings-toggle">
                    <span>Dark Mode</span>
                    <div class="toggle-switch" id="themeToggle" onclick="toggleTheme()"></div>
                </div>
            </div>
            <div class="settings-item">
                <label class="settings-label">Auto-refresh</label>
                <div class="settings-toggle">
                    <span>Auto-refresh inbox</span>
                    <div class="toggle-switch active" id="autoRefreshToggle" onclick="toggleAutoRefresh()"></div>
                </div>
            </div>
        </div>
    </div>

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

    <!-- Toast -->
    <div class="toast" id="toast"></div>

    <script>
        // State
        const API = window.location.origin;
        let ws = null;
        let currentInbox = null;
        let selectedSessionIndex = -1;
        let isInMessagesView = false;
        let autoRefreshEnabled = true;
        let refreshInterval = null;
        let waitingForReply = false;
        let pendingMessages = [];

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            initTheme();
            connectWebSocket();
            loadInbox();
            startAutoRefresh();
            setupInputHandlers();
        });

        // Theme
        function initTheme() {
            const dark = localStorage.getItem('theme') === 'dark';
            if (dark) {
                document.body.classList.add('dark');
                document.getElementById('themeToggle').classList.add('active');
            }
        }

        function toggleTheme() {
            const isDark = document.body.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            document.getElementById('themeToggle').classList.toggle('active', isDark);
        }

        // WebSocket
        function connectWebSocket() {
            // Derive WS port from HTTP port (WS port = HTTP port + 1)
            const httpPort = parseInt(window.location.port) || 3847;
            const wsPort = document.getElementById('wsPort')?.value || (httpPort + 1);
            try {
                ws = new WebSocket('ws://' + window.location.hostname + ':' + wsPort);
                
                ws.onopen = () => {
                    console.log('WebSocket connected on port ' + wsPort);
                    updateStatus(true);
                };
                
                ws.onclose = () => {
                    console.log('WebSocket disconnected');
                    updateStatus(false);
                    setTimeout(connectWebSocket, 5000);
                };
                
                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        handleWebSocketMessage(msg);
                    } catch (e) {
                        console.error('WS message error:', e);
                    }
                };
                
                ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                };
            } catch (e) {
                console.error('WebSocket connection failed:', e);
                updateStatus(false);
            }
        }

        function handleWebSocketMessage(msg) {
            console.log('WS message received:', msg.type);
            
            switch (msg.type) {
                case 'inbox_update':
                case 'session_update':
                case 'message_update':
                    // Update inbox data without full UI refresh
                    if (msg.data && !msg.data.error) {
                        // Check if this update is for the currently selected workspace
                        const updateWorkspace = msg.data.workspaceHash;
                        const selectedWorkspace = allInstances[selectedInstanceIndex]?.id || currentInstanceWorkspaceHash;
                        
                        // Only apply update if it's for the selected workspace
                        if (updateWorkspace && selectedWorkspace && updateWorkspace !== selectedWorkspace) {
                            console.log('Ignoring inbox update for different workspace:', updateWorkspace);
                            return;
                        }
                        
                        const oldInbox = currentInbox;
                        currentInbox = msg.data;
                        
                        // Check if we're waiting for a reply and got new assistant message
                        if (isInMessagesView && selectedSessionIndex >= 0 && waitingForReply) {
                            const newSession = currentInbox.sessions?.[selectedSessionIndex];
                            const oldSession = oldInbox?.sessions?.[selectedSessionIndex];
                            
                            const newMsgCount = newSession?.messages?.length || 0;
                            const oldMsgCount = oldSession?.messages?.length || 0;
                            
                            if (newMsgCount > oldMsgCount) {
                                const lastMsg = newSession.messages[newSession.messages.length - 1];
                                if (lastMsg && lastMsg.role === 'assistant') {
                                    // Got reply! Stop waiting and render
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
                        
                        // If not waiting for reply, just update sidebar
                        renderSessions();
                        updateSessionSelect();
                        
                        // If in messages view and not waiting, also update messages
                        if (isInMessagesView && selectedSessionIndex >= 0 && !waitingForReply) {
                            const session = currentInbox.sessions?.[selectedSessionIndex];
                            if (session) {
                                renderMessages(session);
                            }
                        }
                    }
                    break;
                case 'instances_update':
                    if (msg.data && msg.data.instances) {
                        updateInstances(msg.data.instances);
                    } else if (Array.isArray(msg.data)) {
                        updateInstances(msg.data);
                    }
                    break;
                case 'status':
                    updateStatus(msg.data.connected);
                    break;
            }
        }

        function updateStatus(connected) {
            const dot = document.getElementById('statusDot');
            dot.classList.toggle('offline', !connected);
        }

        // Settings
        function openSettings() {
            document.getElementById('settingsPanel').classList.add('open');
            document.getElementById('overlay').classList.add('visible');
        }

        function closeSettings() {
            document.getElementById('settingsPanel').classList.remove('open');
            document.getElementById('overlay').classList.remove('visible');
        }

        function toggleServer() {
            const toggle = document.getElementById('serverToggle');
            toggle.classList.toggle('active');
            showToast(toggle.classList.contains('active') ? 'Server enabled' : 'Server disabled');
        }

        function toggleAutoRefresh() {
            autoRefreshEnabled = !autoRefreshEnabled;
            document.getElementById('autoRefreshToggle').classList.toggle('active', autoRefreshEnabled);
            if (autoRefreshEnabled) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        }

        function startAutoRefresh() {
            if (refreshInterval) clearInterval(refreshInterval);
            refreshInterval = setInterval(() => {
                if (autoRefreshEnabled && !isInMessagesView) {
                    console.log('Auto-refreshing inbox...');
                    loadInbox();
                }
            }, 5000); // Reduced to 5 seconds for fresher data
        }

        function stopAutoRefresh() {
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }
        }

        // Tabs
        function switchTab(tabName) {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
            document.getElementById('tab-' + tabName).classList.add('active');
        }

        // Inbox
        let allInstances = [];
        let selectedInstanceIndex = 0;
        let currentInstanceWorkspaceHash = null; // Track the current window's hash
        
        async function loadInbox() {
            console.log('Loading inbox...');
            try {
                const wsRes = await fetch(API + '/api/inbox/current-workspace');
                const wsData = await wsRes.json();
                
                if (!wsData.workspaceHash) {
                    updateInboxStatus('offline', 'Workspace not detected');
                    return;
                }
                
                console.log('Current workspace:', wsData.workspaceHash);
                
                // Save current instance hash
                currentInstanceWorkspaceHash = wsData.workspaceHash;
                
                // Update instances from server response (includes all connected windows)
                if (wsData.instances && wsData.instances.length > 0) {
                    allInstances = wsData.instances;
                    
                    // Find which index is the current/active instance
                    const currentIndex = allInstances.findIndex(inst => inst.isActive || inst.id === currentInstanceWorkspaceHash);
                    if (currentIndex >= 0) {
                        selectedInstanceIndex = currentIndex;
                    }
                    
                    updateInstances(allInstances);
                } else {
                    allInstances = [{ 
                        id: wsData.workspaceHash, 
                        workspaceName: wsData.workspaceName || 'VS Code',
                        isActive: true 
                    }];
                    selectedInstanceIndex = 0;
                    updateInstances(allInstances);
                }
                
                // Load inbox for selected instance (defaults to current instance)
                const targetWorkspace = allInstances[selectedInstanceIndex]?.id || currentInstanceWorkspaceHash;
                const timestamp = Date.now(); // Add timestamp to prevent caching
                const r = await fetch(API + '/api/inbox/messages?workspace=' + encodeURIComponent(targetWorkspace) + '&_t=' + timestamp, {
                    cache: 'no-cache',
                    headers: { 'Cache-Control': 'no-cache' }
                });
                currentInbox = await r.json();
                
                console.log('Loaded inbox:', currentInbox.sessions?.length || 0, 'sessions,', currentInbox.totalMessages || 0, 'total messages');
                
                if (currentInbox.error) {
                    document.getElementById('sessionsView').innerHTML = '<div class="placeholder-content"><div class="placeholder-text">' + escapeHtml(currentInbox.error) + '</div></div>';
                    return;
                }
                
                const instanceName = allInstances[selectedInstanceIndex]?.workspaceName || 'VS Code';
                updateInboxStatus('online', instanceName + ' • ' + currentInbox.sessions.length + ' sessions');
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
            allInstances = instances || [];
            const container = document.getElementById('instancesTabs');
            
            if (allInstances.length === 0) {
                container.innerHTML = '<div class="instance-tab active">No instances</div>';
                return;
            }
            
            // Ensure selectedInstanceIndex is valid
            if (selectedInstanceIndex >= allInstances.length) {
                selectedInstanceIndex = 0;
            }
            
            container.innerHTML = allInstances.map((inst, i) => 
                '<div class="instance-tab' + (i === selectedInstanceIndex ? ' active' : '') + '" onclick="selectInstance(' + i + ')" title="' + escapeHtml(inst.id || '') + '">' + 
                escapeHtml(inst.workspaceName || inst.id || 'Unknown') + 
                (allInstances.length > 1 ? ' <span style="opacity:0.5;font-size:10px;">(' + (i + 1) + ')</span>' : '') +
                '</div>'
            ).join('');
        }

        function selectInstance(index) {
            if (index === selectedInstanceIndex) return;
            
            selectedInstanceIndex = index;
            document.querySelectorAll('.instance-tab').forEach((t, i) => {
                t.classList.toggle('active', i === index);
            });
            
            // Clear current selection and reload inbox for new instance
            selectedSessionIndex = -1;
            document.getElementById('sessionsView').innerHTML = '<div class="placeholder-content"><div class="placeholder-icon">⏳</div><div class="placeholder-title">Loading...</div></div>';
            
            loadInbox();
        }
        
        // Get currently selected workspace hash
        function getSelectedWorkspaceHash() {
            return allInstances[selectedInstanceIndex]?.id || null;
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
            const select = document.getElementById('sessionSelect');
            while (select.options.length > 2) select.remove(2);
            
            if (currentInbox && currentInbox.sessions) {
                currentInbox.sessions.forEach((s, i) => {
                    const opt = document.createElement('option');
                    opt.value = 'session-' + i;
                    opt.textContent = '📝 ' + (s.title || 'Untitled');
                    select.appendChild(opt);
                });
            }
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
            document.getElementById('sessionSelect').value = 'session-' + index;
            
            if (session.lastModel) {
                const modelSelect = document.getElementById('modelSelect');
                const opt = Array.from(modelSelect.options).find(o => o.value === session.lastModel);
                if (opt) modelSelect.value = session.lastModel;
            }
            
            renderMessages(session);
            
            // Scroll to bottom after DOM is painted
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
                
                // Thinking boxes (can be multiple)
                if (m.thinking && Array.isArray(m.thinking) && m.thinking.length > 0) {
                    m.thinking.forEach((think, thinkIdx) => {
                        if (think && think.content) {
                            const thinkingId = 'thinking-' + i + '-' + thinkIdx;
                            html += '<div class="thinking-box">';
                            html += '<div class="thinking-header" onclick="toggleThinking(\\'' + thinkingId + '\\')">';
                            html += '<span class="thinking-arrow" id="arrow-' + thinkingId + '">▶</span>';
                            html += '<span>💭 ' + escapeHtml(think.title) + '</span>';
                            html += '</div>';
                            html += '<div class="thinking-content" id="' + thinkingId + '">' + escapeHtml(think.content) + '</div>';
                            html += '</div>';
                        }
                    });
                }
                
                html += '<div class="message-content">' + linkifyFiles(escapeHtml(m.text)) + '</div>';
                
                // Pending command
                if (m.pendingCommand && m.pendingCommand.command) {
                    html += '<div class="pending-command">';
                    html += '<div class="pending-command-title">⏳ Command awaiting approval</div>';
                    html += '<div class="pending-command-code">' + escapeHtml(m.pendingCommand.command) + '</div>';
                    html += '<div class="pending-actions">';
                    html += '<button class="btn-approve" onclick="approveCommand(\\'approve\\')">✓ Approve</button>';
                    html += '<button class="btn-skip" onclick="approveCommand(\\'skip\\')">✕ Skip</button>';
                    html += '</div></div>';
                }
                
                html += '</div>';
                return html;
            }).join('');
            
            // Wrap in messages-wrapper for proper bottom alignment
            container.innerHTML = '<div class="messages-wrapper">' + messagesHtml + '</div>';
            
            // Scroll to bottom after DOM is painted
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

        // Append a message to the current view immediately
        function appendMessageToView(role, text) {
            const container = document.getElementById('messagesView');
            if (!container || !container.classList.contains('active')) {
                console.log('Messages view not active, cannot append');
                return null;
            }
            
            // Remove placeholder if present
            const placeholder = container.querySelector('.placeholder-content');
            if (placeholder) placeholder.remove();
            
            // Remove loading indicator if present
            hideLoadingIndicator();
            
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message ' + role + ' pending-msg';
            msgDiv.innerHTML = 
                '<div class="message-header">' +
                '<span class="message-role">' + (role === 'user' ? '👤 You' : '🤖 Assistant') + '</span>' +
                '<span class="message-status">sending...</span>' +
                '</div>' +
                '<div class="message-content">' + escapeHtml(text) + '</div>';
            
            container.appendChild(msgDiv);
            container.scrollTop = container.scrollHeight;
            
            // Track this pending message
            pendingMessages.push({ role, text, element: msgDiv });
            
            return msgDiv;
        }
        
        // Mark pending messages as sent
        function markMessagesSent() {
            pendingMessages.forEach(pm => {
                if (pm.element) {
                    pm.element.classList.remove('pending-msg');
                    const status = pm.element.querySelector('.message-status');
                    if (status) status.remove();
                }
            });
        }
        
        // Clear pending messages after they appear in JSON
        function clearPendingMessages() {
            pendingMessages = [];
        }
        
        // Show loading indicator for waiting response
        function showLoadingIndicator() {
            const container = document.getElementById('messagesView');
            if (!container || !container.classList.contains('active')) return;
            
            // Remove existing loading indicator
            const existing = document.getElementById('loadingIndicator');
            if (existing) existing.remove();
            
            const loadingDiv = document.createElement('div');
            loadingDiv.id = 'loadingIndicator';
            loadingDiv.className = 'message assistant loading';
            loadingDiv.innerHTML = 
                '<div class="message-header">' +
                '<span class="message-role">🤖 Assistant</span>' +
                '</div>' +
                '<div class="message-content">' +
                '<span class="loading-dots">Thinking<span>.</span><span>.</span><span>.</span></span>' +
                '</div>';
            
            container.appendChild(loadingDiv);
            container.scrollTop = container.scrollHeight;
        }
        
        function hideLoadingIndicator() {
            const loading = document.getElementById('loadingIndicator');
            if (loading) loading.remove();
        }
        
        // Auto-poll for new messages
        let pollInterval = null;
        let pollCount = 0;
        let lastMessageCount = 0;
        let pendingUserMessage = null;
        const MAX_POLL_COUNT = 60; // 60 seconds max
        
        function startPolling() {
            stopPolling();
            pollCount = 0;
            
            // Remember current message count
            if (isInMessagesView && selectedSessionIndex >= 0 && currentInbox?.sessions?.[selectedSessionIndex]) {
                lastMessageCount = currentInbox.sessions[selectedSessionIndex].messages?.length || 0;
            }
            
            pollInterval = setInterval(async () => {
                pollCount++;
                
                try {
                    // Fetch inbox without re-rendering
                    const r = await fetch(API + '/api/inbox/messages');
                    const newInbox = await r.json();
                    
                    if (newInbox.error) {
                        return;
                    }
                    
                    // Check if we got a new message in the selected session
                    if (isInMessagesView && selectedSessionIndex >= 0) {
                        const newSession = newInbox.sessions?.[selectedSessionIndex];
                        const newMsgCount = newSession?.messages?.length || 0;
                        
                        // Check if there's a new assistant message
                        if (newMsgCount > lastMessageCount) {
                            const lastMsg = newSession.messages[newSession.messages.length - 1];
                            
                            if (lastMsg && lastMsg.role === 'assistant') {
                                // Got a reply! Update and render
                                currentInbox = newInbox;
                                hideLoadingIndicator();
                                clearPendingMessages();
                                renderMessages(newSession);
                                updateInboxStatus('online', 'Reply received');
                                showToast('New reply received!');
                                stopPolling();
                                return;
                            }
                        }
                    }
                } catch (e) {
                    console.error('Poll error:', e);
                }
                
                // Stop after max time
                if (pollCount >= MAX_POLL_COUNT) {
                    hideLoadingIndicator();
                    updateInboxStatus('online', 'Timeout - no reply');
                    clearPendingMessages();
                    stopPolling();
                    // Refresh to get current state
                    loadInbox();
                }
            }, 1000);
        }
        
        function stopPolling() {
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
        }

        // New Chat
        function startNewChat() {
            document.getElementById('sessionSelect').value = 'new';
            document.getElementById('chatInput').focus();
            showToast('Ready to start new chat');
        }

        // Send Message - uses server-side polling for reliable reply detection
        async function sendMessage() {
            const input = document.getElementById('chatInput');
            const msg = input.value.trim();
            if (!msg) return;
            
            const model = document.getElementById('modelSelect').value;
            const sessionSelect = document.getElementById('sessionSelect').value;
            
            let sessionMode = 'current';
            let sessionId = null;

            // First priority: If viewing a session, use that session
            if (isInMessagesView && selectedSessionIndex >= 0 && currentInbox?.sessions?.[selectedSessionIndex]?.sessionId) {
                sessionMode = 'session';
                sessionId = currentInbox.sessions[selectedSessionIndex].sessionId;
            } else if (sessionSelect === 'new') {
                sessionMode = 'new';
            } else if (sessionSelect.startsWith('session-')) {
                sessionMode = 'session';
                const idx = parseInt(sessionSelect.replace('session-', ''));
                sessionId = currentInbox?.sessions?.[idx]?.sessionId;
            }
            sendBtn.disabled = true;
            sendBtn.textContent = '...';
            
            // Clear input first
            input.value = '';
            
            // Immediately append user message to the view (if we're in messages view)
            const msgElement = appendMessageToView('user', msg);
            
            updateInboxStatus('working', 'Sending message...');
            
            try {
                const body = { message: msg, sessionMode, maxWait: 60000 };
                if (model) body.model = model;
                if (sessionId) body.sessionId = sessionId;
                
                // Include target workspace for multi-instance support
                const targetWorkspace = getSelectedWorkspaceHash();
                if (targetWorkspace) body.workspace = targetWorkspace;
                
                // Show loading indicator
                showLoadingIndicator();
                waitingForReply = true;
                
                // Use send-and-wait for reliable server-side polling
                const r = await fetch(API + '/api/inbox/send-and-wait', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                
                const d = await r.json();
                
                if (d.success) {
                    // Mark the message as sent
                    markMessagesSent();
                    
                    updateInboxStatus('online', 'Reply received');
                    
                    // Hide loading
                    hideLoadingIndicator();
                    waitingForReply = false;
                    clearPendingMessages();
                    
                    // Save current session info before reload
                    const currentSessionIdx = selectedSessionIndex;
                    const currentSessionId = currentInbox?.sessions?.[currentSessionIdx]?.sessionId;
                    const wasInMessagesView = isInMessagesView;
                    
                    // Reload inbox data
                    await loadInbox();
                    
                    // Find and re-select the session
                    if (wasInMessagesView && currentInbox?.sessions?.length > 0) {
                        // Try to find session by ID first
                        let newIndex = -1;
                        if (currentSessionId) {
                            newIndex = currentInbox.sessions.findIndex(s => s.sessionId === currentSessionId);
                        }
                        
                        // If not found by ID, the first session (most recently updated) is likely ours
                        if (newIndex < 0) {
                            newIndex = 0;
                        }
                        
                        // Make sure the session has messages
                        if (currentInbox.sessions[newIndex]?.messages?.length > 0) {
                            selectSession(newIndex);
                        } else {
                            // Find first session with messages
                            for (let i = 0; i < currentInbox.sessions.length; i++) {
                                if (currentInbox.sessions[i]?.messages?.length > 0) {
                                    selectSession(i);
                                    break;
                                }
                            }
                        }
                    }
                } else {
                    showToast('Error: ' + (d.error || 'Failed to get reply'));
                    updateInboxStatus('online', 'Inbox ready');
                    hideLoadingIndicator();
                    waitingForReply = false;
                    // Remove the pending message on error
                    if (msgElement) msgElement.remove();
                    clearPendingMessages();
                }
            } catch (e) {
                showToast('Error: ' + e.message);
                updateInboxStatus('online', 'Inbox ready');
                hideLoadingIndicator();
                waitingForReply = false;
                // Remove the pending message on error
                if (msgElement) msgElement.remove();
                clearPendingMessages();
            } finally {
                sendBtn.disabled = false;
                sendBtn.textContent = 'Send';
            }
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

        // File handling
        function linkifyFiles(text) {
            return text.replace(/\\[\\[FILE\\|([^|]+)\\|([^\\]]+)\\]\\]/g, (match, path, name) => {
                const encoded = btoa(path);
                return '<span class="file-link" onclick="openFile(\\'' + encoded + '\\')">' + name + '</span>';
            });
        }

        async function openFile(encodedPath) {
            const filename = atob(encodedPath);
            document.getElementById('fileModalTitle').textContent = filename;
            document.getElementById('fileModalContent').textContent = 'Loading...';
            document.getElementById('fileModal').classList.add('open');
            
            try {
                const r = await fetch(API + '/api/file/read', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename })
                });
                const d = await r.json();
                document.getElementById('fileModalContent').textContent = d.success ? d.content : ('Error: ' + d.error);
            } catch (e) {
                document.getElementById('fileModalContent').textContent = 'Error: ' + e.message;
            }
        }

        function closeFileModal() {
            document.getElementById('fileModal').classList.remove('open');
        }

        // Utilities
        function escapeHtml(text) {
            if (!text) return '';
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function showToast(msg) {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.classList.add('visible');
            setTimeout(() => toast.classList.remove('visible'), 3000);
        }

        function setupInputHandlers() {
            const input = document.getElementById('chatInput');
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });
            
            // Auto-resize textarea
            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            });
        }
    </script>
</body>
</html>`;
}
