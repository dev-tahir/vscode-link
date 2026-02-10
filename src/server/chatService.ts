// Chat operations, inbox helpers, and storage scanning
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as inbox from '../inbox';
import { ChatHistoryEntry, VSCodeInstance, StorageFile } from '../types';
import { state, log } from './serverState';
import { broadcastToClients } from './wsHandler';

/** Send a message to the VS Code chat panel */
export async function sendToChat(
    message: string,
    model?: string,
    sessionMode?: string,
    sessionId?: string
): Promise<{ result: string; note?: string }> {
    log(`Sending message: "${message}"${model ? ` (model: ${model})` : ''}${sessionMode ? ` (mode: ${sessionMode})` : ''}${sessionId ? ` (sessionId: ${sessionId})` : ''}`);

    state.chatHistory.push({
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
        } else if (sessionMode === 'session' && sessionId) {
            log(`Target session: ${sessionId}`);
            note = 'Sent to session';
        }

        // Use the VS Code Chat API to send message directly
        try {
            await vscode.commands.executeCommand('workbench.action.chat.open', {
                query: message,
                isPartialQuery: false
            });
            log('Message sent via chat.open API');
        } catch (e1) {
            log(`chat.open failed: ${e1}, trying alternative...`);

            try {
                await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                await new Promise(r => setTimeout(r, 300));
                await vscode.commands.executeCommand('editor.action.selectAll');
                await new Promise(r => setTimeout(r, 100));
                await vscode.commands.executeCommand('type', { text: message });
                await new Promise(r => setTimeout(r, 200));
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

/** Handle command action (approve/skip) via PowerShell key simulation */
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

/** Load inbox for current workspace */
export async function loadInbox() {
    if (!state.currentWorkspaceHash) return null;
    return inbox.getInboxForWorkspace(state.currentWorkspaceHash);
}

/** Get current inbox data, auto-detecting workspace if needed */
export function getCurrentInbox() {
    let hash = state.currentWorkspaceHash;
    if (!hash) {
        hash = inbox.getCurrentWorkspaceHash();
        if (hash) {
            state.currentWorkspaceHash = hash;
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

/** Get chat history */
export function getChatHistory() {
    return state.chatHistory;
}

/** Get all VS Code instances from workspace storage */
export function getAllVSCodeInstances(): VSCodeInstance[] {
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
                isActive: ws.hash === state.currentWorkspaceHash
            });
        }
    } catch (e) {
        log(`Error getting instances: ${e}`);
    }

    return instances;
}

/** Scan chat storage directories for chat-related files */
export async function scanChatStorage() {
    log('Scanning for chat storage files...');
    state.chatStorageContent = [];

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

    log(`Found ${state.chatStorageContent.length} potential chat-related files`);
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
            if (file.isFile() && (file.name.endsWith('.json') || file.name.endsWith('.jsonl'))) {
                const filePath = path.join(folderPath, file.name);
                const stats = fs.statSync(filePath);

                state.chatStorageContent.push({
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
