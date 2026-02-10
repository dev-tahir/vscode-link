// WebSocket server setup, connection handling, and broadcast functions
import WebSocket, { WebSocketServer } from 'ws';
import * as inbox from '../inbox';
import * as instanceManager from '../instanceManager';
import { InstanceInfo } from '../instanceManager';
import { WebSocketMessage, VSCodeInstance } from '../types';
import { state, log } from './serverState';

/** Start the WebSocket server on the given port */
export async function startWebSocketServerAsync(port: number): Promise<boolean> {
    if (state.wsServer) {
        log('WebSocket server already running');
        return true;
    }

    return new Promise((resolve) => {
        state.currentWsPort = port;
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
                state.wsServer = server;
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

/** Set up WebSocket event handlers for new connections */
function setupWebSocketHandlers(server: WebSocketServer) {
    server.on('connection', (ws: WebSocket) => {
        log('WebSocket client connected');
        state.wsClients.add(ws);

        // Track if this is a slave VS Code instance connection
        let clientWorkspaceHash: string | null = null;

        // Send initial status with role info
        sendToClient(ws, {
            type: 'status',
            data: {
                connected: true,
                workspaceHash: state.currentWorkspaceHash,
                role: state.currentRole,
                instances: instanceManager.getAllInstances().map(inst => ({
                    id: inst.workspaceHash,
                    workspaceHash: inst.workspaceHash,
                    workspaceName: inst.workspaceName,
                    workspacePath: inst.workspacePath,
                    lastActive: inst.lastActive,
                    isActive: inst.workspaceHash === state.currentWorkspaceHash
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
                        state.slaveConnections.set(clientWorkspaceHash, ws);
                    }

                    const updatedInstances = instanceManager.registerInstance(msg.instance);
                    log(`Slave instance registered: ${msg.instance.workspaceName}`);

                    broadcastInstancesToClients(updatedInstances);
                    broadcastToSlaves({
                        type: 'instances_update',
                        instances: updatedInstances
                    });
                    return;
                }

                // Handle slave instance unregistration
                if (msg.type === 'unregister_instance' && msg.workspaceHash) {
                    state.slaveConnections.delete(msg.workspaceHash);
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
            state.wsClients.delete(ws);

            // If this was a slave connection, unregister it
            if (clientWorkspaceHash) {
                state.slaveConnections.delete(clientWorkspaceHash);
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
            state.wsClients.delete(ws);
            if (clientWorkspaceHash) {
                state.slaveConnections.delete(clientWorkspaceHash);
            }
        });
    });
}

/** Handle incoming WebSocket messages */
function handleWebSocketMessage(ws: WebSocket, msg: any) {
    switch (msg.type) {
        case 'ping':
            sendToClient(ws, { type: 'status', data: { pong: true }, timestamp: Date.now() });
            break;
        case 'refresh':
            if (state.currentWorkspaceHash) {
                const data = inbox.getInboxForWorkspace(state.currentWorkspaceHash);
                sendToClient(ws, { type: 'inbox_update', data, timestamp: Date.now() });
            }
            break;
    }
}

/** Send a message to a single WebSocket client */
export function sendToClient(ws: WebSocket, msg: WebSocketMessage) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

/** Broadcast a message to all connected WebSocket clients */
export function broadcastToClients(msg: WebSocketMessage) {
    state.wsClients.forEach(ws => sendToClient(ws, msg));
}

/** Broadcast a message to all slave VS Code instances */
export function broadcastToSlaves(msg: any) {
    state.slaveConnections.forEach((ws, hash) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    });
}

/** Broadcast the instances list to all webview clients */
export function broadcastInstancesToClients(instances: InstanceInfo[]) {
    const vsCodeInstances: VSCodeInstance[] = instances.map(inst => ({
        id: inst.workspaceHash,
        workspaceHash: inst.workspaceHash,
        workspaceName: inst.workspaceName,
        workspacePath: inst.workspacePath,
        lastActive: inst.lastActive,
        isActive: inst.workspaceHash === state.currentWorkspaceHash
    }));

    broadcastToClients({
        type: 'instances_update',
        data: { instances: vsCodeInstances },
        timestamp: Date.now()
    });
}
