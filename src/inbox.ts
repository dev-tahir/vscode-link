// Inbox management for chat sessions
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChatMessage, ChatSession, Inbox, MessageTimelineItem, ThinkingPart, PendingCommand, ThinkingSection, ToolInvocation } from './types';

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
        const sessionsById = new Map<string, ChatSession>();
        
        for (const file of files) {
            const filePath = path.join(chatSessionsPath, file.name);
            const session = parseSessionFile(filePath);
            // Only include sessions that have at least 1 message
            if (session && session.messageCount > 0) {
                const existing = sessionsById.get(session.sessionId);
                if (!existing) {
                    sessionsById.set(session.sessionId, session);
                    continue;
                }

                const isBetterSession =
                    session.lastMessageAt > existing.lastMessageAt ||
                    session.messageCount > existing.messageCount ||
                    (session.filePath.endsWith('.jsonl') && !existing.filePath.endsWith('.jsonl'));

                if (isBetterSession) {
                    sessionsById.set(session.sessionId, session);
                }
            }
        }

        inbox.sessions = Array.from(sessionsById.values());
        inbox.totalMessages = inbox.sessions.reduce((sum, session) => sum + session.messageCount, 0);
        
        // Sort sessions by last message time (most recent first)
        inbox.sessions.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
        
    } catch (e) {
        console.error('Error reading inbox:', e);
    }
    
    return inbox;
}

