/**
 * Sidebar TreeView Provider for Remote Chat Control
 * Shows server status, actions, and cloud connection in the activity bar sidebar
 */

import * as vscode from 'vscode';
import * as server from './server';

type SidebarItemType = 'action' | 'status' | 'header' | 'info';

export class SidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _serverRunning = false;
    private _cloudConnected = false;
    private _serverPort = 3847;
    private _cloudUrl = '';

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    get serverRunning(): boolean {
        return this._serverRunning;
    }

    set serverRunning(value: boolean) {
        this._serverRunning = value;
        if (value) {
            this._serverPort = server.getCurrentPort();
        }
        this.refresh();
    }

    get cloudConnected(): boolean {
        return this._cloudConnected;
    }

    set cloudConnected(value: boolean) {
        this._cloudConnected = value;
        this.refresh();
    }

    set cloudUrl(value: string) {
        this._cloudUrl = value;
        this.refresh();
    }

    getTreeItem(element: SidebarItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SidebarItem): SidebarItem[] {
        if (element) {
            return []; // No nested items
        }

        const items: SidebarItem[] = [];

        // === LOCAL SERVER SECTION ===
        items.push(new SidebarItem(
            'LOCAL SERVER',
            'header',
            undefined,
            vscode.TreeItemCollapsibleState.None
        ));

        if (this._serverRunning) {
            // Status
            items.push(new SidebarItem(
                `Running on port ${this._serverPort}`,
                'status',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'))
            ));

            // Stop button
            items.push(new SidebarItem(
                'Stop Server',
                'action',
                {
                    command: 'remoteChatControl.stopServer',
                    title: 'Stop Server'
                },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('debug-stop', new vscode.ThemeColor('testing.iconFailed'))
            ));

            // Open in browser
            items.push(new SidebarItem(
                'Open in Browser',
                'action',
                {
                    command: 'remoteChatControl.showPanel',
                    title: 'Open in Browser'
                },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('globe')
            ));
        } else {
            // Status
            items.push(new SidebarItem(
                'Server stopped',
                'status',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconFailed'))
            ));

            // Start button
            items.push(new SidebarItem(
                'Start Local Server',
                'action',
                {
                    command: 'remoteChatControl.startServer',
                    title: 'Start Server'
                },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('play', new vscode.ThemeColor('testing.iconPassed'))
            ));
        }

        // === SEPARATOR ===
        items.push(new SidebarItem(
            '',
            'header',
            undefined,
            vscode.TreeItemCollapsibleState.None
        ));

        // === CLOUD SERVER SECTION ===
        items.push(new SidebarItem(
            'CLOUD SERVER',
            'header',
            undefined,
            vscode.TreeItemCollapsibleState.None
        ));

        if (this._cloudConnected) {
            // Connected status
            const displayUrl = this._cloudUrl
                ? this._cloudUrl.replace(/^wss?:\/\//, '').replace(/\/extension$/, '').substring(0, 30)
                : 'Connected';
            
            items.push(new SidebarItem(
                displayUrl,
                'status',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('cloud', new vscode.ThemeColor('testing.iconPassed'))
            ));

            // Disconnect
            items.push(new SidebarItem(
                'Disconnect',
                'action',
                {
                    command: 'remoteChatControl.disconnectCloud',
                    title: 'Disconnect Cloud'
                },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('testing.iconFailed'))
            ));
        } else {
            // Not connected
            items.push(new SidebarItem(
                'Not connected',
                'status',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('cloud-upload', new vscode.ThemeColor('disabledForeground'))
            ));

            // Connect button
            items.push(new SidebarItem(
                'Connect to Server',
                'action',
                {
                    command: 'remoteChatControl.connectCloud',
                    title: 'Connect to Cloud'
                },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('plug', new vscode.ThemeColor('testing.iconPassed'))
            ));
        }

        // === SEPARATOR ===
        items.push(new SidebarItem(
            '',
            'header',
            undefined,
            vscode.TreeItemCollapsibleState.None
        ));

        // === TOOLS SECTION ===
        items.push(new SidebarItem(
            'TOOLS',
            'header',
            undefined,
            vscode.TreeItemCollapsibleState.None
        ));

        items.push(new SidebarItem(
            'Send Message',
            'action',
            {
                command: 'remoteChatControl.sendMessage',
                title: 'Send Message'
            },
            vscode.TreeItemCollapsibleState.None,
            new vscode.ThemeIcon('comment')
        ));

        items.push(new SidebarItem(
            'Show Output Log',
            'action',
            {
                command: 'remoteChatControl.showOutput',
                title: 'Show Output'
            },
            vscode.TreeItemCollapsibleState.None,
            new vscode.ThemeIcon('output')
        ));

        return items;
    }
}

export class SidebarItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: SidebarItemType,
        public readonly command_action?: vscode.Command,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        public readonly themeIcon?: vscode.ThemeIcon
    ) {
        super(label, collapsibleState);

        if (command_action) {
            this.command = command_action;
        }

        if (themeIcon) {
            this.iconPath = themeIcon;
        }

        // Style based on type
        switch (type) {
            case 'header':
                this.contextValue = 'header';
                this.description = '';
                break;
            case 'status':
                this.contextValue = 'status';
                break;
            case 'action':
                this.contextValue = 'action';
                break;
            case 'info':
                this.contextValue = 'info';
                break;
        }
    }
}
