const fs = require('fs');
const path = require('path');
const { getInboxForWorkspace } = require('../out/inbox.js');

const workspaceHash = process.argv[2] || 'd14344c874d7f8b71ef1d57d284b18f0';
const sessionId = process.argv[3] || '21694af0-3c67-4c87-9908-1be32c21cb18';

function parseJSONL(content) {
  const lines = [];
  let objectStart = -1;
  let braceDepth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < content.length; index++) {
    const ch = content[index];
    if (objectStart === -1) {
      if (ch === '{') {
        objectStart = index;
        braceDepth = 1;
        inString = false;
        isEscaped = false;
      }
      continue;
    }

    if (inString) {
      if (isEscaped) isEscaped = false;
      else if (ch === '\\') isEscaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      braceDepth++;
      continue;
    }
    if (ch === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        lines.push(content.slice(objectStart, index + 1));
        objectStart = -1;
      }
    }
  }

  if (lines.length === 0) {
    lines.push(...content.trim().split(/\r\n|\n|\r/).filter(Boolean));
  }

  const data = {};
  const setNestedProperty = (obj, p, value) => {
    let current = obj;
    for (let i = 0; i < p.length - 1; i++) {
      const key = p[i];
      const nextKey = p[i + 1];
      const nextIsArrayIndex = /^\d+$/.test(nextKey);
      if (!(key in current)) current[key] = nextIsArrayIndex ? [] : {};
      if (Array.isArray(current[key]) && nextIsArrayIndex) {
        const index = parseInt(nextKey, 10);
        while (current[key].length <= index) current[key].push({});
      }
      current = current[key];
    }
    current[p[p.length - 1]] = value;
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.kind === 0) {
      Object.assign(data, obj.v || {});
    } else if (obj.kind === 1 && Array.isArray(obj.k)) {
      setNestedProperty(data, obj.k, obj.v);
    } else if (obj.kind === 2 && Array.isArray(obj.k) && obj.k.length > 0) {
      if (obj.k.length === 1 && Array.isArray(obj.v) && Array.isArray(data[obj.k[0]])) {
        data[obj.k[0]].push(...obj.v);
      } else {
        setNestedProperty(data, obj.k, obj.v);
      }
    }
  }
  return data;
}

const jsonlPath = path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage', workspaceHash, 'chatSessions', `${sessionId}.jsonl`);
if (!fs.existsSync(jsonlPath)) {
  console.error('Session jsonl not found:', jsonlPath);
  process.exit(1);
}

const raw = fs.readFileSync(jsonlPath, 'utf8');
const data = parseJSONL(raw);
const requests = Array.isArray(data.requests) ? data.requests : [];
const inbox = getInboxForWorkspace(workspaceHash);
const session = inbox.sessions.find(s => s.sessionId === sessionId);
const assistantMsgs = (session?.messages || []).filter(m => m.role === 'assistant');

const assistantByTs = new Map(assistantMsgs.map(m => [m.timestamp, m]));

function hasMeaningfulProgressText(item) {
  const text = item?.content?.value;
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  if (/^Thinking/i.test(t)) return false;
  if (/^Creating edits/i.test(t)) return false;
  if (/^Running/i.test(t)) return false;
  if (/^Completed/i.test(t)) return false;
  return true;
}

const report = [];
for (const req of requests) {
  const response = Array.isArray(req?.response) ? req.response : [];
  if (!response.length) continue;

  const hasTextLike = response.some(item => {
    if (!item) return false;
    if (item.kind === 'thinking' || item.kind === 'toolInvocationSerialized' || item.kind === 'inlineReference' || item.kind === 'markdownContent') return true;
    if (typeof item.value === 'string' && item.value.trim()) return true;
    if (item.kind === 'progressTaskSerialized' && hasMeaningfulProgressText(item)) return true;
    return false;
  });

  const ts = req?.result?.timings?.totalElapsed ? req.timestamp + req.result.timings.totalElapsed : req.timestamp;
  const parsed = assistantByTs.get(ts);
  const parsedEmpty = !parsed || (!parsed.text?.trim() && !(parsed.timeline?.length));

  if (hasTextLike && parsedEmpty) {
    const kinds = response.reduce((acc, item) => {
      const k = item?.kind || 'none';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    report.push({ timestamp: ts, requestTimestamp: req.timestamp, kinds, progress: response.filter(i => i?.kind === 'progressTaskSerialized').map(i => (i.content?.value || '').slice(0, 140)) });
  }
}

console.log('requests:', requests.length);
console.log('assistant parsed:', assistantMsgs.length);
console.log('potentially dropped meaningful assistant turns:', report.length);
for (const item of report.slice(0, 20)) {
  console.log('---');
  console.log('timestamp:', item.timestamp, 'requestTimestamp:', item.requestTimestamp);
  console.log('kinds:', JSON.stringify(item.kinds));
  if (item.progress.length) {
    console.log('progress snippets:', item.progress.join(' | '));
  }
}
