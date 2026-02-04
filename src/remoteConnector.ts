/**
 * Remote Server Connector
 * 
 * This module connects the VS Code extension TO a remote PHP server,
 * allowing control from anywhere without requiring localhost access.
 */

import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export interface RemoteServerConfig {
    serverUrl: string;
    instanceKey: string;
    pollInterval: number;
}

export class RemoteConnector {
    private config: RemoteServerConfig;
    private pollTimer: NodeJS.Timeout | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private outputChannel: vscode.OutputChannel;
    private onMessageCallback: ((message: any) => Promise<void>) | null = null;
    private processedMessageIds: Set<string> = new Set();
    private onCommandActionCallback: ((action: string) => Promise<void>) | null = null;
    private getInboxCallback: (() => any) | null = null;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.config = {
            serverUrl: '',
            instanceKey: '',
            pollInterval: 2000
        };
    }

    /**
     * Set callbacks for handling incoming messages and commands
     */
    setCallbacks(
        onMessage: (message: any) => Promise<void>,
        onCommandAction: (action: string) => Promise<void>,
        getInbox: () => any
    ) {
        this.onMessageCallback = onMessage;
        this.onCommandActionCallback = onCommandAction;
        this.getInboxCallback = getInbox;
    }

    /**
     * Connect to remote PHP server
     */
    async connect(serverUrl: string, workspaceName: string, workspaceHash: string): Promise<boolean> {
        this.config.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
        this.config.instanceKey = workspaceHash || this.generateKey();

        this.log(`Connecting to remote server: ${this.config.serverUrl}`);
        this.log(`Instance key: ${this.config.instanceKey}`);

        try {
            // Register with server
            const registerResult = await this.apiCall('register', 'POST', {
                workspaceName,
                workspaceHash
            });

            if (!registerResult.success) {
                this.log(`Registration failed: ${registerResult.error}`);
                return false;
            }

            this.log('Registered successfully');
            this.isRunning = true;

            // Start polling for messages
            this.startPolling();

            // Start heartbeat
            this.startHeartbeat();

            // Send initial inbox state with retry
            await this.updateInboxWithRetry();

            return true;
        } catch (error: any) {
            this.log(`Connection error: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Update inbox with retry if initially null
     */
    private async updateInboxWithRetry(maxRetries: number = 3) {
        for (let i = 0; i < maxRetries; i++) {
            if (!this.isRunning || !this.getInboxCallback) return;
            
            const inbox = this.getInboxCallback();
            if (inbox && inbox.sessions) {
                this.log(`Initial inbox sync: Found ${inbox.sessions.length} sessions`);
                await this.apiCall('update-inbox', 'POST', { inbox });
                return;
            }
            
            this.log(`Inbox not ready, retrying in 2 seconds... (${i + 1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, 2000));
        }
        
        // Final attempt - send whatever we have
        await this.updateInbox();
    }

    /**
     * Disconnect from remote server
     */
    disconnect() {
        this.isRunning = false;

        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        
        // Clear processed messages tracking
        this.processedMessageIds.clear();

        this.log('Disconnected from remote server');
    }

    /**
     * Start polling for incoming messages from browser
     */
    private startPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }

        this.pollTimer = setInterval(async () => {
            if (!this.isRunning) return;

            try {
                const result = await this.apiCall('poll', 'GET');

                if (result.success) {
                    const msgCount = (result.messages || []).length;
                    const cmdCount = (result.pendingCommands || []).length;
                    
                    if (msgCount > 0 || cmdCount > 0) {
                        this.log(`Poll: ${msgCount} messages, ${cmdCount} commands`);
                    }
                    
                    // Process pending messages
                    for (const msg of result.messages || []) {
                        this.log(`Poll found message: ${msg.id} - "${msg.message?.substring(0, 50)}..."`);
                        await this.processMessage(msg);
                    }

                    // Process pending command actions
                    for (const cmd of result.pendingCommands || []) {
                        await this.processCommandAction(cmd);
                    }

                    // Clear processed commands
                    if ((result.pendingCommands || []).length > 0) {
                        await this.apiCall('clear-commands', 'POST');
                    }
                } else {
                    this.log(`Poll failed: ${result.error || 'unknown error'}`);
                }
            } catch (error: any) {
                this.log(`Poll error: ${error.message}`);
            }
        }, this.config.pollInterval);
    }

    /**
     * Start heartbeat to keep connection alive
     */
    private startHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        this.heartbeatTimer = setInterval(async () => {
            if (!this.isRunning) return;

            try {
                await this.apiCall('heartbeat', 'POST');
                
                // Also update inbox state periodically
                await this.updateInbox();
            } catch (error: any) {
                this.log(`Heartbeat error: ${error.message}`);
            }
        }, 10000); // Every 10 seconds for faster inbox sync
    }

    /**
     * Process incoming message from browser
     */
    private async processMessage(msg: any) {
        const messageId = msg.id;
        
        // Check if already processed
        if (this.processedMessageIds.has(messageId)) {
            this.log(`Message ${messageId} already processed, skipping`);
            return;
        }
        
        // Mark as being processed immediately
        this.processedMessageIds.add(messageId);
        this.log(`Processing message: ${messageId} - "${msg.message}"`);

        if (this.onMessageCallback) {
            try {
                // Mark as processed on server BEFORE calling callback to prevent duplicate polling
                this.log(`Marking message ${messageId} as processed on server...`);
                await this.apiCall('message-processed', 'POST', { messageId });
                
                // Now process the message
                this.log(`Calling message callback for: "${msg.message}"`);
                await this.onMessageCallback(msg);
                this.log(`Message callback completed for: ${messageId}`);

                // Update inbox after processing
                setTimeout(() => this.updateInbox(), 1000);
            } catch (error: any) {
                this.log(`Error processing message: ${error.message}`);
                // Remove from processed set on error so it can be retried
                this.processedMessageIds.delete(messageId);
            }
        } else {
            this.log(`No message callback set!`);
        }
    }

    /**
     * Process command action (approve/skip) from browser
     */
    private async processCommandAction(cmd: any) {
        this.log(`Processing command action: ${cmd.action}`);

        if (this.onCommandActionCallback) {
            try {
                await this.onCommandActionCallback(cmd.action);
            } catch (error: any) {
                this.log(`Error processing command action: ${error.message}`);
            }
        }
    }

    /**
     * Update inbox state on remote server
     */
    async updateInbox() {
        if (!this.isRunning || !this.getInboxCallback) return;

        try {
            const inbox = this.getInboxCallback();
            
            if (!inbox) {
                this.log('updateInbox: Inbox is null, skipping update');
                return;
            }
            
            this.log(`updateInbox: Sending ${inbox.sessions?.length || 0} sessions to server`);
            
            const result = await this.apiCall('update-inbox', 'POST', { inbox });
            
            if (result.success) {
                this.log('updateInbox: Successfully updated inbox on server');
            } else {
                this.log(`updateInbox: Server error - ${result.error || 'unknown'}`);
            }
        } catch (error: any) {
            this.log(`Error updating inbox: ${error.message}`);
        }
    }

    /**
     * Send reply after processing a message
     */
    async sendReply(originalMessageId: string, reply: any) {
        try {
            await this.apiCall('reply', 'POST', {
                replyTo: originalMessageId,
                reply
            });
        } catch (error: any) {
            this.log(`Error sending reply: ${error.message}`);
        }
    }

    /**
     * Make API call to remote server
     */
    private apiCall(action: string, method: 'GET' | 'POST', data?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const url = new URL(this.config.serverUrl);
            url.searchParams.set('action', action);

            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const options: http.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Instance-Key': this.config.instanceKey
                }
            };

            const req = httpModule.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        resolve({ success: false, error: 'Invalid JSON response' });
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (data && method === 'POST') {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }

    /**
     * Generate unique instance key
     */
    private generateKey(): string {
        return 'vscode_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Log to output channel
     */
    private log(message: string) {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [Remote] ${message}`);
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.isRunning;
    }

    /**
     * Get current config
     */
    getConfig(): RemoteServerConfig {
        return { ...this.config };
    }
}
