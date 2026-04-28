# Hermes VS Code Extension - Troubleshooting Guide

**Date:** April 26, 2026  
**Time:** 10:17 PM EDT

---

## Summary of Issues

This document covers three main issues based on the console logs:

1. ❌ **Hermes not starting** - "ACP client not started" error
2. ❌ **Unable to select custom Llama model** - Model selection not working
3. ❌ **Plus icon not creating new session** - Session menu/creation failing

---

## Issue 1: Hermes Not Starting / "ACP client not started"

### Error
```
Error: ACP client not started
at i.listSessions (c:\Users\remal\.vscode\extensions\hermes-local-ai.hermes-local-ai-agent-3.0.0\dist\extension.js:1:3665)
at t.SessionStore.syncSessions (c:\Users\remal\.vscode\extensions\hermes-local-ai.hermes-local-ai-agent-3.0.0\dist\extension.js:1:80992)
at new t.SessionStore (c:\Users\remal\.vscode\extensions\hermes-local-ai.hermes-local-ai-agent-3.0.0\dist\extension.js:1:78791)
at new m (c:\Users\remal\.vscode\extensions\hermes-local-ai.hermes-local-ai-agent-3.0.0\dist\extension.js:1:5771)
at t.activate (c:\Users\remal\.vscode\extensions\hermes-local-ai.hermes-local-ai-agent-3.0.0\dist\extension.js:1:23656)
```

### Root Cause
The `SessionStore` constructor is calling `this.syncSessions()` synchronously, which immediately tries to use the ACP client before it has been started.

### Possible Culprits (in order of likelihood)

| # | Culprit | Description |
|---|---------|-------------|
| 1 | **ACP Client not started before SessionStore constructor runs** | `sessionStore.ts` line 29 calls `this.syncSessions()` synchronously in constructor. `syncSessions()` calls `session.listSessions()` which requires ACP client to be started. |
| 2 | **Hermes binary path not resolved correctly** | `extension.ts` line 268 calls `resolveHermesBinary()`. If binary doesn't exist or isn't executable, extension returns early at line 307. |
| 3 | **Workspace not trusted** | Extension checks `vscode.workspace.isTrusted` at line 418. If not trusted, Hermes launch is blocked. |
| 4 | **Hermes binary permissions issue** | Line 304-308: Extension checks if binary is executable. Linux/Mac have executable bit requirements. |
| 5 | **HERMES environment variable conflict** | Line 262: `hermesPath = hermesEnv ?? configuredHermes.value`. If `process.env.HERMES` is set to an invalid path, it will be used. |
| 6 | **Extension already loaded from installed version** | Extension path shows `3.0.0` version (from gallery). Local code changes may not be loaded. |

---

### ✅ **FIX: ACP Client Timing Issue**

```typescript
// src/sessionStore.ts - Line 29
// BEFORE:
this.syncSessions();  // Blocks constructor, crashes before ACP client is started

// AFTER:
void this.syncSessions();  // Fires-and-forget async call, constructor completes immediately
```

The `void` keyword tells TypeScript that this async method can be called without awaiting, allowing the constructor to complete while the session synchronization runs in the background.

---

## Issue 2: Unable to Select Custom Llama Model

### Symptom
Model selection UI not working or custom models not appearing

### Possible Culprits

| # | Culprit | Description |
|---|---------|-------------|
| 1 | **Model catalog not loaded** | `src/modelCatalog.ts` may not be properly initialized. Custom models not registered in the catalog. |
| 2 | **Hermes config not read correctly** | `extension.ts` line 45-58: `readHermesModel()` reads from `~/.hermes/config.yaml`. If config is missing or malformed, falls back to default Sonnet model. |
| 3 | **Model catalog file missing** | Custom models defined in a catalog file may not be present. Catalog path configuration may be incorrect. |
| 4 | **Hermes server not exposing custom models** | Custom models must be registered in Hermes server. Hermes server may not be restarted after adding models. |
| 5 | **Extension using gallery version instead of local** | If extension is running from installed version, local changes won't apply. |

---

## Issue 3: Plus Icon Not Creating New Session

### Symptom
Clicking plus icon (➕) or "New session" button doesn't work

### Possible Culprits

