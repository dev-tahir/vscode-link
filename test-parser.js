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
            // Show first and last 2 messages
            console.log('  First messages:');
            s.messages.slice(0, 2).forEach((m, idx) => {
                console.log(`    ${idx+1}. [${m.role}] ${m.text.substring(0, 70)}...`);
            });
            
            if (s.messages.length > 4) {
                console.log(`  ... (${s.messages.length - 4} more) ...`);
            }
            
            if (s.messages.length > 2) {
                console.log('  Last messages:');
                s.messages.slice(-2).forEach((m, idx) => {
                    console.log(`    ${s.messages.length - 1 + idx}. [${m.role}] ${m.text.substring(0, 70)}...`);
                });
            }
        }
    });
} catch (err) {
    console.error('❌ ERROR:', err.message);
    console.error(err.stack);
}
