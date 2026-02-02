"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const inbox = __importStar(require("./inbox"));
let server = null;
let chatHistory = [];
let capturedMessages = [];
let outputChannel;
let clipboardWatcher = null;
let lastClipboard = '';
let fileWatchers = [];
let chatStorageContent = [];
let currentWorkspaceHash = null;
let extensionStoragePath = null;
function log(msg) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[RemoteChatControl] ${msg}`);
    outputChannel?.appendLine(`[${timestamp}] ${msg}`);
}
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('Remote Chat Control');
    outputChannel.show();
    log('Extension activating...');
    vscode.window.showInformationMessage('Remote Chat Control is now active!');
    // Get the workspace storage path - this tells us which workspace folder we're in
    extensionStoragePath = context.storageUri?.fsPath || context.globalStorageUri?.fsPath || '';
    // Extract workspace hash from the storage path
    // Path looks like: .../workspaceStorage/HASH/github.copilot-chat/...
    const storagePathParts = extensionStoragePath.split(path.sep);
    const wsIdx = storagePathParts.indexOf('workspaceStorage');
    if (wsIdx >= 0 && storagePathParts[wsIdx + 1]) {
        currentWorkspaceHash = storagePathParts[wsIdx + 1];
        log(`Detected workspace hash: ${currentWorkspaceHash}`);
    }
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('remoteChatControl.sendMessage', () => promptAndSend()), vscode.commands.registerCommand('remoteChatControl.readMessages', showHistory), vscode.commands.registerCommand('remoteChatControl.startServer', startServer), vscode.commands.registerCommand('remoteChatControl.scanChatStorage', scanChatStorage), vscode.commands.registerCommand('remoteChatControl.startClipboardWatch', startClipboardWatch));
    // Log current workspace info
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        workspaceFolders.forEach(folder => {
            log(`Workspace: ${folder.name} at ${folder.uri.fsPath}`);
        });
    }
    log(`Extension storage: ${extensionStoragePath}`);
    // Start all monitoring
    startServer();
    startClipboardWatch();
    startNetworkIntercept();
    scanChatStorage();
    watchChatStorageFiles(context);
    log('Extension activated with all monitors');
}
async function promptAndSend() {
    const msg = await vscode.window.showInputBox({ prompt: 'Enter message for chat' });
    if (msg) {
        await sendToChat(msg);
    }
}
// Session modes: 'new', 'current', 'session' (with sessionId)
async function sendToChat(message, model, sessionMode, sessionId) {
    log(`Sending message: "${message}"${model ? ` (model: ${model})` : ''}${sessionMode ? ` (mode: ${sessionMode})` : ''}`);
    chatHistory.push({
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
    });
    try {
        let note;
        let sessionOpened = false;
        if (sessionMode === 'new') {
            // Create a new chat session then send message
            await vscode.commands.executeCommand('workbench.action.chat.newChat');
            await new Promise(r => setTimeout(r, 300));
            note = 'Created new chat';
            // For new chat, we still need to open with query
        }
        else if (sessionMode === 'session' && sessionId) {
            // Try to open the specific session using its URI
            try {
                // Session ID needs to be base64 encoded for the URI
                const encodedSessionId = Buffer.from(sessionId).toString('base64');
                const sessionUri = vscode.Uri.parse(`vscode-chat-session://local/${encodedSessionId}`);
                log(`Trying to open session URI: ${sessionUri.toString()} (original ID: ${sessionId})`);
                // Open the session - this makes it the active session in chat view
                await vscode.commands.executeCommand('vscode.open', sessionUri);
                log('Opened session via vscode.open');
                note = 'Opened session';
                sessionOpened = true;
                // Wait longer for the session to fully load and become active
                await new Promise(r => setTimeout(r, 800));
            }
            catch (e) {
                log(`Session open error: ${e}`);
                note = 'Session open failed, sending to current';
            }
        }
        // 'current' mode - just send to current/last active session
        if (sessionOpened) {
            // Session is now open and active via vscode.open
            // Type directly into the chat input and press Enter
            try {
                // Wait for session to fully load after vscode.open
                await new Promise(r => setTimeout(r, 500));
                // Focus the chat input - try multiple approaches
                try {
                    await vscode.commands.executeCommand('workbench.action.chat.focusInput');
                }
                catch {
                    await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                }
                await new Promise(r => setTimeout(r, 300));
                log('Chat input focused');
                // Type the message into the focused input
                await vscode.commands.executeCommand('type', { text: message });
                log('Message typed into chat input');
                // Wait for text to appear
                await new Promise(r => setTimeout(r, 300));
                // Submit using the chat submit command
                try {
                    await vscode.commands.executeCommand('workbench.action.chat.submit');
                    log('Submit command executed');
                }
                catch {
                    // If submit fails, try pressing Enter key
                    log('Submit failed, trying Enter key');
                    await vscode.commands.executeCommand('type', { text: '\n' });
                }
            }
            catch (e) {
                log(`Type/submit failed: ${e}`);
                // Fallback - will create new session but at least sends
                await vscode.commands.executeCommand('workbench.action.chat.open', {
                    query: message,
                    isPartialQuery: false
                });
            }
        }
        else {
            // Open chat with the message (for new or current mode)
            await vscode.commands.executeCommand('workbench.action.chat.open', {
                query: message,
                isPartialQuery: false
            });
            // Also try to submit it
            setTimeout(async () => {
                try {
                    await vscode.commands.executeCommand('workbench.action.chat.submit');
                }
                catch (e) {
                    log(`Submit command failed: ${e}`);
                }
            }, 500);
        }
        log('Message sent to chat panel');
        const result = model ? `Message sent (Note: Select ${model} in UI)` : 'Message sent to chat';
        return { result, note };
    }
    catch (err) {
        log(`Error: ${err}`);
        return { result: `Error: ${err}` };
    }
}
// ==================== CLIPBOARD MONITORING ====================
function startClipboardWatch() {
    if (clipboardWatcher) {
        clearInterval(clipboardWatcher);
    }
    log('Starting clipboard monitoring...');
    clipboardWatcher = setInterval(async () => {
        try {
            const current = await vscode.env.clipboard.readText();
            if (current && current !== lastClipboard && current.length > 10) {
                lastClipboard = current;
                // Check if it looks like chat content
                if (looksLikeChatContent(current)) {
                    log(`Clipboard captured (chat-like): ${current.substring(0, 100)}...`);
                    capturedMessages.push({
                        type: 'clipboard',
                        timestamp: new Date().toISOString(),
                        content: current
                    });
                }
            }
        }
        catch (e) {
            // Ignore clipboard errors
        }
    }, 1000);
    log('Clipboard monitoring active');
}
function looksLikeChatContent(text) {
    const indicators = [
        /copilot/i,
        /```[\s\S]*```/, // Code blocks
        /^(user|assistant|human|ai):/im,
        /\*\*.*\*\*/, // Bold text
        /#{1,3}\s+/, // Headers
    ];
    return indicators.some(r => r.test(text));
}
// ==================== NETWORK INTERCEPT ====================
function startNetworkIntercept() {
    log('Setting up network interception...');
    // Hook into Node.js http/https modules
    const originalHttpRequest = http.request;
    const originalHttpsRequest = https.request;
    // Intercept HTTP
    http.request = function (...args) {
        const req = originalHttpRequest.apply(http, args);
        interceptRequest(req, args, 'http');
        return req;
    };
    // Intercept HTTPS
    https.request = function (...args) {
        const req = originalHttpsRequest.apply(https, args);
        interceptRequest(req, args, 'https');
        return req;
    };
    log('Network interception active');
}
function interceptRequest(req, args, protocol) {
    try {
        const options = args[0];
        const url = typeof options === 'string' ? options :
            `${options.hostname || options.host}${options.path || ''}`;
        // Check if this is a Copilot/AI related request
        if (url && (url.includes('copilot') ||
            url.includes('github') ||
            url.includes('openai') ||
            url.includes('api.github') ||
            url.includes('githubcopilot'))) {
            log(`Network request: ${protocol}://${url.substring(0, 100)}`);
            // Capture request data
            const originalWrite = req.write.bind(req);
            let requestBody = '';
            req.write = function (chunk, ...writeArgs) {
                if (chunk) {
                    requestBody += chunk.toString();
                }
                return originalWrite(chunk, ...writeArgs);
            };
            req.on('response', (res) => {
                let responseBody = '';
                res.on('data', (chunk) => {
                    responseBody += chunk.toString();
                });
                res.on('end', () => {
                    try {
                        capturedMessages.push({
                            type: 'network',
                            timestamp: new Date().toISOString(),
                            url: url,
                            request: requestBody.substring(0, 1000),
                            response: responseBody.substring(0, 2000),
                            statusCode: res.statusCode
                        });
                        log(`Captured network response from: ${url.substring(0, 50)}`);
                    }
                    catch (e) {
                        log(`Error capturing response: ${e}`);
                    }
                });
            });
        }
    }
    catch (e) {
        // Ignore interception errors
    }
}
// ==================== FILE SYSTEM MONITORING ====================
async function scanChatStorage() {
    log('Scanning for chat storage files...');
    chatStorageContent = [];
    // VS Code stores chat data in workspaceStorage folders in state.vscdb files
    const possiblePaths = [
        // Windows - Main locations
        path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'Code - Insiders', 'User', 'workspaceStorage'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'Code - Insiders', 'User', 'globalStorage'),
        // macOS
        path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'),
        path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage'),
        // Linux
        path.join(os.homedir(), '.config', 'Code', 'User', 'workspaceStorage'),
        path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage'),
    ];
    for (const basePath of possiblePaths) {
        try {
            if (fs.existsSync(basePath)) {
                log(`Scanning: ${basePath}`);
                // First, find the most recently modified workspace folder
                const latestWorkspacePath = await findMostRecentWorkspaceFolder(basePath);
                if (latestWorkspacePath) {
                    log(`Found most recent workspace folder: ${latestWorkspacePath}`);
                    // Scan the most recent folder first (depth 0 to scan its subdirectories)
                    await scanDirectoryForChat(latestWorkspacePath, 0);
                }
                // Also scan other folders but with less priority
                await scanDirectoryForChat(basePath, 0);
            }
        }
        catch (e) {
            log(`Error scanning ${basePath}: ${e}`);
        }
    }
    log(`Found ${chatStorageContent.length} potential chat-related files`);
}
// Find the most recently modified workspace folder in workspaceStorage
async function findMostRecentWorkspaceFolder(basePath) {
    try {
        const entries = fs.readdirSync(basePath, { withFileTypes: true });
        let mostRecentFolder = null;
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const fullPath = path.join(basePath, entry.name);
                try {
                    const stats = fs.statSync(fullPath);
                    // Check if this folder has a chatSessions subfolder
                    const chatSessionsPath = path.join(fullPath, 'chatSessions');
                    const hasChatSessions = fs.existsSync(chatSessionsPath);
                    // Prioritize folders with chatSessions, and among those, pick the most recent
                    if (hasChatSessions) {
                        const chatStats = fs.statSync(chatSessionsPath);
                        if (!mostRecentFolder || chatStats.mtime.getTime() > mostRecentFolder.mtime) {
                            mostRecentFolder = { path: fullPath, mtime: chatStats.mtime.getTime() };
                        }
                    }
                    else {
                        // If no folder with chatSessions found yet, track the most recent folder
                        if (!mostRecentFolder || stats.mtime.getTime() > mostRecentFolder.mtime) {
                            mostRecentFolder = { path: fullPath, mtime: stats.mtime.getTime() };
                        }
                    }
                }
                catch (e) {
                    // Ignore stat errors for individual folders
                }
            }
        }
        return mostRecentFolder?.path || null;
    }
    catch (e) {
        log(`Error finding most recent workspace folder: ${e}`);
        return null;
    }
}
async function scanDirectoryForChat(dirPath, depth) {
    if (depth > 6)
        return; // Increased depth to scan more files
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                // Prioritize chatSessions folders - these contain the actual chat JSON files!
                if (entry.name === 'chatSessions') {
                    log(`Found chatSessions folder: ${fullPath}`);
                    await scanChatSessionsFolder(fullPath);
                }
                else {
                    await scanDirectoryForChat(fullPath, depth + 1);
                }
            }
            else if (entry.isFile()) {
                const name = entry.name.toLowerCase();
                // Look for state.vscdb files - these contain chat data
                if (name === 'state.vscdb') {
                    await readVscdbFile(fullPath);
                }
                // Also check JSON files that might have chat data
                else if (name.endsWith('.json')) {
                    await readJsonFileForChat(fullPath);
                }
            }
        }
    }
    catch (e) {
        // Ignore permission errors
    }
}
async function scanChatSessionsFolder(folderPath) {
    try {
        const files = fs.readdirSync(folderPath, { withFileTypes: true });
        log(`Scanning chatSessions folder: ${folderPath} - found ${files.length} files`);
        for (const file of files) {
            // Process ALL JSON files, not just specific names
            if (file.isFile() && file.name.endsWith('.json')) {
                const filePath = path.join(folderPath, file.name);
                log(`Processing: ${file.name}`);
                await readChatSessionFile(filePath);
            }
        }
    }
    catch (e) {
        log(`Error reading chatSessions folder: ${e}`);
    }
}
async function readChatSessionFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        log(`Reading chat session: ${filePath}`);
        log(`File size: ${stats.size} bytes`);
        // Parse the chat session JSON
        try {
            const data = JSON.parse(content);
            log(`JSON parsed successfully. Keys: ${Object.keys(data).join(', ')}`);
            const messages = extractChatSessionMessages(data);
            log(`Extracted ${messages.length} messages from ${path.basename(filePath)}`);
            // Get workspace identifier from path
            const pathParts = filePath.split(path.sep);
            const workspaceIndex = pathParts.indexOf('workspaceStorage');
            const workspaceHash = workspaceIndex >= 0 ? pathParts[workspaceIndex + 1] : 'unknown';
            // Filter to show only user messages
            const userMessages = messages.filter(m => m.role === 'user' ||
                m.role === 'prompt' ||
                m.text.toLowerCase().startsWith('[user]'));
            log(`Found ${userMessages.length} user messages`);
            chatStorageContent.push({
                path: filePath,
                name: path.basename(filePath),
                type: 'chat-session',
                workspaceHash: workspaceHash,
                size: stats.size,
                modified: stats.mtime,
                rawData: JSON.stringify(data).substring(0, 2000), // Store raw for debugging
                messages: messages,
                userMessages: userMessages,
                messageCount: messages.length,
                userMessageCount: userMessages.length,
                content: messages.map((m, i) => `[${i + 1}] ${m.text}`).join('\n\n').substring(0, 10000)
            });
        }
        catch (e) {
            // If JSON parse fails, try to extract raw text
            log(`Failed to parse JSON ${filePath}: ${e}`);
            // Look for user messages in raw text
            const userMatches = content.match(/"text"[^}]+/gi) || [];
            if (userMatches.length > 0) {
                const pathParts = filePath.split(path.sep);
                const workspaceIndex = pathParts.indexOf('workspaceStorage');
                const workspaceHash = workspaceIndex >= 0 ? pathParts[workspaceIndex + 1] : 'unknown';
                chatStorageContent.push({
                    path: filePath,
                    name: path.basename(filePath),
                    type: 'chat-session-raw',
                    workspaceHash: workspaceHash,
                    size: stats.size,
                    modified: stats.mtime,
                    rawData: content.substring(0, 2000),
                    messages: userMatches.map(m => ({ role: 'unknown', text: m })),
                    userMessages: userMatches.map(m => ({ role: 'user', text: m })),
                    messageCount: userMatches.length,
                    userMessageCount: userMatches.length,
                    content: userMatches.join('\n---\n')
                });
            }
        }
    }
    catch (e) {
        log(`Error reading chat session file ${filePath}: ${e}`);
    }
}
// FIXED: This is the key function that now properly handles GitHub Copilot chat session format
function extractChatSessionMessages(data) {
    const messages = [];
    // GitHub Copilot Chat Session Format
    // Structure: { requests: [ { message: { text, parts }, response: [...] } ] }
    if (data.requests && Array.isArray(data.requests)) {
        log(`Found ${data.requests.length} requests in chat session`);
        for (let i = 0; i < data.requests.length; i++) {
            const request = data.requests[i];
            // Extract user message
            if (request.message) {
                let userText = '';
                // Method 1: Direct text property
                if (request.message.text) {
                    userText = request.message.text;
                }
                // Method 2: Parts array
                else if (request.message.parts && Array.isArray(request.message.parts)) {
                    userText = request.message.parts
                        .filter((p) => p.kind === 'text' || p.text)
                        .map((p) => p.text || p.value || '')
                        .join(' ');
                }
                if (userText) {
                    // Clean up the text
                    userText = userText.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').trim();
                    messages.push({
                        role: 'user',
                        text: userText
                    });
                    log(`  User message ${i + 1}: "${userText.substring(0, 100)}..."`);
                }
            }
            // Extract assistant response
            if (request.response && Array.isArray(request.response)) {
                let assistantText = '';
                for (const responseItem of request.response) {
                    // Response can have various types: text, thinking, toolInvocation, etc.
                    if (responseItem.value && typeof responseItem.value === 'string') {
                        assistantText += responseItem.value + '\n';
                    }
                    // Some responses have nested content
                    else if (responseItem.kind === 'textEditGroup' && responseItem.edits) {
                        assistantText += '[Code edits provided]\n';
                    }
                    else if (responseItem.kind === 'toolInvocationSerialized') {
                        if (responseItem.pastTenseMessage?.value) {
                            assistantText += '[Tool: ' + responseItem.pastTenseMessage.value + ']\n';
                        }
                    }
                }
                if (assistantText.trim()) {
                    assistantText = assistantText.trim();
                    messages.push({
                        role: 'assistant',
                        text: assistantText
                    });
                    log(`  Assistant response ${i + 1}: "${assistantText.substring(0, 100)}..."`);
                }
            }
        }
    }
    // Fallback: Try other common formats if no requests found
    if (messages.length === 0) {
        log('No messages found in requests format, trying fallback methods...');
        // Pattern 1: Direct array of messages
        if (Array.isArray(data)) {
            for (const item of data) {
                if (item.role && item.content) {
                    const content = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
                    messages.push({
                        role: item.role,
                        text: content
                    });
                }
            }
        }
        // Pattern 2: Object with messages property
        if (data.messages && Array.isArray(data.messages)) {
            for (const msg of data.messages) {
                if (msg.role && (msg.content || msg.text)) {
                    messages.push({
                        role: msg.role,
                        text: msg.content || msg.text
                    });
                }
            }
        }
        // Pattern 3: exchanges array
        if (data.exchanges && Array.isArray(data.exchanges)) {
            for (const exchange of data.exchanges) {
                if (exchange.prompt) {
                    messages.push({
                        role: 'user',
                        text: exchange.prompt
                    });
                }
                if (exchange.response) {
                    const response = typeof exchange.response === 'string' ? exchange.response : JSON.stringify(exchange.response);
                    messages.push({
                        role: 'assistant',
                        text: response
                    });
                }
            }
        }
    }
    log(`Total extracted messages: ${messages.length}`);
    return messages;
}
async function readVscdbFile(filePath) {
    try {
        // state.vscdb is a SQLite database, but we can read it as binary and search for chat strings
        const buffer = fs.readFileSync(filePath);
        const content = buffer.toString('utf-8');
        // Look for chat-related content in the database
        const chatPatterns = [
            /workbench\.panel\.chat/gi,
            /interactive\.session/gi,
            /"role"\s*:\s*"(user|assistant)"/gi,
            /"content"\s*:\s*"/gi,
            /copilot/gi,
        ];
        let hasChat = chatPatterns.some(p => p.test(content));
        if (hasChat) {
            log(`Found chat data in: ${filePath}`);
            // Extract readable text chunks that might be messages
            const messages = extractMessagesFromBinary(content);
            if (messages.length > 0) {
                chatStorageContent.push({
                    path: filePath,
                    name: 'state.vscdb',
                    type: 'vscdb',
                    size: buffer.length,
                    modified: fs.statSync(filePath).mtime,
                    messages: messages.map(m => ({ role: 'unknown', text: m })),
                    content: messages.join('\n---\n').substring(0, 10000)
                });
            }
        }
    }
    catch (e) {
        log(`Error reading vscdb ${filePath}: ${e}`);
    }
}
function extractMessagesFromBinary(content) {
    const messages = [];
    // Pattern to find JSON-like structures with role/content
    const patterns = [
        // Match {"role":"user","content":"..."} or {"role":"assistant","content":"..."}
        /\{"role"\s*:\s*"(user|assistant)"\s*,\s*"content"\s*:\s*"([^"]{10,})"/gi,
        /\{"content"\s*:\s*"([^"]{20,})"\s*,\s*"role"\s*:\s*"(user|assistant)"/gi,
        // Match markdown-like content
        /```[\s\S]{20,}?```/g,
        // Match conversation turns with text
        /"text"\s*:\s*"([^"]{20,})"/gi,
        /"message"\s*:\s*"([^"]{20,})"/gi,
        /"prompt"\s*:\s*"([^"]{20,})"/gi,
        /"response"\s*:\s*"([^"]{20,})"/gi,
    ];
    for (const pattern of patterns) {
        let match;
        const regex = new RegExp(pattern.source, pattern.flags);
        while ((match = regex.exec(content)) !== null) {
            const text = match[0];
            // Clean up the text
            const cleaned = text
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"')
                .substring(0, 2000);
            if (cleaned.length > 20 && !messages.includes(cleaned)) {
                messages.push(cleaned);
            }
        }
    }
    // Also try to find plain text segments that look like messages
    const textChunks = content.split(/[\x00-\x1f]+/).filter(chunk => {
        return chunk.length > 50 &&
            /[a-zA-Z]{5,}/.test(chunk) &&
            !/^[0-9a-f\-]+$/i.test(chunk); // Not a UUID
    });
    for (const chunk of textChunks.slice(0, 20)) {
        if (chunk.includes('```') ||
            chunk.includes('function') ||
            chunk.includes('const ') ||
            chunk.includes('Hello') ||
            chunk.includes('help') ||
            /^[A-Z][a-z]/.test(chunk)) {
            const cleaned = chunk.substring(0, 1000);
            if (!messages.some(m => m.includes(cleaned.substring(0, 50)))) {
                messages.push(cleaned);
            }
        }
    }
    return messages.slice(0, 50); // Limit to 50 messages
}
async function readJsonFileForChat(filePath) {
    try {
        const stats = fs.statSync(filePath);
        if (stats.size > 10 * 1024 * 1024 || stats.size < 10)
            return; // Skip very large or tiny files
        const content = fs.readFileSync(filePath, 'utf-8');
        // Check if it contains chat-related data
        if (content.includes('"role"') && (content.includes('"user"') || content.includes('"assistant"'))) {
            log(`Found chat JSON: ${filePath}`);
            try {
                const data = JSON.parse(content);
                const messages = extractMessagesFromJson(data);
                if (messages.length > 0) {
                    chatStorageContent.push({
                        path: filePath,
                        name: path.basename(filePath),
                        type: 'json',
                        size: stats.size,
                        modified: stats.mtime,
                        messages: messages,
                        content: messages.map(m => m.text).join('\n---\n').substring(0, 10000)
                    });
                }
            }
            catch (e) {
                // Not valid JSON, but might still have useful text
                chatStorageContent.push({
                    path: filePath,
                    name: path.basename(filePath),
                    type: 'json-raw',
                    size: stats.size,
                    modified: stats.mtime,
                    content: content.substring(0, 5000)
                });
            }
        }
    }
    catch (e) {
        // Ignore read errors
    }
}
function extractMessagesFromJson(data, prefix = '') {
    const messages = [];
    if (Array.isArray(data)) {
        for (const item of data) {
            messages.push(...extractMessagesFromJson(item, prefix));
        }
    }
    else if (data && typeof data === 'object') {
        // Check if this looks like a message object
        if (data.role && data.content) {
            messages.push({
                role: data.role,
                text: String(data.content).substring(0, 1000)
            });
        }
        if (data.text && typeof data.text === 'string' && data.text.length > 20) {
            messages.push({
                role: data.role || 'unknown',
                text: data.text.substring(0, 1000)
            });
        }
        if (data.message && typeof data.message === 'string' && data.message.length > 20) {
            messages.push({
                role: data.role || 'unknown',
                text: data.message.substring(0, 1000)
            });
        }
        if (data.prompt && typeof data.prompt === 'string') {
            messages.push({
                role: 'user',
                text: data.prompt.substring(0, 1000)
            });
        }
        if (data.response && typeof data.response === 'string') {
            messages.push({
                role: 'assistant',
                text: data.response.substring(0, 1000)
            });
        }
        // Recurse into nested objects
        for (const key of Object.keys(data)) {
            if (typeof data[key] === 'object') {
                messages.push(...extractMessagesFromJson(data[key], `${prefix}${key}.`));
            }
        }
    }
    return messages;
}
function watchChatStorageFiles(context) {
    log('Setting up file watchers for chat storage...');
    // Watch workspace storage
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            // Watch for any state.vscdb files (VS Code state database)
            const pattern = new vscode.RelativePattern(folder, '**/*.{json,vscdb,db}');
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            watcher.onDidChange((uri) => {
                if (uri.fsPath.toLowerCase().includes('chat') ||
                    uri.fsPath.toLowerCase().includes('copilot')) {
                    log(`Chat-related file changed: ${uri.fsPath}`);
                    readFileContent(uri.fsPath);
                }
            });
            fileWatchers.push(watcher);
            context.subscriptions.push(watcher);
        }
    }
    // Watch global storage paths
    const globalStoragePaths = [
        path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'github.copilot-chat'),
    ];
    for (const storagePath of globalStoragePaths) {
        if (fs.existsSync(storagePath)) {
            try {
                fs.watch(storagePath, { recursive: true }, (eventType, filename) => {
                    if (filename) {
                        log(`File change in copilot storage: ${eventType} - ${filename}`);
                        const fullPath = path.join(storagePath, filename);
                        readFileContent(fullPath);
                    }
                });
                log(`Watching: ${storagePath}`);
            }
            catch (e) {
                log(`Failed to watch ${storagePath}: ${e}`);
            }
        }
    }
}
function readFileContent(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            capturedMessages.push({
                type: 'file_change',
                timestamp: new Date().toISOString(),
                path: filePath,
                content: content.substring(0, 3000)
            });
            log(`Captured file content: ${filePath}`);
        }
    }
    catch (e) {
        // Ignore read errors
    }
}
// ==================== HISTORY DISPLAY ====================
// NEW: Efficiently get the latest reply from the most recent chat session
async function getLatestReply() {
    const workspaceStoragePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
    try {
        // Find all chatSessions folders and their most recent files
        const folders = fs.readdirSync(workspaceStoragePath, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => path.join(workspaceStoragePath, d.name, 'chatSessions'))
            .filter(p => fs.existsSync(p));
        // Find the most recently modified JSON file across all chatSessions folders
        let mostRecentFile = null;
        for (const folder of folders) {
            const files = fs.readdirSync(folder, { withFileTypes: true })
                .filter(f => f.isFile() && f.name.endsWith('.json'));
            for (const file of files) {
                const filePath = path.join(folder, file.name);
                const stats = fs.statSync(filePath);
                if (!mostRecentFile || stats.mtime.getTime() > mostRecentFile.mtime) {
                    mostRecentFile = { path: filePath, mtime: stats.mtime.getTime() };
                }
            }
        }
        if (!mostRecentFile) {
            return { success: false, error: 'No chat session files found' };
        }
        log(`Reading most recent session: ${mostRecentFile.path}`);
        const content = fs.readFileSync(mostRecentFile.path, 'utf-8');
        const data = JSON.parse(content);
        if (!data.requests || data.requests.length === 0) {
            return { success: false, error: 'No requests in session', sessionPath: mostRecentFile.path };
        }
        // Get the last request (most recent exchange)
        const lastRequest = data.requests[data.requests.length - 1];
        // Extract user message
        const userMessage = lastRequest.message?.text ||
            (lastRequest.message?.parts?.find((p) => p.kind === 'text')?.text) || '';
        // Extract assistant reply
        let assistantReply = '';
        if (lastRequest.response && Array.isArray(lastRequest.response)) {
            for (const item of lastRequest.response) {
                if (item.value && typeof item.value === 'string') {
                    assistantReply += item.value;
                }
            }
        }
        return {
            success: true,
            userMessage: userMessage.substring(0, 500),
            assistantReply: assistantReply.trim(),
            sessionPath: mostRecentFile.path
        };
    }
    catch (e) {
        log(`Error getting latest reply: ${e}`);
        return { success: false, error: String(e) };
    }
}
// NEW: Wait for a reply to a specific message with polling
async function waitForReplyToMessage(targetMessage, maxWaitSeconds = 60) {
    const workspaceStoragePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
    const startTime = Date.now();
    const targetLower = targetMessage.toLowerCase().trim();
    const pollIntervalMs = 2000; // Check every 2 seconds
    log(`Waiting for reply to message: "${targetMessage.substring(0, 50)}..."`);
    while ((Date.now() - startTime) < maxWaitSeconds * 1000) {
        try {
            // Find all chatSessions folders
            const folders = fs.readdirSync(workspaceStoragePath, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => path.join(workspaceStoragePath, d.name, 'chatSessions'))
                .filter(p => fs.existsSync(p));
            // Check recent files (modified in last 5 minutes)
            const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
            for (const folder of folders) {
                const files = fs.readdirSync(folder, { withFileTypes: true })
                    .filter(f => f.isFile() && f.name.endsWith('.json'));
                for (const file of files) {
                    const filePath = path.join(folder, file.name);
                    const stats = fs.statSync(filePath);
                    if (stats.mtime.getTime() < fiveMinutesAgo)
                        continue;
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const data = JSON.parse(content);
                    if (!data.requests || data.requests.length === 0)
                        continue;
                    // Search from most recent to oldest
                    for (let i = data.requests.length - 1; i >= 0; i--) {
                        const request = data.requests[i];
                        const msgText = request.message?.text ||
                            (request.message?.parts?.find((p) => p.kind === 'text')?.text) || '';
                        // Check if this message matches our target
                        if (msgText.toLowerCase().includes(targetLower) ||
                            targetLower.includes(msgText.toLowerCase().substring(0, 50))) {
                            // Found the message, now check if there's a reply
                            let assistantReply = '';
                            if (request.response && Array.isArray(request.response)) {
                                for (const item of request.response) {
                                    if (item.value && typeof item.value === 'string') {
                                        assistantReply += item.value;
                                    }
                                }
                            }
                            if (assistantReply.trim().length > 0) {
                                const waitedSeconds = Math.round((Date.now() - startTime) / 1000);
                                log(`Found reply after ${waitedSeconds}s`);
                                return {
                                    success: true,
                                    userMessage: msgText.substring(0, 500),
                                    assistantReply: assistantReply.trim(),
                                    waitedSeconds
                                };
                            }
                        }
                    }
                }
            }
        }
        catch (e) {
            log(`Error during polling: ${e}`);
        }
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    return {
        success: false,
        error: `Timeout after ${maxWaitSeconds}s - no reply found for message`,
        waitedSeconds: maxWaitSeconds
    };
}
function showHistory() {
    const channel = vscode.window.createOutputChannel('Chat Capture Results');
    channel.clear();
    channel.appendLine('╔══════════════════════════════════════════════════════════════╗');
    channel.appendLine('║              REMOTE CHAT CONTROL - CAPTURED DATA             ║');
    channel.appendLine('╚══════════════════════════════════════════════════════════════╝\n');
    // Get current workspace info
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        channel.appendLine('=== CURRENT WORKSPACE ===\n');
        workspaceFolders.forEach(folder => {
            channel.appendLine(`Name: ${folder.name}`);
            channel.appendLine(`Path: ${folder.uri.fsPath}\n`);
        });
    }
    channel.appendLine('=== SENT MESSAGES ===\n');
    if (chatHistory.length === 0) {
        channel.appendLine('No messages sent yet.\n');
    }
    else {
        chatHistory.forEach((msg, i) => {
            channel.appendLine(`[${i + 1}] ${msg.role}: ${msg.content}`);
            channel.appendLine(`    Time: ${msg.timestamp}\n`);
        });
    }
    channel.appendLine('=== CAPTURED DATA ===\n');
    channel.appendLine(`Total captured items: ${capturedMessages.length}\n`);
    const byType = {};
    capturedMessages.forEach(msg => {
        const type = msg.type || 'unknown';
        if (!byType[type])
            byType[type] = [];
        byType[type].push(msg);
    });
    for (const [type, messages] of Object.entries(byType)) {
        channel.appendLine(`\n--- ${type.toUpperCase()} (${messages.length} items) ---\n`);
        messages.slice(-5).forEach((msg, i) => {
            channel.appendLine(`[${i + 1}] ${msg.timestamp}`);
            if (msg.content)
                channel.appendLine(`Content: ${msg.content.substring(0, 500)}`);
            if (msg.url)
                channel.appendLine(`URL: ${msg.url}`);
            if (msg.response)
                channel.appendLine(`Response: ${msg.response.substring(0, 500)}`);
            if (msg.path)
                channel.appendLine(`Path: ${msg.path}`);
            channel.appendLine('');
        });
    }
    channel.appendLine('\n=== CHAT SESSIONS FROM STORAGE ===\n');
    // Get all chat sessions and sort by modification time (most recent first)
    const chatSessions = chatStorageContent
        .filter(f => f.type === 'chat-session')
        .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    if (chatSessions.length === 0) {
        channel.appendLine('No chat sessions found.\n');
        channel.appendLine('Try:\n');
        channel.appendLine('1. Have a conversation in the chat panel first\n');
        channel.appendLine('2. Click "Scan Storage" in the web UI\n');
        channel.appendLine('3. Check if chat data exists in:\n');
        channel.appendLine('   %AppData%\\Roaming\\Code\\User\\workspaceStorage\\*\\chatSessions\\\n');
    }
    else {
        channel.appendLine(`Found ${chatSessions.length} chat sessions (showing most recent first):\n`);
        channel.appendLine('═'.repeat(80) + '\n');
        chatSessions.forEach((session, i) => {
            const modDate = new Date(session.modified);
            const isRecent = (Date.now() - modDate.getTime()) < 24 * 60 * 60 * 1000; // Last 24h
            const marker = isRecent ? '🔥 RECENT' : '📅';
            channel.appendLine(`${marker} SESSION ${i + 1} - ${session.name}`);
            channel.appendLine(`Workspace: ${session.workspaceHash}`);
            channel.appendLine(`Modified: ${modDate.toLocaleString()}`);
            channel.appendLine(`Total Messages: ${session.messageCount || 0}`);
            channel.appendLine(`User Messages: ${session.userMessageCount || 0}`);
            channel.appendLine(`Path: ${session.path}`);
            channel.appendLine('');
            if (session.userMessages && session.userMessages.length > 0) {
                channel.appendLine('  ┌─ USER MESSAGES ONLY ─┐\n');
                session.userMessages.forEach((msg, mi) => {
                    const text = typeof msg === 'string' ? msg : msg.text;
                    channel.appendLine(`  [${mi + 1}/${session.userMessages.length}] ${text}`);
                    channel.appendLine('');
                });
                channel.appendLine('  └─────────────────────────┘\n');
            }
            else {
                channel.appendLine('  (No user messages found)\n');
                // Show raw data for debugging
                if (session.rawData) {
                    channel.appendLine('  RAW DATA PREVIEW:\n');
                    channel.appendLine(`  ${session.rawData.substring(0, 500)}...\n`);
                }
            }
            // Show ALL messages (not just user)
            if (session.messages && session.messages.length > 0) {
                channel.appendLine('  ┌─ ALL MESSAGES (USER + ASSISTANT) ─┐\n');
                session.messages.forEach((msg, mi) => {
                    const role = msg.role || 'unknown';
                    const text = msg.text || msg;
                    channel.appendLine(`  [${mi + 1}] [${role.toUpperCase()}]: ${text.substring(0, 500)}`);
                    channel.appendLine('');
                });
                channel.appendLine('  └─────────────────────────────────────┘\n');
            }
            channel.appendLine('─'.repeat(80) + '\n');
        });
    }
    channel.appendLine('\n=== OTHER STORAGE FILES ===\n');
    const otherFiles = chatStorageContent.filter(f => f.type !== 'chat-session');
    channel.appendLine(`Found ${otherFiles.length} other files with chat data\n`);
    otherFiles.slice(0, 10).forEach((file, i) => {
        channel.appendLine(`[${i + 1}] ${file.path}`);
        channel.appendLine(`    Type: ${file.type}, Size: ${file.size} bytes`);
        if (file.messages && file.messages.length > 0) {
            channel.appendLine(`    Messages found: ${file.messages.length}`);
        }
        channel.appendLine('');
    });
    channel.show();
}
// ==================== HTTP SERVER ====================
function startServer() {
    if (server) {
        log('Server already running');
        return;
    }
    const PORT = 3847;
    log(`Starting HTTP server on port ${PORT}...`);
    server = http.createServer((req, res) => {
        const url = req.url || '/';
        log(`${req.method} ${url}`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        if (url === '/' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(getHTML());
            return;
        }
        if (url === '/api/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                sent: chatHistory.length,
                captured: capturedMessages.length,
                storageFiles: chatStorageContent.length
            }));
            return;
        }
        if (url === '/api/send' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    sendToChat(data.message || 'Hi', data.model, data.sessionMode, data.sessionId).then(({ result, note }) => {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, result, model: data.model, note }));
                    });
                }
                catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: String(e) }));
                }
            });
            return;
        }
        if (url === '/api/captured') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                messages: capturedMessages,
                storage: chatStorageContent,
                history: chatHistory
            }));
            return;
        }
        if (url === '/api/recent-raw') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            // Find all JSON files modified in last 5 minutes
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            const recentFiles = chatStorageContent.filter(f => {
                const modTime = new Date(f.modified).getTime();
                return modTime > fiveMinutesAgo;
            }).map(f => {
                try {
                    const content = fs.readFileSync(f.path, 'utf-8');
                    return {
                        path: f.path,
                        name: f.name,
                        modified: f.modified,
                        rawContent: content
                    };
                }
                catch (e) {
                    return {
                        path: f.path,
                        name: f.name,
                        modified: f.modified,
                        error: String(e)
                    };
                }
            });
            res.end(JSON.stringify({ files: recentFiles }));
            return;
        }
        if (url === '/api/scan') {
            scanChatStorage().then(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    filesFound: chatStorageContent.length
                }));
            });
            return;
        }
        // NEW: Get the latest assistant reply efficiently
        if (url === '/api/latest-reply') {
            getLatestReply().then(result => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            }).catch(err => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(err) }));
            });
            return;
        }
        // NEW: Wait for a reply after sending a message
        if (url === '/api/wait-for-reply' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const userMessage = data.message || '';
                    const maxWaitSeconds = data.maxWait || 60;
                    log(`Waiting for reply to: "${userMessage.substring(0, 50)}..."`);
                    const result = await waitForReplyToMessage(userMessage, maxWaitSeconds);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                }
                catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: String(e) }));
                }
            });
            return;
        }
        // ==================== INBOX API ENDPOINTS ====================
        // Get current workspace info
        if (url === '/api/inbox/current-workspace') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                workspaceHash: currentWorkspaceHash,
                storagePath: extensionStoragePath
            }));
            return;
        }
        // Get inbox for CURRENT workspace only (no selection needed)
        if (url === '/api/inbox/messages') {
            if (!currentWorkspaceHash) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Workspace not detected. Extension may not have started properly.' }));
                return;
            }
            const inboxData = inbox.getInboxForWorkspace(currentWorkspaceHash);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(inboxData));
            return;
        }
        // Get latest reply for current workspace
        if (url === '/api/inbox/latest-reply') {
            let workspaceHash = currentWorkspaceHash || inbox.getCurrentWorkspaceHash();
            if (!workspaceHash) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No workspace selected' }));
                return;
            }
            const result = inbox.getLatestReplyForWorkspace(workspaceHash);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }
        // Send message and wait for reply
        if (url === '/api/inbox/send-and-wait' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const message = data.message || '';
                    const maxWait = data.maxWait || 60000;
                    // Record timestamp before sending
                    const beforeSend = Date.now();
                    // Send the message with session options
                    await sendToChat(message, data.model, data.sessionMode, data.sessionId);
                    log(`Sent message: "${message.substring(0, 50)}..."`);
                    // Get or detect workspace
                    let workspaceHash = currentWorkspaceHash || inbox.getCurrentWorkspaceHash();
                    if (!workspaceHash) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'No workspace detected' }));
                        return;
                    }
                    // Wait for reply
                    const result = await inbox.waitForNewReply(workspaceHash, beforeSend, maxWait);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                }
                catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: String(e) }));
                }
            });
            return;
        }
        // ==================== END INBOX API ====================
        // Read file content
        if (url === '/api/file/read' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    let filename = data.filename || '';
                    if (!filename) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'No filename provided' }));
                        return;
                    }
                    log(`Raw filename received: ${filename}`);
                    // Normalize the path - handle c:/... format (forward slashes)
                    // Convert forward slashes to backslashes on Windows
                    filename = filename.split('/').join('\\\\');
                    log(`Attempting to read file: ${filename}`);
                    // Try to find and read the file
                    let fileUri = null;
                    // Try as full path first (has drive letter like c:\)
                    if (filename.match(/^[a-zA-Z]:\\\\/)) {
                        try {
                            fileUri = vscode.Uri.file(filename);
                        }
                        catch (e) {
                            log(`Not a valid path: ${e}`);
                        }
                    }
                    // Try relative to workspace if not found
                    if (!fileUri && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
                        fileUri = vscode.Uri.joinPath(workspaceRoot, filename);
                    }
                    if (!fileUri) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Could not locate file: ' + filename }));
                        return;
                    }
                    try {
                        const fileData = await vscode.workspace.fs.readFile(fileUri);
                        const content = Buffer.from(fileData).toString('utf-8');
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            content: content,
                            path: fileUri.fsPath
                        }));
                        log(`Read file: ${fileUri.fsPath}`);
                    }
                    catch (e) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'File not found or could not read: ' + filename }));
                    }
                }
                catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: String(e) }));
                }
            });
            return;
        }
        if (url === '/api/terminal' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const term = vscode.window.createTerminal('Remote');
                    term.show();
                    term.sendText(data.command);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                }
                catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: String(e) }));
                }
            });
            return;
        }
        // List available commands (useful for debugging)
        if (url === '/api/commands' && req.method === 'GET') {
            (async () => {
                try {
                    const allCommands = await vscode.commands.getCommands(true);
                    // Filter for chat/copilot/terminal related commands
                    const relevantCommands = allCommands.filter(cmd => cmd.includes('chat') ||
                        cmd.includes('copilot') ||
                        cmd.includes('terminal') ||
                        cmd.includes('accept') ||
                        cmd.includes('confirm') ||
                        cmd.includes('run')).sort();
                    log(`Found ${relevantCommands.length} relevant commands`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, commands: relevantCommands }));
                }
                catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: String(e) }));
                }
            })();
            return;
        }
        // Handle command approve/skip action
        if (url === '/api/command-action' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const action = data.action; // 'approve' or 'skip'
                    log(`Command action: ${action}`);
                    const { exec } = require('child_process');
                    log('Step 1: Activating VS Code window...');
                    // First activate VS Code window using PowerShell (synchronously wait)
                    const activateScript = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('Visual Studio Code'); Start-Sleep -Milliseconds 500`;
                    exec(`powershell -Command "${activateScript}"`, async (activateError) => {
                        if (activateError) {
                            log(`Window activation failed: ${activateError.message}`);
                        }
                        else {
                            log('VS Code window activated');
                        }
                        log('Step 2: Focusing chat input...');
                        // Use same approach as sendToChat - focus the chat input
                        try {
                            await vscode.commands.executeCommand('workbench.action.chat.focusInput');
                        }
                        catch {
                            await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                        }
                        await new Promise(r => setTimeout(r, 300));
                        log('Step 3: Typing space into chat input...');
                        // Type space into chat input (same as how messages are typed)
                        await vscode.commands.executeCommand('type', { text: ' ' });
                        await new Promise(r => setTimeout(r, 200));
                        log('Space typed, starting PowerShell for key combo...');
                        // Now send the keyboard shortcut after delay
                        if (action === 'approve') {
                            const psScript = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 1500; [System.Windows.Forms.SendKeys]::SendWait('^{ENTER}')`;
                            exec(`powershell -Command "${psScript}"`, (err) => {
                                if (err) {
                                    log(`Ctrl+Enter error: ${err.message}`);
                                }
                                else {
                                    log('Ctrl+Enter sent');
                                }
                            });
                        }
                        else if (action === 'skip') {
                            const psScript = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 1500; [System.Windows.Forms.SendKeys]::SendWait('^%{ENTER}')`;
                            exec(`powershell -Command "${psScript}"`, (err) => {
                                if (err) {
                                    log(`Ctrl+Alt+Enter error: ${err.message}`);
                                }
                                else {
                                    log('Ctrl+Alt+Enter sent');
                                }
                            });
                        }
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, action }));
                }
                catch (e) {
                    log(`Command action error: ${e}`);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: String(e) }));
                }
            });
            return;
        }
        res.writeHead(404);
        res.end('Not found');
    });
    server.on('error', (err) => {
        log(`Server error: ${err.message}`);
        server = null;
    });
    server.listen(PORT, () => {
        log(`Server running at http://localhost:${PORT}`);
        vscode.window.showInformationMessage(`Server started at http://localhost:${PORT}`, 'Open Browser').then(choice => {
            if (choice === 'Open Browser') {
                vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${PORT}`));
            }
        });
    });
}
function getHTML() {
    return `<!DOCTYPE html>
<html>
<head>
    <title>VS Code Remote Chat Control</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui; background: #0d1117; color: #c9d1d9; padding: 20px; margin: 0; }
        .container { max-width: 1100px; margin: 0 auto; }
        h1 { color: #58a6ff; text-align: center; margin-bottom: 10px; }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; justify-content: center; }
        .tab { padding: 10px 20px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; }
        .tab.active { background: #238636; border-color: #238636; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .card { background: #161b22; padding: 20px; border-radius: 10px; border: 1px solid #30363d; }
        .card.full { grid-column: 1 / -1; }
        .card h2 { margin-top: 0; color: #58a6ff; font-size: 16px; border-bottom: 1px solid #30363d; padding-bottom: 10px; }
        button { background: #238636; color: white; border: none; padding: 10px 20px; 
                 border-radius: 6px; cursor: pointer; margin: 5px; font-size: 14px; }
        button:hover { background: #2ea043; }
        button.blue { background: #1f6feb; }
        button.blue:hover { background: #388bfd; }
        button.orange { background: #d29922; }
        button.orange:hover { background: #e3b341; }
        button.purple { background: #8b5cf6; }
        button.pink { background: #ec4899; }
        input, select { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #30363d;
                background: #0d1117; color: #c9d1d9; margin-bottom: 10px; font-size: 14px; }
        select { cursor: pointer; }
        .status-box { padding: 10px; border-radius: 6px; margin: 10px 0; font-size: 13px; }
        .ok { background: rgba(35,134,54,0.2); border: 1px solid #238636; }
        .err { background: rgba(248,81,73,0.2); border: 1px solid #f85149; }
        .output-box { background: #010409; padding: 15px; border-radius: 6px; 
               height: 300px; overflow-y: auto; font-family: monospace; font-size: 12px; 
               border: 1px solid #30363d; white-space: pre-wrap; }
        .small-output { height: 150px; }
        .stat { display: inline-block; background: #21262d; padding: 5px 10px; 
                border-radius: 20px; margin: 5px; font-size: 12px; }
        .stat b { color: #58a6ff; }
        .session-item { padding: 10px; margin: 5px 0; background: #21262d; border-radius: 6px; cursor: pointer; }
        .session-item:hover { background: #30363d; }
        .session-item.selected { border: 2px solid #58a6ff; }
        .session-title { font-weight: bold; color: #58a6ff; }
        .session-meta { font-size: 11px; color: #8b949e; margin-top: 4px; }
        .message { padding: 10px; margin: 5px 0; border-radius: 6px; }
        .message.user { background: #1f6feb33; border-left: 3px solid #1f6feb; }
        .message.assistant { background: #23863633; border-left: 3px solid #238636; }
        .message-role { font-weight: bold; font-size: 11px; text-transform: uppercase; margin-bottom: 5px; }
        .message-model { font-size: 10px; color: #8b949e; margin-left: 10px; font-weight: normal; }
        .thinking-box { background: #30363d; border-radius: 6px; margin-bottom: 8px; overflow: hidden; }
        .thinking-header { padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
        .thinking-header:hover { background: #3d444d; }
        .thinking-arrow { transition: transform 0.2s; font-size: 10px; }
        .thinking-arrow.expanded { transform: rotate(90deg); }
        .thinking-title { font-size: 12px; color: #f0883e; font-style: italic; }
        .thinking-content { padding: 10px 12px; border-top: 1px solid #21262d; font-size: 12px; color: #8b949e; white-space: pre-wrap; display: none; }
        .thinking-content.show { display: block; }
        .pending-command-box { background: #3d2a1a; border: 1px solid #f0883e; border-radius: 6px; padding: 12px; margin-top: 10px; }
        .pending-command-header { color: #f0883e; font-weight: bold; margin-bottom: 8px; font-size: 13px; }
        .pending-command-code { background: #161b22; padding: 10px; border-radius: 4px; font-family: monospace; color: #79c0ff; margin-bottom: 10px; white-space: pre-wrap; word-break: break-all; }
        .pending-command-actions { display: flex; gap: 10px; }
        .btn-approve { background: #238636; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
        .btn-approve:hover { background: #2ea043; }
        .btn-skip { background: #6e7681; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
        .btn-skip:hover { background: #8b949e; }
        .workspace-info { background: #21262d; padding: 10px 15px; border-radius: 6px; margin-bottom: 15px; font-size: 13px; }
        .send-box { background: #21262d; padding: 15px; border-radius: 6px; margin-top: 15px; }
        .model-select { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 12px; border-radius: 6px; margin-bottom: 10px; width: 100%; font-size: 13px; }
        .model-label { font-size: 12px; color: #8b949e; margin-bottom: 5px; display: block; }
        .file-link { color: #58a6ff; text-decoration: none; cursor: pointer; font-weight: bold; border-bottom: 1px dashed #58a6ff; }
        .file-link:hover { color: #79c0ff; border-bottom-color: #79c0ff; }
        .modal { display: none; position: fixed; z-index: 9999; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); }
        .modal.show { display: flex; align-items: center; justify-content: center; }
        .modal-content { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; max-width: 800px; width: 90%; max-height: 80vh; overflow: auto; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #30363d; padding-bottom: 10px; }
        .modal-title { font-size: 16px; font-weight: bold; color: #58a6ff; }
        .modal-close { background: #da3633; color: white; border: none; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 18px; }
        .modal-close:hover { background: #f85149; }
        .modal-body { color: #c9d1d9; }
        .file-content { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 15px; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; white-space: pre-wrap; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎮 VS Code Remote Chat Control</h1>
        
        <div class="tabs">
            <div class="tab active" onclick="showTab('inbox')">📬 Inbox</div>
            <div class="tab" onclick="showTab('tools')">🔧 Tools</div>
        </div>
        
        <!-- INBOX TAB -->
        <div id="tab-inbox" class="tab-content active">
            <div class="workspace-info">
                📁 <b>Workspace:</b> <span id="workspaceInfo">Loading...</span>
                <button class="blue" style="float:right;margin:0;padding:5px 10px;" onclick="loadInbox()">🔄 Refresh</button>
            </div>
            
            <div class="grid">
                <div class="card">
                    <h2>📋 Sessions (<span id="statSessions">0</span>)</h2>
                    <div id="sessionsList" class="output-box" style="height:250px;">Loading sessions...</div>
                </div>
                <div class="card">
                    <h2>💬 Send Message</h2>
                    <label class="model-label">📍 Send To:</label>
                    <select id="sessionSelect" class="model-select">
                        <option value="new">🆕 New Chat Session</option>
                        <option value="current">📌 Current/Last Active Session</option>
                    </select>
                    <label class="model-label">🧠 Model:</label>
                    <select id="modelSelect" class="model-select">
                        <option value="">Use session default</option>
                        <option value="copilot/gpt-4o">GPT-4o</option>
                        <option value="copilot/claude-sonnet-4">Claude Sonnet 4</option>
                        <option value="copilot/claude-sonnet-4.5">Claude Sonnet 4.5</option>
                        <option value="copilot/claude-opus-4.5">Claude Opus 4.5 (3x)</option>
                        <option value="copilot/o1">o1 (10x)</option>
                        <option value="copilot/o3-mini">o3-mini (10x)</option>
                        <option value="copilot/gemini-2.0-flash">Gemini 2.0 Flash</option>
                    </select>
                    <input type="text" id="inboxMsg" placeholder="Type message to send...">
                    <button class="pink" onclick="sendFromInbox()">📤 Send Message</button>
                    <button class="purple" onclick="sendAndWaitInbox()">🚀 Send &amp; Get Reply</button>
                    <div id="inboxSendResult" style="margin-top:10px; font-size:12px; color:#8b949e;"></div>
                </div>
                <div class="card full">
                    <h2>💬 Messages in Selected Session</h2>
                    <div id="messagesList" class="output-box">Select a session to see messages</div>
                </div>
                <div class="card full">
                    <h2>🤖 Latest Reply</h2>
                    <button class="purple" onclick="getInboxLatestReply()" style="margin-bottom:10px;">🚀 Get Latest Reply</button>
                    <div id="inboxReply" class="output-box small-output">Click "Get Latest Reply" to fetch the most recent exchange</div>
                </div>
            </div>
        </div>
        
        <!-- TOOLS TAB -->
        <div id="tab-tools" class="tab-content">
            <div class="grid">
                <div class="card">
                    <h2>📡 Status</h2>
                    <div id="status" class="status-box">Checking...</div>
                    <div id="stats"></div>
                </div>
                <div class="card">
                    <h2>💻 Terminal</h2>
                    <input type="text" id="cmd" placeholder="Terminal command...">
                    <button class="orange" onclick="runCmd()">Run Command</button>
                </div>
                <div class="card full">
                    <h2>🔍 Actions</h2>
                    <button class="blue" onclick="scanStorage()">Scan Storage</button>
                    <button class="blue" onclick="loadInbox()">Refresh Inbox</button>
                    <button onclick="clearLog()">Clear Log</button>
                </div>
                <div class="card full">
                    <h2>📋 Activity Log</h2>
                    <div id="log" class="output-box small-output"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- FILE VIEWER MODAL -->
    <div id="fileModal" class="modal" onclick="if(event.target.id==='fileModal') closeFileModal()">
        <div class="modal-content">
            <div class="modal-header">
                <span class="modal-title" id="modalFileName">📄 File</span>
                <button class="modal-close" onclick="closeFileModal()">×</button>
            </div>
            <div class="modal-body">
                <div id="modalFileContent" class="file-content">Loading...</div>
            </div>
        </div>
    </div>

    <script>
        const API = 'http://localhost:3847';
        let currentInbox = null;
        let selectedSessionIndex = -1;
        
        function showTab(tabName) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelector('.tab[onclick*="' + tabName + '"]').classList.add('active');
            document.getElementById('tab-' + tabName).classList.add('active');
        }
        
        function addLog(msg) {
            const log = document.getElementById('log');
            log.innerHTML += new Date().toLocaleTimeString() + ': ' + msg + '\\n';
            log.scrollTop = log.scrollHeight;
        }

        function clearLog() {
            document.getElementById('log').innerHTML = '';
        }

        async function checkStatus() {
            try {
                const r = await fetch(API + '/api/status');
                const d = await r.json();
                document.getElementById('status').className = 'status-box ok';
                document.getElementById('status').innerHTML = '✅ Connected';
                document.getElementById('stats').innerHTML = 
                    '<span class="stat">Sent: <b>' + d.sent + '</b></span>' +
                    '<span class="stat">Captured: <b>' + d.captured + '</b></span>';
            } catch(e) {
                document.getElementById('status').className = 'status-box err';
                document.getElementById('status').innerHTML = '❌ Not connected';
            }
        }

        // ==================== INBOX FUNCTIONS ====================
        
        async function loadInbox() {
            try {
                document.getElementById('workspaceInfo').innerHTML = '⏳ Loading...';
                
                // First get workspace info
                const wsRes = await fetch(API + '/api/inbox/current-workspace');
                const wsData = await wsRes.json();
                
                if (!wsData.workspaceHash) {
                    document.getElementById('workspaceInfo').innerHTML = '❌ Workspace not detected';
                    return;
                }
                
                document.getElementById('workspaceInfo').innerHTML = wsData.workspaceHash.substring(0, 20) + '...';
                
                // Load inbox for current workspace
                const r = await fetch(API + '/api/inbox/messages');
                currentInbox = await r.json();
                
                if (currentInbox.error) {
                    document.getElementById('sessionsList').innerHTML = '❌ ' + currentInbox.error;
                    return;
                }
                
                // Update stats
                document.getElementById('statSessions').textContent = currentInbox.sessions.length;
                
                // Show sessions list
                const sessionsList = document.getElementById('sessionsList');
                const sessionSelect = document.getElementById('sessionSelect');
                
                // Clear existing session options (keep first two: new and current)
                while (sessionSelect.options.length > 2) {
                    sessionSelect.remove(2);
                }
                
                if (currentInbox.sessions.length === 0) {
                    sessionsList.innerHTML = 'No sessions found in this workspace.\\n\\nTry having a chat conversation first!';
                } else {
                    sessionsList.innerHTML = '';
                    currentInbox.sessions.forEach((s, i) => {
                        const date = new Date(s.lastMessageAt).toLocaleString();
                        const title = s.title || 'Untitled Session';
                        sessionsList.innerHTML += '<div class="session-item" onclick="selectSession(' + i + ')" id="session-' + i + '">' +
                            '<div class="session-title">📝 ' + escapeHtml(title) + '</div>' +
                            '<div class="session-meta">' + s.messageCount + ' messages • ' + date + '</div></div>';
                        
                        // Add to session dropdown
                        const opt = document.createElement('option');
                        opt.value = 'session-' + i;
                        opt.textContent = '📝 ' + title;
                        sessionSelect.appendChild(opt);
                    });
                }
                
                // Auto-select first session
                if (currentInbox.sessions.length > 0) {
                    selectSession(0);
                }
                
                addLog('Loaded inbox: ' + currentInbox.sessions.length + ' sessions');
                addLog('Loaded inbox: ' + currentInbox.sessions.length + ' sessions, ' + currentInbox.totalMessages + ' messages');
            } catch (e) {
                document.getElementById('workspaceInfo').innerHTML = '❌ Error';
                addLog('Error loading inbox: ' + e.message);
            }
        }
        
        function selectSession(index) {
            selectedSessionIndex = index;
            
            // Highlight selected
            document.querySelectorAll('.session-item').forEach(s => s.classList.remove('selected'));
            document.getElementById('session-' + index)?.classList.add('selected');
            
            // Update session dropdown to match
            const sessionSelect = document.getElementById('sessionSelect');
            sessionSelect.value = 'session-' + index;
            
            // Show messages
            const session = currentInbox.sessions[index];
            const messagesList = document.getElementById('messagesList');
            
            if (!session || session.messages.length === 0) {
                messagesList.innerHTML = 'No messages in this session';
                return;
            }
            
            // Update model selector to match session's last model
            if (session.lastModel) {
                const modelSelect = document.getElementById('modelSelect');
                const option = Array.from(modelSelect.options).find(o => o.value === session.lastModel);
                if (option) {
                    modelSelect.value = session.lastModel;
                }
            }
            
            let html = '<div style="margin-bottom:10px;color:#8b949e;">Session: <b>' + escapeHtml(session.title || 'Untitled') + '</b>';
            if (session.lastModel) {
                html += ' • Model: <span style="color:#58a6ff;">' + escapeHtml(session.lastModel.replace('copilot/', '')) + '</span>';
            }
            html += '</div>';
            
            session.messages.forEach((m, i) => {
                const roleClass = m.role === 'user' ? 'user' : 'assistant';
                const roleIcon = m.role === 'user' ? '👤' : '🤖';
                
                html += '<div class="message ' + roleClass + '">';
                html += '<div class="message-role">' + roleIcon + ' ' + m.role;
                if (m.model) {
                    html += '<span class="message-model">(' + escapeHtml(m.model.replace('copilot/', '')) + ')</span>';
                }
                html += '</div>';
                
                // Show thinking if present (collapsed by default)
                if (m.thinking && m.thinking.content) {
                    const thinkingId = 'thinking-' + index + '-' + i;
                    html += '<div class="thinking-box">';
                    html += '<div class="thinking-header" onclick="toggleThinking(\\'' + thinkingId + '\\')">';
                    html += '<span class="thinking-arrow" id="arrow-' + thinkingId + '">▶</span>';
                    html += '<span class="thinking-title">💭 ' + escapeHtml(m.thinking.title) + '</span>';
                    html += '</div>';
                    html += '<div class="thinking-content" id="' + thinkingId + '">' + escapeHtml(m.thinking.content) + '</div>';
                    html += '</div>';
                }
                
                // Only linkify files in assistant messages
                const msgText = escapeHtml(m.text);
                html += '<div>' + (m.role === 'assistant' ? linkifyFiles(msgText) : msgText) + '</div>';
                
                // Show pending command if present
                if (m.pendingCommand && m.pendingCommand.command) {
                    html += '<div class="pending-command-box">';
                    html += '<div class="pending-command-header">⏳ Command awaiting approval:</div>';
                    html += '<div class="pending-command-code">' + escapeHtml(m.pendingCommand.command) + '</div>';
                    html += '<div class="pending-command-actions">';
                    html += '<button class="btn-approve" onclick="approveCommand(\\'approve\\')">✅ Approve (Ctrl+Enter)</button>';
                    html += '<button class="btn-skip" onclick="approveCommand(\\'skip\\')">⏭️ Skip (Ctrl+Alt+Enter)</button>';
                    html += '</div>';
                    html += '</div>';
                }
                
                html += '</div>';
            });
            
            messagesList.innerHTML = html;
        }
        
        function toggleThinking(id) {
            const content = document.getElementById(id);
            const arrow = document.getElementById('arrow-' + id);
            if (content.classList.contains('show')) {
                content.classList.remove('show');
                arrow.classList.remove('expanded');
            } else {
                content.classList.add('show');
                arrow.classList.add('expanded');
            }
        }
        
        function linkifyFiles(text) {
            // Detect file patterns from our custom format [[FILE|fullpath|filename]]
            // Uses | as delimiter to avoid conflicts with : in paths like c:/
            text = text.replace(/\\[\\[FILE\\|([^|]+)\\|([^\\]]+)\\]\\]/g, 
                (match, fullPath, fileName) => {
                    // Encode the path for use in onclick - base64 to avoid any escaping issues
                    const encodedPath = btoa(fullPath);
                    return '<a class="file-link" onclick="openFileEncoded(\\'' + encodedPath + '\\')">📄 ' + fileName + '</a>';
                }
            );
            
            return text;
        }
        
        async function openFileEncoded(encodedPath) {
            const filename = atob(encodedPath);
            openFile(filename);
        }
        
        async function openFile(filename) {
            const modal = document.getElementById('fileModal');
            const titleEl = document.getElementById('modalFileName');
            const contentEl = document.getElementById('modalFileContent');
            
            titleEl.textContent = '📄 ' + filename;
            contentEl.textContent = 'Loading file...';
            modal.classList.add('show');
            
            try {
                const r = await fetch(API + '/api/file/read', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ filename: filename })
                });
                const d = await r.json();
                
                if (d.success) {
                    contentEl.textContent = d.content || '(empty file)';
                } else {
                    contentEl.textContent = '❌ Error: ' + (d.error || 'Could not read file');
                }
            } catch (e) {
                contentEl.textContent = '❌ Error: ' + e.message;
            }
        }
        
        function closeFileModal() {
            document.getElementById('fileModal').classList.remove('show');
        }
        
        async function getInboxLatestReply() {
            const replyDiv = document.getElementById('inboxReply');
            replyDiv.innerHTML = '⏳ Fetching latest reply...';
            
            try {
                const r = await fetch(API + '/api/inbox/latest-reply');
                const d = await r.json();
                
                if (d.success) {
                    replyDiv.innerHTML = 
                        '✅ <b>Latest Exchange</b>\\n\\n' +
                        '👤 <b>USER:</b> ' + escapeHtml(d.userMessage || '(empty)') + '\\n\\n' +
                        '🤖 <b>ASSISTANT:</b> ' + escapeHtml(d.assistantReply || '(no reply)');
                    // Refresh inbox to show new messages
                    loadInbox();
                } else {
                    replyDiv.innerHTML = '❌ ' + (d.error || 'No reply found');
                }
            } catch (e) {
                replyDiv.innerHTML = '❌ Error: ' + e.message;
            }
        }

        // ==================== SEND FUNCTIONS ====================
        
        function getSelectedSessionInfo() {
            const sessionSelect = document.getElementById('sessionSelect');
            const value = sessionSelect.value;
            
            if (value === 'new') {
                return { mode: 'new', title: 'New Chat Session', sessionId: null };
            } else if (value === 'current') {
                return { mode: 'current', title: 'Current/Last Active', sessionId: null };
            } else if (value.startsWith('session-')) {
                const idx = parseInt(value.replace('session-', ''));
                const session = currentInbox?.sessions?.[idx];
                if (session) {
                    return { 
                        mode: 'session', 
                        title: session.title || 'Untitled', 
                        sessionId: session.sessionId
                    };
                }
            }
            return { mode: 'current', title: 'Current', sessionId: null };
        }
        
        async function sendFromInbox() {
            const msg = document.getElementById('inboxMsg').value;
            const model = document.getElementById('modelSelect').value;
            const sessionInfo = getSelectedSessionInfo();
            const resultDiv = document.getElementById('inboxSendResult');
            if (!msg) { resultDiv.innerHTML = '⚠️ Please enter a message'; return; }
            
            resultDiv.innerHTML = '⏳ Sending to: ' + escapeHtml(sessionInfo.title) + '...';
            addLog('Sending to ' + sessionInfo.title + ': ' + msg + (model ? ' [model: ' + model + ']' : ''));
            
            try {
                const body = {message: msg, sessionMode: sessionInfo.mode};
                if (model) body.model = model;
                if (sessionInfo.sessionId) body.sessionId = sessionInfo.sessionId;
                
                const r = await fetch(API + '/api/send', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body)
                });
                const d = await r.json();
                resultDiv.innerHTML = '✅ Message sent to: ' + escapeHtml(sessionInfo.title) + (d.note ? ' (' + d.note + ')' : '');
                addLog('Message sent');
                document.getElementById('inboxMsg').value = '';
            } catch(e) {
                resultDiv.innerHTML = '❌ Error: ' + e.message;
                addLog('Error: ' + e.message);
            }
        }
        
        async function sendAndWaitInbox() {
            const msg = document.getElementById('inboxMsg').value;
            const model = document.getElementById('modelSelect').value;
            const sessionInfo = getSelectedSessionInfo();
            const resultDiv = document.getElementById('inboxSendResult');
            const replyDiv = document.getElementById('inboxReply');
            if (!msg) { resultDiv.innerHTML = '⚠️ Please enter a message'; return; }
            
            resultDiv.innerHTML = '⏳ Sending to: ' + escapeHtml(sessionInfo.title) + ' and waiting (up to 60s)...';
            replyDiv.innerHTML = '⏳ Waiting for Copilot reply...';
            addLog('Sending to ' + sessionInfo.title + ' and waiting: ' + msg + (model ? ' [model: ' + model + ']' : ''));
            
            try {
                const body = {message: msg, maxWait: 60000, sessionMode: sessionInfo.mode};
                if (model) body.model = model;
                if (sessionInfo.sessionId) body.sessionId = sessionInfo.sessionId;
                
                const r = await fetch(API + '/api/inbox/send-and-wait', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body)
                });
                const d = await r.json();
                
                if (d.success) {
                    resultDiv.innerHTML = '✅ Got reply in ' + Math.round(d.waitedMs/1000) + 's';
                    replyDiv.innerHTML = 
                        '✅ <b>GOT REPLY</b> (waited ' + Math.round(d.waitedMs/1000) + 's)\\n\\n' +
                        '👤 <b>YOUR MESSAGE:</b>\\n' + escapeHtml(d.userMessage || msg) + '\\n\\n' +
                        '🤖 <b>COPILOT REPLY:</b>\\n' + escapeHtml(d.assistantReply || '(empty)');
                    addLog('Got reply after ' + Math.round(d.waitedMs/1000) + 's');
                    document.getElementById('inboxMsg').value = '';
                    // Refresh inbox to show new messages
                    loadInbox();
                } else {
                    resultDiv.innerHTML = '❌ ' + (d.error || 'Failed to get reply');
                    replyDiv.innerHTML = '❌ ' + (d.error || 'Failed to get reply');
                    addLog('Error: ' + d.error);
                }
            } catch (e) {
                resultDiv.innerHTML = '❌ Error: ' + e.message;
                addLog('Error: ' + e.message);
            }
        }

        // ==================== TOOLS FUNCTIONS ====================

        async function runCmd() {
            const cmd = document.getElementById('cmd').value;
            addLog('Running: ' + cmd);
            try {
                await fetch(API + '/api/terminal', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({command: cmd})
                });
                addLog('Command sent');
            } catch(e) {
                addLog('Error: ' + e.message);
            }
        }

        async function scanStorage() {
            addLog('Scanning storage...');
            try {
                const r = await fetch(API + '/api/scan');
                const d = await r.json();
                addLog('Scan complete. Found ' + d.filesFound + ' files.');
                loadInbox();
            } catch(e) {
                addLog('Error: ' + e.message);
            }
        }
        
        async function approveCommand(action) {
            addLog('Command action: ' + action);
            try {
                const r = await fetch(API + '/api/command-action', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({action: action})
                });
                const d = await r.json();
                if (d.success) {
                    addLog('Command ' + action + ' executed');
                    // Refresh to update the UI
                    setTimeout(() => loadInbox(), 1000);
                } else {
                    addLog('Error: ' + (d.error || 'Unknown error'));
                }
            } catch(e) {
                addLog('Error: ' + e.message);
            }
        }
        
        function escapeHtml(text) {
            if (!text) return '';
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        // Initialize
        checkStatus();
        loadInbox();
        setInterval(checkStatus, 10000);
        
        document.getElementById('inboxMsg').onkeypress = e => { if(e.key === 'Enter') sendAndWaitInbox(); };
        document.getElementById('cmd').onkeypress = e => { if(e.key === 'Enter') runCmd(); };
    </script>
</body>
</html>`;
}
function deactivate() {
    if (server) {
        server.close();
        server = null;
    }
    if (clipboardWatcher) {
        clearInterval(clipboardWatcher);
    }
    fileWatchers.forEach(w => w.dispose());
    log('Extension deactivated');
}
//# sourceMappingURL=extension.js.map