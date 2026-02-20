// File watching and backup polling for chat session changes
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as inbox from '../inbox';
import { state, log } from './serverState';
import { broadcastToClients } from './wsHandler';

// Debounce window: 3 s — prevents flooding ngrok/cloud on rapid VS Code writes
const DEBOUNCE_MS = 3000;
// Backup poll interval: 10 s — catches changes that fs.watch misses
const BACKUP_POLL_MS = 10000;

/** Watch chatSessions folder for changes and trigger broadcasts */
export function startFileWatcher() {
    if (!state.currentWorkspaceHash) return;

    const chatSessionsPath = path.join(
        os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage',
        state.currentWorkspaceHash, 'chatSessions'
    );

    if (!fs.existsSync(chatSessionsPath)) {
        log(`Chat sessions folder not found: ${chatSessionsPath}`);
        return;
    }

    log(`Starting file watcher on: ${chatSessionsPath}`);

    try {
        state.fileWatcherHandle = fs.watch(chatSessionsPath, { persistent: false, recursive: true }, (eventType, filename) => {
            if (filename && (filename.endsWith('.json') || filename.endsWith('.jsonl'))) {
                // Debounce — don't broadcast more than once per DEBOUNCE_MS
                const now = Date.now();
                if (now - state.lastBroadcastTime < DEBOUNCE_MS) return;
                state.lastBroadcastTime = now;

                log(`File changed: ${filename}, broadcasting update...`);

                // 100 ms delay to let the file finish writing, then one read shared
                // between WS broadcast AND cloud push — no double read.
                setTimeout(() => broadcastInboxUpdateAndSync(), 100);
            }
        });

        log('File watcher started successfully');
    } catch (e) {
        log(`Error starting file watcher: ${e}`);
        state.fileWatcherHandle = null;
    }

    // Backup poll: fires every BACKUP_POLL_MS and triggers a broadcast only when
    // fs.watch appears to have stalled (no broadcast in the last poll window).
    if (!state.backupPollInterval) {
        state.backupPollInterval = setInterval(() => {
            const idleSince = Date.now() - state.lastBroadcastTime;
            if (idleSince > BACKUP_POLL_MS * 1.5) {
                // Only broadcast if there are clients waiting
                if (state.wsClients.size > 0 || state.cloudConnector?.connected) {
                    broadcastInboxUpdateAndSync();
                }
            }
        }, BACKUP_POLL_MS);
    }
}

/** Stop the file watcher and backup poll */
export function stopFileWatcher() {
    if (state.fileWatcherHandle) {
        state.fileWatcherHandle.close();
        state.fileWatcherHandle = null;
        log('File watcher stopped');
    }
    if (state.backupPollInterval) {
        clearInterval(state.backupPollInterval);
        state.backupPollInterval = null;
        log('Backup poll stopped');
    }
}

/**
 * Read inbox ONCE, then broadcast to WS clients and push to cloud.
 * Sharing the single read avoids the previous double-parse on every file change.
 */
async function broadcastInboxUpdateAndSync() {
    const hasWsClients = state.wsClients.size > 0;
    const hasCloud = !!state.cloudConnector?.connected;
    if (!hasWsClients && !hasCloud) return;

    try {
        const inboxData = inbox.getInboxForWorkspace(state.currentWorkspaceHash!);

        if (hasWsClients) {
            broadcastToClients({
                type: 'inbox_update',
                data: inboxData,
                timestamp: Date.now()
            });
            log(`Broadcasted inbox update to ${state.wsClients.size} clients`);
        }

        // Reuse the already-read inboxData for cloud push instead of re-reading
        if (hasCloud && state.cloudConnector) {
            state.cloudConnector.sendInboxUpdateWithData(inboxData);
        }
    } catch (e) {
        log(`Error broadcasting update: ${e}`);
    }
}

/** Broadcast current inbox state to all WebSocket clients (external callers) */
export async function broadcastInboxUpdate() {
    await broadcastInboxUpdateAndSync();
}
