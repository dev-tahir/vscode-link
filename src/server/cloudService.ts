// Cloud server connection management and proxy command handlers
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as inbox from '../inbox';
import { CloudConnector } from '../cloudConnector';
import { state, log } from './serverState';
import { sendToChat, handleCommandAction, getCurrentInbox } from './chatService';
import { startFileWatcher, stopFileWatcher } from './fileWatcher';

// Optional callbacks set by extension.ts
let onNotLinkedCallback: (() => void) | null = null;
let onAccountInfoCallback: ((name: string | null, email: string | null) => void) | null = null;

/**
 * Set callbacks from extension.ts (called once during activation)
 */
export function setCloudEventCallbacks(callbacks: {
    onNotLinked?: () => void;
    onAccountInfo?: (name: string | null, email: string | null) => void;
}) {
    onNotLinkedCallback = callbacks.onNotLinked || null;
    onAccountInfoCallback = callbacks.onAccountInfo || null;
}

/**
 * Get account name from active cloud connector, or null if not linked.
 */
export function getAccountName(): string | null {
    return state.cloudConnector?.accountName ?? null;
}

/**
 * Get account email from active cloud connector, or null if not linked.
 */
export function getAccountEmail(): string | null {
    return state.cloudConnector?.accountEmail ?? null;
}

/**
 * Connect to a remote cloud server (Cloud Run, etc.)
 * Extension becomes a WebSocket client
 */
export async function connectToCloud(serverUrl: string): Promise<boolean> {
    // Ensure server is initialized before connecting
    const { ensureInitialized } = require('./index');
    ensureInitialized();

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
        onNotLinked: onNotLinkedCallback || undefined,
        onAccountInfo: onAccountInfoCallback || undefined,
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
        
        // Start file watcher to detect chat session changes
        startFileWatcher();
        
        // Initial inbox sync - file watcher will handle subsequent updates
        if (state.cloudConnector?.connected) {
            state.cloudConnector.sendInboxUpdate();
        }
    } else {
        log('Failed to connect to cloud server');
    }

    return success;
}

/**
 * Connect to cloud server and link using a pre-supplied code (from vscode:// deep link).
 * Always re-links with fresh code, even if already connected.
 */
