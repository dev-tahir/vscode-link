// Shared mutable state and utilities for all server modules
import * as http from 'http';
import * as vscode from 'vscode';
import WebSocket, { WebSocketServer } from 'ws';
import { ChatHistoryEntry, CapturedMessage, StorageFile } from './types';
import { InstanceRole } from './instanceManager';
import { CloudConnector } from './cloudConnector';

/**
 * Centralized server state object.
 * All server modules read/write through this single object
 * to avoid issues with primitive re-exports.
 */
export const state = {
    httpServer: null as http.Server | null,
    wsServer: null as WebSocketServer | null,
    wsClients: new Set<WebSocket>(),
    slaveConnections: new Map<string, WebSocket>(),
    chatHistory: [] as ChatHistoryEntry[],
    capturedMessages: [] as CapturedMessage[],
    chatStorageContent: [] as StorageFile[],
    currentWorkspaceHash: null as string | null,
    extensionStoragePath: null as string | null,
    outputChannel: null as vscode.OutputChannel | null,
    fileWatcherHandle: null as ReturnType<typeof import('fs').watch> | null,
    lastBroadcastTime: 0,
    lastInboxHash: '',
    backupPollInterval: null as NodeJS.Timeout | null,
    currentRole: 'standalone' as InstanceRole,
    currentHttpPort: 3847,
    currentWsPort: 3848,
    cloudConnector: null as CloudConnector | null,
    isCloudConnected: false,
    cloudSyncInterval: null as NodeJS.Timeout | null,
};

/** Log a message to console and output channel */
export function log(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[RemoteChatControl] ${msg}`);
    state.outputChannel?.appendLine(`[${timestamp}] ${msg}`);
}

/** Read HTTP request body as string */
export function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer | string) => body += chunk);
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
