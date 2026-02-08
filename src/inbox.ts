// Inbox management for chat sessions
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChatMessage, ChatSession, Inbox, ThinkingPart, PendingCommand, ThinkingSection, ToolInvocation } from './types';

// Get the workspace hash for the current VS Code window
export function getCurrentWorkspaceHash(): string | null {
    const workspaceStoragePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
    
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
            .sort((a, b) => b!.mtime - a!.mtime);
        
        if (folders.length > 0) {
            return folders[0]!.name;
        }
    } catch (e) {
        console.error('Error finding workspace hash:', e);
    }
    return null;
}

// Get all chat sessions for a specific workspace
export function getInboxForWorkspace(workspaceHash: string): Inbox {
    const workspaceStoragePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
    const chatSessionsPath = path.join(workspaceStoragePath, workspaceHash, 'chatSessions');
    
    const inbox: Inbox = {
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
            .filter(f => f.isFile() && (f.name.endsWith('.json') || f.name.endsWith('.jsonl')));
        
        for (const file of files) {
            const filePath = path.join(chatSessionsPath, file.name);
            const session = parseSessionFile(filePath);
            // Only include sessions that have at least 1 message
            if (session && session.messageCount > 0) {
                inbox.sessions.push(session);
                inbox.totalMessages += session.messageCount;
            }
        }
        
        // Sort sessions by last message time (most recent first)
        inbox.sessions.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
        
    } catch (e) {
        console.error('Error reading inbox:', e);
    }
    
    return inbox;
}

// Parse JSONL format (JSON Lines) where each line is a JSON object
function parseJSONL(content: string): any {
    const lines = content.trim().split('\n');
    let data: any = {};
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
            const obj = JSON.parse(line);
            
            if (obj.kind === 0) {
                // Initial data - merge with existing data
                data = { ...data, ...obj.v };
            } else if (obj.kind === 1) {
                // Field update - set nested field
                if (obj.k && Array.isArray(obj.k)) {
                    setNestedProperty(data, obj.k, obj.v);
                }
            } else if (obj.kind === 2) {
                // Array/complex update
                if (obj.k && Array.isArray(obj.k) && obj.k.length > 0) {
                    // Special handling for top-level array updates (appending)
                    if (obj.k.length === 1 && Array.isArray(obj.v) && Array.isArray(data[obj.k[0]])) {
                        // Append array elements instead of replacing
                        data[obj.k[0]].push(...obj.v);
                    } else {
                        // For nested paths, use setNestedProperty
                        setNestedProperty(data, obj.k, obj.v);
                    }
                }
            }
        } catch (e) {
            // Skip invalid lines
            console.error('Error parsing JSONL line:', e);
        }
    }
    
    return data;
}

// Helper function to set a nested property using a path array
function setNestedProperty(obj: any, path: string[], value: any) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        const nextKey = path[i + 1];
        
        // Check if next key is a number (array index)
        const nextIsArrayIndex = /^\d+$/.test(nextKey);
        
        if (!(key in current)) {
            // Initialize as array if next key is numeric, otherwise as object
            current[key] = nextIsArrayIndex ? [] : {};
        }
        
        // If current[key] is an array and nextKey is numeric, ensure array is long enough
        if (Array.isArray(current[key]) && nextIsArrayIndex) {
            const index = parseInt(nextKey);
            while (current[key].length <= index) {
                current[key].push({});
            }
        }
        
        current = current[key];
    }
    const lastKey = path[path.length - 1];
    current[lastKey] = value;
}

