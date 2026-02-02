# VS Code Remote Chat Control - PHP Relay Server

This folder contains the PHP backend that acts as a relay between VS Code (anywhere) and your browser (anywhere).

## Setup Instructions

### 1. Upload to your PHP server

Upload all files in this folder to your PHP server:
- `api.php` - The API backend
- `index.php` - The browser UI
- `.htaccess` - Apache configuration

For example, upload to: `https://farooqk.sg-host.com/vscode-remote/`

### 2. Create data directory

The `data/` folder will be created automatically when VS Code first connects. Make sure your PHP server has write permissions for the folder.

### 3. Connect VS Code to the server

In VS Code:
1. Press `Ctrl+Shift+P` to open Command Palette
2. Run: `Remote Chat: Connect to Server`
3. Enter your server URL: `https://farooqk.sg-host.com/vscode-remote/api.php`

VS Code will now:
- Register itself with your remote server
- Send heartbeats to stay online
- Poll for incoming messages from the browser
- Update inbox state so browser can see your chat sessions

### 4. Access from anywhere

Open your browser (on any device, anywhere) and go to:
`https://farooqk.sg-host.com/vscode-remote/`

You'll see:
- List of connected VS Code instances
- Their chat sessions
- Ability to send messages and approve/skip commands

## How it works

```
┌─────────────────┐                    ┌─────────────────┐
│   VS Code       │                    │    Browser      │
│   (your PC)     │                    │   (anywhere)    │
└────────┬────────┘                    └────────┬────────┘
         │                                      │
         │  1. Register                         │
         │  2. Poll for messages                │
         │  3. Update inbox                     │
         ▼                                      ▼
    ┌────────────────────────────────────────────────┐
    │              PHP Relay Server                   │
    │         (farooqk.sg-host.com)                  │
    │                                                │
    │  - Stores VS Code registrations                │
    │  - Queues messages from browser               │
    │  - Provides inbox data to browser             │
    └────────────────────────────────────────────────┘
```

## API Endpoints

### VS Code → Server
- `?action=register` - Register VS Code instance
- `?action=heartbeat` - Keep connection alive
- `?action=poll` - Get pending messages
- `?action=update-inbox` - Update inbox state
- `?action=message-processed` - Mark message as processed
- `?action=reply` - Send reply after processing
- `?action=clear-commands` - Clear processed commands

### Browser → Server
- `?action=instances` - List connected VS Code instances
- `?action=inbox&key=xxx` - Get inbox from an instance
- `?action=send&key=xxx` - Send message to VS Code
- `?action=wait-reply&key=xxx&messageId=xxx` - Wait for reply
- `?action=command-action&key=xxx` - Approve/skip command

## Security Notes

- The `data/` directory stores instance info in JSON files
- Instance keys are used to identify VS Code instances
- You may want to add authentication for production use
