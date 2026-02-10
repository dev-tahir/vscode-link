// File watching and backup polling for chat session changes
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as inbox from './inbox';
import { state, log } from './serverState';
import { broadcastToClients } from './wsHandler';

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
                // Debounce - don't broadcast more than once per 200ms
                const now = Date.now();
                if (now - state.lastBroadcastTime < 200) return;
                state.lastBroadcastTime = now;

                log(`File changed: ${filename}, broadcasting update...`);

                setTimeout(() => {
                    broadcastInboxUpdate();
                    // Also push to cloud immediately on file change
                    if (state.cloudConnector?.connected) {
                        state.cloudConnector.sendInboxUpdate();
                    }
                }, 100); // Minimal delay to ensure file is fully written
            }
        });

        log('File watcher started successfully');
    } catch (e) {
        log(`Error starting file watcher: ${e}`);
    }
}

/** Stop the file watcher */
export function stopFileWatcher() {
    if (state.fileWatcherHandle) {
        state.fileWatcherHandle.close();
        state.fileWatcherHandle = null;
        log('File watcher stopped');
    }
}

/** Broadcast current inbox state to all WebSocket clients */
export async function broadcastInboxUpdate() {
    if (state.wsClients.size === 0) return;

    try {
        const inboxData = inbox.getInboxForWorkspace(state.currentWorkspaceHash!);
        broadcastToClients({
            type: 'inbox_update',
            data: inboxData,
            timestamp: Date.now()
        });
        log(`Broadcasted inbox update to ${state.wsClients.size} clients`);
    } catch (e) {
        log(`Error broadcasting update: ${e}`);
    }
}

/** Start backup polling - broadcasts only if inbox has actually changed */
export function startBackupPoll() {
    stopBackupPoll();

    state.backupPollInterval = setInterval(() => {
        if (state.wsClients.size === 0) return; // No clients, skip

        try {
            const inboxData = inbox.getInboxForWorkspace(state.currentWorkspaceHash!);
            // Create a simple hash based on session count and total message count
            const sessions = inboxData?.sessions || [];
            const totalMsgs = sessions.reduce((sum: number, s: any) => sum + (s.messages?.length || 0), 0);
            const hash = `${sessions.length}-${totalMsgs}`;

            if (hash !== state.lastInboxHash) {
                state.lastInboxHash = hash;
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
    }, 1000); // Check every second
}

/** Stop the backup poll interval */
export function stopBackupPoll() {
    if (state.backupPollInterval) {
        clearInterval(state.backupPollInterval);
        state.backupPollInterval = null;
        log('Backup poll stopped');
    }
}
