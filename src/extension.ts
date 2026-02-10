// Remote Chat Control Extension - Main Entry Point
import * as vscode from 'vscode';
import * as server from './server/index';
import { SidebarProvider } from './sidebar';

let outputChannel: vscode.OutputChannel;
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

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteChatControl.connectCloud', async () => {
            const config = vscode.workspace.getConfiguration('remoteChatControl');
            let serverUrl = config.get<string>('serverUrl') || '';
            
            if (!serverUrl) {
                serverUrl = await vscode.window.showInputBox({
                    prompt: 'Enter server URL',
                    placeHolder: 'wss://your-app.run.app or ws://localhost:8080',
                    value: serverUrl
                }) || '';
            }
            
            if (serverUrl) {
                const success = await server.connectToCloud(serverUrl);
                if (success) {
                    vscode.window.showInformationMessage(`Connected to server: ${serverUrl}`);
                    config.update('serverUrl', serverUrl, vscode.ConfigurationTarget.Global);
                    sidebarProvider.cloudConnected = true;
                    sidebarProvider.cloudUrl = serverUrl;
                } else {
                    vscode.window.showErrorMessage('Failed to connect to server');
                }
            }
        }),
        
        vscode.commands.registerCommand('remoteChatControl.disconnectCloud', () => {
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

    // Log workspace info
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        workspaceFolders.forEach(folder => {
            log(`Workspace: ${folder.name} at ${folder.uri.fsPath}`);
        });
    }

    // Auto-connect to server if configured
    const config = vscode.workspace.getConfiguration('remoteChatControl');
    const serverUrl = config.get<string>('serverUrl');
    const autoConnect = config.get<boolean>('autoConnect');
    
    if (serverUrl && autoConnect) {
        log(`Auto-connecting to server: ${serverUrl}`);
        server.connectToCloud(serverUrl).then(success => {
            if (success) {
                log('Auto-connected to server');
                sidebarProvider.cloudConnected = true;
                sidebarProvider.cloudUrl = serverUrl;
            } else {
                log('Failed to auto-connect to server');
            }
        });
    }

    log('Extension activated');
}

export function deactivate() {
    if (server.isConnectedToCloud()) {
        server.disconnectFromCloud();
    }
    log('Extension deactivated');
}