// Parse JSONL format (JSON Lines) where each line is a JSON object
function parseJSONL(content: string): any {
    const lines: string[] = [];
    let objectStart = -1;
    let braceDepth = 0;
    let inString = false;
    let isEscaped = false;

    for (let index = 0; index < content.length; index++) {
        const ch = content[index];

        if (objectStart === -1) {
            if (ch === '{') {
                objectStart = index;
                braceDepth = 1;
                inString = false;
                isEscaped = false;
            }
            continue;
        }

        if (inString) {
            if (isEscaped) {
                isEscaped = false;
            } else if (ch === '\\') {
                isEscaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{') {
            braceDepth++;
            continue;
        }

        if (ch === '}') {
            braceDepth--;
            if (braceDepth === 0) {
                lines.push(content.slice(objectStart, index + 1));
                objectStart = -1;
            }
        }
    }

    if (lines.length === 0) {
        lines.push(...content.trim().split(/\r\n|\n|\r/).filter(line => !!line.trim()));
    }

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
                    const targetValue = getNestedProperty(data, obj.k);
                    const hasIndex = typeof obj.i === 'number';

                    // Indexed insert into an existing array
                    if (Array.isArray(targetValue) && hasIndex) {
                        const insertValues = Array.isArray(obj.v) ? obj.v : [obj.v];
                        targetValue.splice(obj.i, 0, ...insertValues);
                    // Append-style update into existing array
                    } else if (Array.isArray(targetValue) && Array.isArray(obj.v)) {
                        targetValue.push(...obj.v);
                    // Top-level array append when array already exists
                    } else if (obj.k.length === 1 && Array.isArray(obj.v) && Array.isArray(data[obj.k[0]])) {
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

function getNestedProperty(obj: any, path: string[]): any {
    let current = obj;
    for (const key of path) {
        if (current === null || current === undefined) {
            return undefined;
        }
        current = current[key];
    }
    return current;
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

function collectOuterTextFromObject(value: any): string[] {
    const collected: string[] = [];
    const visited = new Set<any>();

    const visit = (node: any) => {
        if (node === null || node === undefined) return;

        if (typeof node === 'string') {
            if (node.trim()) {
                collected.push(node);
            }
            return;
        }

        if (typeof node !== 'object') return;
        if (visited.has(node)) return;
        visited.add(node);

        if (Array.isArray(node)) {
            for (const entry of node) {
                visit(entry);
            }
            return;
        }

        const textKeys = ['value', 'text', 'markdown', 'content', 'message', 'parts', 'items'];
        for (const key of textKeys) {
            if (Object.prototype.hasOwnProperty.call(node, key)) {
                visit(node[key]);
            }
        }
    };

    visit(value);
    return collected;
}

function extractOuterTextFromCodeBlocks(codeBlocks: any): string {
    if (!Array.isArray(codeBlocks)) return '';

    const parts: string[] = [];
    for (const block of codeBlocks) {
        if (!block || typeof block !== 'object') continue;

        if (typeof block.markdownBeforeBlock === 'string' && block.markdownBeforeBlock.trim()) {
            parts.push(block.markdownBeforeBlock);
        }
        if (typeof block.markdownAfterBlock === 'string' && block.markdownAfterBlock.trim()) {
            parts.push(block.markdownAfterBlock);
        }
    }

    return parts.join('\n').trim();
}

function cleanAssistantOuterText(text: string): string {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const cleaned: string[] = [];

    let index = 0;
    while (index < lines.length) {
        if (lines[index].trim() === '```') {
            let end = index + 1;
            while (end < lines.length && lines[end].trim() === '') {
                end++;
            }

            if (end < lines.length && lines[end].trim() === '```') {
                index = end + 1;
                continue;
            }
        }

        cleaned.push(lines[index]);
        index++;
    }

    return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isUsefulProgressText(text: string): boolean {
    const plain = (text || '').trim();
    if (!plain) return false;

    const genericStatuses = [
        /^thinking\b/i,
        /^running\b/i,
        /^creating edits\b/i,
        /^completed\b/i,
        /^working\b/i,
        /^processing\b/i
    ];

    return !genericStatuses.some(pattern => pattern.test(plain));
}

function normalizeFsPath(rawPath: string): string {
    let fp = rawPath || '';
    if (fp.match(/^\/[a-zA-Z]:\//)) {
        fp = fp.substring(1);
    }
    return fp.replace(/\\/g, '/');
}

function replaceUriLinksWithFileTokens(text: string, fileUriMap: Map<string, { path: string; name: string }>): string {
    let output = text;
    for (const [uriKey, fileInfo] of fileUriMap) {
        if (!fileInfo.path) continue;
        const escapedUri = uriKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const linkPattern = new RegExp('\\[[^\\]]*\\]\\(' + escapedUri + '\\)', 'g');
        output = output.replace(linkPattern, `[[FILE|${fileInfo.path}|${fileInfo.name}]]`);
    }
    return output;
}

function getToolDisplayText(item: any): string {
    const past = item?.pastTenseMessage?.value;
    const invocation = item?.invocationMessage?.value;
    return (past || invocation || '').trim();
}

function getToolFallbackTitle(item: any): string {
    const toolId = item?.toolId || 'tool';
    const toolKind = item?.toolSpecificData?.kind;

    if (toolKind === 'terminal') {
        const command = item?.toolSpecificData?.commandLine?.original || item?.toolSpecificData?.commandLine?.toolEdited || '';
        if (typeof command === 'string' && command.trim()) {
            const short = command.trim().split('\n')[0];
            return `Ran command: ${short.length > 120 ? short.slice(0, 120) + '…' : short}`;
        }
        return 'Ran terminal command';
    }

    if (toolKind === 'todoList') {
        const todos = item?.toolSpecificData?.todoList;
        const count = Array.isArray(todos) ? todos.length : 0;
        return count > 0 ? `Updated todo list (${count} item${count !== 1 ? 's' : ''})` : 'Updated todo list';
    }

    return toolId;
}

function isConfirmedTool(item: any): boolean {
    const confirmedType = item?.isConfirmed?.type;
    if (typeof confirmedType === 'number') {
        return confirmedType !== 0;
    }
    return !!item?.isConfirmed;
}

function getReadableValue(value: any): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';

    if (typeof value.fsPath === 'string' && value.fsPath.trim()) return value.fsPath;
    if (typeof value.path === 'string' && value.path.trim()) return value.path;
    if (typeof value.external === 'string' && value.external.trim()) return value.external;

    return '';
}

function getPendingApprovalReason(item: any): string {
    const confirmation = item?.toolSpecificData?.confirmation;
    const explicitMessage = confirmation?.message;
    if (typeof explicitMessage === 'string' && explicitMessage.trim()) {
        return explicitMessage.trim();
    }

    const confirmationCommand = confirmation?.commandLine;
    if (typeof confirmationCommand === 'string' && confirmationCommand.trim()) {
        return `Requires approval before running: ${confirmationCommand.trim()}`;
    }

    const cwdLabel = getReadableValue(confirmation?.cwdLabel) || getReadableValue(item?.toolSpecificData?.cwd);
    if (typeof cwdLabel === 'string' && cwdLabel.trim()) {
        return `Requires approval to run in: ${cwdLabel.trim()}`;
    }

    return 'Requires manual approval before command execution.';
}

function isPendingTerminalApproval(item: any, commandLine: string): boolean {
    if (item?.toolSpecificData?.kind !== 'terminal') {
        return false;
    }

    if (!commandLine || !commandLine.trim()) {
        return false;
    }

    const isConfirmed = isConfirmedTool(item);
    if (isConfirmed) {
        return false;
    }

    const terminalState = item?.toolSpecificData?.terminalCommandState;
    const hasTerminalState = terminalState !== undefined && terminalState !== null;
    if (!hasTerminalState) {
        return true;
    }

    const stateType = typeof terminalState;
    if (stateType === 'string') {
        const normalized = terminalState.toLowerCase();
        return normalized !== 'completed' && normalized !== 'done' && normalized !== 'failed' && normalized !== 'cancelled';
    }

    if (stateType === 'object') {
        const status = String(terminalState.status || terminalState.state || '').toLowerCase();
        if (!status) return true;
        return status !== 'completed' && status !== 'done' && status !== 'failed' && status !== 'cancelled';
    }

    return true;
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
                const timeline: MessageTimelineItem[] = [];
                const outerTextSegments: string[] = [];
                const progressTextSegments: string[] = [];

                const pushTextSegment = (segment: string) => {
                    if (!segment) return;
                    outerTextSegments.push(segment);
                    timeline.push({ type: 'text', text: segment });
                };
                
                // Collect file URI mappings from tool invocations
                const fileUriMap: Map<string, { path: string; name: string }> = new Map();
                
                if (request.response && Array.isArray(request.response)) {
                    // First pass: collect all file URIs and process items
                    for (const item of request.response) {
                        // Collect thinking parts
                        if (item.kind === 'thinking' && typeof item.value === 'string') {
                            // Skip empty thinking markers (vscodeReasoningDone)
                            if (item.value.trim()) {
                                const thinkingPart: ThinkingPart = {
                                    id: item.id,
                                    value: item.value.trim(),
                                    generatedTitle: item.generatedTitle
                                };
                                thinkingParts.push(thinkingPart);
                                timeline.push({ type: 'thinking', thinking: thinkingPart });
                            }
                        }
                        
                        // Collect tool invocations
                        if (item.kind === 'toolInvocationSerialized') {
                            const detailText = getToolDisplayText(item);
                            const fallbackTitle = getToolFallbackTitle(item);
                            const toolInvocation: ToolInvocation = {
                                toolId: item.toolId || 'unknown',
                                toolCallId: item.toolCallId || '',
                                generatedTitle: item.generatedTitle || '',
                                invocationMessage: item.invocationMessage?.value || '',
                                pastTenseMessage: item.pastTenseMessage?.value || '',
                                detailText: detailText || fallbackTitle,
                                isConfirmed: isConfirmedTool(item),
                                isComplete: item.isComplete || false
                            };
                            
                            // Handle terminal commands
                            if (item.toolSpecificData?.kind === 'terminal') {
                                toolInvocation.kind = 'terminal';
                                toolInvocation.commandLine = item.toolSpecificData.commandLine?.original || 
                                                             item.toolSpecificData.commandLine?.toolEdited || '';
                                const terminalCommandLine = toolInvocation.commandLine || '';
                                toolInvocation.language = item.toolSpecificData.language;
                                toolInvocation.cwd = getReadableValue(item.toolSpecificData.cwd) || '';
                                const outputText = item.toolSpecificData.terminalCommandOutput?.text || item.toolSpecificData.output || '';
                                toolInvocation.output = typeof outputText === 'string' ? outputText : '';
                                const outputLines = item.toolSpecificData.terminalCommandOutput?.lineCount;
                                if (typeof outputLines === 'number') {
                                    toolInvocation.outputLineCount = outputLines;
                                }
                                
                                // Check for pending (not confirmed) commands
                                const pendingApproval = isPendingTerminalApproval(item, terminalCommandLine);
                                if (pendingApproval) {
                                    const approvalReason = getPendingApprovalReason(item);
                                    const approvalCwd = getReadableValue(item.toolSpecificData?.confirmation?.cwdLabel) || toolInvocation.cwd;
                                    const approvalCommand = item.toolSpecificData?.confirmation?.commandLine;

                                    toolInvocation.requiresApproval = true;
                                    toolInvocation.approvalReason = approvalReason;
                                    toolInvocation.approvalCwd = approvalCwd;
                                    toolInvocation.approvalCommand = approvalCommand;

                                    pendingCommand = {
                                        command: terminalCommandLine,
                                        language: toolInvocation.language,
                                        toolCallId: toolInvocation.toolCallId,
                                        reason: approvalReason,
                                        cwd: approvalCwd,
                                        confirmationCommand: approvalCommand
                                    };
                                }
                            } else if (item.toolSpecificData?.kind === 'todoList') {
                                toolInvocation.kind = 'todoList';
                                if (Array.isArray(item.toolSpecificData.todoList)) {
                                    toolInvocation.todoList = item.toolSpecificData.todoList.map((todo: any) => ({
                                        id: todo?.id,
                                        title: todo?.title,
                                        status: todo?.status
                                    }));
                                }
                            }
                            
                            // Collect file URIs
                            if (item.pastTenseMessage?.uris) {
                                for (const [uriKey, uri] of Object.entries(item.pastTenseMessage.uris) as [string, any][]) {
                                    if (uri && uri.path) {
                                        const fp = normalizeFsPath(uri.path);
                                        if (!fp) continue;
                                        const fileName = fp.split('/').pop() || fp;
                                        fileUriMap.set(uriKey, { path: fp, name: fileName });
                                    }
                                }
                            }

                            if (item.invocationMessage?.uris) {
                                for (const [uriKey, uri] of Object.entries(item.invocationMessage.uris) as [string, any][]) {
                                    if (uri && uri.path && !fileUriMap.has(uriKey)) {
                                        const fp = normalizeFsPath(uri.path);
                                        if (!fp) continue;
                                        const fileName = fp.split('/').pop() || fp;
                                        fileUriMap.set(uriKey, { path: fp, name: fileName });
                                    }
                                }
                            }

                            toolInvocation.detailText = replaceUriLinksWithFileTokens(toolInvocation.detailText || '', fileUriMap);
                            toolInvocation.pastTenseMessage = replaceUriLinksWithFileTokens(toolInvocation.pastTenseMessage || '', fileUriMap);
                            toolInvocation.invocationMessage = replaceUriLinksWithFileTokens(toolInvocation.invocationMessage || '', fileUriMap);
                            
                            toolInvocations.push(toolInvocation);
                            timeline.push({ type: 'tool', tool: toolInvocation });
                        }
                        
                        // Collect text responses
                        if (item.kind === 'progressTaskSerialized' && typeof item.content?.value === 'string') {
                            const progressText = item.content.value.trim();
                            if (isUsefulProgressText(progressText)) {
                                progressTextSegments.push(progressText);
                            }
                        }

                        if (item.kind === 'inlineReference' && item.inlineReference) {
                            const ref = item.inlineReference;
                            const fp = normalizeFsPath(ref.fsPath || ref.path || '');
                            if (fp) {
                                const fileName = item.name || fp.split('/').pop() || 'file';
                                pushTextSegment(`[[FILE|${fp}|${fileName}]]`);
                            }
                        } else if (item.value !== undefined) {
                            // Handle text responses
                            if (!item.kind || 
                                item.kind === 'markdownContent' ||
                                (item.kind !== 'mcpServersStarting' && 
                                 item.kind !== 'progressTaskSerialized' &&
                                 item.kind !== 'toolInvocationSerialized' &&
                                 item.kind !== 'thinking' &&
                                 item.kind !== 'textEditGroup')) {
                                if (typeof item.value === 'string') {
                                    pushTextSegment(item.value);
                                } else {
                                    for (const textPart of collectOuterTextFromObject(item.value)) {
                                        pushTextSegment(textPart);
                                    }
                                }
                            }
                        }
                    }

                    assistantText += outerTextSegments.join('');
                    assistantText = cleanAssistantOuterText(assistantText);
                    
                    // Apply file URI replacements
                    assistantText = replaceUriLinksWithFileTokens(assistantText, fileUriMap);

                    if (!assistantText.trim()) {
                        assistantText = extractOuterTextFromCodeBlocks(request.result?.metadata?.codeBlocks);
                        assistantText = cleanAssistantOuterText(assistantText);
                        if (assistantText) {
                            timeline.push({ type: 'text', text: assistantText });
                        }
                    }

                    if (!assistantText.trim() && progressTextSegments.length > 0) {
                        assistantText = cleanAssistantOuterText(progressTextSegments.join('\n'));
                        if (assistantText) {
                            timeline.push({ type: 'text', text: assistantText });
                        }
                    }

                    for (const segment of timeline) {
                        if (segment.type === 'text' && segment.text) {
                            segment.text = replaceUriLinksWithFileTokens(segment.text, fileUriMap);
                        }
                    }
                }

                if (assistantText.trim() || pendingCommand || thinkingParts.length > 0 || toolInvocations.length > 0 || (request.response && request.response.length > 0)) {
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

                    // Determine message status from modelState
                    let messageStatus: 'complete' | 'in-progress' | 'canceled' | 'error' = 'complete';
                    if (request.modelState) {
                        if (request.modelState.completedAt) {
                            messageStatus = 'complete';
                        } else if (request.modelState.value === 0) {
                            messageStatus = 'in-progress';
                        }
                    } else if (request.isCanceled) {
                        messageStatus = 'canceled';
                    } else if (request.result?.error) {
                        messageStatus = 'error';
                    } else if (pendingCommand) {
                        messageStatus = 'in-progress';
                    }
                    
                    messages.push({
                        role: 'assistant',
                        text: assistantText.trim(),
                        thinking: thinkingSection,
                        timeline: timeline.filter(segment => {
                            if (segment.type === 'text') return !!segment.text && segment.text.trim().length > 0;
                            if (segment.type === 'thinking') return !!segment.thinking?.value;
                            return !!segment.tool;
                        }),
                        model,
                        pendingCommand,
                        timestamp: assistantTimestamp,
                        status: messageStatus
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

// Wait for new messages in a workspace using fs.watch for instant detection
export async function waitForNewReply(
    workspaceHash: string, 
    afterTimestamp: number,
    maxWaitMs: number = 60000,
    pollIntervalMs: number = 500
): Promise<{
    success: boolean;
    userMessage?: string;
    assistantReply?: string;
    waitedMs?: number;
    error?: string;
}> {
    const startTime = Date.now();
    const chatSessionsPath = path.join(
        os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage',
        workspaceHash, 'chatSessions'
    );

    // Helper to check for new reply in inbox
    const checkForReply = (): { found: boolean; userMessage?: string; assistantReply?: string } => {
        const inboxData = getInboxForWorkspace(workspaceHash);
        
        for (const session of inboxData.sessions) {
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
                        return { found: true, userMessage: userMsg, assistantReply: msg.text };
                    }
                }
            }
        }
        return { found: false };
    };

    // Immediate check first
    const immediate = checkForReply();
    if (immediate.found) {
        return {
            success: true,
            userMessage: immediate.userMessage,
            assistantReply: immediate.assistantReply,
            waitedMs: Date.now() - startTime
        };
    }

    // Use fs.watch for instant file change detection + fallback poll
    return new Promise((resolve) => {
        let watcher: fs.FSWatcher | null = null;
        let fallbackInterval: NodeJS.Timeout | null = null;
        let timeoutTimer: NodeJS.Timeout | null = null;
        let resolved = false;
        let checkDebounce: NodeJS.Timeout | null = null;

        const cleanup = () => {
            if (resolved) return;
            resolved = true;
            if (watcher) { try { watcher.close(); } catch {} watcher = null; }
            if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null; }
            if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
            if (checkDebounce) { clearTimeout(checkDebounce); checkDebounce = null; }
        };

        const doCheck = () => {
            if (resolved) return;
            try {
                const result = checkForReply();
                if (result.found) {
                    cleanup();
                    resolve({
                        success: true,
                        userMessage: result.userMessage,
                        assistantReply: result.assistantReply,
                        waitedMs: Date.now() - startTime
                    });
                }
            } catch {}
        };

        // Debounced check - coalesces rapid file changes into one check
        const debouncedCheck = () => {
            if (checkDebounce) clearTimeout(checkDebounce);
            checkDebounce = setTimeout(doCheck, 80);
        };

        // Start watching the chatSessions folder for changes
        if (fs.existsSync(chatSessionsPath)) {
            try {
                watcher = fs.watch(chatSessionsPath, { persistent: false, recursive: true }, (eventType, filename) => {
                    if (filename && (filename.endsWith('.json') || filename.endsWith('.jsonl'))) {
                        debouncedCheck();
                    }
                });
                watcher.on('error', () => {}); // Ignore watcher errors
            } catch {}
        }

        // Fallback poll in case fs.watch misses events (reduced to 500ms)
        fallbackInterval = setInterval(doCheck, pollIntervalMs);

        // Timeout
        timeoutTimer = setTimeout(() => {
            cleanup();
            resolve({
                success: false,
                error: `Timeout after ${maxWaitMs}ms - no new reply found`,
                waitedMs: maxWaitMs
            });
        }, maxWaitMs);
    });
}
