/**
 * Sidebar TreeView Provider for Remote Chat Control
 * Shows server status, actions, and cloud connection in the activity bar sidebar
 */

import * as vscode from 'vscode';

type SidebarItemType = 'action' | 'status' | 'header' | 'info';

export class SidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _cloudConnected = false;
    private _cloudUrl = '';

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
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

        // === SERVER SECTION ===
        items.push(new SidebarItem(
            'SERVER',
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
