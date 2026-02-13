// Types for Remote Chat Control Extension

export interface ThinkingPart {
    id?: string;
    value: string;
    generatedTitle?: string;
}

export interface ToolInvocation {
    toolId: string;
    toolCallId: string;
    generatedTitle?: string;
    invocationMessage?: string;
    pastTenseMessage?: string;
    detailText?: string;
    commandLine?: string;
    cwd?: string;
    isConfirmed?: boolean;
    isComplete?: boolean;
    language?: string;
    output?: string;
    outputLineCount?: number;
    todoList?: Array<{ id?: string | number; title?: string; status?: string }>;
    kind?: 'terminal' | 'todoList' | 'file' | 'edit' | 'other';
}

export interface PendingCommand {
    command: string;
    language?: string;
    toolCallId: string;
}

export interface ThinkingSection {
    thinkingParts: ThinkingPart[];
    toolInvocations: ToolInvocation[];
}

export interface MessageTimelineItem {
    type: 'text' | 'thinking' | 'tool';
    text?: string;
    thinking?: ThinkingPart;
    tool?: ToolInvocation;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
    thinking?: ThinkingSection;  // Grouped thinking with tool invocations
    timeline?: MessageTimelineItem[];
    model?: string;
    timestamp?: number;
    pendingCommand?: PendingCommand;
}

export interface ChatSession {
    sessionId: string;
    filePath: string;
    title?: string;
    createdAt: number;
    lastMessageAt: number;
    messages: ChatMessage[];
    messageCount: number;
    lastModel?: string;
}

export interface Inbox {
    workspaceHash: string;
    workspacePath: string;
    sessions: ChatSession[];
    totalMessages: number;
    lastUpdated: number;
}

export interface VSCodeInstance {
    id: string;
    workspaceHash: string;
    workspaceName: string;
    workspacePath: string;
    lastActive: number;
    isActive: boolean;
}

export interface ServerConfig {
    port: number;
    wsPort: number;
    autoStart: boolean;
}

export interface WebSocketMessage {
    type: 'inbox_update' | 'session_update' | 'message_update' | 'status' | 'command' | 'instances_update';
    data: any;
    timestamp: number;
}

export interface ChatHistoryEntry {
    role: string;
    content: string;
    timestamp: string;
}

export interface CapturedMessage {
    type: string;
    timestamp: string;
    content?: string;
    url?: string;
    request?: string;
    response?: string;
    statusCode?: number;
    path?: string;
}

export interface StorageFile {
    path: string;
    name: string;
    type: string;
    workspaceHash?: string;
    size: number;
    modified: Date;
    rawData?: string;
    messages?: any[];
    userMessages?: any[];
    messageCount?: number;
    userMessageCount?: number;
    content?: string;
}
