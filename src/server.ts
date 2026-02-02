// WebSocket and HTTP Server for Remote Chat Control
import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import WebSocket, { WebSocketServer } from 'ws';
import * as inbox from './inbox';
import { getWebViewHTML } from './webview';
import { WebSocketMessage, ChatHistoryEntry, CapturedMessage, StorageFile, VSCodeInstance } from './types';

let httpServer: http.Server | null = null;
let wsServer: WebSocketServer | null = null;
let wsClients: Set<WebSocket> = new Set();
let chatHistory: ChatHistoryEntry[] = [];
let capturedMessages: CapturedMessage[] = [];
let chatStorageContent: StorageFile[] = [];
let currentWorkspaceHash: string | null = null;
let extensionStoragePath: string | null = null;
let outputChannel: vscode.OutputChannel;
let fileWatcher: fs.FSWatcher | null = null;
let lastBroadcastTime = 0;
let lastInboxHash = '';
let backupPollInterval: NodeJS.Timeout | null = null;

export function initServer(context: vscode.ExtensionContext, channel: vscode.OutputChannel) {
    outputChannel = channel;
    extensionStoragePath = context.storageUri?.fsPath || context.globalStorageUri?.fsPath || '';
    
    // Extract workspace hash
    const storagePathParts = extensionStoragePath.split(path.sep);
    const wsIdx = storagePathParts.indexOf('workspaceStorage');
    if (wsIdx >= 0 && storagePathParts[wsIdx + 1]) {
        currentWorkspaceHash = storagePathParts[wsIdx + 1];
        log(`Detected workspace hash: ${currentWorkspaceHash}`);
        
        // Start watching chatSessions folder
        startFileWatcher();
        
        // Start backup polling (in case file watcher misses changes)
        startBackupPoll();
    }
}

// Backup polling - only broadcasts if inbox has actually changed
function startBackupPoll() {
    if (backupPollInterval) clearInterval(backupPollInterval);
    
    backupPollInterval = setInterval(() => {
        if (wsClients.size === 0) return; // No clients, skip
        
        try {
            const inboxData = inbox.getInboxForWorkspace(currentWorkspaceHash!);
            // Create a simple hash based on session count and total message count
            const sessions = inboxData?.sessions || [];
            const totalMsgs = sessions.reduce((sum: number, s: any) => sum + (s.messages?.length || 0), 0);
            const hash = `${sessions.length}-${totalMsgs}`;
            
            if (hash !== lastInboxHash) {
                lastInboxHash = hash;
                log(`Backup poll detected change: ${hash}`);
                broadcastToClients({
                    type: 'inbox_update',
                    data: inboxData,
                    timestamp: Date.now()
                });
            }
        } catch (e) {
            // Ignore errors in backup poll
        }
    }, 2000); // Check every 2 seconds
}

function log(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[RemoteChatControl] ${msg}`);
    outputChannel?.appendLine(`[${timestamp}] ${msg}`);
}

// Watch chatSessions folder for changes and broadcast via WebSocket
function startFileWatcher() {
    if (!currentWorkspaceHash) return;
    
    const chatSessionsPath = path.join(
        os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage',
        currentWorkspaceHash, 'chatSessions'
    );
    
    if (!fs.existsSync(chatSessionsPath)) {
        log(`Chat sessions folder not found: ${chatSessionsPath}`);
        return;
    }
    
    log(`Starting file watcher on: ${chatSessionsPath}`);
    
    try {
        fileWatcher = fs.watch(chatSessionsPath, { persistent: false, recursive: true }, (eventType, filename) => {
            if (filename && filename.endsWith('.json')) {
                // Debounce - don't broadcast more than once per second
                const now = Date.now();
                if (now - lastBroadcastTime < 1000) return;
                lastBroadcastTime = now;
                
                log(`File changed: ${filename}, broadcasting update...`);
                
                // Broadcast inbox update to all connected clients
                setTimeout(() => {
                    broadcastInboxUpdate();
                }, 500); // Small delay to ensure file is fully written
            }
        });
        
        log('File watcher started successfully');
    } catch (e) {
        log(`Error starting file watcher: ${e}`);
    }
}

async function broadcastInboxUpdate() {
    if (wsClients.size === 0) return;
    
    try {
        const inboxData = inbox.getInboxForWorkspace(currentWorkspaceHash!);
        broadcastToClients({
            type: 'inbox_update',
            data: inboxData,
            timestamp: Date.now()
        });
        log(`Broadcasted inbox update to ${wsClients.size} clients`);
    } catch (e) {
        log(`Error broadcasting update: ${e}`);
    }
}

export function startServer(port: number = 3847, wsPort: number = 3848) {
    startHTTPServer(port);
    startWebSocketServer(wsPort);
}

export function stopServer() {
    if (backupPollInterval) {
        clearInterval(backupPollInterval);
        backupPollInterval = null;
        log('Backup poll stopped');
    }
    if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = null;
        log('File watcher stopped');
    }
    if (httpServer) {
        httpServer.close();
        httpServer = null;
        log('HTTP server stopped');
    }
    if (wsServer) {
        wsServer.close();
        wsServer = null;
        log('WebSocket server stopped');
    }
    wsClients.clear();
}

function startHTTPServer(port: number) {
    if (httpServer) {
        log('HTTP server already running');
        return;
    }

    log(`Starting HTTP server on port ${port}...`);

    httpServer = http.createServer(async (req, res) => {
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

        try {
            await handleRequest(req, res, url);
        } catch (e) {
            log(`Request error: ${e}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(e) }));
        }
    });

    httpServer.on('error', (err: Error) => {
        log(`HTTP server error: ${err.message}`);
        httpServer = null;
    });

    httpServer.listen(port, () => {
        log(`HTTP server running at http://localhost:${port}`);
        vscode.window.showInformationMessage(
            `Server started at http://localhost:${port}`,
            'Open Browser'
        ).then(choice => {
            if (choice === 'Open Browser') {
                vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
            }
        });
    });
}

