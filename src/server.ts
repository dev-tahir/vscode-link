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
import * as instanceManager from './instanceManager';
import { InstanceInfo, InstanceRole, LockFileData } from './instanceManager';

let httpServer: http.Server | null = null;
let wsServer: WebSocketServer | null = null;
let wsClients: Set<WebSocket> = new Set();
// Map of WebSocket connections from slave instances (master only)
let slaveConnections: Map<string, WebSocket> = new Map(); // workspaceHash -> WebSocket
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
let currentRole: InstanceRole = 'standalone';
let currentHttpPort: number = 3847; // Track the port this instance is running on
let currentWsPort: number = 3848;

// Export function to get current port (for extension.ts)
export function getCurrentPort(): number {
    return currentHttpPort;
}

export function initServer(context: vscode.ExtensionContext, channel: vscode.OutputChannel) {
    outputChannel = channel;
    extensionStoragePath = context.storageUri?.fsPath || context.globalStorageUri?.fsPath || '';
    
    // Initialize instance manager
    instanceManager.initInstanceManager(channel);
    
    // Extract workspace hash
    const storagePathParts = extensionStoragePath.split(path.sep);
    const wsIdx = storagePathParts.indexOf('workspaceStorage');
    if (wsIdx >= 0 && storagePathParts[wsIdx + 1]) {
        currentWorkspaceHash = storagePathParts[wsIdx + 1];
        log(`Detected workspace hash: ${currentWorkspaceHash}`);
        
        // Register with instance manager
        const workspaceName = vscode.workspace.name || 
            vscode.workspace.workspaceFolders?.[0]?.name || 
            'VS Code';
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        instanceManager.setLocalInstance(currentWorkspaceHash, workspaceName, workspacePath);
        
        // Start watching chatSessions folder
        startFileWatcher();
        
        // Start backup polling (in case file watcher misses changes)
        startBackupPoll();
    }
    
    // Set up role change handler
    instanceManager.onRoleChange((role, lockData) => {
        currentRole = role;
        log(`Role changed to: ${role}`);
        
        if (role === 'slave' && lockData) {
            // We're a slave, notify webview clients about the master
            broadcastToClients({
                type: 'status',
                data: { 
                    connected: true, 
                    workspaceHash: currentWorkspaceHash,
                    role: 'slave',
                    masterPort: lockData.masterPort
                },
                timestamp: Date.now()
            });
        }
        // Note: Don't auto-retry on 'standalone' - the server is already running
    });
    
    // Set up instances update handler
    instanceManager.onInstancesUpdate((instances) => {
        broadcastInstancesToClients(instances);
    });
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

export async function startServer(port: number = 3847, wsPort: number = 3848) {
    log('Starting server...');
    
    // Try to start on the default port first
    let success = await tryStartServers(port, wsPort);
    
    if (success) {
        // We got the master port
        currentRole = 'master';
        await instanceManager.tryBecomeMaster(port, wsPort);
        vscode.window.showInformationMessage(`Remote Chat Control: Master (port ${port})`);
    } else {
        // Master port taken - find an alternative
        log('Master port taken, finding alternative...');
        currentRole = 'slave';
        
        for (let tryPort = port + 2; tryPort < port + 100; tryPort += 2) {
            success = await tryStartServers(tryPort, tryPort + 1);
            if (success) {
                log(`Started on alternative port ${tryPort}`);
                
                // Try to connect to master for coordination (non-blocking)
                instanceManager.connectAsSlave().catch(e => {
                    log(`Master coordination failed: ${e}`);
                });
                
                vscode.window.showInformationMessage(`Remote Chat Control: Running (port ${tryPort})`);
                return;
            }
        }
        
        vscode.window.showErrorMessage('Remote Chat Control: Could not find available port');
    }
}

// Try to start both HTTP and WebSocket servers on given ports
async function tryStartServers(httpPort: number, wsPort: number): Promise<boolean> {
    // Try HTTP server first
    const httpSuccess = await startHTTPServerAsync(httpPort);
    if (!httpSuccess) {
        return false;
    }
    
    // Try WebSocket server
    const wsSuccess = await startWebSocketServerAsync(wsPort);
    if (!wsSuccess) {
        // Clean up HTTP server if WS fails
        if (httpServer) {
            httpServer.close();
            httpServer = null;
        }
        return false;
    }
    
    return true;
}

// Async version of HTTP server startup that returns success/failure
async function startHTTPServerAsync(port: number): Promise<boolean> {
    if (httpServer) {
        log('HTTP server already running');
        return true;
    }

    return new Promise((resolve) => {
        currentHttpPort = port;
        log(`Trying HTTP server on port ${port}...`);

        const server = http.createServer(async (req, res) => {
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

        server.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                log(`Port ${port} already in use`);
            } else {
                log(`HTTP server error: ${err.message}`);
            }
            resolve(false);
        });

        server.listen(port, () => {
            httpServer = server;
            log(`HTTP server running on port ${port}`);
            resolve(true);
        });
    });
}

