// Instance Manager - Coordinates multiple VS Code windows with a single shared server
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import WebSocket from 'ws';
import { VSCodeInstance } from './types';

// Lock file location (in temp directory for all windows to access)
const LOCK_FILE_PATH = path.join(os.tmpdir(), 'remotechatcontrol.lock');
const HEARTBEAT_INTERVAL = 5000; // 5 seconds
const LOCK_TIMEOUT = 15000; // 15 seconds - consider master dead if no heartbeat

export type InstanceRole = 'master' | 'slave' | 'standalone';

export interface InstanceInfo {
    workspaceHash: string;
    workspaceName: string;
    workspacePath: string;
    pid: number;
    lastActive: number;
}

export interface LockFileData {
    masterPid: number;
    masterPort: number;
    masterWsPort: number;
    lastHeartbeat: number;
    instances: { [workspaceHash: string]: InstanceInfo };
}

let currentRole: InstanceRole = 'standalone';
let lockHeartbeatInterval: NodeJS.Timeout | null = null;
let masterCheckInterval: NodeJS.Timeout | null = null;
let slaveWsConnection: WebSocket | null = null;
let localInstance: InstanceInfo | null = null;
let outputChannel: vscode.OutputChannel | null = null;
let onRoleChangeCallback: ((role: InstanceRole, lockData?: LockFileData) => void) | null = null;
let onInstancesUpdateCallback: ((instances: InstanceInfo[]) => void) | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function log(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[InstanceManager] ${msg}`);
    outputChannel?.appendLine(`[${timestamp}] [InstanceManager] ${msg}`);
}

export function initInstanceManager(channel: vscode.OutputChannel) {
    outputChannel = channel;
    log('Instance manager initialized');
}

export function setLocalInstance(workspaceHash: string, workspaceName: string, workspacePath: string) {
    localInstance = {
        workspaceHash,
        workspaceName,
        workspacePath,
        pid: process.pid,
        lastActive: Date.now()
    };
    log(`Local instance set: ${workspaceName} (${workspaceHash})`);
}

export function onRoleChange(callback: (role: InstanceRole, lockData?: LockFileData) => void) {
    onRoleChangeCallback = callback;
}

export function onInstancesUpdate(callback: (instances: InstanceInfo[]) => void) {
    onInstancesUpdateCallback = callback;
}

export function getCurrentRole(): InstanceRole {
    return currentRole;
}

export function getLocalInstance(): InstanceInfo | null {
    return localInstance;
}

// Check if lock file exists and is valid (master is alive)
function readLockFile(): LockFileData | null {
    try {
        if (!fs.existsSync(LOCK_FILE_PATH)) {
            return null;
        }
        const content = fs.readFileSync(LOCK_FILE_PATH, 'utf-8');
        const data: LockFileData = JSON.parse(content);
        
        // Check if master is still alive (heartbeat not too old)
        const now = Date.now();
        if (now - data.lastHeartbeat > LOCK_TIMEOUT) {
            log(`Master heartbeat expired (${now - data.lastHeartbeat}ms old), lock is stale`);
            return null;
        }
        
        return data;
    } catch (e) {
        log(`Error reading lock file: ${e}`);
        return null;
    }
}

// Write lock file (only master should do this)
function writeLockFile(data: LockFileData): boolean {
    try {
        fs.writeFileSync(LOCK_FILE_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        log(`Error writing lock file: ${e}`);
        return false;
    }
}

// Delete lock file
function deleteLockFile(): boolean {
    try {
        if (fs.existsSync(LOCK_FILE_PATH)) {
            fs.unlinkSync(LOCK_FILE_PATH);
        }
        return true;
    } catch (e) {
        log(`Error deleting lock file: ${e}`);
        return false;
    }
}

// Try to become master
export async function tryBecomeMaster(port: number, wsPort: number): Promise<boolean> {
    const existingLock = readLockFile();
    
    if (existingLock) {
        // Check if master is actually reachable
        const isAlive = await checkMasterAlive(existingLock.masterPort);
        if (isAlive) {
            log(`Master already exists on port ${existingLock.masterPort}, becoming slave`);
            return false;
        } else {
            log('Master lock exists but server unreachable, taking over');
        }
    }
    
    // Create lock file as master
    const lockData: LockFileData = {
        masterPid: process.pid,
        masterPort: port,
        masterWsPort: wsPort,
        lastHeartbeat: Date.now(),
        instances: {}
    };
    
    // Add ourselves to instances
    if (localInstance) {
        lockData.instances[localInstance.workspaceHash] = localInstance;
    }
    
    if (writeLockFile(lockData)) {
        currentRole = 'master';
        startMasterHeartbeat(port, wsPort);
        log(`Became MASTER on port ${port}`);
        onRoleChangeCallback?.('master', lockData);
        return true;
    }
    
    return false;
}

// Check if master server is actually responding
async function checkMasterAlive(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 2000);
        
        const req = http.request({
            hostname: 'localhost',
            port: port,
            path: '/api/status',
            method: 'GET',
            timeout: 2000
        }, (res) => {
            clearTimeout(timeout);
            resolve(res.statusCode === 200);
        });
        
        req.on('error', () => {
            clearTimeout(timeout);
            resolve(false);
        });
        
        req.on('timeout', () => {
            req.destroy();
            clearTimeout(timeout);
            resolve(false);
        });
        
        req.end();
    });
}

// Start heartbeat interval (master only)
function startMasterHeartbeat(port: number, wsPort: number) {
    if (lockHeartbeatInterval) {
        clearInterval(lockHeartbeatInterval);
    }
    
    lockHeartbeatInterval = setInterval(() => {
        const lockData = readLockFile();
        if (lockData && lockData.masterPid === process.pid) {
            lockData.lastHeartbeat = Date.now();
            
            // Update our instance's lastActive
            if (localInstance && lockData.instances[localInstance.workspaceHash]) {
                lockData.instances[localInstance.workspaceHash].lastActive = Date.now();
            }
            
            writeLockFile(lockData);
        } else {
            // Someone else took over or lock was deleted
            log('Lost master lock, stopping heartbeat');
            stopMasterHeartbeat();
            currentRole = 'standalone';
            onRoleChangeCallback?.('standalone');
        }
    }, HEARTBEAT_INTERVAL);
}

function stopMasterHeartbeat() {
    if (lockHeartbeatInterval) {
        clearInterval(lockHeartbeatInterval);
        lockHeartbeatInterval = null;
    }
}

// Connect as slave to master server
export async function connectAsSlave(): Promise<boolean> {
    const lockData = readLockFile();
    if (!lockData) {
        log('No lock file found, cannot connect as slave');
        return false;
    }
    
    return new Promise((resolve) => {
        try {
            const wsUrl = `ws://localhost:${lockData.masterWsPort}`;
            log(`Connecting as slave to ${wsUrl}`);
            
            slaveWsConnection = new WebSocket(wsUrl);
            
            slaveWsConnection.on('open', () => {
                log('Connected to master as slave');
                currentRole = 'slave';
                reconnectAttempts = 0;
                
                // Register ourselves with master
                if (localInstance) {
                    slaveWsConnection?.send(JSON.stringify({
                        type: 'register_instance',
                        instance: localInstance
                    }));
                }
                
                onRoleChangeCallback?.('slave', lockData);
                startMasterCheck();
                resolve(true);
            });
            
            slaveWsConnection.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    handleMasterMessage(msg);
                } catch (e) {
                    log(`Error parsing master message: ${e}`);
                }
            });
            
            slaveWsConnection.on('close', () => {
                log('Disconnected from master');
                slaveWsConnection = null;
                
                // Try to reconnect or take over as master
                if (currentRole === 'slave') {
                    handleMasterDisconnect();
                }
            });
            
            slaveWsConnection.on('error', (err) => {
                log(`Slave connection error: ${err.message}`);
                resolve(false);
            });
            
            // Timeout for connection
            setTimeout(() => {
                if (slaveWsConnection?.readyState !== WebSocket.OPEN) {
                    slaveWsConnection?.close();
                    resolve(false);
                }
            }, 5000);
            
        } catch (e) {
            log(`Error connecting as slave: ${e}`);
            resolve(false);
        }
    });
}

