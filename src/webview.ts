// WebView HTML builder
// Delegates to standalone/webview/ modules (source of truth)
// Falls back to minimal placeholder if standalone modules not found

import * as path from 'path';

export function getWebViewHTML(): string {
    try {
        // Load from standalone/webview/index.js (source of truth)
        const standaloneIndex = path.join(__dirname, '..', 'standalone', 'webview', 'index.js');
        // Clear require cache so changes are picked up
        delete require.cache[require.resolve(standaloneIndex)];
        const { getWebViewHTML: buildHTML } = require(standaloneIndex);
        return buildHTML();
    } catch (e) {
        console.error('[WebView] Failed to load standalone webview modules:', e);
        return getFallbackHTML();
    }
}

function getFallbackHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VS Code Remote Control</title>
    <style>
        body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1e1e1e; color: #ccc; }
        .msg { text-align: center; }
        .msg h2 { color: #fff; }
        .msg a { color: #4fc1ff; }
    </style>
</head>
<body>
    <div class="msg">
        <h2>WebView modules not found</h2>
        <p>The standalone/webview/ directory is missing.</p>
        <p>Please ensure the standalone webview modules are present.</p>
    </div>
</body>
</html>`;
}
