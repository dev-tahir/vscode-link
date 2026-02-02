"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentWorkspaceHash = getCurrentWorkspaceHash;
exports.getInboxForWorkspace = getInboxForWorkspace;
exports.getAllWorkspacesWithChats = getAllWorkspacesWithChats;
exports.getLatestReplyForWorkspace = getLatestReplyForWorkspace;
exports.waitForNewReply = waitForNewReply;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// Get the workspace hash for the current VS Code window
function getCurrentWorkspaceHash() {
    const workspaceStoragePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
    // Find the most recently modified chatSessions folder
    try {
        const folders = fs.readdirSync(workspaceStoragePath, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => {
            const chatSessionsPath = path.join(workspaceStoragePath, d.name, 'chatSessions');
            if (fs.existsSync(chatSessionsPath)) {
                const stats = fs.statSync(chatSessionsPath);
                return { name: d.name, path: chatSessionsPath, mtime: stats.mtime.getTime() };
            }
            return null;
        })
            .filter(f => f !== null)
            .sort((a, b) => b.mtime - a.mtime);
        if (folders.length > 0) {
            return folders[0].name;
        }
    }
    catch (e) {
        console.error('Error finding workspace hash:', e);
    }
    return null;
}
// Get all chat sessions for a specific workspace
function getInboxForWorkspace(workspaceHash) {
    const workspaceStoragePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
    const chatSessionsPath = path.join(workspaceStoragePath, workspaceHash, 'chatSessions');
    const inbox = {
        workspaceHash,
        workspacePath: chatSessionsPath,
        sessions: [],
        totalMessages: 0,
        lastUpdated: Date.now()
    };
    if (!fs.existsSync(chatSessionsPath)) {
        return inbox;
    }
    try {
        const files = fs.readdirSync(chatSessionsPath, { withFileTypes: true })
            .filter(f => f.isFile() && f.name.endsWith('.json'));
        for (const file of files) {
            const filePath = path.join(chatSessionsPath, file.name);
            const session = parseSessionFile(filePath);
            if (session) {
                inbox.sessions.push(session);
                inbox.totalMessages += session.messageCount;
            }
        }
        // Sort sessions by last message time (most recent first)
        inbox.sessions.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    }
    catch (e) {
        console.error('Error reading inbox:', e);
    }
    return inbox;
}
// Parse a single session JSON file
function parseSessionFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        const messages = [];
        let lastModel;
        if (data.requests && Array.isArray(data.requests)) {
            for (const request of data.requests) {
                // Get model for this request
                const model = request.modelId || undefined;
                if (model)
                    lastModel = model;
                // Extract user message
                const userText = request.message?.text ||
                    (request.message?.parts?.find((p) => p.kind === 'text')?.text) || '';
                if (userText) {
                    messages.push({
                        role: 'user',
                        text: userText.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').trim(),
                        timestamp: request.timestamp
                    });
                }
                // Extract assistant response with thinking and file operations
                let assistantText = '';
                let thinking;
                let pendingCommand;
                // First pass: collect all file URI mappings from tool invocations
                const fileUriMap = new Map();
                if (request.response && Array.isArray(request.response)) {
                    // Collect all file URIs from tool invocations first
                    for (const item of request.response) {
                        if (item.kind === 'toolInvocationSerialized' && item.pastTenseMessage?.uris) {
                            for (const [uriKey, uri] of Object.entries(item.pastTenseMessage.uris)) {
                                if (uri && uri.path) {
                                    let filePath = uri.path;
                                    if (filePath.match(/^\/[a-zA-Z]:\//)) {
                                        filePath = filePath.substring(1);
                                    }
                                    const fileName = filePath.split('/').pop() || filePath;
                                    fileUriMap.set(uriKey, { path: filePath, name: fileName });
                                }
                            }
                        }
                        // Check for pending terminal command (no isConfirmed and no terminalCommandState)
                        if (item.kind === 'toolInvocationSerialized' &&
                            item.toolId === 'run_in_terminal' &&
                            item.toolSpecificData?.kind === 'terminal' &&
                            !item.isConfirmed &&
                            !item.toolSpecificData?.terminalCommandState) {
                            pendingCommand = {
                                command: item.toolSpecificData.commandLine?.original ||
                                    item.toolSpecificData.commandLine?.toolEdited || '',
                                language: item.toolSpecificData.language,
                                toolCallId: item.toolCallId
                            };
                        }
                    }
                    // Second pass: build text from all response items
                    for (const item of request.response) {
                        // Check for thinking part
                        if (item.kind === 'thinking' && item.value && item.value.trim()) {
                            thinking = {
                                title: item.generatedTitle || 'Thinking...',
                                content: item.value.trim()
                            };
                        }
                        // Check for inline file references (these are file links in the message)
                        else if (item.kind === 'inlineReference' && item.inlineReference) {
                            const ref = item.inlineReference;
                            let filePath = ref.fsPath || ref.path || '';
                            // Normalize path
                            if (filePath.match(/^\/[a-zA-Z]:\//)) {
                                filePath = filePath.substring(1);
                            }
                            filePath = filePath.replace(/\\/g, '/');
                            const fileName = item.name || filePath.split('/').pop() || 'file';
                            assistantText += `[[FILE|${filePath}|${fileName}]]`;
                        }
                        // Skip tool invocations - they're redundant since files appear via inlineReference
                        // Regular text items (have value but no special kind, or kind is undefined)
                        else if (item.value && typeof item.value === 'string' &&
                            (!item.kind || item.kind === 'markdownContent')) {
                            assistantText += item.value;
                        }
                    }
                    // Apply all file URI replacements (for markdown links in tool invocation messages)
                    for (const [uriKey, fileInfo] of fileUriMap) {
                        const escapedUri = uriKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const linkPattern = new RegExp('\\[[^\\]]*\\]\\(' + escapedUri + '\\)', 'g');
                        assistantText = assistantText.replace(linkPattern, `[[FILE|${fileInfo.path}|${fileInfo.name}]]`);
                    }
                }
                if (assistantText.trim() || pendingCommand) {
                    messages.push({
                        role: 'assistant',
                        text: assistantText.trim(),
                        thinking,
                        model,
                        pendingCommand,
                        timestamp: request.result?.timings?.totalElapsed ?
                            (request.timestamp + request.result.timings.totalElapsed) : request.timestamp
                    });
                }
            }
        }
        return {
            sessionId: data.sessionId || path.basename(filePath, '.json'),
            filePath,
            title: data.customTitle || 'Untitled Session',
            createdAt: data.creationDate || 0,
            lastMessageAt: data.lastMessageDate || 0,
            messages,
            messageCount: messages.length,
            lastModel
        };
    }
    catch (e) {
        console.error(`Error parsing session file ${filePath}:`, e);
        return null;
    }
}
// Get all workspaces that have chat sessions
function getAllWorkspacesWithChats() {
    const workspaceStoragePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
    const workspaces = [];
    try {
        const folders = fs.readdirSync(workspaceStoragePath, { withFileTypes: true })
            .filter(d => d.isDirectory());
        for (const folder of folders) {
            const chatSessionsPath = path.join(workspaceStoragePath, folder.name, 'chatSessions');
            if (fs.existsSync(chatSessionsPath)) {
                const stats = fs.statSync(chatSessionsPath);
                const files = fs.readdirSync(chatSessionsPath).filter(f => f.endsWith('.json'));
                workspaces.push({
                    hash: folder.name,
                    chatSessionsPath,
                    lastModified: stats.mtime.getTime(),
                    sessionCount: files.length
                });
            }
        }
        // Sort by last modified (most recent first)
        workspaces.sort((a, b) => b.lastModified - a.lastModified);
    }
    catch (e) {
        console.error('Error listing workspaces:', e);
    }
    return workspaces;
}
// Get the latest reply for a specific workspace
function getLatestReplyForWorkspace(workspaceHash) {
    const inbox = getInboxForWorkspace(workspaceHash);
    if (inbox.sessions.length === 0) {
        return { success: false, error: 'No sessions found for this workspace' };
    }
    // Get the most recent session
    const latestSession = inbox.sessions[0];
    if (latestSession.messages.length === 0) {
        return { success: false, error: 'No messages in latest session' };
    }
    // Find the last user message and its reply
    let lastUserMsg = '';
    let lastAssistantReply = '';
    for (let i = latestSession.messages.length - 1; i >= 0; i--) {
        const msg = latestSession.messages[i];
        if (msg.role === 'assistant' && !lastAssistantReply) {
            lastAssistantReply = msg.text;
        }
        else if (msg.role === 'user' && !lastUserMsg) {
            lastUserMsg = msg.text;
            if (lastAssistantReply)
                break; // Found both, stop
        }
    }
    return {
        success: true,
        userMessage: lastUserMsg,
        assistantReply: lastAssistantReply,
        sessionId: latestSession.sessionId
    };
}
// Watch for new messages in a workspace (poll-based)
async function waitForNewReply(workspaceHash, afterTimestamp, maxWaitMs = 60000, pollIntervalMs = 2000) {
    const startTime = Date.now();
    while ((Date.now() - startTime) < maxWaitMs) {
        const inbox = getInboxForWorkspace(workspaceHash);
        for (const session of inbox.sessions) {
            // Only check sessions modified after our timestamp
            if (session.lastMessageAt > afterTimestamp) {
                // Find messages after the timestamp
                for (let i = session.messages.length - 1; i >= 0; i--) {
                    const msg = session.messages[i];
                    if (msg.role === 'assistant' && msg.timestamp && msg.timestamp > afterTimestamp) {
                        // Found a new assistant reply!
                        // Find the corresponding user message
                        let userMsg = '';
                        for (let j = i - 1; j >= 0; j--) {
                            if (session.messages[j].role === 'user') {
                                userMsg = session.messages[j].text;
                                break;
                            }
                        }
                        return {
                            success: true,
                            userMessage: userMsg,
                            assistantReply: msg.text,
                            waitedMs: Date.now() - startTime
                        };
                    }
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    return {
        success: false,
        error: `Timeout after ${maxWaitMs}ms - no new reply found`,
        waitedMs: maxWaitMs
    };
}
//# sourceMappingURL=inbox.js.map