// Handle messages from master (when we're a slave)
function handleMasterMessage(msg: any) {
    switch (msg.type) {
        case 'instances_update':
            log(`Received instances update: ${msg.instances?.length || 0} instances`);
            onInstancesUpdateCallback?.(msg.instances || []);
            break;
            
        case 'execute_command':
            // Master is asking us to execute a command (e.g., send chat message)
            log(`Received command from master: ${msg.command}`);
            handleRemoteCommand(msg);
            break;
            
        case 'ping':
            slaveWsConnection?.send(JSON.stringify({ type: 'pong' }));
            break;
    }
}

// Handle commands sent from master (for workspace-specific actions)
async function handleRemoteCommand(msg: any) {
    if (msg.targetWorkspace && msg.targetWorkspace !== localInstance?.workspaceHash) {
        return; // Not for us
    }
    
    switch (msg.command) {
        case 'send_chat':
            // Import dynamically to avoid circular dependency
            const server = await import('./server/index');
            await server.sendToChat(msg.message, msg.model, msg.sessionMode, msg.sessionId);
            break;
    }
}

// Check if master is still alive (slave only)
function startMasterCheck() {
    if (masterCheckInterval) {
        clearInterval(masterCheckInterval);
    }
    
    masterCheckInterval = setInterval(async () => {
        const lockData = readLockFile();
        if (!lockData || Date.now() - lockData.lastHeartbeat > LOCK_TIMEOUT) {
            log('Master appears dead, attempting to take over');
            handleMasterDisconnect();
        }
    }, HEARTBEAT_INTERVAL);
}