// Parse a single session JSON or JSONL file
function parseSessionFile(filePath: string): ChatSession | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Check if it's JSONL format (multiple JSON objects, one per line)
        let data: any;
        if (filePath.endsWith('.jsonl')) {
            // Parse JSONL format - each line is a JSON object
            data = parseJSONL(content);
        } else {
            // Parse regular JSON format
            data = JSON.parse(content);
        }
        
        const messages: ChatMessage[] = [];
        let lastModel: string | undefined;
        
        if (data.requests && Array.isArray(data.requests)) {
            for (const request of data.requests) {
                // Skip undefined or null requests
                if (!request || typeof request !== 'object') {
                    continue;
                }
                
                const model = request.modelId || undefined;
                if (model) lastModel = model;
                
                // Extract user message
                const userText = request.message?.text || 
                    (request.message?.parts?.find((p: any) => p.kind === 'text')?.text) || '';
                
                if (userText) {
                    messages.push({
                        role: 'user',
                        text: userText.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').trim(),
                        timestamp: request.timestamp
                    });
                }
                
                // Extract assistant response with thinking and file operations
                let assistantText = '';
                const thinkingParts: ThinkingPart[] = [];
                const toolInvocations: ToolInvocation[] = [];
                let pendingCommand: PendingCommand | undefined;
                
                // Collect file URI mappings from tool invocations
                const fileUriMap: Map<string, { path: string; name: string }> = new Map();
                
                if (request.response && Array.isArray(request.response)) {
                    // First pass: collect all file URIs and process items
                    for (const item of request.response) {
                        // Collect thinking parts
                        if (item.kind === 'thinking' && item.value) {
                            // Skip empty thinking markers (vscodeReasoningDone)
                            if (item.value.trim()) {
                                thinkingParts.push({
                                    id: item.id,
                                    value: item.value.trim(),
                                    generatedTitle: item.generatedTitle
                                });
                            }
                        }
                        
                        // Collect tool invocations
                        if (item.kind === 'toolInvocationSerialized') {
                            const toolInvocation: ToolInvocation = {
                                toolId: item.toolId || 'unknown',
                                toolCallId: item.toolCallId || '',
                                invocationMessage: item.invocationMessage?.value || '',
                                pastTenseMessage: item.pastTenseMessage?.value || '',
                                isConfirmed: item.isConfirmed?.type === 1,
                                isComplete: item.isComplete || false
                            };
                            
                            // Handle terminal commands
                            if (item.toolSpecificData?.kind === 'terminal') {
                                toolInvocation.kind = 'terminal';
                                toolInvocation.commandLine = item.toolSpecificData.commandLine?.original || 
                                                             item.toolSpecificData.commandLine?.toolEdited || '';
                                toolInvocation.language = item.toolSpecificData.language;
                                toolInvocation.output = item.toolSpecificData.output || '';
                                
                                // Check for pending (not confirmed) commands
                                if (!item.isConfirmed && !item.toolSpecificData.terminalCommandState && toolInvocation.commandLine) {
                                    pendingCommand = {
                                        command: toolInvocation.commandLine,
                                        language: toolInvocation.language,
                                        toolCallId: toolInvocation.toolCallId
                                    };
                                }
                            }
                            
                            // Collect file URIs
                            if (item.pastTenseMessage?.uris) {
                                for (const [uriKey, uri] of Object.entries(item.pastTenseMessage.uris) as [string, any][]) {
                                    if (uri && uri.path) {
                                        let fp = uri.path;
                                        if (fp.match(/^\/[a-zA-Z]:\//)) {
                                            fp = fp.substring(1);
                                        }
                                        const fileName = fp.split('/').pop() || fp;
                                        fileUriMap.set(uriKey, { path: fp, name: fileName });
                                    }
                                }
                            }
                            
                            toolInvocations.push(toolInvocation);
                        }
                        
                        // Collect text responses
                        if (item.kind === 'inlineReference' && item.inlineReference) {
                            const ref = item.inlineReference;
                            let fp = ref.fsPath || ref.path || '';
                            if (fp.match(/^\/[a-zA-Z]:\//)) {
                                fp = fp.substring(1);
                            }
                            fp = fp.replace(/\\/g, '/');
                            const fileName = item.name || fp.split('/').pop() || 'file';
                            assistantText += `[[FILE|${fp}|${fileName}]]`;
                        } else if (item.value && typeof item.value === 'string') {
                            // Handle text responses
                            if (!item.kind || 
                                item.kind === 'markdownContent' ||
                                (item.kind !== 'mcpServersStarting' && 
                                 item.kind !== 'progressTaskSerialized' &&
                                 item.kind !== 'toolInvocationSerialized' &&
                                 item.kind !== 'thinking' &&
                                 item.kind !== 'textEditGroup')) {
                                assistantText += item.value;
                            }
                        }
                    }
                    
                    // Apply file URI replacements
                    for (const [uriKey, fileInfo] of fileUriMap) {
                        const escapedUri = uriKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const linkPattern = new RegExp('\\[[^\\]]*\\]\\(' + escapedUri + '\\)', 'g');
                        assistantText = assistantText.replace(linkPattern, `[[FILE|${fileInfo.path}|${fileInfo.name}]]`);
                    }
                }
                
                if (assistantText.trim() || pendingCommand || thinkingParts.length > 0 || toolInvocations.length > 0) {
                    const assistantTimestamp = request.result?.timings?.totalElapsed ? 
                        (request.timestamp + request.result.timings.totalElapsed) : request.timestamp;
                    
                    // Create thinking section if we have thinking or tool invocations
                    let thinkingSection: ThinkingSection | undefined;
                    if (thinkingParts.length > 0 || toolInvocations.length > 0) {
                        thinkingSection = {
                            thinkingParts,
                            toolInvocations
                        };
                    }
                    
                    messages.push({
                        role: 'assistant',
                        text: assistantText.trim(),
                        thinking: thinkingSection,
                        model,
                        pendingCommand,
                        timestamp: assistantTimestamp
                    });
                }
            }
        }
        
        // Calculate lastMessageAt from the last message timestamp
        const lastMessageAt = messages.length > 0 ? 
            (messages[messages.length - 1].timestamp || 0) : 
            (data.creationDate || 0);
        
        return {
            sessionId: data.sessionId || path.basename(filePath).replace(/\.(json|jsonl)$/, ''),
            filePath,
            title: data.customTitle || 'Untitled Session',
            createdAt: data.creationDate || 0,
            lastMessageAt,
            messages,
            messageCount: messages.length,
            lastModel
        };
    } catch (e) {
        console.error(`Error parsing session file ${filePath}:`, e);
        return null;
    }
}