export async function connectToCloudWithCode(serverUrl: string, linkCode: string): Promise<boolean> {
    const { ensureInitialized } = require('./index');
    ensureInitialized();

    // Disconnect any existing connector so we start fresh
    if (state.cloudConnector) {
        state.cloudConnector.disconnect();
        state.cloudConnector = null;
        state.isCloudConnected = false;
    }

    // Create connector and pre-supply the link code so no prompt is shown
    state.cloudConnector = new CloudConnector(state.outputChannel!);
    
    const workspaceName = vscode.workspace.name ||
        vscode.workspace.workspaceFolders?.[0]?.name ||
        'VS Code';
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    state.cloudConnector.setWorkspaceInfo(
        state.currentWorkspaceHash || 'unknown',
        workspaceName,
        workspacePath
    );

    state.cloudConnector.setCallbacks({
        onInboxRequest: () => getCurrentInbox(),
        onSendChat: sendToChat,
        onCommandAction: handleCommandAction,
        onNotLinked: onNotLinkedCallback || undefined,
        onAccountInfo: onAccountInfoCallback || undefined,
        onSendAndWait: async (message, model?, sessionMode?, sessionId?, maxWait?) => {
            const beforeSend = Date.now();
            await sendToChat(message, model, sessionMode, sessionId);
            const effectiveWorkspace = state.currentWorkspaceHash || inbox.getCurrentWorkspaceHash();
            if (!effectiveWorkspace) { return { error: 'No workspace detected' }; }
            return await inbox.waitForNewReply(effectiveWorkspace, beforeSend, maxWait || 60000);
        }
    });

    registerProxyCommandHandlers(state.cloudConnector);

    // Clear any saved link token so the fresh code is used, then set the code
    await state.cloudConnector.clearLinkToken();
    state.cloudConnector.setPendingLinkCode(linkCode);

    const success = await state.cloudConnector.connect(serverUrl);
    state.isCloudConnected = success;

    if (success) {
        log('Connected to cloud server via deep link');
        startFileWatcher();
        if (state.cloudConnector?.connected) {
            state.cloudConnector.sendInboxUpdate();
        }
    } else {
        log('Deep link connection failed');
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
    
    // Stop file watcher when disconnecting
    stopFileWatcher();
    
    log('Disconnected from cloud server');
}

/** Check if connected to cloud */
export function isConnectedToCloud(): boolean {
    return state.isCloudConnected && state.cloudConnector?.connected === true;
}

/** Unlink account - clears saved link token and disconnects */
export async function unlinkAccount(): Promise<void> {
    if (state.cloudConnector) {
        await state.cloudConnector.clearLinkToken();
        state.cloudConnector.disconnect();
        state.cloudConnector = null;
    } else {
        // No current connector, just clear the token from settings
        const config = vscode.workspace.getConfiguration('remoteChatControl');
        await config.update('linkToken', undefined, vscode.ConfigurationTarget.Global);
    }
    state.isCloudConnected = false;
    stopFileWatcher();
    log('Account unlinked and disconnected');
}

/** Re-link account - clear link token and reconnect so extension prompts for new code */
export async function relinkAccount(): Promise<void> {
    const config = vscode.workspace.getConfiguration('remoteChatControl');
    const serverUrl = (config.get<string>('serverUrl') || config.get<string>('cloudServerUrl') || '').trim();
    
    await unlinkAccount();
    
    if (serverUrl) {
        log('Re-linking account with new code...');
        const success = await connectToCloud(serverUrl);
        if (!success) {
            log('Re-link connection failed');
        }
    }
}

/** Get terminal buffer for a specific terminal */
export function getTerminalBuffer(terminal: vscode.Terminal): string | undefined {
    return terminalOutputBuffers.get(terminal);
}

/** Re-export stripAnsi for use by httpRouter */
export { stripAnsi };

/** Initialize terminal data capture - call early so buffers are ready */
export { ensureTerminalDataCapture };

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
// Terminal output buffer - captures data written to terminals
const terminalOutputBuffers = new Map<vscode.Terminal, string>();
const MAX_TERMINAL_BUFFER = 50000; // ~50KB per terminal
let terminalDataListener: vscode.Disposable | null = null;

function ensureTerminalDataCapture() {
    if (terminalDataListener) { return; }
    terminalDataListener = { dispose: () => {} } as vscode.Disposable;
    
    log('[Terminal] Setting up terminal capture using shell integration...');
    
    try {
        // STABLE API: Track shell executions for command+output
        const startDisposable = vscode.window.onDidStartTerminalShellExecution?.(async (event) => {
            try {
                const terminal = event.terminal;
                const cmdLine = event.execution?.commandLine?.value;
                
                if (cmdLine) {
                    let output = `> ${cmdLine}\n`;
                    log(`[Terminal] Command started: ${cmdLine}`);
                    
                    // Read output as it streams
                    const stream = event.execution?.read;
                    if (stream) {
                        for await (const data of stream()) {
                            output += data;
                            log(`[Terminal] Received ${data.length} chars`);
                        }
                    }
                    
                    // Store in buffer
                    const existing = terminalOutputBuffers.get(terminal) || '';
                    let updated = existing + output;
                    if (updated.length > MAX_TERMINAL_BUFFER) {
                        updated = updated.slice(-MAX_TERMINAL_BUFFER);
                    }
                    terminalOutputBuffers.set(terminal, updated);
                    log(`[Terminal] Total buffered: ${updated.length} chars for "${terminal.name}"`);
                }
            } catch (err) {
                log(`[Terminal] Execution capture error: ${err}`);
            }
        });
        
        if (startDisposable) {
            terminalDataListener = startDisposable;
            log('[Terminal] ✓ Shell execution monitoring active');
        } else {
            log('[Terminal] ✗ Shell integration not available (requires VS Code 1.93+)');
        }

        // Clean up buffers when terminals close
        vscode.window.onDidCloseTerminal((terminal) => {
            terminalOutputBuffers.delete(terminal);
        });
    } catch (e) {
        log(`[Terminal] Capture setup error: ${e}`);
    }
}

/** Strip ANSI escape codes for clean text display */
function stripAnsi(str: string): string {
    return str
        // OSC sequences: ESC ] ... BEL  or  ESC ] ... ESC \\
        .replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g, '')
        // CSI sequences: ESC [ ... command (includes private modes like ?25h)
        .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
        // 2-byte ESC sequences (charset shifts, etc.)
        .replace(/\u001B[@-Z\\-_]/g, '')
        // Remove remaining C0 control chars except LF and TAB
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        // Normalize carriage returns
        .replace(/\r/g, '');
}

