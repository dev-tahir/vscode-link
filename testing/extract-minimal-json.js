const fs = require('fs');
const path = require('path');

function usage() {
  console.log('Usage: node testing/extract-minimal-json.js <sessionFile.jsonl|sessionFile.json> [outFile] [featureName] [checkPathsCsv]');
  console.log('Example: node testing/extract-minimal-json.js "C:\\Users\\<you>\\AppData\\Roaming\\Code\\User\\workspaceStorage\\<workspaceHash>\\chatSessions\\<sessionId>.jsonl"');
  console.log('Example (feature check): node testing/extract-minimal-json.js <file> "" chatRuntimeStatus "chatRuntimeStatus,requests[].response[].toolSpecificData.chatStatus"');
  console.log('Default output: src/server/sequenceappendjson-<workspaceHash>-<sessionId>.json');
}

function tokenizePath(pathExpr) {
  return String(pathExpr || '')
    .split('.')
    .map(token => token.trim())
    .filter(Boolean);
}

function getValuesByPath(root, pathExpr) {
  const tokens = tokenizePath(pathExpr);
  if (tokens.length === 0) return [];

  let current = [root];
  for (const token of tokens) {
    const next = [];
    const isWildcardArray = token.endsWith('[]');
    const key = isWildcardArray ? token.slice(0, -2) : token;

    for (const node of current) {
      if (node === null || node === undefined) continue;
      const value = key ? node[key] : node;
      if (isWildcardArray) {
        if (Array.isArray(value)) {
          next.push(...value);
        }
      } else {
        next.push(value);
      }
    }
    current = next;
    if (current.length === 0) break;
  }

  return current.filter(v => v !== undefined && v !== null);
}

function deepFindByKey(root, targetKey) {
  const matches = [];
  const target = String(targetKey || '').trim().toLowerCase();
  if (!target) return matches;

  const visit = (node, currentPath) => {
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }

    if (typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      if (key.toLowerCase() === target && value !== undefined && value !== null) {
        matches.push({ path: nextPath, value });
      }
      visit(value, nextPath);
    }
  };

  visit(root, '');
  return matches;
}

function previewValue(value) {
  if (typeof value === 'string') return value.slice(0, 120);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (value && typeof value === 'object') return '[object]';
  return '';
}

function parseCheckPaths(checkPathsCsv) {
  if (!checkPathsCsv) return [];
  return String(checkPathsCsv)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function buildSequenceAppendJson(data, options) {
  const requestedFeature = (options?.featureName || '').trim();
  const checkedPaths = options?.checkedPaths || [];
  const evidence = [];

  for (const pathExpr of checkedPaths) {
    const values = getValuesByPath(data, pathExpr);
    for (const value of values) {
      evidence.push({ path: pathExpr, valuePreview: previewValue(value) });
      if (evidence.length >= 10) break;
    }
    if (evidence.length >= 10) break;
  }

  if (evidence.length === 0 && requestedFeature) {
    const keyMatches = deepFindByKey(data, requestedFeature);
    for (const match of keyMatches.slice(0, 10)) {
      evidence.push({ path: match.path, valuePreview: previewValue(match.value) });
    }
  }

  const existsInSource = evidence.length > 0;

  return {
    name: 'sequenceappendjson',
    requestedFeature: requestedFeature || 'unspecified_feature',
    question: requestedFeature
      ? `Does source JSON include feature \"${requestedFeature}\"?`
      : 'Does source JSON include the requested feature?',
    existsInSource,
    checkedPaths,
    evidence,
    howToAddIfMissing: {
      summary: 'If feature is missing, add it at producer level, keep it in extraction output, then render it in UI.',
      producerContractTemplate: {
        featureName: requestedFeature || '<featureName>',
        featureValue: '<value>',
        updatedAt: '2026-02-16T10:30:00.000Z'
      },
      implementationSteps: [
        'Add stable field(s) for the feature in the source session/update payload.',
        'Map those field(s) into sequenceappendjson during extraction.',
        'Render feature presence/value in render-chat-json.js with a clear badge or summary line.'
      ],
      fallbackWhenNoPathProvided: 'Pass check paths as 4th argument to avoid guessing and make feature detection deterministic.'
    }
  };
}

function setNestedProperty(obj, propertyPath, value) {
  let current = obj;

  for (let index = 0; index < propertyPath.length - 1; index++) {
    const key = propertyPath[index];
    const nextKey = propertyPath[index + 1];
    const nextIsArrayIndex = /^\d+$/.test(nextKey);

    if (!(key in current)) {
      current[key] = nextIsArrayIndex ? [] : {};
    }

    if (Array.isArray(current[key]) && nextIsArrayIndex) {
      const arrayIndex = Number(nextKey);
      while (current[key].length <= arrayIndex) {
        current[key].push({});
      }
    }

    current = current[key];
  }

  const lastKey = propertyPath[propertyPath.length - 1];
  current[lastKey] = value;
}

function getNestedProperty(obj, propertyPath) {
  let current = obj;
  for (const key of propertyPath) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function parseJSONL(content) {
  const objects = [];
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
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === '\\') {
        isEscaped = true;
      } else if (ch === '"') {
        inString = false;
      }
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
        objects.push(content.slice(objectStart, index + 1));
        objectStart = -1;
      }
    }
  }

  if (objects.length === 0) {
    objects.push(...content.split(/\r\n|\n|\r/).filter(line => !!line.trim()));
  }

  const data = {};

  for (const rawObject of objects) {
    if (!rawObject.trim()) continue;

    let op;
    try {
      op = JSON.parse(rawObject);
    } catch {
      continue;
    }

    if (op.kind === 0) {
      Object.assign(data, op.v || {});
      continue;
    }

    if (op.kind === 1 && Array.isArray(op.k)) {
      setNestedProperty(data, op.k, op.v);
      continue;
    }

    if (op.kind === 2 && Array.isArray(op.k) && op.k.length > 0) {
      const targetValue = getNestedProperty(data, op.k);
      const hasInsertIndex = typeof op.i === 'number';

      if (Array.isArray(targetValue) && hasInsertIndex) {
        const insertValues = Array.isArray(op.v) ? op.v : [op.v];
        targetValue.splice(op.i, 0, ...insertValues);
      } else if (Array.isArray(targetValue) && Array.isArray(op.v)) {
        targetValue.push(...op.v);
      } else if (op.k.length === 1 && Array.isArray(op.v) && Array.isArray(data[op.k[0]])) {
        data[op.k[0]].push(...op.v);
      } else {
        setNestedProperty(data, op.k, op.v);
      }
    }
  }

  return data;
}

