// Cloud server connection management and proxy command handlers
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as inbox from '../inbox';
import { CloudConnector } from '../cloudConnector';
import { state, log } from './serverState';
import { sendToChat, handleCommandAction, getCurrentInbox } from './chatService';

/**
 * Connect to a remote cloud server (Cloud Run, etc.)
 * Extension becomes a WebSocket client
 */
export async function connectToCloud(serverUrl: string): Promise<boolean> {
    if (state.isCloudConnected && state.cloudConnector?.connected) {
        log('Already connected to cloud server');
        return true;
    }

    log(`Connecting to cloud server: ${serverUrl}`);

    // Create cloud connector if not exists
    if (!state.cloudConnector) {
        state.cloudConnector = new CloudConnector(state.outputChannel!);
    }

    // Set workspace info
    const workspaceName = vscode.workspace.name ||
        vscode.workspace.workspaceFolders?.[0]?.name ||
        'VS Code';
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    state.cloudConnector.setWorkspaceInfo(
        state.currentWorkspaceHash || 'unknown',
        workspaceName,
        workspacePath
    );

    // Set callbacks
    state.cloudConnector.setCallbacks({
        onInboxRequest: () => getCurrentInbox(),
        onSendChat: sendToChat,
        onCommandAction: handleCommandAction,
        onSendAndWait: async (message: string, model?: string, sessionMode?: string, sessionId?: string, maxWait?: number) => {
            const beforeSend = Date.now();
            await sendToChat(message, model, sessionMode, sessionId);

            const effectiveWorkspace = state.currentWorkspaceHash || inbox.getCurrentWorkspaceHash();
            if (!effectiveWorkspace) {
                return { error: 'No workspace detected' };
            }

            const result = await inbox.waitForNewReply(effectiveWorkspace, beforeSend, maxWait || 60000);
            return result;
        }
    });

    // Register terminal/files/git command handlers for proxy
    registerProxyCommandHandlers(state.cloudConnector);

    // Connect
    const success = await state.cloudConnector.connect(serverUrl);
    state.isCloudConnected = success;

    if (success) {
        log('Connected to cloud server successfully');
        startCloudInboxSync();
    } else {
        log('Failed to connect to cloud server');
    }

    return success;
}

/** Disconnect from cloud server */
export function disconnectFromCloud(): void {
    if (state.cloudConnector) {
        state.cloudConnector.disconnect();
        state.cloudConnector = null;
    }
    state.isCloudConnected = false;
    stopCloudInboxSync();
    log('Disconnected from cloud server');
}

/** Check if connected to cloud */
export function isConnectedToCloud(): boolean {
    return state.isCloudConnected && state.cloudConnector?.connected === true;
}

/** Start periodic inbox sync to cloud */
function startCloudInboxSync() {
    stopCloudInboxSync();

    state.cloudSyncInterval = setInterval(() => {
        if (state.cloudConnector?.connected) {
            state.cloudConnector.sendInboxUpdate();
        }
    }, 1000);
}

/** Stop cloud inbox sync */
function stopCloudInboxSync() {
    if (state.cloudSyncInterval) {
        clearInterval(state.cloudSyncInterval);
        state.cloudSyncInterval = null;
    }
}

