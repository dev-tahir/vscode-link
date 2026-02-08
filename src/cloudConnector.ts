/**
 * Cloud Server Connector
 * 
 * Connects the VS Code extension TO a remote cloud server (Cloud Run, etc.)
 * The extension becomes a WebSocket client, sending inbox updates and
 * receiving commands from the cloud server.
 */

import * as vscode from 'vscode';
import WebSocket from 'ws';
import * as inbox from './inbox';

export interface CloudServerConfig {
    serverUrl: string;          // e.g., wss://your-app.run.app/extension
    reconnectInterval: number;  // ms
    heartbeatInterval: number;  // ms
}

interface CommandHandler {
    (data: any): Promise<any>;
}

export class CloudConnector {
    private config: CloudServerConfig;
    private ws: WebSocket | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private isRunning = false;
    private isConnected = false;
    private outputChannel: vscode.OutputChannel;
    
    private workspaceHash: string;
    private workspaceName: string;
    private workspacePath: string;
    
    // Command handlers
    private commandHandlers: Map<string, CommandHandler> = new Map();
    
    // Callbacks
    private onInboxRequestCallback: (() => any) | null = null;
    private onSendChatCallback: ((message: string, model?: string, sessionMode?: string, sessionId?: string) => Promise<any>) | null = null;
    private onCommandActionCallback: ((action: string) => Promise<void>) | null = null;
    private onSendAndWaitCallback: ((message: string, model?: string, sessionMode?: string, sessionId?: string, maxWait?: number) => Promise<any>) | null = null;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.config = {
            serverUrl: '',
            reconnectInterval: 5000,
            heartbeatInterval: 30000
        };
        
