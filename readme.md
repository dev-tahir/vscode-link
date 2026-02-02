# VS Code Remote Chat Control Extension

A proof of concept VS Code extension that allows you to control the AI chat feature and terminal remotely via a web browser.

## Features

- **Send messages to AI Chat** - Send any message to the VS Code Copilot chat
- **Read chat history** - View all sent messages and responses
- **Terminal control** - Run terminal commands remotely
- **Web-based control panel** - Control everything from your browser at `http://localhost:3847`

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Compile the Extension

```bash
npm run compile
```

### 3. Run the Extension

Press `F5` in VS Code to launch a new Extension Development Host window with the extension loaded.

### 4. Use the Extension

Once the extension is active:

1. The control server starts automatically on `http://localhost:3847`
2. Open your browser and go to `http://localhost:3847`
3. Use the web interface to:
   - Send "Hi" to the chat
   - Send custom messages
   - View chat history
   - Run terminal commands

### Commands

You can also use these commands from the Command Palette (`Ctrl+Shift+P`):

- `Remote Chat: Send Hi to Chat` - Sends "Hi" to the AI chat
- `Remote Chat: Read Chat Messages` - Shows chat history in output panel
- `Remote Chat: Start Control Server` - Starts the HTTP server (auto-starts on activation)

## API Endpoints

The extension exposes these HTTP endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web control panel |
| `/api/status` | GET | Check extension status |
| `/api/sendHi` | GET | Quick send "Hi" to chat |
| `/api/send` | POST | Send custom message `{"message": "..."}` |
| `/api/history` | GET | Get chat history |
| `/api/terminal` | POST | Run terminal command `{"command": "..."}` |

## Example API Usage

```javascript
// Send a message
fetch('http://localhost:3847/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello AI!' })
});

// Get chat history
fetch('http://localhost:3847/api/history')
    .then(res => res.json())
    .then(data => console.log(data.history));

// Run terminal command
fetch('http://localhost:3847/api/terminal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'echo Hello World' })
});
```

## Notes

- This is a proof of concept for testing the VS Code chat API capabilities
- The chat API access is limited by VS Code's extension API
- The extension uses `workbench.action.chat.open` to send messages to the chat panel

## Requirements

- VS Code 1.85.0 or higher
- GitHub Copilot extension (for AI chat functionality)
- Node.js for development
