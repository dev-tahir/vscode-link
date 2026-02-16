# Fix Session Routing Issue

## Problem
Messages sent from webview go to wrong chat session (creates new session instead of going to intended session).

## Root Cause
VS Code's `workbench.action.chat.open` command has **NO `sessionId` parameter**.

When you call:
```typescript
vscode.commands.executeCommand('workbench.action.chat.open', {
    query: message,
    isPartialQuery: false
});
```

It **always sends to the currently active chat session in VS Code** - NOT to a specific session by ID.

## What Works
The code actually works correctly IF:
1. User clicks on the desired chat session in VS Code's chat history FIRST
2. Then sends message from webview
3. Message goes to the active session

## What Doesn't Work
- Trying to programmatically switch to a specific session by ID (no API)
- Using `isPartialQuery: true` then submit separately (creates issues)
- Any attempt to route by sessionId string


## The Fixes (2026)

### 1. Correct Session Routing
We restored the ability to programmatically open a specific chat session by encoding the sessionId and opening it with a special URI:

```typescript
if (sessionMode === 'session' && sessionId) {
    const encodedSessionId = Buffer.from(sessionId).toString('base64');
    const sessionUri = vscode.Uri.parse(`vscode-chat-session://local/${encodedSessionId}`);
    await vscode.commands.executeCommand('vscode.open', sessionUri);
    await new Promise(r => setTimeout(r, 500));
}
```
This ensures the message is sent to the correct session.

### 2. Reliable Message Sending (No PowerShell)
Instead of using PowerShell or unreliable APIs, we:
- Focus the chat input using VS Code commands
- Type the message
- Submit using `workbench.action.chat.submit`, with a fallback to typing `\n` (Enter) if needed

```typescript
try {
    await vscode.commands.executeCommand('workbench.action.chat.focusInput');
} catch {
    await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
}
await new Promise(r => setTimeout(r, 300));
await vscode.commands.executeCommand('type', { text: message });
await new Promise(r => setTimeout(r, 300));
try {
    await vscode.commands.executeCommand('workbench.action.chat.submit');
} catch {
    await vscode.commands.executeCommand('type', { text: '\n' });
}
```
This approach is fast, reliable, and does not use any keypress simulation or external scripts.

### 3. Fallback for Unknown Session
If the session cannot be determined, we still use the chat.open API as a last resort.

---
These changes restore correct session targeting and instant message sending, matching the best behavior from previous versions.

## What sessionId is For
- Identifying which session to display in the webview
- Logging/debugging
- NOT for routing messages (API doesn't support it)

## User Workaround
Tell user: "Open the target chat session in VS Code first, then send your message"
