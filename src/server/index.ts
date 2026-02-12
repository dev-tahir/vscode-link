// WebSocket and HTTP Server for Remote Chat Control - Orchestrator
// This module ties together all server sub-modules and exposes the public API.
import * as vscode from 'vscode';
import * as path from 'path';
import * as instanceManager from '../instanceManager';
import { InstanceRole } from '../instanceManager';
import { state, log } from './serverState';
import { startFileWatcher, stopFileWatcher } from './fileWatcher';
import { startWebSocketServerAsync, broadcastToClients, broadcastInstancesToClients } from './wsHandler';
import { startHTTPServerAsync } from './httpRouter';

// ========== Re-exports (public API consumed by extension.ts and instanceManager.ts) ==========
export { broadcastToClients } from './wsHandler';
export { sendToChat, getChatHistory, getCurrentInbox, handleCommandAction } from './chatService';
export { connectToCloud, disconnectFromCloud, isConnectedToCloud } from './cloudService';
import { ensureTerminalDataCapture } from './cloudService';

// Store extension context for lazy initialization
let extensionContext: vscode.ExtensionContext | null = null;
let isInitialized = false;

/** Get the HTTP port this instance is running on */
export function getCurrentPort(): number {
    return state.currentHttpPort;
}

/** Get the current workspace hash */
export function getWorkspaceHash() {
    return state.currentWorkspaceHash;
}

/** Store extension context and output channel (call once on activation) */
export function setExtensionContext(context: vscode.ExtensionContext, channel: vscode.OutputChannel) {
    extensionContext = context;
    state.outputChannel = channel;
    // Start capturing terminal output early so data is ready
    try {
        ensureTerminalDataCapture();
    } catch (e) {
        // Don't let terminal capture failure prevent activation
        console.error('[RemoteChatControl] Terminal capture init failed:', e);
    }
}

/** Initialize the server module (called lazily when needed) */
export function ensureInitialized() {
    if (isInitialized || !extensionContext) return;
    isInitialized = true;

    const context = extensionContext;
    state.extensionStoragePath = context.storageUri?.fsPath || context.globalStorageUri?.fsPath || '';

    // Initialize instance manager
    instanceManager.initInstanceManager(state.outputChannel!);

    // Extract workspace hash from storage path
    const storagePathParts = state.extensionStoragePath.split(path.sep);
    const wsIdx = storagePathParts.indexOf('workspaceStorage');
    if (wsIdx >= 0 && storagePathParts[wsIdx + 1]) {
        state.currentWorkspaceHash = storagePathParts[wsIdx + 1];
        log(`Detected workspace hash: ${state.currentWorkspaceHash}`);

        // Register with instance manager
        const workspaceName = vscode.workspace.name ||
            vscode.workspace.workspaceFolders?.[0]?.name ||
            'VS Code';
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        instanceManager.setLocalInstance(state.currentWorkspaceHash, workspaceName, workspacePath);

        // File watcher will start when connecting to cloud server
    }

    // Set up role change handler
    instanceManager.onRoleChange((role: InstanceRole, lockData: any) => {
        state.currentRole = role;
        log(`Role changed to: ${role}`);

        if (role === 'slave' && lockData) {
            broadcastToClients({
                type: 'status',
                data: {
                    connected: true,
                    workspaceHash: state.currentWorkspaceHash,
                    role: 'slave',
                    masterPort: lockData.masterPort
                },
                timestamp: Date.now()
            });
        }
    });

    // Set up instances update handler
    instanceManager.onInstancesUpdate((instances: any[]) => {
        broadcastInstancesToClients(instances);
    });
}

/** Start HTTP and WebSocket servers */
export async function startServer(port: number = 3847, wsPort: number = 3848) {
    log('Starting server...');

    // Try to start on the default port first
    let success = await tryStartServers(port, wsPort);

    if (success) {
        // We got the master port
        state.currentRole = 'master';
        await instanceManager.tryBecomeMaster(port, wsPort);
        vscode.window.showInformationMessage(`Remote Chat Control: Master (port ${port})`);
    } else {
        // Master port taken - find an alternative
        log('Master port taken, finding alternative...');
        state.currentRole = 'slave';

        for (let tryPort = port + 2; tryPort < port + 100; tryPort += 2) {
            success = await tryStartServers(tryPort, tryPort + 1);
            if (success) {
                log(`Started on alternative port ${tryPort}`);

                // Try to connect to master for coordination (non-blocking)
                instanceManager.connectAsSlave().catch((e: any) => {
                    log(`Master coordination failed: ${e}`);
                });

                vscode.window.showInformationMessage(`Remote Chat Control: Running (port ${tryPort})`);
                return;
            }
        }

        vscode.window.showErrorMessage('Remote Chat Control: Could not find available port');
    }
}

/** Stop all servers and clean up */
export function stopServer() {
    // Clean up instance manager
    instanceManager.cleanup();

    // Stop file watcher
    stopFileWatcher();

    // Stop HTTP server
    if (state.httpServer) {
        state.httpServer.close();
        state.httpServer = null;
        log('HTTP server stopped');
    }

    // Stop WebSocket server
    if (state.wsServer) {
        state.wsServer.close();
        state.wsServer = null;
        log('WebSocket server stopped');
    }

    state.wsClients.clear();
    state.slaveConnections.clear();
    state.currentRole = 'standalone';
}

// ========== Internal Helpers ==========

/** Try to start both HTTP and WebSocket servers on given ports */
async function tryStartServers(httpPort: number, wsPort: number): Promise<boolean> {
    const httpSuccess = await startHTTPServerAsync(httpPort);
    if (!httpSuccess) {
        return false;
    }

    const wsSuccess = await startWebSocketServerAsync(wsPort);
    if (!wsSuccess) {
        // Clean up HTTP server if WS fails
        if (state.httpServer) {
            state.httpServer.close();
            state.httpServer = null;
        }
        return false;
    }

    return true;
}