        this.workspaceHash = '';
        this.workspaceName = '';
        this.workspacePath = '';
    }

    private log(msg: string) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[CloudConnector] ${msg}`);
        this.outputChannel?.appendLine(`[${timestamp}] [Cloud] ${msg}`);
    }

    /**
     * Set workspace info for registration
     */
    setWorkspaceInfo(hash: string, name: string, path: string) {
        this.workspaceHash = hash;
        this.workspaceName = name;
        this.workspacePath = path;
    }

    /**
     * Set callbacks for handling commands from cloud server
     */
    setCallbacks(callbacks: {
        onInboxRequest: () => any;
        onSendChat: (message: string, model?: string, sessionMode?: string, sessionId?: string) => Promise<any>;
        onCommandAction: (action: string) => Promise<void>;
        onSendAndWait?: (message: string, model?: string, sessionMode?: string, sessionId?: string, maxWait?: number) => Promise<any>;
    }) {
        this.onInboxRequestCallback = callbacks.onInboxRequest;
        this.onSendChatCallback = callbacks.onSendChat;
        this.onCommandActionCallback = callbacks.onCommandAction;
        this.onSendAndWaitCallback = callbacks.onSendAndWait || null;
    }

    /**
     * Register a custom command handler
     */
    registerCommandHandler(command: string, handler: CommandHandler) {
        this.commandHandlers.set(command, handler);
    }

    /**
     * Connect to cloud server
     */
    async connect(serverUrl: string): Promise<boolean> {
        if (this.isRunning) {
            this.log('Already connected or connecting');
            return this.isConnected;
        }

        // Ensure URL ends with /extension for the extension endpoint
        let wsUrl = serverUrl;
        if (!wsUrl.includes('/extension')) {
            wsUrl = wsUrl.replace(/\/$/, '') + '/extension';
        }
        
        // Convert http(s) to ws(s) if needed
        wsUrl = wsUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
        
        this.config.serverUrl = wsUrl;
        this.isRunning = true;
        
        this.log(`Connecting to cloud server: ${wsUrl}`);
        
        return new Promise((resolve) => {
            this.createConnection(resolve);
        });
    }

    private createConnection(onFirstConnect?: (success: boolean) => void) {
        if (!this.isRunning) return;

        try {
            this.ws = new WebSocket(this.config.serverUrl);
            
            this.ws.on('open', () => {
                this.log('Connected to cloud server');
                this.isConnected = true;
                
                // Clear reconnect timer
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
                
                // Start heartbeat
                this.startHeartbeat();
                
                if (onFirstConnect) {
                    onFirstConnect(true);
                }
                
                // Show notification
                vscode.window.showInformationMessage(`Connected to cloud server`);
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                this.handleMessage(data);
            });

            this.ws.on('close', () => {
                this.log('Disconnected from cloud server');
                this.isConnected = false;
                this.stopHeartbeat();
                
                if (onFirstConnect) {
                    onFirstConnect(false);
                    onFirstConnect = undefined; // Only call once
                }
                
                // Reconnect if still running
                if (this.isRunning) {
                    this.scheduleReconnect();
                }
            });

            this.ws.on('error', (err) => {
                this.log(`WebSocket error: ${err.message}`);
                
                if (onFirstConnect) {
                    onFirstConnect(false);
                    onFirstConnect = undefined;
                }
            });

        } catch (e: any) {
            this.log(`Connection error: ${e.message}`);
            if (onFirstConnect) {
                onFirstConnect(false);
            }
            this.scheduleReconnect();
        }
    }

    private handleMessage(data: WebSocket.Data) {
        try {
            const msg = JSON.parse(data.toString());
            this.log(`Received: ${msg.type}`);
            
            switch (msg.type) {
                case 'request_registration':
                    this.sendRegistration();
                    break;
                    
                case 'registration_confirmed':
                    this.log('Registration confirmed by server');
                    // Send initial inbox state
                    this.sendInboxUpdate();
                    break;
                    
                case 'request_inbox':
                    this.sendInboxUpdate();
                    break;
                    
                case 'execute_command':
                    this.handleCommand(msg);
                    break;
                    
                case 'ping':
                    this.send({ type: 'pong', timestamp: Date.now() });
                    break;
                    
                case 'send_message':
                    // Browser wants to send a chat message
                    if (this.onSendChatCallback && msg.message) {
                        this.onSendChatCallback(msg.message, msg.model, msg.sessionMode, msg.sessionId);
                    }
                    break;
                    
                case 'command_action':
                    // Browser wants to approve/skip command
                    if (this.onCommandActionCallback && msg.action) {
                        this.onCommandActionCallback(msg.action);
                    }
                    break;
            }
        } catch (e: any) {
            this.log(`Message parse error: ${e.message}`);
        }
    }

    private sendRegistration() {
        this.send({
            type: 'register_extension',
            workspaceHash: this.workspaceHash,
            workspaceName: this.workspaceName,
            workspacePath: this.workspacePath,
            timestamp: Date.now()
        });
    }

    private async handleCommand(msg: any) {
        const { command, data, requestId } = msg;
        this.log(`Executing command: ${command}${requestId ? ` (reqId: ${requestId})` : ''}`);
        
        // Check for registered handlers
        const handler = this.commandHandlers.get(command);
        if (handler) {
            try {
                const result = await handler(data);
                if (requestId) {
                    this.sendProxyResponse(requestId, result);
                }
            } catch (e: any) {
                this.log(`Command handler error: ${e.message}`);
                if (requestId) {
                    this.sendProxyResponse(requestId, { error: e.message });
                }
            }
            return;
        }
        
        // Built-in commands
        let result: any = null;
        switch (command) {
            case 'send_chat':
                if (this.onSendChatCallback) {
                    result = await this.onSendChatCallback(
                        data.message,
                        data.model,
                        data.sessionMode,
                        data.sessionId
                    );
                }
                break;
                
            case 'command_action':
                if (this.onCommandActionCallback) {
                    await this.onCommandActionCallback(data.action);
                    result = { success: true };
                }
                break;
                
            case 'get_inbox':
                if (this.onInboxRequestCallback) {
                    result = this.onInboxRequestCallback();
                }
                // Also send as inbox_update so it gets cached
                this.sendInboxUpdate();
                break;
                
            case 'get_latest_reply':
                // Forward to inbox request callback - caller will handle
                if (this.onInboxRequestCallback) {
                    result = this.onInboxRequestCallback();
                }
                break;
                
            case 'send_and_wait':
                if (this.onSendAndWaitCallback) {
                    result = await this.onSendAndWaitCallback(
                        data.message,
                        data.model,
                        data.sessionMode,
                        data.sessionId,
                        data.maxWait
                    );
                } else if (this.onSendChatCallback) {
                    // Fallback: just send without waiting
                    result = await this.onSendChatCallback(
                        data.message,
                        data.model,
                        data.sessionMode,
                        data.sessionId
                    );
                }
                break;
                
            default:
                this.log(`Unknown command: ${command}`);
                result = { error: `Unknown command: ${command}` };
        }
        
        // Send response back if requestId was provided
        if (requestId) {
            this.sendProxyResponse(requestId, result);
        }
    }

    /**
     * Send a response back to the server for a proxied request
     */
    private sendProxyResponse(requestId: number, data: any) {
        this.send({
            type: 'proxy_response',
            requestId,
            data,
            timestamp: Date.now()
        });
    }

    /**
     * Send inbox update to cloud server
     */
    sendInboxUpdate() {
        if (!this.isConnected || !this.onInboxRequestCallback) return;
        
        try {
            const inboxData = this.onInboxRequestCallback();
            this.send({
                type: 'inbox_update',
                data: inboxData,
                timestamp: Date.now()
            });
        } catch (e: any) {
            this.log(`Failed to send inbox update: ${e.message}`);
        }
    }

    /**
     * Send a message to the cloud server
     */
    send(msg: any) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    private startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.isConnected) {
                this.send({ type: 'heartbeat', timestamp: Date.now() });
            }
        }, this.config.heartbeatInterval);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimer || !this.isRunning) return;
        
        this.log(`Reconnecting in ${this.config.reconnectInterval}ms...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.createConnection();
        }, this.config.reconnectInterval);
    }

    /**
     * Disconnect from cloud server
     */
    disconnect() {
        this.isRunning = false;
        this.stopHeartbeat();
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.isConnected = false;
        this.log('Disconnected from cloud server');
    }

    /**
     * Check if connected
     */
    get connected(): boolean {
        return this.isConnected;
    }
}