function stopMasterCheck() {
    if (masterCheckInterval) {
        clearInterval(masterCheckInterval);
        masterCheckInterval = null;
    }
}

// Handle master disconnect - try to reconnect or become new master
async function handleMasterDisconnect() {
    stopMasterCheck();
    currentRole = 'standalone';
    
    reconnectAttempts++;
    
    if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
        log(`Attempting to reconnect to master (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
        
        const lockData = readLockFile();
        if (lockData && await checkMasterAlive(lockData.masterPort)) {
            await connectAsSlave();
            return;
        }
    }
    
    // Master is gone, notify to potentially become new master
    log('Master is gone, notifying role change');
    onRoleChangeCallback?.('standalone');
}

// Send message to master (slave only)
export function sendToMaster(msg: any): boolean {
    if (currentRole !== 'slave' || !slaveWsConnection || slaveWsConnection.readyState !== WebSocket.OPEN) {
        return false;
    }
    
    slaveWsConnection.send(JSON.stringify(msg));
    return true;
}

// Register a new instance (master only, called when slave connects)
export function registerInstance(instance: InstanceInfo): InstanceInfo[] {
    const lockData = readLockFile();
    if (!lockData || currentRole !== 'master') {
        return [];
    }
    
    lockData.instances[instance.workspaceHash] = instance;
    writeLockFile(lockData);
    
    log(`Registered instance: ${instance.workspaceName} (${instance.workspaceHash})`);
    
    return Object.values(lockData.instances);
}

// Unregister an instance (master only)
export function unregisterInstance(workspaceHash: string): InstanceInfo[] {
    const lockData = readLockFile();
    if (!lockData || currentRole !== 'master') {
        return [];
    }
    
    delete lockData.instances[workspaceHash];
    writeLockFile(lockData);
    
    log(`Unregistered instance: ${workspaceHash}`);
    
    return Object.values(lockData.instances);
}

// Get all registered instances
export function getAllInstances(): InstanceInfo[] {
    const lockData = readLockFile();
    if (!lockData) {
        // No lock file, return just local instance if available
        return localInstance ? [localInstance] : [];
    }
    
    return Object.values(lockData.instances);
}

// Cleanup on extension deactivate
export function cleanup() {
    log('Cleaning up instance manager');
    
    stopMasterHeartbeat();
    stopMasterCheck();
    
    if (slaveWsConnection) {
        slaveWsConnection.close();
        slaveWsConnection = null;
    }
    
    // If we're master, clean up lock file
    if (currentRole === 'master') {
        const lockData = readLockFile();
        if (lockData && lockData.masterPid === process.pid) {
            // Remove our instance
            if (localInstance) {
                delete lockData.instances[localInstance.workspaceHash];
            }
            
            // If no other instances, delete lock file entirely
            if (Object.keys(lockData.instances).length === 0) {
                deleteLockFile();
                log('Deleted lock file (no remaining instances)');
            } else {
                // Leave lock file for other instances to take over
                lockData.lastHeartbeat = 0; // Mark as dead so others can take over
                writeLockFile(lockData);
                log('Marked master as dead, other instances can take over');
            }
        }
    } else if (currentRole === 'slave' && localInstance) {
        // Notify master we're leaving
        sendToMaster({
            type: 'unregister_instance',
            workspaceHash: localInstance.workspaceHash
        });
    }
    
    currentRole = 'standalone';
}

// Get lock file path (for debugging)
export function getLockFilePath(): string {
    return LOCK_FILE_PATH;
}
