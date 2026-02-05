// Types for Remote Chat Control Extension

export interface ThinkingPart {
    title: string;
    content: string;
    id?: string;
}

export interface PendingCommand {
    command: string;
    language?: string;
    toolCallId: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
    thinking?: ThinkingPart[];  // Changed to array to support multiple thinking items
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
