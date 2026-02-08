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

## The Fix
**Don't try to fix it** - the limitation is in VS Code's API.

The correct code is:
```typescript
if (sessionMode === 'new') {
    await vscode.commands.executeCommand('workbench.action.chat.newChat');
    await new Promise(r => setTimeout(r, 300));
}

// Send message (goes to active session)
await vscode.commands.executeCommand('workbench.action.chat.open', {
    query: message,
    isPartialQuery: false  // auto-submit
});
```

## What sessionId is For
- Identifying which session to display in the webview
- Logging/debugging
- NOT for routing messages (API doesn't support it)

## User Workaround
Tell user: "Open the target chat session in VS Code first, then send your message"
