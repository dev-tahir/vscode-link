const {getInboxForWorkspace} = require('../out/inbox.js');

try {
    const inbox = getInboxForWorkspace('d14344c874d7f8b71ef1d57d284b18f0');
    
    console.log('✅ SUCCESS - No crashes!');
    console.log('Total sessions:', inbox.sessions.length);
    console.log('Total messages:', inbox.totalMessages);
    console.log('');
    
    inbox.sessions.forEach((s, i) => {
        console.log(`\nSession ${i+1}: ${s.sessionId.substring(0, 8)}...`);
        console.log(`  File: ${s.filePath}`);
        console.log(`  Messages: ${s.messageCount}`);
        console.log(`  Title: ${s.title || '(no title)'}`);
        
        if (s.messages && s.messages.length > 0) {
            console.log('  Last 3 messages:');
            s.messages.slice(-3).forEach((m, idx) => {
                const msgIdx = s.messages.length - 3 + idx + 1;
                const thinkingParts = m.thinking?.thinkingParts?.length || 0;
                const toolInvocations = m.thinking?.toolInvocations?.length || 0;
                const thinkCount = thinkingParts + toolInvocations;
                const thinkInfo = thinkCount > 0 ? ` [${thinkCount} thinking/tools]` : '';
                const timestamp = m.timestamp ? new Date(m.timestamp).toLocaleString() : 'no timestamp';
                console.log(`    ${msgIdx}. [${m.role}]${thinkInfo} ${timestamp}`);
                console.log(`        ${String(m.text || '').substring(0, 60)}...`);
            });
        }
    });
} catch (err) {
    console.error('❌ ERROR:', err.message);
    console.error(err.stack);
}