| # | Culprit | Description |
|---|---------|-------------|
| 1 | **Store not initialized in webview** | Console logs show: `[webview] store not yet initialized`. Webview state not ready when button is clicked. |
| 2 | **Session creation failing silently** | `session.reset()` may throw an error that's not handled. `panel.post({ type: 'clear' })` may fail. |
| 3 | **Session menu toggle not working** | Console shows: `[webview] ⚙️ Session menu toggle button clicked`. But menu may not be rendering properly. |
| 4 | **Event handlers not attached** | Check `src/webview/main.ts` for proper event listener attachment. |
| 5 | **State synchronization issues** | Webview state may not be properly synced with extension state. |

---

## Verification Steps

### For Hermes Not Starting:
1. Check `~/.hermes/config.yaml` exists and is valid YAML
2. Verify Hermes binary path is correct and executable
3. Check if workspace is trusted
4. Look at `extension.ts` line 264-269 output in console

### For Custom Model Selection:
1. Check `~/.hermes/config.yaml` has `model:` setting
2. Verify custom models exist in model catalog
3. Restart Hermes server after adding models

### For Plus Icon:
1. Check webview console for errors
2. Verify store initialization completes before button click
3. Add error handling around session creation

---

## Quick Fixes

### 1. Fix ACP client timing issue:
```typescript
// In src/sessionStore.ts line 29
void this.syncSessions();  // Instead of this.syncSessions();
```

### 2. Clean extension cache:
- Delete `.vscode-data/` folder
- Reload VS Code window

### 3. Verify local extension is loaded:
- Check Developer → Show Commands → `Developer: Reload Window`
- Verify extension version matches your local code

---

## Session Management Architecture Reference

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **SessionStore** | `src/sessionStore.ts` | Manages chat sessions in VS Code workspaceState |
| **SessionManager** | `src/sessionManager.ts` | ACP session manager — maps ACP sessions to Hermes AIAgent instances |
| **ChatPanel** | `src/chatPanel.ts` | Bridges webview and SessionManager |
| **AcpClient** | `src/acpClient.ts` | Communicates with Hermes ACP server |

---

## Message Flow

### User Message Flow
```
User types in webview
    ↓
Webview sends {type: 'send', text: "..."}
    ↓
ChatPanel.handleFromWebview()
    ↓
1. Store user message in history (skip slash commands)
2. Build context annotation (attached files, selected skills)
3. Send {type: 'statusBar', contextAnnotation: "..."}
4. Call session.cancel() or session.runPrompt()
    ↓
Hermes ACP processes prompt
    ↓
Updates session history in state.db
    ↓
Emits {type: 'append', text: "..."}
    ↓
Webview displays response
```

---

## Slash Commands Reference

| Command | Description |
|---------|-------------|
| `/help` | Show help documentation |
| `/model [model]` | Switch to a different model |
| `/title [title]` | Set session title |
| `/new` | Create a new session |
| `/retry` | Retry last tool call |
| `/compact` | Compact session (remove unused memory) |
| `/save` | Save session for later |
| `/save-as [filename]` | Save with custom name |
| `/undo` | Undo last action |
| `/compress` | Compress session (reduce memory) |

---

## File Locations Reference

| File | Purpose |
|------|---------|
| `src/sessionStore.ts` | SessionStore class with all session operations |
| `src/sessionManager.ts` | SessionManager for ACP integration |
| `src/acpClient.ts` | ACP client for Hermes server communication |
| `src/chatPanel.ts` | Chat panel provider bridging webview and session system |
| `src/types.ts` | TypeScript type definitions |
| `src/extension.ts` | Extension entry point |
| `src/webview/main.ts` | Webview event handling |
| `src/webview/state.ts` | Webview state management |

---

## Important Notes

### CWD Normalization
The `_normalize_cwd_for_compare()` function normalizes Windows drive paths to WSL mount form:
```
C:\path\to\workspace  →  /mnt/c/path/to/workspace
```

### Session ID Format
Session IDs are timestamps (format: `s1234567890123`).

### Persistence
- **VS Code**: Stored in `.vscode-data/` via `workspaceState`
- **Hermes**: Stored in `~/.hermes/state.db` (SQLite)

### Thread Safety
`SessionManager` uses a `Lock()` for thread-safe operations on `self._sessions`.

---

## Session Completed At:
**April 26, 2026, 10:17 PM EDT**

---
*This document summarizes the troubleshooting analysis and fixes for Hermes VS Code extension issues.*