# Agent Testing Guide

This folder contains all parser/app simulation tests for the extension.

## Purpose

Use these tests to validate chat parsing and app-visible rendering output after any parser/UI change.
The tests are file-based and do **not** require starting the standalone server.

## Test Files

- `test-parser.js`
  - Quick smoke test for inbox parsing across sessions.
  - Verifies parser does not crash and prints recent message summaries.

- `test-dates.js`
  - Date/timestamp sanity checks for session ordering and metadata.

- `test-parser-feedback.js`
  - Deep parser diagnostics for one session.
  - Validates:
    - assistant/user counts
    - thinking/tool extraction
    - timeline segment extraction
    - tool title quality
    - empty file-token regressions
  - Prints last assistant snapshot in app-like timeline format.

- `test-app-view-simulation.js`
  - Simulates app behavior for last user→assistant pairs.
  - Validates that tail assistant replies are renderable.
  - Distinguishes:
    - `pendingMissingPairs` (latest user prompts with no assistant yet)
    - `hardMissingPairs` (unexpected missing assistant)
    - `nullRenderablePairs` (assistant exists but has no renderable content)

## NPM Commands

From workspace root:

- `npm run compile`
- `npm run test:parser`
- `npm run test:app-view`

## Direct Script Usage

Pass custom workspace/session IDs if needed:

- `node testing/test-parser-feedback.js <workspaceHash> <sessionId>`
- `node testing/test-app-view-simulation.js <workspaceHash> <sessionId> <tailPairCount>`
- `node testing/test-parser.js`
- `node testing/test-dates.js`

Example:

- `node testing/test-parser-feedback.js d14344c874d7f8b71ef1d57d284b18f0 607e5ee6-46c7-4c99-a6ec-842ba05a59b8`
- `node testing/test-app-view-simulation.js d14344c874d7f8b71ef1d57d284b18f0 607e5ee6-46c7-4c99-a6ec-842ba05a59b8 2`

## Update Workflow (for agents)

When changing parser or chat renderer:

1. Run `npm run compile`
2. Run `npm run test:parser`
3. Run `npm run test:app-view`
4. If a target session is known, run both direct scripts with that exact session ID.
5. Only consider change successful when:
   - no compile errors
   - `test-parser-feedback` assertions pass
   - `test-app-view-simulation` has `hardMissingPairs=0` and `nullRenderablePairs=0`

## Notes

- Tests rely on real chat storage under VS Code `workspaceStorage`.
- A failing `pendingMissingPairs` is acceptable when the conversation has fresh user prompts with no assistant response yet.
- If output looks stale in browser, cache key/version changes in webview code may be needed.

## Targeted Diagnostics

Run parser feedback test:

```powershell
node testing/test-parser-feedback.js d14344c874d7f8b71ef1d57d284b18f0 21694af0-3c67-4c87-9908-1be32c21cb18
```

Run dropped-message analyzer:

```powershell
node testing/analyze-missing-messages.js d14344c874d7f8b71ef1d57d284b18f0 21694af0-3c67-4c87-9908-1be32c21cb18
```
