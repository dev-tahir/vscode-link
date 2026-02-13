const { getInboxForWorkspace } = require('../out/inbox.js');

const workspaceHash = process.argv[2] || 'd14344c874d7f8b71ef1d57d284b18f0';
const sessionId = process.argv[3] || '607e5ee6-46c7-4c99-a6ec-842ba05a59b8';

function fail(message) {
    console.error('❌', message);
    process.exit(1);
}

try {
    const inbox = getInboxForWorkspace(workspaceHash);
    const session = inbox.sessions.find(s => s.sessionId === sessionId);

    if (!session) {
        fail(`Session not found: ${sessionId}`);
    }

    const assistants = (session.messages || []).filter(m => m.role === 'assistant');
    const users = (session.messages || []).filter(m => m.role === 'user');
    const withThinking = assistants.filter(m => m.thinking && m.thinking.toolInvocations && m.thinking.toolInvocations.length > 0);
    const emptyAssistantTurns = assistants.filter(m => !m.text && (!m.thinking || ((m.thinking.thinkingParts || []).length === 0 && (m.thinking.toolInvocations || []).length === 0)));
    const withTimeline = assistants.filter(m => Array.isArray(m.timeline) && m.timeline.length > 0);
    const interleavedTimeline = withTimeline.filter(m => {
        const kinds = (m.timeline || []).map(seg => seg && seg.type).filter(Boolean);
        for (let i = 0; i < kinds.length - 2; i++) {
            if (kinds[i] === 'thinking' && kinds[i + 1] === 'text' && kinds[i + 2] === 'thinking') {
                return true;
            }
        }
        return false;
    });

    if (assistants.length === 0) {
        fail('No assistant messages parsed');
    }

    if (withThinking.length === 0) {
        fail('No assistant thinking/tool data parsed');
    }

    const allTools = withThinking.flatMap(m => m.thinking.toolInvocations || []);
    const terminalTools = allTools.filter(t => t.kind === 'terminal');
    const todoTools = allTools.filter(t => t.kind === 'todoList');

    const terminalWithCommand = terminalTools.filter(t => t.commandLine && t.commandLine.trim().length > 0);
    const terminalWithOutput = terminalTools.filter(t => t.output && t.output.trim().length > 0);
    const todoWithItems = todoTools.filter(t => Array.isArray(t.todoList) && t.todoList.length > 0);
    const missingToolTitles = allTools.filter(t => !(t.pastTenseMessage || t.invocationMessage || t.detailText));
    const badEmptyFileTokens = assistants.reduce((count, msg) => {
        return count + (((msg.text || '').match(/\[\[FILE\|\|file\]\]/g) || []).length);
    }, 0);

    console.log('✅ Parser feedback summary');
    console.log(`Workspace: ${workspaceHash}`);
    console.log(`Session:   ${sessionId}`);
    console.log(`Messages:  ${session.messages.length} total, ${assistants.length} assistant`);
    console.log(`Users:     ${users.length}`);
    console.log(`Thinking:  ${withThinking.length} assistant messages with thinking/tool blocks`);
    console.log(`Timeline:  ${withTimeline.length} assistant messages with ordered timeline segments`);
    console.log(`Interleave:${interleavedTimeline.length} messages with thinking→text→thinking pattern`);
    console.log(`Tools:     ${allTools.length} total`);
    console.log(`Terminal:  ${terminalTools.length} (with command: ${terminalWithCommand.length}, with output: ${terminalWithOutput.length})`);
    console.log(`TodoList:  ${todoTools.length} (with items: ${todoWithItems.length})`);
    console.log(`Quality:   missing tool titles=${missingToolTitles.length}, empty file tokens=${badEmptyFileTokens}`);
    console.log(`Gaps:      empty assistant placeholders=${emptyAssistantTurns.length}`);
    console.log('');

    const lastAssistant = assistants[assistants.length - 1];
    if (lastAssistant) {
        const timelineKinds = (lastAssistant.timeline || []).map(seg => seg.type).join(' > ');
        console.log('Last assistant snapshot (app-like):');
        console.log(`  textLen=${(lastAssistant.text || '').length}`);
        console.log(`  timelineSegments=${(lastAssistant.timeline || []).length}`);
        if (timelineKinds) {
            console.log(`  timelineKinds=${timelineKinds.slice(0, 220)}`);
        }
        (lastAssistant.timeline || []).slice(0, 6).forEach((seg, idx) => {
            if (seg.type === 'text') {
                const preview = String(seg.text || '').replace(/\s+/g, ' ').slice(0, 100);
                console.log(`  ${idx + 1}. [text] ${preview}`);
            } else if (seg.type === 'thinking') {
                const title = seg.thinking?.generatedTitle || 'thinking';
                const preview = String(seg.thinking?.value || '').replace(/\s+/g, ' ').slice(0, 80);
                console.log(`  ${idx + 1}. [thinking] ${title}: ${preview}`);
            } else if (seg.type === 'tool') {
                const title = seg.tool?.pastTenseMessage || seg.tool?.invocationMessage || seg.tool?.detailText || seg.tool?.toolId;
                console.log(`  ${idx + 1}. [tool] ${title ? String(title).slice(0, 100) : '(no title)'}`);
            }
        });
        console.log('');
    }

    const previews = withThinking.slice(-3);
    previews.forEach((msg, idx) => {
        const num = withThinking.length - previews.length + idx + 1;
        const textPreview = (msg.text || '').replace(/\s+/g, ' ').slice(0, 110);
        console.log(`Assistant thinking msg ${num}: textLen=${(msg.text || '').length} preview="${textPreview}"`);

        (msg.thinking.toolInvocations || []).slice(0, 4).forEach((tool, toolIdx) => {
            const title = tool.pastTenseMessage || tool.invocationMessage || tool.detailText || tool.toolId;
            const commandInfo = tool.commandLine ? ' cmd' : '';
            const outputInfo = tool.output ? ' out' : '';
            const todoInfo = tool.todoList ? ` todo:${tool.todoList.length}` : '';
            console.log(`  ${toolIdx + 1}. [${tool.toolId}] ${title.slice(0, 90)}${commandInfo}${outputInfo}${todoInfo}`);
        });
    });

    if (terminalTools.length === 0) {
        fail('Expected at least one terminal tool invocation in this session');
    }

    if (todoTools.length === 0) {
        fail('Expected at least one todoList tool invocation in this session');
    }

    if (missingToolTitles.length > 0) {
        fail(`Found ${missingToolTitles.length} tool invocation(s) without any display title`);
    }

    if (badEmptyFileTokens > 0) {
        fail(`Found ${badEmptyFileTokens} empty file placeholder token(s) in assistant text`);
    }

    if (withTimeline.length === 0) {
        fail('Expected timeline segments on assistant messages, but none were found');
    }

    console.log('\n✅ Assertions passed.');
} catch (error) {
    fail(error && error.stack ? error.stack : String(error));
}
