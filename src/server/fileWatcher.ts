// File watching and backup polling for chat session changes
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as inbox from '../inbox';
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