// Async version of WebSocket server startup
async function startWebSocketServerAsync(port: number): Promise<boolean> {
    if (wsServer) {
        log('WebSocket server already running');
        return true;
    }

    return new Promise((resolve) => {
        currentWsPort = port;
        log(`Trying WebSocket server on port ${port}...`);

        try {
            const server = new WebSocketServer({ port });

            server.once('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    log(`WS Port ${port} already in use`);
                } else {
                    log(`WebSocket server error: ${err.message}`);
                }
                resolve(false);
            });

            server.once('listening', () => {
                wsServer = server;
                log(`WebSocket server running on port ${port}`);
                setupWebSocketHandlers(server);
                resolve(true);
            });
        } catch (e) {
            log(`WebSocket server creation error: ${e}`);
            resolve(false);
        }
    });
}

// Set up WebSocket event handlers
function setupWebSocketHandlers(server: WebSocketServer) {
    server.on('connection', (ws: WebSocket) => {
        log('WebSocket client connected');
        wsClients.add(ws);

        // Track if this is a slave VS Code instance connection
        let clientWorkspaceHash: string | null = null;

        // Send initial status with role info
        sendToClient(ws, {
            type: 'status',
            data: { 
                connected: true, 
                workspaceHash: currentWorkspaceHash,
                role: currentRole,
                instances: instanceManager.getAllInstances().map(inst => ({
                    id: inst.workspaceHash,
                    workspaceHash: inst.workspaceHash,
                    workspaceName: inst.workspaceName,
                    workspacePath: inst.workspacePath,
                    lastActive: inst.lastActive,
                    isActive: inst.workspaceHash === currentWorkspaceHash
                }))
            },
            timestamp: Date.now()
        });

        ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());
                
                // Handle slave instance registration
                if (msg.type === 'register_instance' && msg.instance) {
                    clientWorkspaceHash = msg.instance.workspaceHash;
                    if (clientWorkspaceHash) {
                        slaveConnections.set(clientWorkspaceHash, ws);
                    }
                    
                    const updatedInstances = instanceManager.registerInstance(msg.instance);
                    log(`Slave instance registered: ${msg.instance.workspaceName}`);
                    
                    // Broadcast updated instances to all clients
                    broadcastInstancesToClients(updatedInstances);
                    
                    // Also broadcast to all slave connections
                    broadcastToSlaves({
                        type: 'instances_update',
                        instances: updatedInstances
                    });
                    return;
                }
                
                // Handle slave instance unregistration
                if (msg.type === 'unregister_instance' && msg.workspaceHash) {
                    slaveConnections.delete(msg.workspaceHash);
                    const updatedInstances = instanceManager.unregisterInstance(msg.workspaceHash);
                    log(`Slave instance unregistered: ${msg.workspaceHash}`);
                    
                    broadcastInstancesToClients(updatedInstances);
                    broadcastToSlaves({
                        type: 'instances_update',
                        instances: updatedInstances
                    });
                    return;
                }
                
                // Handle pong from slaves
                if (msg.type === 'pong') {
                    return;
                }
                
                handleWebSocketMessage(ws, msg);
            } catch (e) {
                log(`WS message error: ${e}`);
            }
        });

        ws.on('close', () => {
            log('WebSocket client disconnected');
            wsClients.delete(ws);
            
            // If this was a slave connection, unregister it
            if (clientWorkspaceHash) {
                slaveConnections.delete(clientWorkspaceHash);
                const updatedInstances = instanceManager.unregisterInstance(clientWorkspaceHash);
                broadcastInstancesToClients(updatedInstances);
                broadcastToSlaves({
                    type: 'instances_update',
                    instances: updatedInstances
                });
            }
        });

        ws.on('error', (err) => {
            log(`WebSocket error: ${err.message}`);
            wsClients.delete(ws);
            if (clientWorkspaceHash) {
                slaveConnections.delete(clientWorkspaceHash);
            }
        });
    });
}