/** Register command handlers for terminal, files, and git proxy commands */
function registerProxyCommandHandlers(connector: CloudConnector) {
    // ========== TERMINAL COMMANDS ==========

    connector.registerCommandHandler('get_terminals', async () => {
        const terminals = vscode.window.terminals.map((t, i) => ({
            id: i,
            name: t.name,
            processId: null
        }));
        return { terminals };
    });

    connector.registerCommandHandler('get_terminal_output', async (data: any) => {
        const termIdx = data?.terminalId ?? 0;
        const terminals = vscode.window.terminals;
        if (termIdx < 0 || termIdx >= terminals.length) {
            return { error: 'Terminal not found' };
        }
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
                    if (exec.commandLine?.value) { text += '> ' + exec.commandLine.value + '\n'; }
                    if (exec.output) {
                        try { for (const chunk of exec.output) { text += chunk; } } catch {}
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
        return { success: true, output, cwd, name: terminal.name };
    });

    connector.registerCommandHandler('execute_terminal', async (data: any) => {
        const command = data?.command;
        const terminalId = data?.terminalId;
        if (!command) { return { error: 'No command provided' }; }
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
        return { success: true, terminalName: terminal.name };
    });

    connector.registerCommandHandler('create_terminal', async () => {
        const terminal = vscode.window.createTerminal('Remote Terminal');
        terminal.show(false);
        const idx = vscode.window.terminals.indexOf(terminal);
        return { success: true, id: idx, name: terminal.name };
    });

    // ========== FILES COMMANDS ==========

    connector.registerCommandHandler('get_file_tree', async (data: any) => {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const targetPath = data?.path || workspacePath;
        if (!targetPath) { return { error: 'No workspace open' }; }
        try {
            const items: any[] = [];
            const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.env') { continue; }
                if (['node_modules', '__pycache__', '.git', 'dist', 'out', '.next', 'coverage'].includes(entry.name)) { continue; }
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
            return { success: true, items, root: workspacePath };
        } catch (e: any) {
            return { error: e.message };
        }
    });

    connector.registerCommandHandler('read_file', async (data: any) => {
        let filename = data?.filename || '';
        if (!filename) { return { error: 'No filename provided' }; }
        filename = filename.split('/').join('\\');
        let fileUri: vscode.Uri | null = null;
        if (filename.match(/^[a-zA-Z]:\\/)) {
            fileUri = vscode.Uri.file(filename);
        } else if (vscode.workspace.workspaceFolders?.length) {
            fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filename);
        }
        if (!fileUri) { return { error: 'Could not locate file' }; }
        try {
            const fileData = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(fileData).toString('utf-8');
            return { success: true, content, path: fileUri.fsPath };
        } catch {
            return { error: 'File not found' };
        }
    });

    // ========== GIT COMMANDS ==========

    const getWorkspacePath = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    connector.registerCommandHandler('get_git_status', async () => {
        const workspacePath = getWorkspacePath();
        if (!workspacePath) { return { success: false, error: 'No workspace open' }; }
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
                if (x !== ' ' && x !== '?') { staged.push({ name: fileName, path: filePath, status: x }); }
                if (y !== ' ' && y !== '?') { changed.push({ name: fileName, path: filePath, status: y === 'M' ? 'M' : y === 'D' ? 'D' : y }); }
                if (x === '?' && y === '?') { untracked.push({ name: fileName, path: filePath, status: 'U' }); }
            });
            return { success: true, branch, staged, changed, untracked };
        } catch (e: any) {
            return { success: false, error: e.message.includes('not a git repository') ? 'Not a git repository' : e.message };
        }
    });

    connector.registerCommandHandler('get_git_diff', async (data: any) => {
        const workspacePath = getWorkspacePath();
        try {
            const { execSync } = require('child_process');
            let diff = '';
            try {
                diff = execSync(`git diff -- "${data.file}"`, { cwd: workspacePath, encoding: 'utf-8' });
                if (!diff) { diff = execSync(`git diff --cached -- "${data.file}"`, { cwd: workspacePath, encoding: 'utf-8' }); }
                if (!diff) {
                    const content = fs.readFileSync(path.join(workspacePath, data.file), 'utf-8');
                    return { success: true, content };
                }
            } catch { diff = ''; }
            return { success: true, diff };
        } catch (e: any) {
            return { error: e.message };
        }
    });

    connector.registerCommandHandler('git_stage', async (data: any) => {
        const workspacePath = getWorkspacePath();
        try {
            const { execSync } = require('child_process');
            execSync(`git add "${data.file}"`, { cwd: workspacePath });
            return { success: true };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_unstage', async (data: any) => {
        const workspacePath = getWorkspacePath();
        try {
            const { execSync } = require('child_process');
            execSync(`git reset HEAD "${data.file}"`, { cwd: workspacePath });
            return { success: true };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_stage_all', async () => {
        const workspacePath = getWorkspacePath();
        try {
            const { execSync } = require('child_process');
            execSync('git add -A', { cwd: workspacePath });
            return { success: true };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_unstage_all', async () => {
        const workspacePath = getWorkspacePath();
        try {
            const { execSync } = require('child_process');
            execSync('git reset HEAD', { cwd: workspacePath });
            return { success: true };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_commit', async (data: any) => {
        const workspacePath = getWorkspacePath();
        if (!data?.message) { return { success: false, error: 'No commit message' }; }
        try {
            const { execSync } = require('child_process');
            const escapedMsg = data.message.replace(/"/g, '\\"');
            const result = execSync(`git commit -m "${escapedMsg}"`, { cwd: workspacePath, encoding: 'utf-8' });
            return { success: true, output: result };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_pull', async () => {
        const workspacePath = getWorkspacePath();
        try {
            const { execSync } = require('child_process');
            const result = execSync('git pull', { cwd: workspacePath, encoding: 'utf-8', timeout: 30000 });
            return { success: true, output: result };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_push', async () => {
        const workspacePath = getWorkspacePath();
        try {
            const { execSync } = require('child_process');
            const result = execSync('git push', { cwd: workspacePath, encoding: 'utf-8', timeout: 30000 });
            return { success: true, output: result };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    log('Registered terminal/files/git proxy command handlers');
}
