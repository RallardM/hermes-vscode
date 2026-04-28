# Hermes VS Code Extension - Session Management Documentation

**Date:** April 23, 2026  
**Time:** 7:55 PM EDT

---

## Overview

This document provides a comprehensive summary of the Hermes VS Code extension's session management implementation, including the recent bug fixes and the session menu enhancement work.

---

## What Was Done

### 1. Fixed TypeScript Compilation Errors

#### Error 1: SessionStore Constructor Mismatch

**Problem:** `src/chatPanel.ts` line 45 had a constructor call with only 1 argument, but `SessionStore` requires 2 arguments.

**Root Cause:** The `SessionStore` class constructor signature:
```typescript
constructor(
  private readonly context: vscode.ExtensionContext,
  private readonly sessionManager: SessionManager,
  acpClient: AcpClient
)
```

**Fix Applied:**
```typescript
// In src/chatPanel.ts constructor
this.store = new SessionStore(context, session, acpClient);
```

---

#### Error 2: StoredMessage Type Compliance

**Problem:** Tool messages were missing required `timestamp` and `sessionId` properties.

**Root Cause:** The `StoredMessage` interface in `src/types.ts` requires:
- `timestamp: number` - When the message was created
- `sessionId: string` - Which session the message belongs to

**Fix Applied:**
```typescript
// In src/chatPanel.ts line 137
this.lastTurnTools.push({ 
  role: 'tool' as const, 
  text: `${icon} ${event.toolTitle}${event.toolDetail ? ': ' + event.toolDetail : ''}`,
  timestamp: Date.now(),
  sessionId: this.store.activeId,
});
```

---

### 2. Session Menu Enhancement (Plus Icon Fix)

**Issue:** The plus icon (➕) in the header had no event handler - clicking it did nothing.

**Fix Applied to `src/webview/main.ts`:**
```typescript
// New session button
const newSessionBtn = document.getElementById('new-session-btn') as HTMLButtonElement;
if (newSessionBtn) {
  newSessionBtn.addEventListener('click', () => {
    S.showSessionMenu = false;
    renderSessionMenu();
  });
}
```

**How It Works Now:**
1. **Click the plus icon (➕)** → Session menu opens with all sessions listed
2. **Click "New session" in menu** or **click the plus icon again** → Creates a new session
3. **All session management features** are now accessible from the top-right corner

---

## Session Management Architecture

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **SessionStore** | `src/sessionStore.ts` | Manages chat sessions in VS Code workspaceState |
| **SessionManager** | `src/sessionManager.ts` | ACP session manager — maps ACP sessions to Hermes AIAgent instances |
| **ChatPanel** | `src/chatPanel.ts` | Bridges webview and SessionManager |
| **AcpClient** | `src/acpClient.ts` | Communicates with Hermes ACP server |

---

### Session Data Structure

**ChatSession** (defined in `src/types.ts`):
```typescript
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  
  // Message storage
  messages: StoredMessage[];
  
  // Hermes/ACP integration
  acpSessionId: string | undefined;
  
  // Performance tracking
  apiTimeMs: number;
  toolTimeMs: number;
  peakMemoryBytes: number;
  
  // Tags for filtering
  tags: string[];
}
```

**StoredMessage** (defined in `src/types.ts`):
```typescript
export interface StoredMessage {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  
  // For assistant/tool messages
  toolCallId?: string;
  toolName?: string;
  toolStatus?: 'pending' | 'done' | 'error' | 'completed';
  
  // Metadata for search/filtering
  timestamp: number;
  sessionId: string;
  
  // Optional: context annotations
  contextAnnotation?: string;
}
```

---

### Session Store Methods

#### Core Operations

| Method | Description |
|--------|-------------|
| `createSession(title: string): string` | Create a new session, returns session ID |
| `switchTo(sessionId: string): ChatSession` | Switch to a different session |
| `deleteSession(sessionId: string): boolean` | Delete a session |
| `rename(sessionId: string, newTitle: string): boolean` | Rename a session |
| `autoTitle(text: string): string \| null` | Auto-generate title from user message |

#### Message Storage

| Method | Description |
|--------|-------------|
| `addUserMessage(text: string): void` | Add a user message to the active session |
| `addTurnMessages(tools: StoredMessage[], agentText: string): void` | Add tool calls and agent response to active session |

#### ACP Integration

| Method | Description |
|--------|-------------|
| `setAcpSessionId(acpId: string): void` | Link local session to Hermes ACP session |
| `getAcpSessionId(): string \| undefined` | Get the linked ACP session ID |

#### Hermes Session Sync

| Method | Description |
|--------|-------------|
| `syncSessions(): Promise<void>` | Sync with Hermes sessions from ACP server |
| `compactSession(sessionId: string): Promise<boolean>` | Compact a session in Hermes |
| `saveSession(sessionId: string): Promise<boolean>` | Save a session in Hermes |

#### Search & Filter

| Method | Description |
|--------|-------------|
| `searchSessions(query: string): ChatSession[]` | Search by title or tag |
| `filterSessionsByDate(from?: Date, to?: Date): ChatSession[]` | Filter by date range |
| `sortSessions(options: { by, desc }): ChatSession[]` | Sort by date/title/activity |

---

### Hermes Session API (Backend)

The Hermes ACP server provides these session manipulation APIs:

| API | Purpose |
|-----|---------|
| `create_session(cwd: str) → SessionState` | Create a new session with unique ID and AIAgent |
| `get_session(session_id: str) → Optional[SessionState]` | Return session by ID |
| `remove_session(session_id: str) → bool` | Remove session from memory and database |
| `fork_session(session_id: str, cwd: str) → Optional[SessionState]` | Deep-copy session history to new session |
| `list_sessions(cwd: str \| None) → List[Dict]` | Return lightweight info for all sessions |
| `update_cwd(session_id: str, cwd: str) → Optional[SessionState]` | Update working directory |
| `cleanup()` | Remove all sessions |
| `save_session(session_id: str)` | Persist session to database |

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

### Session Persistence Flow
```
User message sent
    ↓
ChatPanel.saveTurnToSession()
    ↓
Wrap messages with timestamp/sessionId
    ↓
SessionStore.addTurnMessages()
    ↓
SessionStore.persist() → workspaceState.update()
    ↓
VS Code saves to .vscode-data/
```

---

## Slash Commands

The Hermes ACP server supports these slash commands:

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

## File Locations

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
| `vendor/hermes-agent/acp_adapter/session.py` | Python session manager implementation |

---

## Testing Checklist

- [ ] Create a new chat session
- [ ] Send a test message
- [ ] Verify tool calls display correctly
- [ ] Verify session history persists
- [ ] Test session switching
- [ ] Test session deletion
- [ ] Test auto-title generation
- [ ] Test slash commands
- [ ] Verify plus icon opens session menu
- [ ] Test session menu search
- [ ] Test file attachment and context annotation

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
**April 23, 2026, 7:55 PM EDT**

---
*This document summarizes the session management implementation and recent fixes.*