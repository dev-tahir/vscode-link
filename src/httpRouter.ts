// HTTP server and API route handling
import * as http from 'http';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import * as inbox from './inbox';
import * as instanceManager from './instanceManager';
import { getWebViewHTML } from './webview';
import { state, log, readBody } from './serverState';
import { broadcastToSlaves } from './wsHandler';
import { sendToChat, scanChatStorage, handleCommandAction } from './chatService';

/** Start the HTTP server on the given port */
export async function startHTTPServerAsync(port: number): Promise<boolean> {
    if (state.httpServer) {
        log('HTTP server already running');
        return true;
    }

    return new Promise((resolve) => {
        state.currentHttpPort = port;
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
            state.httpServer = server;
            log(`HTTP server running on port ${port}`);
            resolve(true);
        });
    });
}

// ========== Request Router ==========

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, url: string) {
    const urlParts = url.split('?');
    const pathname = urlParts[0];
    const queryString = urlParts[1] || '';
    const params = new URLSearchParams(queryString);
    const targetWorkspace = params.get('workspace');

    // Serve HTML
    if (pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getWebViewHTML());
        return;
    }

    // API Status
    if (pathname === '/api/status') {
        return handleStatus(res);
    }

    // Instances
    if (pathname === '/api/instances') {
        return handleInstances(res);
    }

    // Send message
    if (pathname === '/api/send' && req.method === 'POST') {
        return handleSendMessage(req, res, targetWorkspace);
    }

    // Current workspace
    if (pathname === '/api/inbox/current-workspace') {
        return handleCurrentWorkspace(res);
    }

    // Inbox messages
    if (pathname === '/api/inbox/messages') {
        return handleInboxMessages(res, targetWorkspace);
    }

    // All workspaces inbox
    if (pathname === '/api/inbox/all') {
        return handleInboxAll(res);
    }

    // Latest reply
    if (pathname === '/api/inbox/latest-reply') {
        return handleLatestReply(res, targetWorkspace);
    }

    // Send and wait
    if (pathname === '/api/inbox/send-and-wait' && req.method === 'POST') {
        return handleSendAndWait(req, res, targetWorkspace);
    }

    // Read file
    if (pathname === '/api/file/read' && req.method === 'POST') {
        return handleFileRead(req, res);
    }

    // Terminal command (legacy)
    if (pathname === '/api/terminal' && req.method === 'POST') {
        return handleTerminalLegacy(req, res);
    }

    // Command action
    if (pathname === '/api/command-action' && req.method === 'POST') {
        return handleCommandActionRoute(req, res, targetWorkspace);
    }

    // Scan storage
    if (pathname === '/api/scan') {
        return handleScan(res);
    }

    // ========== TERMINAL API ==========
    if (pathname === '/api/terminals') {
        return handleTerminalsList(res);
    }
    if (pathname.match(/^\/api\/terminals\/(\d+)\/output$/)) {
        return handleTerminalOutput(res, pathname);
    }
    if (pathname === '/api/terminals/execute' && req.method === 'POST') {
        return handleTerminalExecute(req, res);
    }
    if (pathname === '/api/terminals/create' && req.method === 'POST') {
        return handleTerminalCreate(res);
    }

    // ========== FILES API ==========
    if (pathname === '/api/files/tree' && req.method === 'POST') {
        return handleFileTree(req, res);
    }

    // ========== GIT API ==========
    if (pathname === '/api/git/status') {
        return handleGitStatus(res);
    }
    if (pathname === '/api/git/diff' && req.method === 'POST') {
        return handleGitDiff(req, res);
    }
    if (pathname === '/api/git/stage' && req.method === 'POST') {
        return handleGitStage(req, res);
    }
    if (pathname === '/api/git/unstage' && req.method === 'POST') {
        return handleGitUnstage(req, res);
    }
    if (pathname === '/api/git/stage-all' && req.method === 'POST') {
        return handleGitStageAll(res);
    }
    if (pathname === '/api/git/unstage-all' && req.method === 'POST') {
        return handleGitUnstageAll(res);
    }
    if (pathname === '/api/git/commit' && req.method === 'POST') {
        return handleGitCommit(req, res);
    }
    if (pathname === '/api/git/pull' && req.method === 'POST') {
        return handleGitPull(res);
    }
    if (pathname === '/api/git/push' && req.method === 'POST') {
        return handleGitPush(res);
    }

    res.writeHead(404);
    res.end('Not found');
}

