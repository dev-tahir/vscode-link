// Remote Chat Control Extension - Main Entry Point
import * as vscode from 'vscode';
import * as server from './server/index';
import { SidebarProvider, CLOUD_URL, LOCALHOST_URL, WEBSITE_URL } from './sidebar';

let outputChannel: vscode.OutputChannel;
let sidebarProvider: SidebarProvider;

// Startup retry state
let startupRetryTimer: NodeJS.Timeout | null = null;
let startupRetryStopped = false;
let startupConnectInFlight = false;

// Keys for persisting toggle state
const KEY_VS_MOBILE_ENABLED = 'vsMobileEnabled';
const KEY_LOCALHOST_ENABLED  = 'localhostEnabled';

function log(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[RemoteChatControl] ${msg}`);
    outputChannel?.appendLine(`[${timestamp}] ${msg}`);
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Remote Chat Control');

    server.setExtensionContext(context, outputChannel);

    // ── Sidebar ────────────────────────────────────────────────
    sidebarProvider = new SidebarProvider();
    const treeView = vscode.window.createTreeView('remoteChatControl.sidebar', {
        treeDataProvider: sidebarProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(treeView);

    // Restore persisted toggle states (UI only — connection happens below)
    const vsMobileWasEnabled = context.globalState.get<boolean>(KEY_VS_MOBILE_ENABLED, false);
    const localhostWasEnabled = context.globalState.get<boolean>(KEY_LOCALHOST_ENABLED, false);
    sidebarProvider.vsMobileEnabled = vsMobileWasEnabled;
    sidebarProvider.localhostEnabled = localhostWasEnabled;

    // ── Cloud event callbacks ──────────────────────────────────
    server.setCloudEventCallbacks({
        onNotLinked: () => {
            // Called when connector has no link token — not signed in
            vscode.window.showInformationMessage(
                'Sign in to VS Code Mobile to connect.',
                'Sign In'
            ).then(choice => {
                if (choice === 'Sign In') {
                    vscode.env.openExternal(vscode.Uri.parse(WEBSITE_URL));
                }
            });
            // Turn off whichever toggle triggered the attempt
            sidebarProvider.vsMobileEnabled = false;
            sidebarProvider.localhostEnabled = false;
            context.globalState.update(KEY_VS_MOBILE_ENABLED, false);
            context.globalState.update(KEY_LOCALHOST_ENABLED, false);
        },
        onAccountInfo: (name, email) => {
            sidebarProvider.setAccountInfo(name, email);
        }
    });

    // ── Commands ───────────────────────────────────────────────

    context.subscriptions.push(

        // Toggle VS Code Mobile connection
        vscode.commands.registerCommand('remoteChatControl.toggleVsMobile', async () => {
            if (sidebarProvider.vsMobileEnabled) {
                // Disconnect
                stopStartupRetry();
                server.disconnectFromCloud();
                sidebarProvider.vsMobileEnabled = false;
                sidebarProvider.vsMobileConnected = false;
                sidebarProvider.clearAccountInfo();
                await context.globalState.update(KEY_VS_MOBILE_ENABLED, false);
                vscode.window.showInformationMessage('Disconnected from VS Code Mobile');
            } else {
                // Disconnect localhost first if active
                if (sidebarProvider.localhostEnabled) {
                    server.disconnectFromCloud();
                    sidebarProvider.localhostEnabled = false;
                    sidebarProvider.localhostConnected = false;
                    await context.globalState.update(KEY_LOCALHOST_ENABLED, false);
                }
                // Enable and connect
                sidebarProvider.vsMobileEnabled = true;
                await context.globalState.update(KEY_VS_MOBILE_ENABLED, true);
                stopStartupRetry();
                await connectWithRetry(CLOUD_URL, 'vsMobile');
            }
        }),

        // Toggle localhost connection
        vscode.commands.registerCommand('remoteChatControl.toggleLocalhost', async () => {
            if (sidebarProvider.localhostEnabled) {
                // Disconnect
                stopStartupRetry();
                server.disconnectFromCloud();
                sidebarProvider.localhostEnabled = false;
                sidebarProvider.localhostConnected = false;
                sidebarProvider.clearAccountInfo();
                await context.globalState.update(KEY_LOCALHOST_ENABLED, false);
                vscode.window.showInformationMessage('Disconnected from localhost');
            } else {
                // Disconnect VS Mobile first if active
                if (sidebarProvider.vsMobileEnabled) {
                    server.disconnectFromCloud();
                    sidebarProvider.vsMobileEnabled = false;
                    sidebarProvider.vsMobileConnected = false;
                    await context.globalState.update(KEY_VS_MOBILE_ENABLED, false);
                }
                // Enable and connect
                sidebarProvider.localhostEnabled = true;
                await context.globalState.update(KEY_LOCALHOST_ENABLED, true);
                stopStartupRetry();
                await connectWithRetry(LOCALHOST_URL, 'localhost');
            }
        }),

        // Sign in — open website
        vscode.commands.registerCommand('remoteChatControl.signIn', () => {
            vscode.env.openExternal(vscode.Uri.parse(WEBSITE_URL));
        }),

        // Log out — clear link token and disconnect
        vscode.commands.registerCommand('remoteChatControl.logout', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Log out and disconnect from VS Code Mobile?',
                { modal: true },
                'Log Out'
            );
            if (confirm === 'Log Out') {
                stopStartupRetry();
                await server.unlinkAccount();
                server.disconnectFromCloud();
                sidebarProvider.vsMobileEnabled = false;
                sidebarProvider.vsMobileConnected = false;
                sidebarProvider.localhostEnabled = false;
                sidebarProvider.localhostConnected = false;
                sidebarProvider.clearAccountInfo();
                await context.globalState.update(KEY_VS_MOBILE_ENABLED, false);
                await context.globalState.update(KEY_LOCALHOST_ENABLED, false);
                vscode.window.showInformationMessage('Logged out of VS Code Mobile');
            }
        }),

        // Show output log
        vscode.commands.registerCommand('remoteChatControl.showOutput', () => {
            outputChannel.show();
        }),

        // Legacy / command-palette commands kept for compatibility
        vscode.commands.registerCommand('remoteChatControl.sendMessage', async () => {
            const msg = await vscode.window.showInputBox({ prompt: 'Enter message for chat' });
            if (msg) {
                await server.sendToChat(msg);
            }
        }),

        vscode.commands.registerCommand('remoteChatControl.connectCloud', async () => {
            await vscode.commands.executeCommand('remoteChatControl.toggleVsMobile');
        }),

        vscode.commands.registerCommand('remoteChatControl.disconnectCloud', async () => {
            if (sidebarProvider.vsMobileEnabled) {
                await vscode.commands.executeCommand('remoteChatControl.toggleVsMobile');
            } else if (sidebarProvider.localhostEnabled) {
                await vscode.commands.executeCommand('remoteChatControl.toggleLocalhost');
            }
        }),

        vscode.commands.registerCommand('remoteChatControl.unlinkAccount', async () => {
            await vscode.commands.executeCommand('remoteChatControl.logout');
        }),

        vscode.commands.registerCommand('remoteChatControl.relinkAccount', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Re-link this extension? You will need to sign in again via the website.',
                { modal: true },
                'Re-link'
            );
            if (confirm === 'Re-link') {
                await server.relinkAccount();
                sidebarProvider.clearAccountInfo();
                vscode.env.openExternal(vscode.Uri.parse(WEBSITE_URL));
            }
        })
    );

    // ── Deep-link URI handler (vscode://vscodemobile.vscodemobile/link) ───
    context.subscriptions.push(
        vscode.window.registerUriHandler({
            handleUri: async (uri: vscode.Uri) => {
                if (uri.path !== '/link') { return; }

                const params = new URLSearchParams(uri.query);
                const code = params.get('code');
                const serverUrl = params.get('server');

                if (!code || !serverUrl) {
                    vscode.window.showErrorMessage('Invalid link URL: missing code or server');
                    return;
                }

                log(`Deep link received: server=${serverUrl}, code=${code}`);
                stopStartupRetry();

                vscode.window.showInformationMessage(`Linking to your account...`);

                const success = await server.connectToCloudWithCode(serverUrl, code);
                if (success) {
                    // Determine which toggle to enable based on URL
                    if (serverUrl.includes('localhost')) {
                        sidebarProvider.localhostEnabled = true;
                        sidebarProvider.localhostConnected = true;
                        await context.globalState.update(KEY_LOCALHOST_ENABLED, true);
                    } else {
                        sidebarProvider.vsMobileEnabled = true;
                        sidebarProvider.vsMobileConnected = true;
                        await context.globalState.update(KEY_VS_MOBILE_ENABLED, true);
                    }
                } else {
                    vscode.window.showErrorMessage('Failed to connect via link');
                }
            }
        })
    );

    context.subscriptions.push({ dispose: stopStartupRetry });

    // ── Auto-connect on startup ────────────────────────────────
    if (vsMobileWasEnabled) {
        log('Auto-connecting to VS Code Mobile (remembered state)');
        connectWithRetry(CLOUD_URL, 'vsMobile');
    } else if (localhostWasEnabled) {
        log('Auto-connecting to localhost (remembered state)');
        connectWithRetry(LOCALHOST_URL, 'localhost');
    }
}

export function deactivate() {
    stopStartupRetry();
    if (server.isConnectedToCloud()) {
        server.disconnectFromCloud();
    }
}

// ── Connection helpers ─────────────────────────────────────────

type ConnectionTarget = 'vsMobile' | 'localhost';

async function connectWithRetry(url: string, target: ConnectionTarget) {
    startupRetryStopped = false;

    const attemptConnect = async () => {
        if (startupRetryStopped || startupConnectInFlight || server.isConnectedToCloud()) {
            return;
        }

        startupConnectInFlight = true;
        try {
            const success = await server.connectToCloud(url);
            if (success) {
                if (target === 'vsMobile') {
                    sidebarProvider.vsMobileConnected = true;
                } else {
                    sidebarProvider.localhostConnected = true;
                }
                stopStartupRetry();
                return;
            }

            server.disconnectFromCloud();
            scheduleNextAttempt(url, target, attemptConnect);
        } catch (error: any) {
            log(`Connection error: ${error?.message || error}`);
            server.disconnectFromCloud();
            scheduleNextAttempt(url, target, attemptConnect);
        } finally {
            startupConnectInFlight = false;
        }
    };

    void attemptConnect();
}

function scheduleNextAttempt(url: string, target: ConnectionTarget, retryFn: () => Promise<void>) {
    if (startupRetryStopped || server.isConnectedToCloud()) return;

    // Only retry if the corresponding toggle is still enabled
    const stillEnabled = target === 'vsMobile'
        ? sidebarProvider.vsMobileEnabled
        : sidebarProvider.localhostEnabled;
    if (!stillEnabled) return;

    if (startupRetryTimer) clearTimeout(startupRetryTimer);

    log(`Connection failed. Retrying in 5s: ${url}`);
    startupRetryTimer = setTimeout(() => {
        startupRetryTimer = null;
        void retryFn();
    }, 5000);
}

function stopStartupRetry() {
    startupRetryStopped = true;
    if (startupRetryTimer) {
        clearTimeout(startupRetryTimer);
        startupRetryTimer = null;
    }
}