function registerProxyCommandHandlers(connector: CloudConnector) {
    // Ensure terminal data capture is active
    ensureTerminalDataCapture();

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
        log(`[Terminal] get_terminal_output: termIdx=${termIdx}, totalTerminals=${terminals.length}, bufferMapSize=${terminalOutputBuffers.size}`);
        if (termIdx < 0 || termIdx >= terminals.length) {
            return { error: 'Terminal not found' };
        }
        const terminal = terminals[termIdx];
        let output = '';
        let cwd = '';

        // Log buffer keys for debugging
        const bufferKeys = Array.from(terminalOutputBuffers.keys()).map(t => t.name);
        log(`[Terminal] Buffer keys: [${bufferKeys.join(', ')}], looking up: "${terminal.name}"`);

        // Try captured buffer first (most reliable)
        const buffered = terminalOutputBuffers.get(terminal);
        log(`[Terminal] Buffer found: ${!!buffered}, length: ${buffered?.length ?? 0}`);
        if (buffered) {
            output = stripAnsi(buffered);
            // Keep last ~200 lines
            const lines = output.split('\n');
            if (lines.length > 200) {
                output = lines.slice(-200).join('\n');
            }
        }

        // Try shell integration for CWD
        try {
            const shellIntegration = (terminal as any).shellIntegration;
            log(`[Terminal] Shell integration available: ${!!shellIntegration}`);
            if (shellIntegration) {
                cwd = shellIntegration.cwd?.fsPath || '';
            }
        } catch (e) {
            log(`Shell integration not available for terminal ${termIdx}: ${e}`);
        }

        if (!cwd) {
            cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        }
        log(`[Terminal] Returning output: ${output.length} chars, cwd: ${cwd}`);
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
        
        // Wait briefly for shell integration to activate on new terminals
        const shellIntegration = (terminal as any).shellIntegration;
        if (!shellIntegration) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Use executeCommand if available (captures output), otherwise sendText
        const si = (terminal as any).shellIntegration;
        if (si && typeof si.executeCommand === 'function') {
            log(`[Terminal] Using shellIntegration.executeCommand for: ${command}`);
            si.executeCommand(command);
        } else {
            log(`[Terminal] Shell integration not ready, using sendText for: ${command}`);
            terminal.sendText(command);
        }
        
        return { success: true, terminalName: terminal.name };
    });

    connector.registerCommandHandler('create_terminal', async () => {
        const terminal = vscode.window.createTerminal('Remote Terminal');
        terminal.show(false);
        const idx = vscode.window.terminals.indexOf(terminal);
        return { success: true, id: idx, name: terminal.name };
    });

    connector.registerCommandHandler('close_terminal', async (data: any) => {
        const terminalId = data?.terminalId;
        const terminals = vscode.window.terminals;
        if (terminalId !== undefined && terminalId >= 0 && terminalId < terminals.length) {
            const terminal = terminals[terminalId];
            terminal.dispose();
            return { success: true };
        }
        return { success: false, error: 'Terminal not found' };
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

    // Detect all git repositories in workspace
    connector.registerCommandHandler('get_git_repos', async () => {
        const workspacePath = getWorkspacePath();
        if (!workspacePath) { return { success: false, error: 'No workspace open', repos: [] }; }
        
        const repos: any[] = [];
        
        // Helper to check if a directory is the ROOT of a git repo (has .git folder directly)
        const isGitRepoRoot = (dir: string): boolean => {
            try {
                const gitDir = path.join(dir, '.git');
                const stat = fs.statSync(gitDir);
                return stat.isDirectory() || stat.isFile(); // .git can be a file in worktrees
            } catch {
                return false;
            }
        };
        
        // Helper to get display name from path
        const getDisplayName = (repoPath: string): string => {
            if (repoPath === workspacePath) {
                // For root, use the workspace folder name
                return path.basename(workspacePath);
            }
            // For subdirectories, use the folder name
            return path.basename(repoPath);
        };
        
        // Helper to get repo name from path (for URL routing)
        const getRepoName = (repoPath: string): string => {
            if (repoPath === workspacePath) return 'root';
            const relative = path.relative(workspacePath, repoPath);
            return relative.replace(/\\\\/g, '/');
        };
        
        // Check workspace root
        if (isGitRepoRoot(workspacePath)) {
            repos.push({ 
                path: workspacePath, 
                name: 'root', 
                displayName: getDisplayName(workspacePath)
            });
        }
        
        // Recursively search for git repos in subdirectories
        // But SKIP searching inside directories that are already git repos
        const searchForGitRepos = async (dir: string, depth: number = 0) => {
            if (depth > 3) return; // Limit depth to avoid performance issues
            
            try {
                const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    if (entry.name.startsWith('.')) continue; // Skip all hidden directories including .git
                    if (['node_modules', '__pycache__', 'dist', 'out', '.next', 'coverage', 'build'].includes(entry.name)) continue;
                    
                    const fullPath = path.join(dir, entry.name);
                    
                    // Check if this directory is the ROOT of a git repo (has .git directly inside)
                    if (isGitRepoRoot(fullPath)) {
                        const repoName = getRepoName(fullPath);
                        repos.push({ 
                            path: fullPath, 
                            name: repoName,
                            displayName: getDisplayName(fullPath)
                        });
                        // DON'T search subdirectories of this git repo
                        // This prevents finding nested repos inside repos
                    } else {
                        // Only continue searching if this is NOT a git repo root
                        await searchForGitRepos(fullPath, depth + 1);
                    }
                }
            } catch {}
        };
        
        await searchForGitRepos(workspacePath);
        return { success: true, repos };
    });

    connector.registerCommandHandler('get_git_status', async (data: any) => {
        const workspacePath = getWorkspacePath();
        if (!workspacePath) { return { success: false, error: 'No workspace open' }; }
        
        // Use provided repo path or default to workspace root
        const repoPath = data?.repoPath || workspacePath;
        
        try {
            const { execSync } = require('child_process');
            const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
            const statusOut = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8' });
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
            
            // Check commits ahead/behind remote
            let ahead = 0;
            let behind = 0;
            try {
                // First, try to fetch to get latest remote info (silently)
                try {
                    execSync('git fetch --quiet', { cwd: repoPath, timeout: 5000, stdio: 'pipe' });
                } catch {}
                
                // Get upstream branch
                const upstream = execSync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: repoPath, encoding: 'utf-8', stdio: 'pipe' }).trim();
                
                if (upstream) {
                    // Count commits ahead and behind
                    const aheadOut = execSync(`git rev-list --count ${upstream}..HEAD`, { cwd: repoPath, encoding: 'utf-8', stdio: 'pipe' }).trim();
                    const behindOut = execSync(`git rev-list --count HEAD..${upstream}`, { cwd: repoPath, encoding: 'utf-8', stdio: 'pipe' }).trim();
                    ahead = parseInt(aheadOut) || 0;
                    behind = parseInt(behindOut) || 0;
                }
            } catch {
                // No upstream or network issue, ignore
            }
            
            return { success: true, branch, staged, changed, untracked, repoPath, ahead, behind };
        } catch (e: any) {
            return { success: false, error: e.message.includes('not a git repository') ? 'Not a git repository' : e.message };
        }
    });

    connector.registerCommandHandler('get_git_diff', async (data: any) => {
        const workspacePath = getWorkspacePath();
        const repoPath = data?.repoPath || workspacePath;
        try {
            const { execSync } = require('child_process');
            let diff = '';
            try {
                diff = execSync(`git diff -- "${data.file}"`, { cwd: repoPath, encoding: 'utf-8' });
                if (!diff) { diff = execSync(`git diff --cached -- "${data.file}"`, { cwd: repoPath, encoding: 'utf-8' }); }
                if (!diff) {
                    const content = fs.readFileSync(path.join(repoPath, data.file), 'utf-8');
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
        const repoPath = data?.repoPath || workspacePath;
        try {
            const { execSync } = require('child_process');
            execSync(`git add "${data.file}"`, { cwd: repoPath });
            return { success: true };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_unstage', async (data: any) => {
        const workspacePath = getWorkspacePath();
        const repoPath = data?.repoPath || workspacePath;
        try {
            const { execSync } = require('child_process');
            execSync(`git reset HEAD "${data.file}"`, { cwd: repoPath });
            return { success: true };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_stage_all', async (data: any) => {
        const workspacePath = getWorkspacePath();
        const repoPath = data?.repoPath || workspacePath;
        try {
            const { execSync } = require('child_process');
            execSync('git add -A', { cwd: repoPath });
            return { success: true };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_unstage_all', async (data: any) => {
        const workspacePath = getWorkspacePath();
        const repoPath = data?.repoPath || workspacePath;
        try {
            const { execSync } = require('child_process');
            execSync('git reset HEAD', { cwd: repoPath });
            return { success: true };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_commit', async (data: any) => {
        const workspacePath = getWorkspacePath();
        const repoPath = data?.repoPath || workspacePath;
        if (!data?.message) { return { success: false, error: 'No commit message' }; }
        try {
            const { execSync } = require('child_process');
            const escapedMsg = data.message.replace(/"/g, '\\"');
            const result = execSync(`git commit -m "${escapedMsg}"`, { cwd: repoPath, encoding: 'utf-8' });
            return { success: true, output: result };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_pull', async (data: any) => {
        const workspacePath = getWorkspacePath();
        const repoPath = data?.repoPath || workspacePath;
        try {
            const { execSync } = require('child_process');
            const result = execSync('git pull', { cwd: repoPath, encoding: 'utf-8', timeout: 30000 });
            return { success: true, output: result };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_push', async (data: any) => {
        const workspacePath = getWorkspacePath();
        const repoPath = data?.repoPath || workspacePath;
        try {
            const { execSync } = require('child_process');
            const result = execSync('git push', { cwd: repoPath, encoding: 'utf-8', timeout: 30000 });
            return { success: true, output: result };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    connector.registerCommandHandler('git_sync', async (data: any) => {
        const workspacePath = getWorkspacePath();
        const repoPath = data?.repoPath || workspacePath;
        try {
            const { execSync } = require('child_process');
            let output = '';
            
            // Pull first
            try {
                const pullResult = execSync('git pull', { cwd: repoPath, encoding: 'utf-8', timeout: 30000 });
                output += 'Pull: ' + pullResult.trim() + '\n';
            } catch (e: any) {
                if (e.message.includes('Already up to date')) {
                    output += 'Already up to date\n';
                } else {
                    throw e;
                }
            }
            
            // Then push
            try {
                const pushResult = execSync('git push', { cwd: repoPath, encoding: 'utf-8', timeout: 30000 });
                output += 'Push: ' + pushResult.trim();
            } catch (e: any) {
                if (e.message.includes('Everything up-to-date')) {
                    output += 'Everything up-to-date';
                } else {
                    throw e;
                }
            }
            
            return { success: true, output: output.trim() };
        } catch (e: any) { return { success: false, error: e.message }; }
    });

    log('Registered terminal/files/git proxy command handlers');
}
