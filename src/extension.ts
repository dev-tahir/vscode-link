// Remote Chat Control Extension - Main Entry Point
import * as vscode from 'vscode';
import * as server from './server';
import { RemoteConnector } from './remoteConnector';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let serverRunning = false;
let remoteConnector: RemoteConnector | null = null;

function log(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[RemoteChatControl] ${msg}`);
    outputChannel?.appendLine(`[${timestamp}] ${msg}`);
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Remote Chat Control');
    outputChannel.show();
    log('Extension activating...');

    // Initialize server module
    server.initServer(context, outputChannel);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'remoteChatControl.toggleServer';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteChatControl.startServer', () => {
            if (!serverRunning) {
                server.startServer();
                serverRunning = true;
                updateStatusBar();
                log('Server started');
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.stopServer', () => {
            if (serverRunning) {
                server.stopServer();
                serverRunning = false;
                updateStatusBar();
                log('Server stopped');
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.toggleServer', () => {
            if (serverRunning) {
                vscode.commands.executeCommand('remoteChatControl.stopServer');
            } else {
                vscode.commands.executeCommand('remoteChatControl.startServer');
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.showPanel', () => {
            vscode.env.openExternal(vscode.Uri.parse('http://localhost:3847'));
        }),
        
        vscode.commands.registerCommand('remoteChatControl.sendMessage', async () => {
            const msg = await vscode.window.showInputBox({ prompt: 'Enter message for chat' });
            if (msg) {
                await server.sendToChat(msg);
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.clearHistory', () => {
            // Clear functionality can be added if needed
            log('History cleared');
        }),

        // Remote Server Connection Commands
        vscode.commands.registerCommand('remoteChatControl.connectRemote', async () => {
            const serverUrl = await vscode.window.showInputBox({
                prompt: 'Enter remote server URL',
                placeHolder: 'https://yoursite.com/vscode-remote/api.php',
                value: vscode.workspace.getConfiguration('remoteChatControl').get('remoteServerUrl') || ''
            });

            if (!serverUrl) return;

            // Save to settings
            await vscode.workspace.getConfiguration('remoteChatControl').update('remoteServerUrl', serverUrl, true);

            // Get workspace info
            const workspaceHash = server.getWorkspaceHash() || '';
            const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'VS Code';

            // Initialize remote connector
            if (!remoteConnector) {
                remoteConnector = new RemoteConnector(outputChannel);
                
                // Set callbacks
                remoteConnector.setCallbacks(
                    // On message from browser
                    async (msg) => {
                        log(`Remote message received: ${msg.message}`);
                        await server.sendToChat(msg.message);
                    },
                    // On command action from browser
                    async (action) => {
                        log(`Remote command action: ${action}`);
                        await server.handleCommandAction(action);
                    },
                    // Get current inbox
                    () => server.getCurrentInbox()
                );
            }

            const connected = await remoteConnector.connect(serverUrl, workspaceName, workspaceHash);

            if (connected) {
                vscode.window.showInformationMessage(`Connected to remote server: ${serverUrl}`);
                log(`Connected to remote server: ${serverUrl}`);
                updateStatusBar();
            } else {
                vscode.window.showErrorMessage('Failed to connect to remote server');
            }
        }),

        vscode.commands.registerCommand('remoteChatControl.disconnectRemote', () => {
            if (remoteConnector) {
                remoteConnector.disconnect();
                remoteConnector = null;
                vscode.window.showInformationMessage('Disconnected from remote server');
                log('Disconnected from remote server');
                updateStatusBar();
            }
        })
    );

    // Log workspace info
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        workspaceFolders.forEach(folder => {
            log(`Workspace: ${folder.name} at ${folder.uri.fsPath}`);
        });
    }

    // Auto-start server by default
    server.startServer();
    serverRunning = true;
    updateStatusBar();

    vscode.window.showInformationMessage('Remote Chat Control is now active!');
    log('Extension activated');
}

function updateStatusBar() {
    const remoteStatus = remoteConnector?.isConnected() ? ' + Remote' : '';
    if (serverRunning) {
        statusBarItem.text = `$(broadcast) Remote: ON${remoteStatus}`;
        statusBarItem.tooltip = `Remote Chat Control - Server Running${remoteStatus ? '\nConnected to remote server' : ''}\nClick to stop`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(circle-slash) Remote: OFF';
        statusBarItem.tooltip = 'Remote Chat Control - Server Stopped\nClick to start';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

export function deactivate() {
    if (remoteConnector) {
        remoteConnector.disconnect();
    }
    if (serverRunning) {
        server.stopServer();
    }
    log('Extension deactivated');
}