// Broadcast instances list to all webview clients
function broadcastInstancesToClients(instances: InstanceInfo[]) {
    const vsCodeInstances: VSCodeInstance[] = instances.map(inst => ({
        id: inst.workspaceHash,
        workspaceHash: inst.workspaceHash,
        workspaceName: inst.workspaceName,
        workspacePath: inst.workspacePath,
        lastActive: inst.lastActive,
        isActive: inst.workspaceHash === currentWorkspaceHash
    }));
    
    broadcastToClients({
        type: 'instances_update',
        data: { instances: vsCodeInstances },
        timestamp: Date.now()
    });
}

export function stopServer() {
    // Clean up instance manager
    instanceManager.cleanup();
    
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
    slaveConnections.clear();
    currentRole = 'standalone';
}

// Broadcast to all slave VS Code instances
function broadcastToSlaves(msg: any) {
    slaveConnections.forEach((ws, hash) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    });
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
    // Parse URL and query params
    const urlParts = url.split('?');
    const pathname = urlParts[0];
    const queryString = urlParts[1] || '';
    const params = new URLSearchParams(queryString);
    const targetWorkspace = params.get('workspace'); // Optional workspace hash to target
    
    // Serve HTML
    if (pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getWebViewHTML());
        return;
    }

    // API Status
    if (pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            role: currentRole,
            sent: chatHistory.length,
            captured: capturedMessages.length,
            storageFiles: chatStorageContent.length,
            workspaceHash: currentWorkspaceHash,
            instances: instanceManager.getAllInstances().map(i => ({
                id: i.workspaceHash,
                workspaceName: i.workspaceName,
                isActive: i.workspaceHash === currentWorkspaceHash
            }))
        }));
        return;
    }

    // Get all connected instances
    if (pathname === '/api/instances') {
        const instances = instanceManager.getAllInstances();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            instances: instances.map(inst => ({
                id: inst.workspaceHash,
                workspaceHash: inst.workspaceHash,
                workspaceName: inst.workspaceName,
                workspacePath: inst.workspacePath,
                lastActive: inst.lastActive,
                isActive: inst.workspaceHash === currentWorkspaceHash
            }))
        }));
        return;
    }

    // Send message - can target specific workspace
    if (pathname === '/api/send' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const workspace = data.workspace || targetWorkspace;
        
        // If targeting a different workspace, route to that slave
        if (workspace && workspace !== currentWorkspaceHash) {
            const result = await sendToSlaveWorkspace(workspace, 'send_chat', {
                message: data.message,
                model: data.model,
                sessionMode: data.sessionMode,
                sessionId: data.sessionId
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }
        
        const result = await sendToChat(data.message || 'Hi', data.model, data.sessionMode, data.sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
        return;
    }

    // Current workspace
    if (pathname === '/api/inbox/current-workspace') {
        const workspaceName = vscode.workspace.name || 
            vscode.workspace.workspaceFolders?.[0]?.name || 
            'VS Code';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            workspaceHash: currentWorkspaceHash,
            storagePath: extensionStoragePath,
            workspaceName: workspaceName,
            role: currentRole,
            instances: instanceManager.getAllInstances().map(i => ({
                id: i.workspaceHash,
                workspaceName: i.workspaceName,
                isActive: i.workspaceHash === currentWorkspaceHash
            }))
        }));
        return;
    }

    // Get inbox messages - can target specific workspace
    if (pathname === '/api/inbox/messages') {
        const workspace = targetWorkspace || currentWorkspaceHash;
        if (!workspace) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Workspace not detected' }));
            return;
        }
        
        const inboxData = inbox.getInboxForWorkspace(workspace);
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.end(JSON.stringify(inboxData));
        return;
    }

    // Get inbox for all workspaces
    if (pathname === '/api/inbox/all') {
        const allInstances = instanceManager.getAllInstances();
        const allInboxes = allInstances.map(inst => ({
            ...inbox.getInboxForWorkspace(inst.workspaceHash),
            workspaceName: inst.workspaceName,
            isActive: inst.workspaceHash === currentWorkspaceHash
        }));
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.end(JSON.stringify({ workspaces: allInboxes }));
        return;
    }

    // Get latest reply
    if (pathname === '/api/inbox/latest-reply') {
        const workspace = targetWorkspace || currentWorkspaceHash || inbox.getCurrentWorkspaceHash();
        if (!workspace) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No workspace selected' }));
            return;
        }
        
        const result = inbox.getLatestReplyForWorkspace(workspace);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
    }

    // Send and wait for reply
    if (pathname === '/api/inbox/send-and-wait' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const workspace = data.workspace || targetWorkspace;
        const beforeSend = Date.now();
        
        // If targeting a different workspace, route to that slave
        if (workspace && workspace !== currentWorkspaceHash) {
            const slaveWs = slaveConnections.get(workspace);
            if (slaveWs && slaveWs.readyState === WebSocket.OPEN) {
                slaveWs.send(JSON.stringify({
                    type: 'execute_command',
                    command: 'send_chat',
                    targetWorkspace: workspace,
                    message: data.message,
                    model: data.model,
                    sessionMode: data.sessionMode,
                    sessionId: data.sessionId
                }));
            }
        } else {
            await sendToChat(data.message, data.model, data.sessionMode, data.sessionId);
        }
        
        const effectiveWorkspace = workspace || currentWorkspaceHash || inbox.getCurrentWorkspaceHash();
        if (!effectiveWorkspace) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No workspace detected' }));
            return;
        }
        
        const result = await inbox.waitForNewReply(effectiveWorkspace, beforeSend, data.maxWait || 60000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
    }

    // Read file
    if (pathname === '/api/file/read' && req.method === 'POST') {
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
    if (pathname === '/api/terminal' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const term = vscode.window.createTerminal('Remote');
        term.show();
        term.sendText(data.command);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // Command action (approve/skip) - can target specific workspace
    if (pathname === '/api/command-action' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const action = data.action;
        const workspace = data.workspace || targetWorkspace;
        
        // If targeting a different workspace, route to that slave
        if (workspace && workspace !== currentWorkspaceHash) {
            const result = await sendToSlaveWorkspace(workspace, 'command_action', { action });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }
        
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

    // Scan storage
    if (pathname === '/api/scan') {
        await scanChatStorage();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, filesFound: chatStorageContent.length }));
        return;
    }

    res.writeHead(404);
    res.end('Not found');
}

