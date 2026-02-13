// Remote Chat Control Extension - Main Entry Point
import * as vscode from 'vscode';
import * as server from './server/index';
import { SidebarProvider } from './sidebar';

let outputChannel: vscode.OutputChannel;
let sidebarProvider: SidebarProvider;
let startupRetryTimer: NodeJS.Timeout | null = null;
let startupRetryStopped = false;
let startupConnectInFlight = false;

function log(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[RemoteChatControl] ${msg}`);
    outputChannel?.appendLine(`[${timestamp}] ${msg}`);
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Remote Chat Control');
    // Don't auto-show output panel - user can open via command

    // Store context for lazy initialization (will initialize when connecting)
    server.setExtensionContext(context, outputChannel);

    // Register sidebar
    sidebarProvider = new SidebarProvider();
    const treeView = vscode.window.createTreeView('remoteChatControl.sidebar', {
        treeDataProvider: sidebarProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(treeView);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteChatControl.connectCloud', async () => {
            stopStartupRetry();
            const config = vscode.workspace.getConfiguration('remoteChatControl');
            let serverUrl = getConfiguredServerUrl(config);
            
            if (!serverUrl) {
                serverUrl = await vscode.window.showInputBox({
                    prompt: 'Enter server URL',
                    placeHolder: 'wss://your-app.run.app or ws://localhost:8080',
                    value: serverUrl
                }) || '';
            }

            serverUrl = serverUrl.trim();
            
            if (serverUrl) {
                // Persist immediately so startup autoconnect works even if first attempt fails.
                await config.update('serverUrl', serverUrl, vscode.ConfigurationTarget.Global);
                await config.update('cloudServerUrl', serverUrl, vscode.ConfigurationTarget.Global);

                const success = await server.connectToCloud(serverUrl);
                if (success) {
                    vscode.window.showInformationMessage(`Connected to server: ${serverUrl}`);
                    sidebarProvider.cloudConnected = true;
                    sidebarProvider.cloudUrl = serverUrl;
                } else {
                    vscode.window.showErrorMessage('Failed to connect to server');
                }
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.disconnectCloud', () => {
            stopStartupRetry();
            server.disconnectFromCloud();
            sidebarProvider.cloudConnected = false;
            sidebarProvider.cloudUrl = '';
            vscode.window.showInformationMessage('Disconnected from server');
        }),
        
        vscode.commands.registerCommand('remoteChatControl.sendMessage', async () => {
            const msg = await vscode.window.showInputBox({ prompt: 'Enter message for chat' });
            if (msg) {
                await server.sendToChat(msg);
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.showOutput', () => {
            outputChannel.show();
        })
    );

    // Auto-connect to server on startup if configured
    const config = vscode.workspace.getConfiguration('remoteChatControl');
    const serverUrl = getConfiguredServerUrl(config);

    if (serverUrl) {
        startStartupRetry(serverUrl);
    } else {
        log('Startup connect skipped: no server URL configured');
    }

    context.subscriptions.push({ dispose: stopStartupRetry });
}

export function deactivate() {
    stopStartupRetry();
    if (server.isConnectedToCloud()) {
        server.disconnectFromCloud();
    }
}

function startStartupRetry(serverUrl: string) {
    serverUrl = serverUrl.trim();
    if (!serverUrl) {
        log('Startup connect skipped: empty server URL');
        return;
    }

    startupRetryStopped = false;
    log(`Startup auto-connect enabled for: ${serverUrl}`);

    const attemptConnect = async () => {
        if (startupRetryStopped || startupConnectInFlight || server.isConnectedToCloud()) {
            return;
        }

        startupConnectInFlight = true;
        try {
            const success = await server.connectToCloud(serverUrl);
            if (success) {
                sidebarProvider.cloudConnected = true;
                sidebarProvider.cloudUrl = serverUrl;
                stopStartupRetry();
                return;
            }

            server.disconnectFromCloud();
            scheduleNextAttempt(serverUrl, attemptConnect);
        } catch (error: any) {
            log(`Startup connection error: ${error?.message || error}`);
            server.disconnectFromCloud();
            scheduleNextAttempt(serverUrl, attemptConnect);
        } finally {
            startupConnectInFlight = false;
        }
    };

    void attemptConnect();
}

function scheduleNextAttempt(serverUrl: string, retryFn: () => Promise<void>) {
    if (startupRetryStopped || server.isConnectedToCloud()) {
        return;
    }

    if (startupRetryTimer) {
        clearTimeout(startupRetryTimer);
    }

    log(`Connection failed. Retrying in 1 second: ${serverUrl}`);
    startupRetryTimer = setTimeout(() => {
        startupRetryTimer = null;
        void retryFn();
    }, 1000);
}

function stopStartupRetry() {
    startupRetryStopped = true;

    if (startupRetryTimer) {
        clearTimeout(startupRetryTimer);
        startupRetryTimer = null;
    }
}

function getConfiguredServerUrl(config: vscode.WorkspaceConfiguration): string {
    const primary = (config.get<string>('serverUrl') || '').trim();
    if (primary) {
        return primary;
    }

    // Backward compatibility with older setting names used in previous versions/docs.
    const legacy = (config.get<string>('cloudServerUrl') || '').trim();
    return legacy;
}
