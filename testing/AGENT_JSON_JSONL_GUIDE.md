# Agent JSON/JSONL Search Guide

Use this guide when debugging parser/UI features without re-discovering storage format.

## 1) Decode localhost URL -> workspace + session

Input URL pattern used by standalone server:

- `http://localhost:8080/<workspaceHash>/<sessionId>`
- Example:
  - `http://localhost:8080/d14344c874d7f8b71ef1d57d284b18f0/21694af0-3c67-4c87-9908-1be32c21cb18`

Extraction:

- `workspaceHash = first path segment`
- `sessionId = second path segment` (chat session id)

## 2) Exact files to open for that session

For `workspaceHash=<W>` and `sessionId=<S>`:

- Chat log (main source):
  - `%APPDATA%/Code/User/workspaceStorage/<W>/chatSessions/<S>.jsonl`
- Optional paired JSON (exists for some sessions):
  - `%APPDATA%/Code/User/workspaceStorage/<W>/chatSessions/<S>.json`
- Edit timeline (not primary chat payload):
  - `%APPDATA%/Code/User/workspaceStorage/<W>/chatEditingSessions/<S>/state.json`

In this repo parser:

- `src/inbox.ts` reads from `chatSessions/` and parses `.json` + `.jsonl`.

## 3) Critical JSONL format facts (must know)

`chatSessions/*.jsonl` is **operation-log JSON**, not one complete session per line.

Operation kinds:

- `kind: 0` => base object in `v`
- `kind: 1` => set nested path `k` to `v`
- `kind: 2` => array update at path `k`
  - if `i` is present: insert `v` at index `i`
  - else: append array values

If you do not replay ops correctly, you will miss `requests[].response[]` data.

## 4) Where approval/pending data actually lives

Main items:

- `requests[*].response[*]` items with:
  - `kind: "toolInvocationSerialized"`
  - `toolSpecificData.kind: "terminal"`

Approval state:

- `isConfirmed` can be object form, e.g. `{ "type": 0 }`, `{ "type": 1 }`, `{ "type": 3 }`
- Pending approval is typically `type: 0`

Terminal fields commonly present:

- `toolSpecificData.commandLine.original`
- `toolSpecificData.confirmation.commandLine`
- `toolSpecificData.confirmation.cwdLabel` (sometimes object-like URI)
- `toolSpecificData.terminalCommandState` (often null for pending)
- `toolSpecificData.autoApproveInfo`

Important: exact UI phrase

- `"Allow reading external directory?"` may **not** be persisted in JSONL.
- Don’t key only on that phrase.
- Use structural fields above (`isConfirmed`, `confirmation`, terminal kind).

## 5) Fast search checklist (agent workflow)

1. Parse URL and get `<W>`, `<S>`.
2. Open `<W>/chatSessions/<S>.jsonl`.
3. Reconstruct final session object by replaying ops (kind 0/1/2, including indexed inserts).
4. Scan `requests[].response[]` for terminal tool items.
5. For pending commands, filter:
   - terminal tool item
   - `isConfirmed.type === 0` OR parser-specific pending logic
6. Extract display payload:
   - command: `toolSpecificData.commandLine.original`
   - reason source: `toolSpecificData.confirmation.message` else fallback
   - approval target: `toolSpecificData.confirmation.commandLine`
   - directory: `confirmation.cwdLabel` or terminal `cwd`

## 6) Known project mapping (this repo)

Relevant code paths:

- Parser + pending detection:
  - `src/inbox.ts`
- Data types for UI payload:
  - `src/types.ts`
- Standalone/extension shared chat rendering:
  - `standalone/webview/chat.js.js`
  - `standalone/webview/chat.css.js`
- Shared webview composer:
  - `standalone/webview/index.js`
- Standalone server uses webview modules live:
  - `standalone/server.js`

## 7) Validation commands after parser/UI change

From repo root:

```powershell
npm run compile
node testing/test-parser-feedback.js <workspaceHash> <sessionId>
node testing/test-app-view-simulation.js <workspaceHash> <sessionId> 2
```

Recommended target session (example):

```powershell
node testing/test-parser-feedback.js d14344c874d7f8b71ef1d57d284b18f0 21694af0-3c67-4c87-9908-1be32c21cb18
```

## 8) Common pitfalls

- Treating `.jsonl` as plain JSON lines without op replay.
- Searching only for exact human-visible phrases.
- Ignoring object-form `isConfirmed`.
- Using stale browser cache or old extension host process after code edits.
  - Hard refresh page (`Ctrl+F5`) and reload VS Code window when needed.

## 9) Minimal “done” criteria for future agents

A fix is done when:

- pending approval item is found from session storage structurally,
- parser emits approval payload (`reason`, command, cwd) for that item,
- standalone chat view renders approval-required box with that payload,
- compile + parser feedback + app-view simulation all pass.
