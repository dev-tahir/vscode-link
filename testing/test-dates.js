const {getInboxForWorkspace} = require('../out/inbox.js');

try {
    const inbox = getInboxForWorkspace('d14344c874d7f8b71ef1d57d284b18f0');
    
    console.log('✅ Inbox Sessions with Dates:\n');
    
    inbox.sessions.forEach((s, i) => {
        const lastMsgDate = new Date(s.lastMessageAt).toLocaleString();
        const createdDate = new Date(s.createdAt).toLocaleString();
        
        console.log(`Session ${i+1}: ${s.sessionId.substring(0, 8)}...`);
        console.log(`  Title: ${s.title}`);
        console.log(`  Created: ${createdDate}`);
        console.log(`  Last Message: ${lastMsgDate}`);
        console.log(`  Messages: ${s.messageCount}`);
        console.log(`  lastMessageAt timestamp: ${s.lastMessageAt}`);
        console.log('');
    });
} catch (err) {
    console.error('❌ ERROR:', err.message);
    console.error(err.stack);
}