// ========== Route Handlers ==========

function handleStatus(res: http.ServerResponse) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'ok',
        role: state.currentRole,
        sent: state.chatHistory.length,
        captured: state.capturedMessages.length,
        storageFiles: state.chatStorageContent.length,
        workspaceHash: state.currentWorkspaceHash,
        instances: instanceManager.getAllInstances().map(i => ({
            id: i.workspaceHash,
            workspaceName: i.workspaceName,
            isActive: i.workspaceHash === state.currentWorkspaceHash
        }))
    }));
}

function handleInstances(res: http.ServerResponse) {
    const instances = instanceManager.getAllInstances();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        instances: instances.map(inst => ({
            id: inst.workspaceHash,
            workspaceHash: inst.workspaceHash,
            workspaceName: inst.workspaceName,
            workspacePath: inst.workspacePath,
            lastActive: inst.lastActive,
            isActive: inst.workspaceHash === state.currentWorkspaceHash
        }))
    }));
}

async function handleSendMessage(req: http.IncomingMessage, res: http.ServerResponse, targetWorkspace: string | null) {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const workspace = data.workspace || targetWorkspace;

    // If targeting a different workspace, route to that slave
    if (workspace && workspace !== state.currentWorkspaceHash) {
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
}

function handleCurrentWorkspace(res: http.ServerResponse) {
    const workspaceName = vscode.workspace.name ||
        vscode.workspace.workspaceFolders?.[0]?.name ||
        'VS Code';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        workspaceHash: state.currentWorkspaceHash,
        storagePath: state.extensionStoragePath,
        workspaceName: workspaceName,
        role: state.currentRole,
        instances: instanceManager.getAllInstances().map(i => ({
            id: i.workspaceHash,
            workspaceName: i.workspaceName,
            isActive: i.workspaceHash === state.currentWorkspaceHash
        }))
    }));
}

function handleInboxMessages(res: http.ServerResponse, targetWorkspace: string | null) {
    const workspace = targetWorkspace || state.currentWorkspaceHash;
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
}

function handleInboxAll(res: http.ServerResponse) {
    const allInstances = instanceManager.getAllInstances();
    const allInboxes = allInstances.map(inst => ({
        ...inbox.getInboxForWorkspace(inst.workspaceHash),
        workspaceName: inst.workspaceName,
        isActive: inst.workspaceHash === state.currentWorkspaceHash
    }));
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.end(JSON.stringify({ workspaces: allInboxes }));
}

function handleLatestReply(res: http.ServerResponse, targetWorkspace: string | null) {
    const workspace = targetWorkspace || state.currentWorkspaceHash || inbox.getCurrentWorkspaceHash();
    if (!workspace) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No workspace selected' }));
        return;
    }

    const result = inbox.getLatestReplyForWorkspace(workspace);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
}

async function handleSendAndWait(req: http.IncomingMessage, res: http.ServerResponse, targetWorkspace: string | null) {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const workspace = data.workspace || targetWorkspace;
    const beforeSend = Date.now();

    if (workspace && workspace !== state.currentWorkspaceHash) {
        const slaveWs = state.slaveConnections.get(workspace);
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

    const effectiveWorkspace = workspace || state.currentWorkspaceHash || inbox.getCurrentWorkspaceHash();
    if (!effectiveWorkspace) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No workspace detected' }));
        return;
    }

    const result = await inbox.waitForNewReply(effectiveWorkspace, beforeSend, data.maxWait || 60000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
}

async function handleFileRead(req: http.IncomingMessage, res: http.ServerResponse) {
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
}

async function handleTerminalLegacy(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const term = vscode.window.createTerminal('Remote');
    term.show();
    term.sendText(data.command);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
}

async function handleCommandActionRoute(req: http.IncomingMessage, res: http.ServerResponse, targetWorkspace: string | null) {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const action = data.action;
    const workspace = data.workspace || targetWorkspace;

    // If targeting a different workspace, route to that slave
    if (workspace && workspace !== state.currentWorkspaceHash) {
        const result = await sendToSlaveWorkspace(workspace, 'command_action', { action });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
    }

    await handleCommandAction(action);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, action }));
}

