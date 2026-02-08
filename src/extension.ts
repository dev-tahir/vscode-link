// Remote Chat Control Extension - Main Entry Point
import * as vscode from 'vscode';
import * as server from './server';
import { SidebarProvider } from './sidebar';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let serverRunning = false;
let sidebarProvider: SidebarProvider;

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

    // Register sidebar
    sidebarProvider = new SidebarProvider();
    const treeView = vscode.window.createTreeView('remoteChatControl.sidebar', {
        treeDataProvider: sidebarProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(treeView);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'remoteChatControl.toggleServer';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteChatControl.startServer', async () => {
            if (!serverRunning) {
                await server.startServer();
                serverRunning = true;
                updateStatusBar();
                sidebarProvider.serverRunning = true;
                log('Server started');
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.stopServer', () => {
            if (serverRunning) {
                server.stopServer();
                serverRunning = false;
                updateStatusBar();
                sidebarProvider.serverRunning = false;
                log('Server stopped');
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.toggleServer', async () => {
            if (serverRunning) {
                vscode.commands.executeCommand('remoteChatControl.stopServer');
            } else {
                await vscode.commands.executeCommand('remoteChatControl.startServer');
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.showPanel', () => {
            const port = server.getCurrentPort();
            vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
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
        
        vscode.commands.registerCommand('remoteChatControl.connectCloud', async () => {
            const config = vscode.workspace.getConfiguration('remoteChatControl');
            let cloudUrl = config.get<string>('cloudServerUrl') || '';
            
            if (!cloudUrl) {
                cloudUrl = await vscode.window.showInputBox({
                    prompt: 'Enter cloud server URL',
                    placeHolder: 'wss://your-app.run.app or http://localhost:8080',
                    value: cloudUrl
                }) || '';
            }
            
            if (cloudUrl) {
                const success = await server.connectToCloud(cloudUrl);
                if (success) {
                    vscode.window.showInformationMessage(`Connected to cloud server: ${cloudUrl}`);
                    // Save URL for future use
                    config.update('cloudServerUrl', cloudUrl, vscode.ConfigurationTarget.Global);
                    sidebarProvider.cloudConnected = true;
                    sidebarProvider.cloudUrl = cloudUrl;
                } else {
                    vscode.window.showErrorMessage('Failed to connect to cloud server');
                }
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.disconnectCloud', () => {
            server.disconnectFromCloud();
            sidebarProvider.cloudConnected = false;
            sidebarProvider.cloudUrl = '';
            vscode.window.showInformationMessage('Disconnected from cloud server');
        }),
        
        vscode.commands.registerCommand('remoteChatControl.showOutput', () => {
            outputChannel.show();
        })
    );

    // Log workspace info
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        workspaceFolders.forEach(folder => {
            log(`Workspace: ${folder.name} at ${folder.uri.fsPath}`);
        });
    }

    // Only auto-start if configured
    const config = vscode.workspace.getConfiguration('remoteChatControl');
    const autoStart = config.get<boolean>('autoStart', false);
    
    if (autoStart) {
        server.startServer().then(() => {
            serverRunning = true;
            updateStatusBar();
            sidebarProvider.serverRunning = true;
            
            // Auto-connect to cloud if configured
            const cloudUrl = config.get<string>('cloudServerUrl');
            const cloudAutoConnect = config.get<boolean>('cloudAutoConnect');
            
            if (cloudUrl && cloudAutoConnect) {
                log(`Auto-connecting to cloud server: ${cloudUrl}`);
                server.connectToCloud(cloudUrl).then(success => {
                    if (success) {
                        log('Auto-connected to cloud server');
                        sidebarProvider.cloudConnected = true;
                        sidebarProvider.cloudUrl = cloudUrl;
                    } else {
                        log('Failed to auto-connect to cloud server');
                    }
                });
            }
        });
    } else {
        log('Server not auto-started. Use sidebar or command palette to start.');
    }

    vscode.window.showInformationMessage('Remote Chat Control is now active!');
    log('Extension activated');
}

function updateStatusBar() {
    if (serverRunning) {
        const port = server.getCurrentPort();
        statusBarItem.text = `$(broadcast) Remote: ${port}`;
        statusBarItem.tooltip = `Remote Chat Control - Server Running on port ${port}\nClick to stop`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(circle-slash) Remote: OFF';
        statusBarItem.tooltip = 'Remote Chat Control - Server Stopped\nClick to start';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

export function deactivate() {
    // Disconnect from cloud if connected
    if (server.isConnectedToCloud()) {
        server.disconnectFromCloud();
    }
    
    if (serverRunning) {
        server.stopServer();
    }
    log('Extension deactivated');
}
