const { getInboxForWorkspace } = require('../out/inbox.js');

const workspaceHash = process.argv[2] || 'd14344c874d7f8b71ef1d57d284b18f0';
const sessionId = process.argv[3] || '607e5ee6-46c7-4c99-a6ec-842ba05a59b8';
const requiredTailPairs = Number(process.argv[4] || 2);

function fail(message) {
    console.error(`❌ ${message}`);
    process.exit(1);
}

function messageHasRenderableAssistantContent(message) {
    if (!message || message.role !== 'assistant') return false;

    if (typeof message.text === 'string' && message.text.trim().length > 0) {
        return true;
    }

    const timeline = Array.isArray(message.timeline) ? message.timeline : [];
    if (timeline.length > 0) {
        for (const segment of timeline) {
            if (!segment || typeof segment !== 'object') continue;
            if (segment.type === 'text' && typeof segment.text === 'string' && segment.text.trim().length > 0) {
                return true;
            }
            if (segment.type === 'thinking' && segment.thinking && typeof segment.thinking.value === 'string' && segment.thinking.value.trim().length > 0) {
                return true;
            }
            if (segment.type === 'tool' && segment.tool) {
                return true;
            }
        }
    }

    const thinkingParts = message.thinking?.thinkingParts || [];
    const tools = message.thinking?.toolInvocations || [];
    return thinkingParts.length > 0 || tools.length > 0;
}

function summarizeAssistant(message) {
    const timelineKinds = Array.isArray(message.timeline)
        ? message.timeline.map(s => s?.type).filter(Boolean).join(' > ')
        : '';
    const thinkingCount = (message.thinking?.thinkingParts || []).length;
    const toolCount = (message.thinking?.toolInvocations || []).length;
    const textLen = typeof message.text === 'string' ? message.text.length : 0;
    const renderable = messageHasRenderableAssistantContent(message);

    return {
        textLen,
        thinkingCount,
        toolCount,
        timelineCount: Array.isArray(message.timeline) ? message.timeline.length : 0,
        timelineKinds,
        renderable,
    };
}

try {
    const inbox = getInboxForWorkspace(workspaceHash);
    const session = inbox.sessions.find(s => s.sessionId === sessionId);

    if (!session) {
        fail(`Session not found: ${sessionId}`);
    }

    const messages = session.messages || [];
    if (messages.length === 0) {
        fail('No messages found in session');
    }

    const userIndices = [];
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
            userIndices.push(i);
        }
    }

    if (userIndices.length === 0) {
        fail('No user messages found in session');
    }

    const tailUsers = userIndices.slice(-requiredTailPairs);
    const pairResults = [];

    for (const userIndex of tailUsers) {
        const userMsg = messages[userIndex];
        let assistantIndex = -1;
        for (let i = userIndex + 1; i < messages.length; i++) {
            if (messages[i].role === 'assistant') {
                assistantIndex = i;
                break;
            }
            if (messages[i].role === 'user') {
                break;
            }
        }

        if (assistantIndex === -1) {
            pairResults.push({
                userIndex,
                userPreview: String(userMsg.text || '').replace(/\s+/g, ' ').slice(0, 120),
                assistantFound: false,
                renderable: false,
                summary: null,
            });
            continue;
        }

        const assistantMsg = messages[assistantIndex];
        const summary = summarizeAssistant(assistantMsg);
        pairResults.push({
            userIndex,
            userPreview: String(userMsg.text || '').replace(/\s+/g, ' ').slice(0, 120),
            assistantFound: true,
            assistantIndex,
            renderable: summary.renderable,
            summary,
        });
    }

    console.log('✅ App view simulation test');
    console.log(`Workspace: ${workspaceHash}`);
    console.log(`Session:   ${sessionId}`);
    console.log(`Messages:  ${messages.length}`);
    console.log(`Checking last ${requiredTailPairs} user -> assistant pairs`);
    console.log('');

    for (const pair of pairResults) {
        console.log(`User #${pair.userIndex}: ${pair.userPreview}`);
        if (!pair.assistantFound) {
            console.log('  -> Assistant: MISSING');
        } else {
            const s = pair.summary;
            console.log(`  -> Assistant #${pair.assistantIndex}: renderable=${s.renderable} textLen=${s.textLen} timeline=${s.timelineCount} thinking=${s.thinkingCount} tools=${s.toolCount}`);
            if (s.timelineKinds) {
                console.log(`     timelineKinds=${s.timelineKinds.slice(0, 180)}`);
            }
        }
    }

    console.log('');
    console.log('Recent message tail (last 10):');
    const start = Math.max(0, messages.length - 10);
    for (let i = start; i < messages.length; i++) {
        const m = messages[i];
        if (m.role === 'assistant') {
            const s = summarizeAssistant(m);
            console.log(`${i}. assistant renderable=${s.renderable} textLen=${s.textLen} timeline=${s.timelineCount} thinking=${s.thinkingCount} tools=${s.toolCount}`);
        } else {
            const preview = String(m.text || '').replace(/\s+/g, ' ').slice(0, 90);
            console.log(`${i}. user ${preview}`);
        }
    }

    const missingPairs = pairResults.filter(p => !p.assistantFound);
    const nullPairs = pairResults.filter(p => p.assistantFound && !p.renderable);

    const trailingUserIndices = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
            trailingUserIndices.push(i);
        } else {
            break;
        }
    }
    const trailingUserSet = new Set(trailingUserIndices);
    const pendingMissingPairs = missingPairs.filter(p => trailingUserSet.has(p.userIndex));
    const hardMissingPairs = missingPairs.filter(p => !trailingUserSet.has(p.userIndex));

    console.log('');
    console.log(`Summary: missingAssistantPairs=${missingPairs.length}, pendingMissingPairs=${pendingMissingPairs.length}, hardMissingPairs=${hardMissingPairs.length}, nullRenderablePairs=${nullPairs.length}`);

    const failures = pairResults.filter(p => {
        if (p.assistantFound) {
            return !p.renderable;
        }
        return !trailingUserSet.has(p.userIndex);
    });
    if (failures.length > 0) {
        fail(`${failures.length} tail pair(s) failed (hardMissing=${hardMissingPairs.length}, null=${nullPairs.length})`);
    }

    console.log('\n✅ Tail assistant replies are renderable in app simulation.');
} catch (error) {
    fail(error && error.stack ? error.stack : String(error));
}
