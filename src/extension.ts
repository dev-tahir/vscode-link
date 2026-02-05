// Remote Chat Control Extension - Main Entry Point
import * as vscode from 'vscode';
import * as server from './server';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let serverRunning = false;

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
    if (serverRunning) {
        statusBarItem.text = '$(broadcast) Remote: ON';
        statusBarItem.tooltip = 'Remote Chat Control - Server Running\nClick to stop';
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(circle-slash) Remote: OFF';
        statusBarItem.tooltip = 'Remote Chat Control - Server Stopped\nClick to start';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

export function deactivate() {
    if (serverRunning) {
        server.stopServer();
    }
    log('Extension deactivated');
}
