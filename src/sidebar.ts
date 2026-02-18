/**
 * Sidebar TreeView Provider for VS Code Mobile
 * Shows account info, VS Code Mobile toggle, and localhost toggle.
 */

import * as vscode from 'vscode';

type SidebarItemType = 'action' | 'status' | 'header' | 'info';

export const CLOUD_URL = 'wss://vscodemobile-655025977368.europe-west1.run.app/extension';
export const WEBSITE_URL = 'https://vscodemobile-655025977368.europe-west1.run.app/';
export const LOCALHOST_URL = 'ws://localhost:8080/extension';

export class SidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Account state
    private _accountName: string | null = null;
    private _accountEmail: string | null = null;

    // Connection state
    private _vsMobileConnected = false;
    private _localhostConnected = false;

    // Toggle preferences (remembered across restarts)
    private _vsMobileEnabled = false;
    private _localhostEnabled = false;

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    // ── Account ──────────────────────────────────────────────────

    get accountName(): string | null { return this._accountName; }
    get accountEmail(): string | null { return this._accountEmail; }

    setAccountInfo(name: string | null, email: string | null) {
        this._accountName = name;
        this._accountEmail = email;
        this.refresh();
    }

    clearAccountInfo() {
        this._accountName = null;
        this._accountEmail = null;
        this.refresh();
    }

    // ── VS Code Mobile toggle ─────────────────────────────────────

    get vsMobileEnabled(): boolean { return this._vsMobileEnabled; }

    set vsMobileEnabled(value: boolean) {
        this._vsMobileEnabled = value;
        if (!value) {
            this._vsMobileConnected = false;
        }
        this.refresh();
    }

    set vsMobileConnected(value: boolean) {
        this._vsMobileConnected = value;
        this.refresh();
    }

    get vsMobileConnected(): boolean { return this._vsMobileConnected; }

    // ── Localhost toggle ──────────────────────────────────────────

    get localhostEnabled(): boolean { return this._localhostEnabled; }

    set localhostEnabled(value: boolean) {
        this._localhostEnabled = value;
        if (!value) {
            this._localhostConnected = false;
        }
        this.refresh();
    }

    set localhostConnected(value: boolean) {
        this._localhostConnected = value;
        this.refresh();
    }

    get localhostConnected(): boolean { return this._localhostConnected; }

    // ── TreeView ──────────────────────────────────────────────────

    getTreeItem(element: SidebarItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SidebarItem): SidebarItem[] {
        if (element) return [];

        const items: SidebarItem[] = [];

        // ═══ ACCOUNT ═══════════════════════════════════════════
        items.push(new SidebarItem(
            'ACCOUNT',
            'header',
            undefined,
            vscode.TreeItemCollapsibleState.None
        ));

        if (this._accountName) {
            // Signed in — show name
            items.push(new SidebarItem(
                this._accountName,
                'status',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('account', new vscode.ThemeColor('testing.iconPassed'))
            ));

            if (this._accountEmail) {
                items.push(new SidebarItem(
                    this._accountEmail,
                    'info',
                    undefined,
                    vscode.TreeItemCollapsibleState.None,
                    new vscode.ThemeIcon('mail')
                ));
            }

            // Logout button
            items.push(new SidebarItem(
                'Log Out',
                'action',
                { command: 'remoteChatControl.logout', title: 'Log Out' },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('sign-out', new vscode.ThemeColor('testing.iconFailed'))
            ));
        } else {
            // Not signed in
            items.push(new SidebarItem(
                'Not signed in',
                'status',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('person', new vscode.ThemeColor('disabledForeground'))
            ));

            items.push(new SidebarItem(
                'Sign In',
                'action',
                { command: 'remoteChatControl.signIn', title: 'Sign In' },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('link-external', new vscode.ThemeColor('textLink.foreground'))
            ));
        }

        // ═══ VS CODE MOBILE ════════════════════════════════════
        items.push(new SidebarItem('', 'header', undefined, vscode.TreeItemCollapsibleState.None));
        items.push(new SidebarItem(
            'VS CODE MOBILE',
            'header',
            undefined,
            vscode.TreeItemCollapsibleState.None
        ));

        if (this._vsMobileEnabled) {
            const statusLabel = this._vsMobileConnected ? 'Connected' : 'Connecting...';
            const statusColor = this._vsMobileConnected
                ? new vscode.ThemeColor('testing.iconPassed')
                : new vscode.ThemeColor('list.warningForeground');
            items.push(new SidebarItem(
                statusLabel,
                'status',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('cloud', statusColor)
            ));

            items.push(new SidebarItem(
                'Disconnect',
                'action',
                { command: 'remoteChatControl.toggleVsMobile', title: 'Disconnect VS Code Mobile' },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('testing.iconFailed'))
            ));
        } else {
            items.push(new SidebarItem(
                'Not connected',
                'status',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('cloud-upload', new vscode.ThemeColor('disabledForeground'))
            ));

            items.push(new SidebarItem(
                'Connect',
                'action',
                { command: 'remoteChatControl.toggleVsMobile', title: 'Connect VS Code Mobile' },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('plug', new vscode.ThemeColor('testing.iconPassed'))
            ));
        }

        // ═══ LOCALHOST ══════════════════════════════════════════
        items.push(new SidebarItem('', 'header', undefined, vscode.TreeItemCollapsibleState.None));
        items.push(new SidebarItem(
            'LOCALHOST',
            'header',
            undefined,
            vscode.TreeItemCollapsibleState.None
        ));

        if (this._localhostEnabled) {
            const statusLabel = this._localhostConnected ? 'Connected' : 'Connecting...';
            const statusColor = this._localhostConnected
                ? new vscode.ThemeColor('testing.iconPassed')
                : new vscode.ThemeColor('list.warningForeground');
            items.push(new SidebarItem(
                statusLabel,
                'status',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('server', statusColor)
            ));

            items.push(new SidebarItem(
                'Disconnect',
                'action',
                { command: 'remoteChatControl.toggleLocalhost', title: 'Disconnect Localhost' },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('testing.iconFailed'))
            ));
        } else {
            items.push(new SidebarItem(
                'Not connected',
                'status',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('server', new vscode.ThemeColor('disabledForeground'))
            ));

            items.push(new SidebarItem(
                'Connect',
                'action',
                { command: 'remoteChatControl.toggleLocalhost', title: 'Connect to Localhost' },
                vscode.TreeItemCollapsibleState.None,
                new vscode.ThemeIcon('plug', new vscode.ThemeColor('testing.iconPassed'))
            ));
        }

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
