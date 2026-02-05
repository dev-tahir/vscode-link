const {getInboxForWorkspace} = require('./out/inbox.js');

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
            // Show last 3 messages to see recent updates
            console.log('  Last 3 messages:');
            s.messages.slice(-3).forEach((m, idx) => {
                const msgIdx = s.messages.length - 3 + idx + 1;
                const thinkCount = m.thinking ? m.thinking.length : 0;
                const thinkInfo = thinkCount > 0 ? ` [${thinkCount} thinking]` : '';
                const timestamp = m.timestamp ? new Date(m.timestamp).toLocaleString() : 'no timestamp';
                console.log(`    ${msgIdx}. [${m.role}]${thinkInfo} ${timestamp}`);
                console.log(`        ${m.text.substring(0, 60)}...`);
                
                // Show thinking titles if present
                if (m.thinking && m.thinking.length > 0) {
                    m.thinking.forEach((t, ti) => {
                        console.log(`        💭 ${t.title}`);
                    });
                }
            });
        }
    });
} catch (err) {
    console.error('❌ ERROR:', err.message);
    console.error(err.stack);
}