// Send command to a specific slave workspace
async function sendToSlaveWorkspace(workspaceHash: string, command: string, data: any): Promise<any> {
    const slaveWs = slaveConnections.get(workspaceHash);
    
    if (!slaveWs || slaveWs.readyState !== WebSocket.OPEN) {
        return { success: false, error: `Workspace ${workspaceHash} not connected` };
    }
    
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve({ success: false, error: 'Timeout waiting for slave response' });
        }, 10000);
        
        // Send command to slave
        slaveWs.send(JSON.stringify({
            type: 'execute_command',
            command,
            targetWorkspace: workspaceHash,
            ...data
        }));
        
        // For now, just assume success (proper implementation would need request/response tracking)
        clearTimeout(timeout);
        resolve({ success: true, routed: true, targetWorkspace: workspaceHash });
    });
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
        
        if (sessionMode === 'new') {
            await vscode.commands.executeCommand('workbench.action.chat.newChat');
            await new Promise(r => setTimeout(r, 300));
            note = 'Created new chat';
        }
        
        // Use the VS Code Chat API to send message directly
        // This opens the chat panel with the message and auto-submits
        try {
            // Method 1: Use workbench.action.chat.open with query (newer API)
            await vscode.commands.executeCommand('workbench.action.chat.open', {
                query: message,
                isPartialQuery: false  // false = auto-submit the message
            });
            log('Message sent via chat.open API');
        } catch (e1) {
            log(`chat.open failed: ${e1}, trying alternative...`);
            
            try {
                // Method 2: Focus chat and use type + submit commands
                await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                await new Promise(r => setTimeout(r, 300));
                
                // Clear any existing input first
                await vscode.commands.executeCommand('editor.action.selectAll');
                await new Promise(r => setTimeout(r, 100));
                
                // Type the message
                await vscode.commands.executeCommand('type', { text: message });
                await new Promise(r => setTimeout(r, 200));
                
                // Submit
                await vscode.commands.executeCommand('workbench.action.chat.submit');
                log('Message sent via type + submit');
            } catch (e2) {
                log(`Alternative also failed: ${e2}`);
                throw e2;
            }
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
    // Try to get workspaceHash if not already set
    let hash = currentWorkspaceHash;
    if (!hash) {
        hash = inbox.getCurrentWorkspaceHash();
        if (hash) {
            currentWorkspaceHash = hash;
            log(`Late-detected workspace hash: ${hash}`);
        }
    }
    
    if (!hash) {
        log('getCurrentInbox: No workspace hash available');
        return null;
    }
    
    const inboxData = inbox.getInboxForWorkspace(hash);
    log(`getCurrentInbox: Found ${inboxData?.sessions?.length || 0} sessions`);
    return inboxData;
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