async function handleScan(res: http.ServerResponse) {
    await scanChatStorage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, filesFound: state.chatStorageContent.length }));
}

// ========== Terminal Route Handlers ==========

function handleTerminalsList(res: http.ServerResponse) {
    const terminals = vscode.window.terminals.map((t, i) => ({
        id: i,
        name: t.name,
        processId: null
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ terminals }));
}

function handleTerminalOutput(res: http.ServerResponse, pathname: string) {
    const termIdx = parseInt(pathname.split('/')[3]);
    const terminals = vscode.window.terminals;
    if (termIdx >= 0 && termIdx < terminals.length) {
        const terminal = terminals[termIdx];
        let output = '';
        let cwd = '';
        try {
            const shellIntegration = (terminal as any).shellIntegration;
            if (shellIntegration) {
                cwd = shellIntegration.cwd?.fsPath || '';
                const executions = shellIntegration.executions || [];
                const recentExecutions = Array.from(executions).slice(-20);
                output = recentExecutions.map((exec: any) => {
                    let text = '';
                    if (exec.commandLine?.value) text += '> ' + exec.commandLine.value + '\n';
                    if (exec.output) {
                        try {
                            for (const chunk of exec.output) { text += chunk; }
                        } catch (e) { /* output may not be iterable */ }
                    }
                    return text;
                }).join('\n');
            }
        } catch (e) {
            log(`Shell integration not available for terminal ${termIdx}: ${e}`);
        }

        if (!cwd) {
            cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, output, cwd, name: terminal.name }));
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Terminal not found' }));
    }
}

async function handleTerminalExecute(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const command = data.command;
    const terminalId = data.terminalId;

    if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No command provided' }));
        return;
    }

    const terminals = vscode.window.terminals;
    let terminal: vscode.Terminal;

    if (terminalId !== undefined && terminalId >= 0 && terminalId < terminals.length) {
        terminal = terminals[terminalId];
    } else if (terminals.length > 0) {
        terminal = terminals[0];
    } else {
        terminal = vscode.window.createTerminal('Remote');
    }

    terminal.show(false);
    terminal.sendText(command);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, terminalName: terminal.name }));
}

function handleTerminalCreate(res: http.ServerResponse) {
    const terminal = vscode.window.createTerminal('Remote Terminal');
    terminal.show(false);
    const idx = vscode.window.terminals.indexOf(terminal);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, id: idx, name: terminal.name }));
}

// ========== Files Route Handlers ==========

async function handleFileTree(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readBody(req);
    const data = JSON.parse(body || '{}');
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const targetPath = data.path || workspacePath;

    if (!targetPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No workspace open' }));
        return;
    }

    try {
        const items: any[] = [];
        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.env') continue;
            if (['node_modules', '__pycache__', '.git', 'dist', 'out', '.next', 'coverage'].includes(entry.name)) continue;

            const fullPath = path.join(targetPath, entry.name);
            let size = 0;
            try {
                if (!entry.isDirectory()) {
                    const stat = await fs.promises.stat(fullPath);
                    size = stat.size;
                }
            } catch {}

            items.push({
                name: entry.name,
                path: fullPath,
                isDirectory: entry.isDirectory(),
                size: entry.isDirectory() ? undefined : size,
                depth: 0
            });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, items, root: workspacePath }));
    } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    }
}

// ========== Git Route Handlers ==========

function getWorkspacePath(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
}