function getUserText(request) {
  if (typeof request?.message?.text === 'string' && request.message.text.trim()) {
    return request.message.text;
  }

  const parts = Array.isArray(request?.message?.parts) ? request.message.parts : [];
  const textPart = parts.find(part => part && part.kind === 'text' && typeof part.text === 'string' && part.text.trim());
  return textPart ? textPart.text : '';
}

function readableValue(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (typeof value.fsPath === 'string' && value.fsPath) return value.fsPath;
  if (typeof value.path === 'string' && value.path) return value.path;
  if (typeof value.external === 'string' && value.external) return value.external;
  return '';
}

function minimalToolInvocation(item) {
  const toolSpecificData = item.toolSpecificData || {};
  const toolKind = toolSpecificData.kind || '';

  const minimal = {
    kind: 'toolInvocationSerialized',
    toolId: item.toolId || '',
    toolCallId: item.toolCallId || '',
    isConfirmed: item.isConfirmed !== undefined ? item.isConfirmed : null,
    toolKind,
  };

  if (toolKind === 'terminal') {
    minimal.commandLine = toolSpecificData.commandLine?.original || toolSpecificData.commandLine?.toolEdited || '';
    minimal.language = toolSpecificData.language || '';
    minimal.cwd = readableValue(toolSpecificData.cwd);
    minimal.terminalCommandState = toolSpecificData.terminalCommandState !== undefined ? toolSpecificData.terminalCommandState : null;

    if (toolSpecificData.confirmation) {
      minimal.confirmation = {
        message: typeof toolSpecificData.confirmation.message === 'string' ? toolSpecificData.confirmation.message : '',
        commandLine: typeof toolSpecificData.confirmation.commandLine === 'string' ? toolSpecificData.confirmation.commandLine : '',
        cwdLabel: readableValue(toolSpecificData.confirmation.cwdLabel),
      };
    }
  }

  if (toolKind === 'todoList' && Array.isArray(toolSpecificData.todoList)) {
    minimal.todoList = toolSpecificData.todoList.map(todo => ({
      id: todo?.id,
      title: todo?.title,
      status: todo?.status,
    }));
  }

  return minimal;
}

function minimalResponseItem(item) {
  if (!item || typeof item !== 'object') return null;

  if (item.kind === 'toolInvocationSerialized') {
    return minimalToolInvocation(item);
  }

  if (item.kind === 'thinking' && typeof item.value === 'string') {
    return {
      kind: 'thinking',
      value: item.value,
    };
  }

  if (item.kind === 'inlineReference') {
    return {
      kind: 'inlineReference',
      path: readableValue(item.inlineReference),
      name: item.name || '',
    };
  }

  if (typeof item.value === 'string') {
    return {
      kind: item.kind || 'value',
      value: item.value,
    };
  }

  if (item.kind && (item.kind === 'markdownContent' || item.kind === 'progressTaskSerialized')) {
    const content = typeof item.content?.value === 'string' ? item.content.value : '';
    return {
      kind: item.kind,
      value: content,
    };
  }

  return { kind: item.kind || 'unknown' };
}

