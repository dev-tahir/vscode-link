// WebView HTML builder
// Delegates to standalone/webview/ modules (source of truth)

import * as path from 'path';

export function getWebViewHTML(): string {
    // Load from standalone/webview/index.js (source of truth)
    const standaloneIndex = path.join(__dirname, '..', 'standalone', 'webview', 'index.js');
    // Clear require cache so changes are picked up
    delete require.cache[require.resolve(standaloneIndex)];
    const { getWebViewHTML: buildHTML } = require(standaloneIndex);
    return buildHTML();
}
