# Hermes VS Code Extension - Session History API Reference

## Overview

This document provides a comprehensive reference for listing, tracking, and building session history in the Hermes VS Code extension. It documents all the APIs, methods, and code snippets needed to interact with the session system.

---

## Table of Contents

1. [Session Listing API](#session-listing-api)
2. [Session Store Methods](#session-store-methods)
3. [Hermes Session Commands](#hermes-session-commands)
4. [History Building](#history-building)
5. [Session Data Structures](#session-data-structures)
6. [Code Examples](#code-examples)

---

## Session Listing API

### Primary Methods

| Method | Location | Description |
|--------|----------|-------------|
| `AcpClient.listSessions()` | `src/acpClient.ts:241` | Lists all Hermes sessions from the backend |
| `SessionStore.allSessions()` | `src/sessionStore.ts:40` | Returns all locally stored sessions |
| `SessionStore.allSessionsReversed()` | `src/sessionStore.ts:42` | Returns sessions in reverse chronological order |
| `SessionStore.searchSessions()` | `src/sessionStore.ts:175` | Search sessions by title or tag |
| `SessionStore.getPagination()` | `src/sessionStore.ts:320` | Get paginated session results |

---

### AcpClient.listSessions()

**File:** `src/acpClient.ts` (lines 241-262)

```typescript
/**
 * List all sessions in Hermes.
 */
async listSessions(): Promise<ChatSession[]> {
  const result = await this.call('session/list', {});
  
  // Handle unexpected response types gracefully (e.g., null, undefined, empty object)
  if (!Array.isArray(result)) {
    console.warn('[acp] session/list returned non-array, returning empty list');
    return [];
  }
  
  return result.map((r: Record<string, unknown>) => ({
    id: String(r.session_id ?? r.id),
    title: String(r.title ?? 'New Session'),
    createdAt: Number(r.created_at ?? Date.now()),
    updatedAt: Number(r.updated_at ?? r.updated_at ?? Date.now()),
    messages: Array.isArray(r.messages) ? r.messages : [],
    acpSessionId: String(r.acp_session_id ?? undefined),
    apiTimeMs: Number(r.api_time_ms ?? 0),
    toolTimeMs: Number(r.tool_time_ms ?? 0),
    peakMemoryBytes: Number(r.peak_memory_bytes ?? 0),
    tags: Array.isArray(r.tags) ? r.tags : [],
  }));
}
```

**Usage Example:**

```typescript
// List all sessions from Hermes backend
const sessions = await acpClient.listSessions();
sessions.forEach(session => {
  console.log(`Session: ${session.title} (${session.id})`);
  console.log(`  Messages: ${session.messages.length}`);
  console.log(`  API Time: ${session.apiTimeMs}ms`);
  console.log(`  Tool Time: ${session.toolTimeMs}ms`);
});
```

---

### SessionStore Methods

#### allSessions()

**File:** `src/sessionStore.ts` (line 40)

```typescript
allSessions(): ChatSession[] { return this.sessions; }
```

Returns all sessions in chronological order.

#### allSessionsReversed()

**File:** `src/sessionStore.ts` (line 42)

```typescript
allSessionsReversed(): ChatSession[] { return [...this.sessions].reverse(); }
```

Returns sessions in reverse chronological order (newest first).

#### searchSessions()

**File:** `src/sessionStore.ts` (lines 175-182)

```typescript
searchSessions(query: string): ChatSession[] {
  if (!query.trim()) return this.sessions;
  const lowerQuery = query.toLowerCase();
  return this.sessions.filter(s =>
    s.title.toLowerCase().includes(lowerQuery) ||
    s.tags.some(t => t.toLowerCase().includes(lowerQuery))
  );
}
```

Searches by session title and tags.

#### getPagination()

**File:** `src/sessionStore.ts` (lines 320-332)

```typescript
getPagination(
  offset: number,
  limit: number,
  sortOptions: { by: 'date' | 'title' | 'activity' }
): { sessions: ChatSession[]; total: number; hasMore: boolean } {
  const sorted = this.sortSessions(sortOptions);
  const paginated = sorted.slice(offset, offset + limit);
  return {
    sessions: paginated,
    total: sorted.length,
    hasMore: offset + limit < sorted.length,
  };
}
```

Returns paginated results with metadata.

#### filterSessionsByDate()

**File:** `src/sessionStore.ts` (lines 291-299)

```typescript
filterSessionsByDate(from?: Date, to?: Date): ChatSession[] {
  const now = Date.now();
  return this.sessions.filter(s => {
    const ts = s.createdAt;
    if (from && ts < from.getTime()) return false;
    if (to && ts > to.getTime()) return false;
    return true;
  });
}
```

Filters sessions by date range.

#### sortSessions()

**File:** `src/sessionStore.ts` (lines 301-318)

```typescript
sortSessions(options: { by: 'date' | 'title' | 'activity'; desc?: boolean }): ChatSession[] {
  const copy = [...this.sessions];
  copy.sort((a, b) => {
    switch (options.by) {
      case 'date':
        return options.desc ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
      case 'title':
        return options.desc
          ? b.title.localeCompare(a.title)
          : a.title.localeCompare(b.title);
      case 'activity':
        return options.desc
          ? b.messages.length - a.messages.length
          : a.messages.length - b.messages.length;
    }
  });
  return copy;
}
```

Sorts by date, title, or activity (message count).

---

## Hermes Session Commands

**File:** `src/protocol.ts` (lines 181-186)

```typescript
/** Hermes session command types for MCP protocol. */
export type HermesSessionCommand =
  | { type: 'hermes.sessions.create'; sessionId: string }
  | { type: 'hermes.sessions.delete'; sessionId: string }
  | { type: 'hermes.sessions.list'; sessions: ACPSession[] }
  | { type: 'hermes.sessions.compact'; sessionId: string }
  | { type: 'hermes.sessions.save'; sessionId: string };
```

### ACPSession Structure

```typescript
export interface ACPSession {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
  message_count: number;
}
```

### Hermes Session API (Backend)

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

## History Building

### Message Flow

The session history is built through a series of steps:

```
User Message Flow
├── User types in webview
├── Webview sends {type: 'send', text: "..."}
├── ChatPanel.handleFromWebview()
├── 1. Store user message in history (skip slash commands)
├── 2. Build context annotation (attached files, selected skills)
├── 3. Send {type: 'statusBar', contextAnnotation: "..."}
├── 4. Call session.cancel() or session.runPrompt()
├── Hermes ACP processes prompt
├── Updates session history in state.db
├── Emits {type: 'append', text: "..."}
└── Webview displays response
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

### Message Storage Methods

#### addUserMessage()

**File:** `src/sessionStore.ts` (lines 108-122)

```typescript
addUserMessage(text: string): void {
  const s = this.active();
  if (s) {
    // Extract context annotation from session title or agent message
    const contextAnnotation = s.title;
    s.messages.push({
      role: 'user',
      text,
      timestamp: Date.now(),
      sessionId: s.id,
      contextAnnotation,
    });
    this.persist();
  }
}
```

#### addTurnMessages()

**File:** `src/sessionStore.ts` (lines 124-140)

```typescript
addTurnMessages(tools: StoredMessage[], agentText: string): void {
  const s = this.active();
  if (!s) return;
  for (const t of tools) s.messages.push(t);
  if (agentText.trim()) {
    s.messages.push({
      role: 'agent' as const,
      text: agentText,
      timestamp: Date.now(),
      sessionId: s.id,
    });
  }
  if (s.messages.length > MAX_MESSAGES_PER_SESSION) {
    s.messages = s.messages.slice(-MAX_MESSAGES_PER_SESSION);
  }
  this.persist();
}
```

---

## Session Data Structures

### ChatSession

**File:** `src/types.ts` (lines 48-67)

```typescript
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  
  // Message storage
  messages: StoredMessage[];
  
  // Hermes-specific: links to ACP session
  acpSessionId?: string;
  
  // Performance tracking (Cline-style)
  apiTimeMs: number;           // Total API call time
  toolTimeMs: number;          // Total tool execution time
  peakMemoryBytes: number;     // Peak RSS memory
  
  // Optional: session tags for filtering
  tags: string[];
}
```

### StoredMessage

**File:** `src/types.ts` (lines 31-46)

```typescript
export interface StoredMessage {
  role: 'user' | 'agent' | 'tool' | 'error';
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

### TodoState

**File:** `src/types.ts` (lines 78-87)

```typescript
export interface TodoState {
  todos: TodoItem[];
  summary?: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    cancelled: number;
  };
}

export interface TodoItem {
  id?: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  activeForm?: string;
}
```

### SessionUpdateEvent

**File:** `src/types.ts` (lines 91-111)

```typescript
export interface SessionUpdateEvent {
  session_id: string;
  text?: string;
  thinkingText?: string;
  toolTitle?: string;
  toolStatus?: string;
  toolCallId?: string;
  toolDetail?: string;
  toolKind?: string;
  toolLocations?: string[];
  todoState?: TodoState;
  done?: boolean;
  error?: string;
  model?: string;
  sessionTitle?: string;
  contextUsed?: number;
  contextSize?: number;
  cachedTokens?: number;
}
```

---

## Code Examples

### Complete Session Listing with Stats

```typescript
import { SessionStore } from './sessionStore';
import { AcpClient } from './acpClient';

// Get all sessions with full statistics
const sessions = store.allSessionsReversed();

sessions.forEach(session => {
  console.log(`\n=== ${session.title} (${session.id}) ===`);
  console.log(`  Created: ${new Date(session.createdAt).toISOString()}`);
  console.log(`  Updated: ${new Date(session.updatedAt).toISOString()}`);
  console.log(`  Messages: ${session.messages.length}`);
  console.log(`  ACP Session: ${session.acpSessionId || 'N/A'}`);
  console.log(`  API Time: ${session.apiTimeMs}ms (${(session.apiTimeMs / 1000).toFixed(2)}s)`);
  console.log(`  Tool Time: ${session.toolTimeMs}ms`);
  console.log(`  Peak Memory: ${(session.peakMemoryBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Tags: ${session.tags.join(', ') || 'None'}`);
  
  // Preview first 3 messages
  const preview = session.messages.slice(0, 3).map(m => 
    `${m.role}: ${m.text.slice(0, 50)}...`
  ).join('\n  ');
  console.log(`  Preview: ${preview}`);
});
```

### Build Session History for Export

```typescript
import { SessionStore } from './sessionStore';
import { StoredMessage } from './types';

function buildSessionHistory(): { sessionId: string; messages: StoredMessage[] }[] {
  return store.allSessionsReversed().map(session => ({
    sessionId: session.id,
    messages: session.messages.map(m => ({
      role: m.role,
      text: m.text,
      timestamp: m.timestamp,
      toolCallId: m.toolCallId,
      toolName: m.toolName,
      toolStatus: m.toolStatus,
      contextAnnotation: m.contextAnnotation,
    })),
  }));
}

// Export to JSON
const history = buildSessionHistory();
console.log(JSON.stringify(history, null, 2));
```

### Search Sessions with Full History

```typescript
import { SessionStore } from './sessionStore';

// Search for sessions containing a specific term
const query = 'authentication';
const results = store.searchSessions(query);

results.forEach(session => {
  const matchingMessages = session.messages.filter(
    m => m.text.toLowerCase().includes(query.toLowerCase())
  );
  
  console.log(`\nSession: ${session.title}`);
  matchingMessages.forEach(m => {
    console.log(`  ${new Date(m.timestamp).toLocaleString()}: ${m.text}`);
  });
});
```

### Get Session by ACP Session ID

```typescript
import { SessionStore } from './sessionStore';

// Find local session by ACP session ID (for context resume)
const acpSessionId = '1234567890abcdef';
const localSession = store.allSessions().find(
  s => s.acpSessionId === acpSessionId
);

if (localSession) {
  console.log(`Found local session for ACP session ${acpSessionId}`);
  console.log(`Title: ${localSession.title}`);
  console.log(`Messages: ${localSession.messages.length}`);
} else {
  console.log(`No local session found for ACP session ${acpSessionId}`);
}
```

---

## File Locations

| File | Purpose |
|------|---------|
| `src/sessionStore.ts` | SessionStore class with all session operations |
| `src/sessionManager.ts` | SessionManager for ACP integration |
| `src/acpClient.ts` | ACP client for Hermes server communication |
| `src/chatPanel.ts` | Chat panel provider bridging webview and session system |
| `src/types.ts` | TypeScript type definitions |
| `src/protocol.ts` | ACP protocol parsing |
| `src/extension.ts` | Extension entry point |
| `src/webview/main.ts` | Webview event handling |
| `src/webview/state.ts` | Webview state management |

---

## Additional Resources

- [SESSION_MANAGEMENT.md](./SESSION_MANAGEMENT.md) - Session management documentation
- [SESSION_API_REFERENCE.md](./SESSION_API_REFERENCE.md) - Session API reference
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions

---

*Generated: $(date +%Y-%m-%d %H:%M:%S)*