function startWebSocketServer(port: number) {
    if (wsServer) {
        log('WebSocket server already running');
        return;
    }

    log(`Starting WebSocket server on port ${port}...`);

    wsServer = new WebSocketServer({ port });

    wsServer.on('connection', (ws: WebSocket) => {
        log('WebSocket client connected');
        wsClients.add(ws);

        // Send initial status
        sendToClient(ws, {
            type: 'status',
            data: { connected: true, workspaceHash: currentWorkspaceHash },
            timestamp: Date.now()
        });

        ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());
                handleWebSocketMessage(ws, msg);
            } catch (e) {
                log(`WS message error: ${e}`);
            }
        });

        ws.on('close', () => {
            log('WebSocket client disconnected');
            wsClients.delete(ws);
        });

        ws.on('error', (err) => {
            log(`WebSocket error: ${err.message}`);
            wsClients.delete(ws);
        });
    });

    wsServer.on('error', (err: Error) => {
        log(`WebSocket server error: ${err.message}`);
        wsServer = null;
    });

    log(`WebSocket server running on port ${port}`);
}

function sendToClient(ws: WebSocket, msg: WebSocketMessage) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

export function broadcastToClients(msg: WebSocketMessage) {
    wsClients.forEach(ws => sendToClient(ws, msg));
}

