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
    private linkToken: string | null = null;
    private pendingLinkCode: string | null = null; // Code pre-supplied via vscode:// deep link
    private _accountName: string | null = null;
    private _accountEmail: string | null = null;
    
    // Command handlers
    private commandHandlers: Map<string, CommandHandler> = new Map();
    
    // Callbacks
    private onInboxRequestCallback: (() => any) | null = null;
    private onSendChatCallback: ((message: string, model?: string, sessionMode?: string, sessionId?: string) => Promise<any>) | null = null;
    private onCommandActionCallback: ((action: string) => Promise<void>) | null = null;
    private onSendAndWaitCallback: ((message: string, model?: string, sessionMode?: string, sessionId?: string, maxWait?: number) => Promise<any>) | null = null;
    private onNotLinkedCallback: (() => void) | null = null;
    private onAccountInfoCallback: ((name: string | null, email: string | null) => void) | null = null;

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
        onNotLinked?: () => void;
        onAccountInfo?: (name: string | null, email: string | null) => void;
    }) {
        this.onInboxRequestCallback = callbacks.onInboxRequest;
        this.onSendChatCallback = callbacks.onSendChat;
        this.onCommandActionCallback = callbacks.onCommandAction;
        this.onSendAndWaitCallback = callbacks.onSendAndWait || null;
        this.onNotLinkedCallback = callbacks.onNotLinked || null;
        this.onAccountInfoCallback = callbacks.onAccountInfo || null;
    }

    /**
     * Get account name (null if not linked/signed in)
     */
    get accountName(): string | null {
        return this._accountName;
    }

    /**
     * Get account email (null if not linked/signed in)
     */
    get accountEmail(): string | null {
        return this._accountEmail;
    }

    /**
     * Register a custom command handler
     */
    registerCommandHandler(command: string, handler: CommandHandler) {
        this.commandHandlers.set(command, handler);
    }

    /**
     * Load link token from VS Code settings
     */
    private async loadLinkToken() {
        const config = vscode.workspace.getConfiguration('remoteChatControl');
        this.linkToken = config.get<string>('linkToken') || null;
        if (this.linkToken) {
            this.log('Loaded existing link token from settings');
        }
    }

    /**
     * Save link token to VS Code settings
     */
    private async saveLinkToken(token: string) {
        const config = vscode.workspace.getConfiguration('remoteChatControl');
        await config.update('linkToken', token, vscode.ConfigurationTarget.Global);
        this.log('Saved link token to settings');
    }

    /**
     * Clear link token (for unlinking)
     */
    async clearLinkToken() {
        const config = vscode.workspace.getConfiguration('remoteChatControl');
        await config.update('linkToken', undefined, vscode.ConfigurationTarget.Global);
        this.linkToken = null;
        this.log('Cleared link token');
    }

    /**
     * Connect to cloud server
     */
    async connect(serverUrl: string): Promise<boolean> {
        if (this.isRunning) {
            this.log('Already connected or connecting');
            return this.isConnected;
        }

        // Load link token from settings
        await this.loadLinkToken();

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
                    this._accountName = msg.userName || null;
                    this._accountEmail = msg.userEmail || null;
                    if (this.onAccountInfoCallback) {
                        this.onAccountInfoCallback(this._accountName, this._accountEmail);
                    }
                    // Send initial inbox state
                    this.sendInboxUpdate();
                    break;
                    
                case 'link_confirmed':
                    this.log('Link confirmed! Received link token');
                    this.linkToken = msg.linkToken;
                    this._accountName = msg.userName || null;
                    this._accountEmail = msg.userEmail || null;
                    // Save link token to settings
                    this.saveLinkToken(msg.linkToken);
                    if (this.onAccountInfoCallback) {
                        this.onAccountInfoCallback(this._accountName, this._accountEmail);
                    }
                    vscode.window.showInformationMessage('Successfully linked to your account!');
                    // Send initial inbox state
                    this.sendInboxUpdate();
                    break;
                    
                case 'link_error':
                    this.log(`Link error: ${msg.error}`);
                    vscode.window.showErrorMessage(`Link failed: ${msg.error}`);
                    // Try again with registration
                    this.sendRegistration();
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

    /**
     * Pre-supply a link code (from vscode:// URI) to skip the prompt
     */
    setPendingLinkCode(code: string) {
        this.pendingLinkCode = code.trim().toUpperCase();
        this.log(`Pending link code set: ${this.pendingLinkCode}`);
    }

    private async sendRegistration() {
        // If we have a link token, use it to register
        if (this.linkToken) {
            this.send({
                type: 'register_extension',
                linkToken: this.linkToken,
                workspaceHash: this.workspaceHash,
                workspaceName: this.workspaceName,
                workspacePath: this.workspacePath,
                timestamp: Date.now()
            });
            return;
        }
        
        // Use pre-supplied code (from vscode:// deep link) if available
        const code = this.pendingLinkCode;
        this.pendingLinkCode = null;
        
        if (code) {
            this.send({
                type: 'link_with_code',
                code: code.trim().toUpperCase(),
                workspaceHash: this.workspaceHash,
                workspaceName: this.workspaceName,
                workspacePath: this.workspacePath,
                timestamp: Date.now()
            });
            return;
        }
        
        // No link token and no deep-link code — not signed in
        this.log('No link token found — not signed in');
        if (this.onNotLinkedCallback) {
            this.onNotLinkedCallback();
        }
        this.disconnect();
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
     * Disconnect from cloud server (and clear account info)
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
        this._accountName = null;
        this._accountEmail = null;
        this.log('Disconnected from cloud server');
    }

    /**
     * Check if connected
     */
    get connected(): boolean {
        return this.isConnected;
    }
}