function handleGitStatus(res: http.ServerResponse) {
    const workspacePath = getWorkspacePath();
    if (!workspacePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'No workspace open' }));
        return;
    }

    try {
        const { execSync } = require('child_process');
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath, encoding: 'utf-8' }).trim();
        const statusOut = execSync('git status --porcelain', { cwd: workspacePath, encoding: 'utf-8' });
        const lines = statusOut.split('\n').filter((l: string) => l.trim());

        const staged: any[] = [];
        const changed: any[] = [];
        const untracked: any[] = [];

        lines.forEach((line: string) => {
            const x = line[0];
            const y = line[1];
            const filePath = line.substring(3).trim();
            const fileName = filePath.split('/').pop() || filePath;

            if (x !== ' ' && x !== '?') {
                staged.push({ name: fileName, path: filePath, status: x });
            }
            if (y !== ' ' && y !== '?') {
                changed.push({ name: fileName, path: filePath, status: y === 'M' ? 'M' : y === 'D' ? 'D' : y });
            }
            if (x === '?' && y === '?') {
                untracked.push({ name: fileName, path: filePath, status: 'U' });
            }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, branch, staged, changed, untracked }));
    } catch (e: any) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message.includes('not a git repository') ? 'Not a git repository' : e.message }));
    }
}

async function handleGitDiff(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const workspacePath = getWorkspacePath();

    try {
        const { execSync } = require('child_process');
        let diff = '';
        try {
            diff = execSync(`git diff -- "${data.file}"`, { cwd: workspacePath, encoding: 'utf-8' });
            if (!diff) {
                diff = execSync(`git diff --cached -- "${data.file}"`, { cwd: workspacePath, encoding: 'utf-8' });
            }
            if (!diff) {
                const content = fs.readFileSync(path.join(workspacePath, data.file), 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, content }));
                return;
            }
        } catch {
            diff = '';
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, diff }));
    } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    }
}

async function handleGitStage(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const workspacePath = getWorkspacePath();
    try {
        const { execSync } = require('child_process');
        execSync(`git add "${data.file}"`, { cwd: workspacePath });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
    }
}

async function handleGitUnstage(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const workspacePath = getWorkspacePath();
    try {
        const { execSync } = require('child_process');
        execSync(`git reset HEAD "${data.file}"`, { cwd: workspacePath });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
    }
}

function handleGitStageAll(res: http.ServerResponse) {
    const workspacePath = getWorkspacePath();
    try {
        const { execSync } = require('child_process');
        execSync('git add -A', { cwd: workspacePath });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
    }
}

function handleGitUnstageAll(res: http.ServerResponse) {
    const workspacePath = getWorkspacePath();
    try {
        const { execSync } = require('child_process');
        execSync('git reset HEAD', { cwd: workspacePath });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
    }
}

async function handleGitCommit(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const workspacePath = getWorkspacePath();
    if (!data.message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'No commit message' }));
        return;
    }
    try {
        const { execSync } = require('child_process');
        const escapedMsg = data.message.replace(/"/g, '\\"');
        const result = execSync(`git commit -m "${escapedMsg}"`, { cwd: workspacePath, encoding: 'utf-8' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, output: result }));
    } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
    }
}

function handleGitPull(res: http.ServerResponse) {
    const workspacePath = getWorkspacePath();
    try {
        const { execSync } = require('child_process');
        const result = execSync('git pull', { cwd: workspacePath, encoding: 'utf-8', timeout: 30000 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, output: result }));
    } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
    }
}

function handleGitPush(res: http.ServerResponse) {
    const workspacePath = getWorkspacePath();
    try {
        const { execSync } = require('child_process');
        const result = execSync('git push', { cwd: workspacePath, encoding: 'utf-8', timeout: 30000 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, output: result }));
    } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
    }
}

// ========== Slave Routing ==========

/** Send command to a specific slave workspace */
async function sendToSlaveWorkspace(workspaceHash: string, command: string, data: any): Promise<any> {
    const slaveWs = state.slaveConnections.get(workspaceHash);

    if (!slaveWs || slaveWs.readyState !== WebSocket.OPEN) {
        return { success: false, error: `Workspace ${workspaceHash} not connected` };
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve({ success: false, error: 'Timeout waiting for slave response' });
        }, 10000);

        slaveWs.send(JSON.stringify({
            type: 'execute_command',
            command,
            targetWorkspace: workspaceHash,
            ...data
        }));

        // For now, just assume success
        clearTimeout(timeout);
        resolve({ success: true, routed: true, targetWorkspace: workspaceHash });
    });
}