function handleWebSocketMessage(ws: WebSocket, msg: any) {
    switch (msg.type) {
        case 'ping':
            sendToClient(ws, { type: 'status', data: { pong: true }, timestamp: Date.now() });
            break;
        case 'refresh':
            loadInbox().then(data => {
                sendToClient(ws, { type: 'inbox_update', data, timestamp: Date.now() });
            });
            break;
    }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, url: string) {
    // Serve HTML
    if (url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getWebViewHTML());
        return;
    }

    // API Status
    if (url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            sent: chatHistory.length,
            captured: capturedMessages.length,
            storageFiles: chatStorageContent.length,
            workspaceHash: currentWorkspaceHash
        }));
        return;
    }

    // Send message
    if (url === '/api/send' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const result = await sendToChat(data.message || 'Hi', data.model, data.sessionMode, data.sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
        return;
    }

    // Current workspace
    if (url === '/api/inbox/current-workspace') {
        const workspaceName = vscode.workspace.name || 
            vscode.workspace.workspaceFolders?.[0]?.name || 
            'VS Code';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            workspaceHash: currentWorkspaceHash,
            storagePath: extensionStoragePath,
            workspaceName: workspaceName
        }));
        return;
    }

    // Get inbox messages
    if (url === '/api/inbox/messages') {
        if (!currentWorkspaceHash) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Workspace not detected' }));
            return;
        }
        
        const inboxData = inbox.getInboxForWorkspace(currentWorkspaceHash);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(inboxData));
        return;
    }

    // Get latest reply
    if (url === '/api/inbox/latest-reply') {
        const workspaceHash = currentWorkspaceHash || inbox.getCurrentWorkspaceHash();
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

    // Send and wait for reply
    if (url === '/api/inbox/send-and-wait' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const beforeSend = Date.now();
        
        await sendToChat(data.message, data.model, data.sessionMode, data.sessionId);
        
        const workspaceHash = currentWorkspaceHash || inbox.getCurrentWorkspaceHash();
        if (!workspaceHash) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No workspace detected' }));
            return;
        }
        
        const result = await inbox.waitForNewReply(workspaceHash, beforeSend, data.maxWait || 60000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
    }

    // Read file
    if (url === '/api/file/read' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        let filename = data.filename || '';
        
        if (!filename) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No filename provided' }));
            return;
        }
        
        filename = filename.split('/').join('\\');
        
        let fileUri: vscode.Uri | null = null;
        
        if (filename.match(/^[a-zA-Z]:\\/)) {
            fileUri = vscode.Uri.file(filename);
        } else if (vscode.workspace.workspaceFolders?.length) {
            fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filename);
        }
        
        if (!fileUri) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Could not locate file' }));
            return;
        }
        
        try {
            const fileData = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(fileData).toString('utf-8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, content, path: fileUri.fsPath }));
        } catch (e) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
        }
        return;
    }

    // Terminal command
    if (url === '/api/terminal' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const term = vscode.window.createTerminal('Remote');
        term.show();
        term.sendText(data.command);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // Command action (approve/skip)
    if (url === '/api/command-action' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const action = data.action;
        
        const { exec } = require('child_process');
        
        const activateScript = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('Visual Studio Code'); Start-Sleep -Milliseconds 500`;
        
        exec(`powershell -Command "${activateScript}"`, async () => {
            try {
                await vscode.commands.executeCommand('workbench.action.chat.focusInput');
            } catch {
                await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
            }
            await new Promise(r => setTimeout(r, 300));
            await vscode.commands.executeCommand('type', { text: ' ' });
            await new Promise(r => setTimeout(r, 200));
            
            if (action === 'approve') {
                const psScript = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 1500; [System.Windows.Forms.SendKeys]::SendWait('^{ENTER}')`;
                exec(`powershell -Command "${psScript}"`);
            } else if (action === 'skip') {
                const psScript = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 1500; [System.Windows.Forms.SendKeys]::SendWait('^%{ENTER}')`;
                exec(`powershell -Command "${psScript}"`);
            }
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, action }));
        return;
    }

    // Get all VS Code instances
    if (url === '/api/instances') {
        const instances = getAllVSCodeInstances();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ instances }));
        return;
    }

    // Scan storage
    if (url === '/api/scan') {
        await scanChatStorage();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, filesFound: chatStorageContent.length }));
        return;
    }

    res.writeHead(404);
    res.end('Not found');
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

async function loadInbox() {
    if (!currentWorkspaceHash) return null;
    return inbox.getInboxForWorkspace(currentWorkspaceHash);
}

// Send message to chat
export async function sendToChat(message: string, model?: string, sessionMode?: string, sessionId?: string): Promise<{ result: string; note?: string }> {
    log(`Sending message: "${message}"${model ? ` (model: ${model})` : ''}${sessionMode ? ` (mode: ${sessionMode})` : ''}`);
    
    chatHistory.push({
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
    });

    try {
        let note: string | undefined;
        let sessionOpened = false;
        
        if (sessionMode === 'new') {
            await vscode.commands.executeCommand('workbench.action.chat.newChat');
            await new Promise(r => setTimeout(r, 300));
            note = 'Created new chat';
        } else if (sessionMode === 'session' && sessionId) {
            try {
                const encodedSessionId = Buffer.from(sessionId).toString('base64');
                const sessionUri = vscode.Uri.parse(`vscode-chat-session://local/${encodedSessionId}`);
                await vscode.commands.executeCommand('vscode.open', sessionUri);
                note = 'Opened session';
                sessionOpened = true;
                await new Promise(r => setTimeout(r, 800));
            } catch (e) {
                log(`Session open error: ${e}`);
                note = 'Session open failed, sending to current';
            }
        }
        
        if (sessionOpened) {
            await new Promise(r => setTimeout(r, 500));
            
            try {
                await vscode.commands.executeCommand('workbench.action.chat.focusInput');
            } catch {
                await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
            }
            await new Promise(r => setTimeout(r, 300));
            
            await vscode.commands.executeCommand('type', { text: message });
            await new Promise(r => setTimeout(r, 300));
            
            try {
                await vscode.commands.executeCommand('workbench.action.chat.submit');
            } catch {
                await vscode.commands.executeCommand('type', { text: '\n' });
            }
        } else {
            // Use PowerShell to type into existing chat (same approach as approve/skip)
            const { exec } = require('child_process');
            
            // Escape message for PowerShell
            const escapedMessage = message.replace(/'/g, "''").replace(/`/g, "``").replace(/\$/g, "`$");
            
            const activateScript = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('Visual Studio Code'); Start-Sleep -Milliseconds 500`;
            
            await new Promise<void>((resolve) => {
                exec(`powershell -Command "${activateScript}"`, async () => {
                    // Focus chat input
                    try {
                        await vscode.commands.executeCommand('workbench.action.chat.focusInput');
                    } catch {
                        await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                    }
                    await new Promise(r => setTimeout(r, 500));
                    
                    // Type message using SendKeys
                    const typeScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapedMessage.replace(/[+^%~(){}[\]]/g, '{$&}')}')`;
                    exec(`powershell -Command "${typeScript}"`, () => {
                        // Submit with Enter after typing
                        setTimeout(() => {
                            const submitScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`;
                            exec(`powershell -Command "${submitScript}"`, () => resolve());
                        }, 500);
                    });
                });
            });
        }
        // Notify clients
        broadcastToClients({
            type: 'message_update',
            data: { message, model, sessionMode },
            timestamp: Date.now()
        });
        
        log('Message sent to chat panel');
        const result = model ? `Message sent (Note: Select ${model} in UI)` : 'Message sent to chat';
        return { result, note };
    } catch (err) {
        log(`Error: ${err}`);
        return { result: `Error: ${err}` };
    }
}

// Get all VS Code instances
function getAllVSCodeInstances(): VSCodeInstance[] {
    const workspaceStoragePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
    const instances: VSCodeInstance[] = [];
    
    try {
        const workspaces = inbox.getAllWorkspacesWithChats();
        
        for (const ws of workspaces) {
            instances.push({
                id: ws.hash,
                workspaceHash: ws.hash,
                workspaceName: ws.hash.substring(0, 16) + '...',
                workspacePath: ws.chatSessionsPath,
                lastActive: ws.lastModified,
                isActive: ws.hash === currentWorkspaceHash
            });
        }
    } catch (e) {
        log(`Error getting instances: ${e}`);
    }
    
    return instances;
}

// Scan chat storage
async function scanChatStorage() {
    log('Scanning for chat storage files...');
    chatStorageContent = [];
    
    const possiblePaths = [
        path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage'),
    ];
    
    for (const basePath of possiblePaths) {
        try {
            if (fs.existsSync(basePath)) {
                log(`Scanning: ${basePath}`);
                await scanDirectoryForChat(basePath, 0);
            }
        } catch (e) {
            log(`Error scanning ${basePath}: ${e}`);
        }
    }
    
    log(`Found ${chatStorageContent.length} potential chat-related files`);
}

async function scanDirectoryForChat(dirPath: string, depth: number) {
    if (depth > 4) return;
    
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            
            if (entry.isDirectory()) {
                if (entry.name === 'chatSessions') {
                    await scanChatSessionsFolder(fullPath);
                } else {
                    await scanDirectoryForChat(fullPath, depth + 1);
                }
            }
        }
    } catch (e) {
        // Ignore permission errors
    }
}

async function scanChatSessionsFolder(folderPath: string) {
    try {
        const files = fs.readdirSync(folderPath, { withFileTypes: true });
        
        for (const file of files) {
            if (file.isFile() && file.name.endsWith('.json')) {
                const filePath = path.join(folderPath, file.name);
                const stats = fs.statSync(filePath);
                
                chatStorageContent.push({
                    path: filePath,
                    name: file.name,
                    type: 'chat-session',
                    size: stats.size,
                    modified: stats.mtime
                });
            }
        }
    } catch (e) {
        log(`Error reading chatSessions folder: ${e}`);
    }
}

export function getWorkspaceHash() {
    return currentWorkspaceHash;
}

export function getChatHistory() {
    return chatHistory;
}

export function getCurrentInbox() {
    if (!currentWorkspaceHash) return null;
    return inbox.getInboxForWorkspace(currentWorkspaceHash);
}

export async function handleCommandAction(action: string): Promise<void> {
    const { exec } = require('child_process');
    
    const activateScript = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('Visual Studio Code'); Start-Sleep -Milliseconds 500`;
    
    return new Promise((resolve) => {
        exec(`powershell -Command "${activateScript}"`, async () => {
            try {
                await vscode.commands.executeCommand('workbench.action.chat.focusInput');
            } catch {
                await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
            }
            await new Promise(r => setTimeout(r, 300));
            await vscode.commands.executeCommand('type', { text: ' ' });
            await new Promise(r => setTimeout(r, 200));
            
            if (action === 'approve') {
                const psScript = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 1500; [System.Windows.Forms.SendKeys]::SendWait('^{ENTER}')`;
                exec(`powershell -Command "${psScript}"`, () => resolve());
            } else if (action === 'skip') {
                const psScript = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 1500; [System.Windows.Forms.SendKeys]::SendWait('^%{ENTER}')`;
                exec(`powershell -Command "${psScript}"`, () => resolve());
            } else {
                resolve();
            }
        });
    });
}
