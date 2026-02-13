const { getInboxForWorkspace } = require('../out/inbox.js');

const workspaceHash = process.argv[2] || 'd14344c874d7f8b71ef1d57d284b18f0';
const sessionId = process.argv[3] || '21694af0-3c67-4c87-9908-1be32c21cb18';

function fail(message) {
    console.error('❌', message);
    process.exit(1);
}

function summarizeKinds(timeline = []) {
    return timeline.reduce((acc, segment) => {
        acc[segment.type] = (acc[segment.type] || 0) + 1;
        return acc;
    }, {});
}

try {
    const inbox = getInboxForWorkspace(workspaceHash);
    const session = inbox.sessions.find(s => s.sessionId === sessionId);

    if (!session) {
        fail(`Session not found: ${sessionId}`);
    }

    const messages = session.messages || [];
    const assistants = messages.filter(m => m.role === 'assistant');
    const withThinking = assistants.filter(m => m.thinking && (m.thinking.toolInvocations?.length || m.thinking.thinkingParts?.length));
    const allTools = withThinking.flatMap(m => m.thinking.toolInvocations || []);

    const emptyAssistants = assistants.filter(m => !(m.text || '').trim() && !(m.timeline || []).length);
    const timelineOnlyAssistants = assistants.filter(m => !(m.text || '').trim() && (m.timeline || []).length > 0);
    const placeholderAssistants = assistants.filter(m => {
        const t = (m.text || '').trim().toLowerCase();
        return t === 'processing response...' || t.includes('no response payload found');
    });

    const terminalTools = allTools.filter(t => t.kind === 'terminal');
    const todoTools = allTools.filter(t => t.kind === 'todoList');
    const missingToolTitles = allTools.filter(t => !(t.pastTenseMessage || t.invocationMessage || t.detailText));

    console.log('✅ Parser feedback summary');
    console.log(`Workspace: ${workspaceHash}`);
    console.log(`Session:   ${sessionId}`);
    console.log(`Messages:  ${messages.length} total, ${assistants.length} assistant`);
    console.log(`Thinking:  ${withThinking.length} assistant messages with thinking/tool blocks`);
    console.log(`Tools:     ${allTools.length} total (terminal: ${terminalTools.length}, todoList: ${todoTools.length})`);
    console.log(`Quality:   empty assistants=${emptyAssistants.length}, timeline-only=${timelineOnlyAssistants.length}, placeholders=${placeholderAssistants.length}, missing tool titles=${missingToolTitles.length}`);

    if (emptyAssistants.length > 0) {
        console.log('\nEmpty assistant messages detected:');
        emptyAssistants.slice(0, 10).forEach((m, idx) => {
            console.log(`  ${idx + 1}. timestamp=${m.timestamp || 'n/a'} model=${m.model || 'n/a'}`);
        });
    }

    console.log('\nLast 4 assistant messages:');
    assistants.slice(-4).forEach((m, idx) => {
        const n = assistants.length - 4 + idx + 1;
        const preview = (m.text || '').replace(/\s+/g, ' ').slice(0, 120);
        const kinds = summarizeKinds(m.timeline || []);
        console.log(`  ${n}. ts=${m.timestamp || 'n/a'} textLen=${(m.text || '').length} timeline=${JSON.stringify(kinds)} preview="${preview}"`);
    });

    if (missingToolTitles.length > 0) {
        fail(`Found ${missingToolTitles.length} tool invocation(s) without display title`);
    }

    if (emptyAssistants.length > 0) {
        fail(`Found ${emptyAssistants.length} assistant message(s) that are still empty`);
    }

    console.log('\n✅ Assertions passed.');
} catch (error) {
    fail(error && error.stack ? error.stack : String(error));
}
