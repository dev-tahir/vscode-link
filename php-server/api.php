<?php
/**
 * VS Code Remote Chat Control - PHP Relay Server
 * 
 * This acts as a hub between VS Code (anywhere) and Browser (anywhere)
 * 
 * Upload this folder to your PHP server (e.g., farooqk.sg-host.com/vscode-remote/)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Instance-Key');

// Prevent caching
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Cache-Control: post-check=0, pre-check=0', false);
header('Pragma: no-cache');
header('Expires: 0');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Configuration
define('DATA_DIR', __DIR__ . '/data');
define('INSTANCE_TIMEOUT', 120); // seconds before instance considered offline

// Ensure data directory exists
if (!is_dir(DATA_DIR)) {
    mkdir(DATA_DIR, 0755, true);
}

// Get action from URL
$action = $_GET['action'] ?? '';
$instanceKey = $_SERVER['HTTP_X_INSTANCE_KEY'] ?? $_GET['key'] ?? '';

// Helper functions
function getInstanceFile($key) {
    return DATA_DIR . '/instance_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $key) . '.json';
}

function getQueueFile($key) {
    return DATA_DIR . '/queue_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $key) . '.json';
}

function loadJson($file) {
    if (file_exists($file)) {
        $content = file_get_contents($file);
        return json_decode($content, true) ?: [];
    }
    return [];
}

function saveJson($file, $data) {
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT), LOCK_EX);
}

function response($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

// API Routes
switch ($action) {
    
    // === VS Code Extension Endpoints ===
    
    case 'register':
        // VS Code registers itself with a unique key
        if (!$instanceKey) {
            response(['error' => 'Instance key required'], 400);
        }
        
        $input = json_decode(file_get_contents('php://input'), true) ?: [];
        
        $instanceData = [
            'key' => $instanceKey,
            'workspaceName' => $input['workspaceName'] ?? 'Unknown',
            'workspaceHash' => $input['workspaceHash'] ?? '',
            'registeredAt' => time(),
            'lastSeen' => time(),
            'status' => 'online'
        ];
        
        saveJson(getInstanceFile($instanceKey), $instanceData);
        
        // Initialize empty queue if not exists
        if (!file_exists(getQueueFile($instanceKey))) {
            saveJson(getQueueFile($instanceKey), ['messages' => [], 'pendingCommands' => []]);
        }
        
        response(['success' => true, 'message' => 'Registered']);
        break;
        
    case 'heartbeat':
        // VS Code sends heartbeat to stay online
        if (!$instanceKey) {
            response(['error' => 'Instance key required'], 400);
        }
        
        $instanceFile = getInstanceFile($instanceKey);
        $instance = loadJson($instanceFile);
        
        if (empty($instance)) {
            response(['error' => 'Instance not registered'], 404);
        }
        
        $instance['lastSeen'] = time();
        $instance['status'] = 'online';
        saveJson($instanceFile, $instance);
        
        response(['success' => true]);
        break;
        
    case 'poll':
        // VS Code polls for new messages from browser
        if (!$instanceKey) {
            response(['error' => 'Instance key required'], 400);
        }
        
        // Update heartbeat
        $instanceFile = getInstanceFile($instanceKey);
        $instance = loadJson($instanceFile);
        if (!empty($instance)) {
            $instance['lastSeen'] = time();
            saveJson($instanceFile, $instance);
        }
        
        $queueFile = getQueueFile($instanceKey);
        $queue = loadJson($queueFile);
        
        // Get pending messages for VS Code to process
        $pending = array_filter($queue['messages'] ?? [], function($m) {
            return ($m['status'] ?? '') === 'pending' && ($m['direction'] ?? '') === 'to_vscode';
        });
        
        response([
            'success' => true,
            'messages' => array_values($pending),
            'pendingCommands' => $queue['pendingCommands'] ?? []
        ]);
        break;
        
    case 'update-inbox':
        // VS Code sends its current inbox state
        if (!$instanceKey) {
            response(['error' => 'Instance key required'], 400);
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input) {
            response(['error' => 'Invalid JSON'], 400);
        }
        
        $instanceFile = getInstanceFile($instanceKey);
        $instance = loadJson($instanceFile);
        $instance['inbox'] = $input['inbox'] ?? null;
        $instance['lastSeen'] = time();
        saveJson($instanceFile, $instance);
        
        // Log inbox update for debugging
        $sessionCount = is_array($instance['inbox']) && isset($instance['inbox']['sessions']) 
            ? count($instance['inbox']['sessions']) 
            : 0;
        
        response(['success' => true, 'sessionCount' => $sessionCount]);
        break;
        
    case 'message-processed':
        // VS Code marks a message as processed
        if (!$instanceKey) {
            response(['error' => 'Instance key required'], 400);
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        $messageId = $input['messageId'] ?? '';
        
        $queueFile = getQueueFile($instanceKey);
        $queue = loadJson($queueFile);
        
        foreach ($queue['messages'] as &$msg) {
            if (($msg['id'] ?? '') === $messageId) {
                $msg['status'] = 'processed';
                $msg['processedAt'] = time();
                break;
            }
        }
        
        saveJson($queueFile, $queue);
        response(['success' => true]);
        break;
        
    case 'reply':
        // VS Code sends reply after processing a message
        if (!$instanceKey) {
            response(['error' => 'Instance key required'], 400);
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        
        $queueFile = getQueueFile($instanceKey);
        $queue = loadJson($queueFile);
        
        // Mark original message as replied
        $originalId = $input['replyTo'] ?? '';
        foreach ($queue['messages'] as &$msg) {
            if (($msg['id'] ?? '') === $originalId) {
                $msg['status'] = 'replied';
                $msg['reply'] = $input['reply'] ?? null;
                break;
            }
        }
        
        saveJson($queueFile, $queue);
        response(['success' => true]);
        break;
    
    // === Browser Endpoints ===
    
    case 'instances':
        // Browser gets list of online VS Code instances
        $instances = [];
        
        // Try glob first, then fallback to scandir
        $pattern = DATA_DIR . '/instance_*.json';
        $files = glob($pattern);
        
        // Fallback: if glob returns empty, try scandir
        if (empty($files) && is_dir(DATA_DIR)) {
            $allFiles = scandir(DATA_DIR);
            $files = [];
            foreach ($allFiles as $f) {
                if (strpos($f, 'instance_') === 0 && substr($f, -5) === '.json') {
                    $files[] = DATA_DIR . '/' . $f;
                }
            }
        }
        
        foreach ($files as $file) {
            $inst = loadJson($file);
            if (!empty($inst)) {
                $isOnline = (time() - ($inst['lastSeen'] ?? 0)) < INSTANCE_TIMEOUT;
                $instances[] = [
                    'key' => $inst['key'] ?? '',
                    'workspaceName' => $inst['workspaceName'] ?? 'Unknown',
                    'workspaceHash' => $inst['workspaceHash'] ?? '',
                    'status' => $isOnline ? 'online' : 'offline',
                    'lastSeen' => $inst['lastSeen'] ?? 0
                ];
            }
        }
        
        response(['success' => true, 'instances' => $instances]);
        break;
        
    case 'inbox':
        // Browser gets inbox from a VS Code instance
        $key = $_GET['key'] ?? '';
        if (!$key) {
            response(['error' => 'Instance key required'], 400);
        }
        
        $instance = loadJson(getInstanceFile($key));
        if (empty($instance)) {
            response(['error' => 'Instance not found'], 404);
        }
        
        response([
            'success' => true,
            'inbox' => $instance['inbox'] ?? null,
            'status' => (time() - ($instance['lastSeen'] ?? 0)) < INSTANCE_TIMEOUT ? 'online' : 'offline'
        ]);
        break;
        
    case 'send':
        // Browser sends message to VS Code
        $key = $_GET['key'] ?? '';
        if (!$key) {
            response(['error' => 'Instance key required'], 400);
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input || empty($input['message'])) {
            response(['error' => 'Message required'], 400);
        }
        
        $queueFile = getQueueFile($key);
        $queue = loadJson($queueFile);
        
        $messageId = uniqid('msg_', true);
        $queue['messages'][] = [
            'id' => $messageId,
            'direction' => 'to_vscode',
            'message' => $input['message'],
            'sessionMode' => $input['sessionMode'] ?? 'current',
            'status' => 'pending',
            'createdAt' => time()
        ];
        
        // Keep only last 100 messages
        if (count($queue['messages']) > 100) {
            $queue['messages'] = array_slice($queue['messages'], -100);
        }
        
        saveJson($queueFile, $queue);
        
        response(['success' => true, 'messageId' => $messageId]);
        break;
        
    case 'wait-reply':
        // Browser waits for reply to a message (long polling)
        $key = $_GET['key'] ?? '';
        $messageId = $_GET['messageId'] ?? '';
        $timeout = min(intval($_GET['timeout'] ?? 30), 60);
        
        if (!$key || !$messageId) {
            response(['error' => 'Key and messageId required'], 400);
        }
        
        $queueFile = getQueueFile($key);
        $startTime = time();
        
        while ((time() - $startTime) < $timeout) {
            $queue = loadJson($queueFile);
            
            foreach ($queue['messages'] as $msg) {
                if (($msg['id'] ?? '') === $messageId) {
                    if (($msg['status'] ?? '') === 'replied') {
                        response([
                            'success' => true,
                            'status' => 'replied',
                            'reply' => $msg['reply'] ?? null
                        ]);
                    }
                    break;
                }
            }
            
            usleep(500000); // 0.5 second
        }
        
        response(['success' => true, 'status' => 'timeout']);
        break;
        
    case 'command-action':
        // Browser approves/skips a command
        $key = $_GET['key'] ?? '';
        if (!$key) {
            response(['error' => 'Instance key required'], 400);
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        $action = $input['action'] ?? '';
        
        if (!in_array($action, ['approve', 'skip'])) {
            response(['error' => 'Invalid action'], 400);
        }
        
        $queueFile = getQueueFile($key);
        $queue = loadJson($queueFile);
        
        $queue['pendingCommands'][] = [
            'action' => $action,
            'createdAt' => time()
        ];
        
        saveJson($queueFile, $queue);
        
        response(['success' => true]);
        break;
        
    case 'clear-commands':
        // VS Code clears processed commands
        if (!$instanceKey) {
            response(['error' => 'Instance key required'], 400);
        }
        
        $queueFile = getQueueFile($instanceKey);
        $queue = loadJson($queueFile);
        $queue['pendingCommands'] = [];
        saveJson($queueFile, $queue);
        
        response(['success' => true]);
        break;
        
    case 'status':
        // Health check
        response(['status' => 'ok', 'time' => time()]);
        break;
        
    case 'debug':
        // Debug endpoint to see what's stored
        $key = $_GET['key'] ?? '';
        if (!$key) {
            // List all data files using scandir (more reliable than glob)
            $info = [];
            if (is_dir(DATA_DIR)) {
                $allFiles = scandir(DATA_DIR);
                foreach ($allFiles as $f) {
                    if ($f === '.' || $f === '..') continue;
                    $filePath = DATA_DIR . '/' . $f;
                    if (is_file($filePath)) {
                        $info[] = [
                            'file' => $f,
                            'size' => filesize($filePath),
                            'modified' => date('Y-m-d H:i:s', filemtime($filePath))
                        ];
                    }
                }
            }
            response([
                'success' => true, 
                'files' => $info, 
                'dataDir' => DATA_DIR,
                'dataDirExists' => is_dir(DATA_DIR),
                'dataDirWritable' => is_writable(DATA_DIR)
            ]);
        } else {
            // Show specific instance data
            $instanceFile = getInstanceFile($key);
            $instance = loadJson($instanceFile);
            $inboxSessions = isset($instance['inbox']['sessions']) ? count($instance['inbox']['sessions']) : 0;
            response([
                'success' => true,
                'instanceFile' => basename($instanceFile),
                'exists' => file_exists($instanceFile),
                'instance' => [
                    'key' => $instance['key'] ?? null,
                    'workspaceName' => $instance['workspaceName'] ?? null,
                    'lastSeen' => $instance['lastSeen'] ?? null,
                    'lastSeenAgo' => isset($instance['lastSeen']) ? (time() - $instance['lastSeen']) . 's ago' : null,
                    'hasInbox' => isset($instance['inbox']),
                    'inboxSessions' => $inboxSessions,
                    'inboxTotalMessages' => $instance['inbox']['totalMessages'] ?? 0
                ]
            ]);
        }
        break;
        
    default:
        response(['error' => 'Unknown action', 'available' => [
            'register', 'heartbeat', 'poll', 'update-inbox', 'message-processed', 'reply',
            'instances', 'inbox', 'send', 'wait-reply', 'command-action', 'status'
        ]], 400);
}