function determineChatStatus(data) {
  // Use real VS Code modelState field to determine if chat is complete or in progress
  // modelState.completedAt exists when request is complete
  // modelState.value: 0 = running, 1/2 = completed
  
  if (data.slashCommandCanceled) {
    return 'canceled';
  }

  const requests = Array.isArray(data.requests) ? data.requests : [];
  if (requests.length === 0) {
    return 'complete';
  }

  const lastRequest = requests[requests.length - 1];
  
  // Check modelState field (native VS Code field)
  if (lastRequest.modelState) {
    // If completedAt exists, the request is complete
    if (lastRequest.modelState.completedAt) {
      return 'complete';
    }
    // If modelState.value is 0, it's still running
    if (lastRequest.modelState.value === 0) {
      return 'in-progress';
    }
  }

  // Fallback: if no modelState, assume complete
  return 'complete';
}

function buildMinimalSession(data, workspaceHash, sessionId, sourceFile, options) {
  const requests = Array.isArray(data.requests) ? data.requests : [];
  const sequenceappendjson = buildSequenceAppendJson(data, options);
  const chatStatus = determineChatStatus(data);

  return {
    workspaceHash,
    sessionId: data.sessionId || sessionId,
    sourceFile,
    creationDate: data.creationDate || null,
    customTitle: data.customTitle || '',
    requestCount: requests.length,
    chatStatus,
    sequenceappendjson,
    requests: requests.map(request => {
      const response = Array.isArray(request?.response) ? request.response : [];
      return {
        timestamp: request?.timestamp || null,
        modelId: request?.modelId || '',
        userText: getUserText(request),
        totalElapsed: request?.result?.timings?.totalElapsed ?? null,
        modelState: request?.modelState || null,
        response: response.map(minimalResponseItem).filter(Boolean),
      };
    }),
  };
}

function inferSessionMetaFromPath(sessionFilePath, parsedData) {
  const normalized = path.resolve(sessionFilePath).replace(/\\/g, '/');
  const sessionIdFromFile = path.basename(sessionFilePath).replace(/\.(json|jsonl)$/i, '');
  const match = normalized.match(/workspaceStorage\/([^/]+)\/chatSessions\//i);

  return {
    workspaceHash: match ? match[1] : 'unknown-workspace',
    sessionId: (parsedData && parsedData.sessionId) || sessionIdFromFile,
  };
}

function readSessionFile(sessionFilePath) {
  const resolved = path.resolve(sessionFilePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Session file not found: ${resolved}`);
  }

  const ext = path.extname(resolved).toLowerCase();
  if (ext !== '.json' && ext !== '.jsonl') {
    throw new Error(`Unsupported file type: ${ext}. Use .json or .jsonl`);
  }

  const raw = fs.readFileSync(resolved, 'utf8');
  const data = ext === '.jsonl' ? parseJSONL(raw) : JSON.parse(raw);
  return { data, sourceFile: resolved };
}

function main() {
  const fileArg = process.argv[2];
  const outArg = process.argv[3];
  const featureNameArg = process.argv[4] || '';
  const checkPathsArg = process.argv[5] || '';

  if (!fileArg) {
    usage();
    process.exit(1);
  }

  const { data, sourceFile } = readSessionFile(fileArg);
  const { workspaceHash, sessionId } = inferSessionMetaFromPath(sourceFile, data);
  const minimal = buildMinimalSession(data, workspaceHash, sessionId, sourceFile, {
    featureName: featureNameArg,
    checkedPaths: parseCheckPaths(checkPathsArg)
  });

  const outputPath = outArg
    ? path.resolve(outArg)
    : path.join(process.cwd(), 'src', 'server', `sequenceappendjson-${workspaceHash}-${sessionId}.json`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  fs.writeFileSync(outputPath, JSON.stringify(minimal, null, 2), 'utf8');

  console.log('✅ Minimal JSON generated');
  console.log(`Input file: ${sourceFile}`);
  console.log(`Workspace:  ${workspaceHash}`);
  console.log(`Session:    ${sessionId}`);
  console.log(`Requests:   ${minimal.requestCount}`);
  console.log(`Output:     ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error('❌ Failed to extract minimal JSON');
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
}