// Get all workspaces that have chat sessions
export function getAllWorkspacesWithChats(): Array<{hash: string, chatSessionsPath: string, lastModified: number, sessionCount: number}> {
    const workspaceStoragePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
    const workspaces: Array<{hash: string, chatSessionsPath: string, lastModified: number, sessionCount: number}> = [];
    
    try {
        const folders = fs.readdirSync(workspaceStoragePath, { withFileTypes: true })
            .filter(d => d.isDirectory());
        
        for (const folder of folders) {
            const chatSessionsPath = path.join(workspaceStoragePath, folder.name, 'chatSessions');
            if (fs.existsSync(chatSessionsPath)) {
                const stats = fs.statSync(chatSessionsPath);
                const files = fs.readdirSync(chatSessionsPath).filter(f => f.endsWith('.json') || f.endsWith('.jsonl'));
                workspaces.push({
                    hash: folder.name,
                    chatSessionsPath,
                    lastModified: stats.mtime.getTime(),
                    sessionCount: files.length
                });
            }
        }
        
        workspaces.sort((a, b) => b.lastModified - a.lastModified);
        
    } catch (e) {
        console.error('Error listing workspaces:', e);
    }
    
    return workspaces;
}

// Get the latest reply for a specific workspace
export function getLatestReplyForWorkspace(workspaceHash: string): {
    success: boolean;
    userMessage?: string;
    assistantReply?: string;
    sessionId?: string;
    error?: string;
} {
    const inbox = getInboxForWorkspace(workspaceHash);
    
    if (inbox.sessions.length === 0) {
        return { success: false, error: 'No sessions found for this workspace' };
    }
    
    const latestSession = inbox.sessions[0];
    
    if (latestSession.messages.length === 0) {
        return { success: false, error: 'No messages in latest session' };
    }
    
    let lastUserMsg = '';
    let lastAssistantReply = '';
    
    for (let i = latestSession.messages.length - 1; i >= 0; i--) {
        const msg = latestSession.messages[i];
        if (msg.role === 'assistant' && !lastAssistantReply) {
            lastAssistantReply = msg.text;
        } else if (msg.role === 'user' && !lastUserMsg) {
            lastUserMsg = msg.text;
            if (lastAssistantReply) break;
        }
    }
    
    return {
        success: true,
        userMessage: lastUserMsg,
        assistantReply: lastAssistantReply,
        sessionId: latestSession.sessionId
    };
}

// Wait for new messages in a workspace (poll-based)
export async function waitForNewReply(
    workspaceHash: string, 
    afterTimestamp: number,
    maxWaitMs: number = 60000,
    pollIntervalMs: number = 2000
): Promise<{
    success: boolean;
    userMessage?: string;
    assistantReply?: string;
    waitedMs?: number;
    error?: string;
}> {
    const startTime = Date.now();
    
    while ((Date.now() - startTime) < maxWaitMs) {
        const inbox = getInboxForWorkspace(workspaceHash);
        
        for (const session of inbox.sessions) {
            if (session.lastMessageAt > afterTimestamp) {
                for (let i = session.messages.length - 1; i >= 0; i--) {
                    const msg = session.messages[i];
                    if (msg.role === 'assistant' && msg.timestamp && msg.timestamp > afterTimestamp) {
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
