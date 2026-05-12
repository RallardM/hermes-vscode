# Hermes VS Code Extension - Session History Navigation & Management

## Overview

This document provides a comprehensive architectural overview of how Hermes VS Code extension manages, navigates, and operates on session history. It covers the complete flow from session creation, navigation, editing, to deletion.

---

## Table of Contents

1. [Session Storage Architecture](#1-session-storage-architecture)
2. [Data Structures](#2-data-structures)
3. [Session Lifecycle](#3-session-lifecycle)
4. [Navigation System](#4-navigation-system)
5. [Session Management APIs](#5-session-management-apis)
6. [Persistence Layer](#6-persistence-layer)
7. [Hermes/ACP Integration](#7-hermesacp-integration)

---

## 1. Session Storage Architecture

### 1.1 Core Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Hermes VS Code Extension                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      SessionStore                              │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  sessions: ChatSession[] (localStorage/VS Code State)   │  │  │
│  │  │  activeSessionId: string                                │  │  │
│  │  │                                                          │  │  │
│  │  │  Methods:                                                │  │  │
│  │  │  • createSession()  → creates new session               │  │  │
│  │  │  • switchTo()       → navigates to session              │  │  │
│  │  │  • deleteSession()  → removes session                   │  │  │
│  │  │  • rename()         → edits session title               │  │  │
│  │  │  • autoTitle()      → generates title from message      │  │  │
│  │  │  • addUserMessage() → stores user input                 │  │  │
│  │  │  • addTurnMessages()→ stores tools + agent response     │  │  │
│  │  │  • searchSessions() → finds by title/tag                │  │  │
│  │  │  • sortSessions()   → order by date/title/activity      │  │  │
│  │  │  • filterByDate()   → date range filtering              │  │  │
│  │  │  • getPagination()  → page through sessions             │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 SessionManager (ACP Layer)                    │  │
│  │  • Tracks per-session statistics                              │  │
│  │  • apiTimeMs, toolTimeMs, peakMemoryBytes                     │  │
│  │  • Thread-safe operations with Lock()                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

                    │
                    │ (via AcpClient)
                    ▼
         ┌──────────────────────┐
         │  Hermes ACP Server   │
         │  ~/.hermes/state.db  │
         │  (SQLite Database)   │
         └──────────────────────┘
```

### 1.2 Storage Locations

| Location | Type | Content |
|----------|------|---------|
| **VS Code Workspace State** | `.vscode-data/` | Local session history (primary cache) |
| **Hermes ACP Server** | `~/.hermes/state.db` | Full session history in SQLite |
| **Memory** | Runtime | Active session state during session |

---

## 2. Data Structures

### 2.1 ChatSession

The main session container with all metadata and message history.

```typescript
export interface ChatSession {
  // Core identity
  id: string;                          // Format: "s" + timestamp (e.g., "s1234567890")
  title: string;                       // Auto-generated or user-defined (max 60 chars)
  createdAt: number;                   // Unix timestamp (milliseconds)
  updatedAt: number;                   // Last modification timestamp
  
  // Message storage
  messages: StoredMessage[];           // Ordered conversation history
  
  // Hermes/ACP integration link
  acpSessionId?: string;               // Links to ACP session ID
  
  // Performance metrics (Cline-style tracking)
  apiTimeMs: number;                   // Total API call duration
  toolTimeMs: number;                  // Total tool execution time
  peakMemoryBytes: number;             // Peak RSS memory usage
  
  // Optional: tags for filtering
  tags: string[];
}
```

### 2.2 StoredMessage

Individual message in the conversation history.

```typescript
export interface StoredMessage {
  // Message role
  role: 'user' | 'agent' | 'tool' | 'error';
  text: string;                        // Message content
  
  // For assistant/tool messages
  toolCallId?: string;                 // Tool call identifier
  toolName?: string;                   // Tool being called
  toolStatus?: 'pending' | 'done' | 'error' | 'completed';
  
  // Metadata for search/filtering
  timestamp: number;                   // When message was created
  sessionId: string;                   // Which session this belongs to
  
  // Optional: context annotations
  contextAnnotation?: string;          // Attached files, selected skills
}
```

### 2.3 TodoState

Task tracking state within a session.

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

---

## 3. Session Lifecycle

### 3.1 Session Creation Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                        Session Creation Flow                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Step 1: User Action                                              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  • Click "New Chat" button  OR                             │ │
│  │  • Send first user message to Hermes                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                     │
│                              ▼                                     │
│  Step 2: Local Session Creation                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  SessionStore.createSession(title: string): string          │ │
│  │  ├─ Generate ID: `s${Date.now()}`                           │ │
│  │  ├─ Create session object:                                  │ │
│  │  │  • id, title, createdAt, updatedAt                       │ │
│  │  │  • messages: [], acpSessionId: undefined                  │ │
│  │  │  • apiTimeMs: 0, toolTimeMs: 0, peakMemoryBytes: 0       │ │
│  │  │  • tags: []                                               │ │
│  │  ├─ Add to sessions array                                   │ │
│  │  ├─ Set as active session                                   │ │
│  │  └─ Enforce MAX_SESSIONS (default: 20)                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                     │
│                              ▼                                     │
│  Step 3: Hermes ACP Session Creation                              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  AcpClient.call('create', { cwd }) → { session_id, ... }    │ │
│  │  • Creates session in Hermes ACP server                     │ │
│  │  • Generates unique ACP session ID                          │ │
│  │  • Initializes AIAgent instance                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                     │
│                              ▼                                     │
│  Step 4: Link Local to ACP Session                                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  SessionStore.setAcpSessionId(acpId: string): void          │ │
│  │  • Updates local session's acpSessionId field               │ │
│  │  • Persists to VS Code workspace state                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                     │
│                              ▼                                     │
│  Step 5: Persist to VS Code Workspace                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  SessionStore.persist(): void                               │ │
│  │  ├─ workspaceState.update(SESSIONS_KEY, this.sessions)      │ │
│  │  └─ VS Code stores in .vscode-data/                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                     │
│                              ▼                                     │
│  Step 6: Initialize AIAgent Context                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  ACP Adapter (Python)                                       │ │
│  │  ├─ Fork session from workspace root                        │ │
│  │  ├─ Create new AIAgent instance                             │ │
│  │  └─ Initialize context with working directory               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Session Deletion Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                        Session Deletion Flow                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  User Action: Click "X" on session or use delete command   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  SessionStore.deleteSession(sessionId: string): boolean    │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  1. Check if deleting active session                 │  │  │
│  │  │     └─ If yes: return false (cannot delete active)  │  │  │
│  │  │                                                       │  │  │
│  │  │  2. Filter out session from array                    │  │  │
│  │  │     sessions = sessions.filter(s => s.id !== id)    │  │  │
│  │  │                                                       │  │  │
│  │  │  3. Persist changes                                  │  │  │
│  │  │     this.persist()                                   │  │  │
│  │  │                                                       │  │  │
│  │  │  4. Return true                                      │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Webview: Session Picker Rebuild                           │  │
│  │  ├─ Filter out deleted session from list                   │  │
│  │  ├─ Update active session if needed                        │  │
│  │  └─ Refresh UI                                              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Hermes ACP: Optional Cleanup                              │  │
│  │  ├─ AcpClient.listSessions() → get ACP sessions            │  │
│  │  ├─ Check if local session has acpSessionId                │  │
│  │  └─ If yes, send delete request to ACP server              │  │
│  │       (ACPSession.remove_session())                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Navigation System

### 4.1 Session Navigation Methods

| Method | Purpose | Description |
|--------|---------|-------------|
| `allSessions()` | Get all | Returns sessions in chronological order |
| `allSessionsReversed()` | Get all | Returns sessions newest-first |
| `switchTo(sessionId)` | Navigate | Switch active session to given ID |
| `searchSessions(query)` | Search | Find by title or tags |
| `filterSessionsByDate()` | Filter | Filter by date range |
| `sortSessions()` | Sort | Sort by date/title/activity |
| `getPagination()` | Paginate | Get paginated results |

### 4.2 Session Switching Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                        Session Switching Flow                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  User Action                                                │  │
│  │  • Click session in picker                                  │  │
│  │  • Use slash command `/switch [id]`                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ChatPanel.handleFromWebview()                             │  │
│  │  └─ Receive: { type: 'switchSession', sessionId: '...' }   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ChatPanel.switchTo(sessionId: string)                     │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  1. Update ACP session context                       │  │  │
│  │  │     session.switchTo(acpSessionId)                   │  │  │
│  │  │                                                       │  │  │
│  │  │  2. Update local session context                     │  │  │
│  │  │     this.store.switchTo(sessionId)                   │  │  │
│  │  │                                                       │  │  │
│  │  │  3. Update webview state                            │  │  │
│  │  │     this.state.currentActiveSessionId = sessionId   │  │  │
│  │  │                                                       │  │  │
│  │  │  4. Re-render session picker                         │  │  │
│  │  │     this.renderSessionPicker()                      │  │  │
│  │  │                                                       │  │  │
│  │  │  5. Update status bar                               │  │  │
│  │  │     this.updateStatusBar()                          │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Webview Update:                                            │  │
│  │  ├─ Show session picker with all sessions                  │  │
│  │  ├─ Highlight active session                               │  │
│  │  └─ Update status bar with session info                    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 Session Picker UI Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                      Session Picker UI Flow                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Click "➕" (plus) or "..." (menu) icon                    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  SessionPicker Component (src/webview/menus.ts)            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  SessionPicker {                                      │  │  │
│  │  │    sessions: WebviewSession[]                        │  │  │
│  │  │    activeId: string                                  │  │  │
│  │  │    searchTerm: string                                │  │  │
│  │  │                                                       │  │  │
│  │  │    Methods:                                           │  │  │
│  │  │    ├─ render()           → render HTML               │  │  │
│  │  │    ├─ buildSessions()    → filter/search sessions    │  │  │
│  │  │    ├─ renderSessionList()→ list all sessions         │  │  │
│  │  │    ├─ handleNew()        → create new session        │  │  │
│  │  │    ├─ handleSelect()     → switch to session         │  │  │
│  │  │    └─ handleDelete()     → delete session            │  │  │
│  │  │                                                       │  │  │
│  │  │    HTML Output:                                       │  │  │
│  │  │    ┌─────────────────────────────────────────────┐   │  │  │
│  │  │    │  Search: [______________]  [➕ New]          │   │  │  │
│  │  │    ├─────────────────────────────────────────────┤   │  │  │
│  │  │    │  Session 1: "Implement feature"    [🗑]    │   │  │  │
│  │  │    │  Session 2: "Debug issue"          [🗑]    │   │  │  │
│  │  │    │  Session 3: "Code review"          [🗑]    │   │  │  │
│  │  │    └─────────────────────────────────────────────┘   │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Event Handlers:                                           │  │
│  │  ├─ Click session → switchTo(session.id)                  │  │
│  │  ├─ Click "New"    → createSession()                      │  │
│  │  └─ Click "Delete" → deleteSession(session.id)            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Session Management APIs

### 5.1 SessionStore API Reference

```typescript
// ── Getters ────────────────────────────────────────

get activeId(): string;                          // Active session ID
active(): ChatSession | undefined;               // Get active session
allSessions(): ChatSession[];                    // All sessions (chronological)
allSessionsReversed(): ChatSession[];            // All sessions (newest-first)

// ── Create / Switch / Delete ───────────────────────

createSession(title: string): string;            // Create new session, return ID
switchTo(sessionId: string): ChatSession | undefined; // Switch to session
deleteSession(sessionId: string): boolean;       // Delete session
rename(sessionId: string, newTitle: string): boolean; // Rename session
autoTitle(text: string): string | null;          // Generate title from message

// ── Message storage ────────────────────────────────

addUserMessage(text: string): void;              // Add user message
addTurnMessages(tools: StoredMessage[], agentText: string): void; // Add turn

// ── ACP session ID ─────────────────────────────────

setAcpSessionId(acpId: string): void;            // Link to ACP session
getAcpSessionId(): string | undefined;           // Get ACP session ID
getStats(): { apiTimeMs: number; toolTimeMs: number; peakMemoryBytes: number };

// ── Hermes Session Sync ─────────────────────────────

syncSessions(): Promise<void>;                   // Sync with Hermes
compactSession(sessionId: string): Promise<boolean>; // Compact in Hermes
saveSession(sessionId: string): Promise<boolean>; // Save in Hermes

// ── Search / Filter / Sort ─────────────────────────

searchSessions(query: string): ChatSession[];    // Search by title/tag
filterSessionsByDate(from?: Date, to?: Date): ChatSession[]; // Filter by date
sortSessions(options: { by: 'date' | 'title' | 'activity'; desc?: boolean }): ChatSession[];

// ── Pagination ─────────────────────────────────────

getPagination(offset: number, limit: number, sortOptions: { by: 'date' | 'title' | 'activity' }): 
  { sessions: ChatSession[]; total: number; hasMore: boolean };

// ── Persistence ────────────────────────────────────

private persist(): void;                         // Persist to workspaceState
```

### 5.2 AcpClient API Reference

```typescript
// Session commands
async listSessions(): Promise<ChatSession[]>;                    // List all sessions
async createSession(cwd: string): Promise<ACPSessionResponse>;   // Create new session
async getAcpSessionId(acpSessionId: string): Promise<string>;    // Get ACP session ID
async compactSession(sessionId: string): Promise<boolean>;       // Compact session
async saveSession(sessionId: string): Promise<boolean>;          // Save session
async removeSession(sessionId: string): Promise<boolean>;        // Remove session
```

### 5.3 Hermes Session API (Backend)

| API | Purpose |
|-----|---------|
| `create_session(cwd: str) → SessionState` | Create new session with unique ID and AIAgent |
| `get_session(session_id: str) → Optional[SessionState]` | Return session by ID |
| `remove_session(session_id: str) → bool` | Remove session from memory and database |
| `fork_session(session_id: str, cwd: str) → Optional[SessionState]` | Deep-copy session history to new session |
| `list_sessions(cwd: str \| None) → List[Dict]` | Return lightweight info for all sessions |
| `update_cwd(session_id: str, cwd: str) → Optional[SessionState]` | Update working directory |
| `cleanup()` | Remove all sessions |
| `save_session(session_id: str)` | Persist session to database |

---

## 6. Persistence Layer

### 6.1 VS Code Workspace State Persistence

```
┌──────────────────────────────────────────────────────────────────┐
│                    VS Code Workspace State Persistence            │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Extension Code                                           │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  SessionStore.persist(): void                        │  │  │
│  │  │  ┌────────────────────────────────────────────────┐  │  │  │
│  │  │  │  workspaceState.update(SESSIONS_KEY,           │  │  │  │
│  │  │  │    this.sessions)                              │  │  │  │
│  │  │  │                                                 │  │  │  │
│  │  │  │  where:                                        │  │  │  │
│  │  │  │  SESSIONS_KEY = 'hermes.sessions'              │  │  │  │
│  │  │  │  this.sessions = ChatSession[]                 │  │  │  │
│  │  │  │                                                 │  │  │  │
│  │  │  └────────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  VS Code Internal: ExtensionContext.workspaceState         │  │
│  │  └─ Stores data in VS Code's state management system       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  VS Code Storage Location                                  │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  ~/.vscode-data/                                      │  │  │
│  │  │  └─ VS Code's data directory                          │  │  │
│  │  │                                                       │  │  │
│  │  │  └─ Data is automatically persisted on:              │  │  │
│  │  │     • Extension deactivation                          │  │  │
│  │  │     • Window close                                   │  │  │
│  │  │     • Extension reactivation                         │  │  │
│  │  │                                                       │  │  │
│  │  │  └─ On load, VS Code restores workspaceState          │  │  │
│  │  │     → SessionStore constructor reads saved sessions  │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Persistence Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         Persistence Flow                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  USER ACTION                                                │  │
│  │  • Send message                                             │  │
│  │  • Create session                                           │  │
│  │  • Delete session                                           │  │
│  │  • Rename session                                           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  MESSAGE PROCESSING                                         │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  1. ChatPanel.handleFromWebview()                   │  │  │
│  │  │     ├─ Store user message                           │  │  │
│  │  │     ├─ Build context annotation                     │  │  │
│  │  │     └─ Call session.runPrompt()                     │  │  │
│  │  │                                                       │  │  │
│  │  │  2. Hermes ACP processes prompt                     │  │  │
│  │  │     ├─ Updates state.db with messages               │  │  │
│  │  │     ├─ Tracks tool calls                            │  │  │
│  │  │     └─ Updates session state                        │  │  │
│  │  │                                                       │  │  │
│  │  │  3. Webview receives response                       │  │  │
│  │  │     ├─ { type: 'append', text: "..." }              │  │  │
│  │  │     ├─ { type: 'done' }                             │  │  │
│  │  │     └─ { type: 'toolCall', ... }                    │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  SESSION UPDATE                                             │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  ChatPanel.saveTurnToSession()                      │  │  │
│  │  │  ├─ Wrap messages with timestamp/sessionId          │  │  │
│  │  │  ├─ Call store.addTurnMessages()                    │  │  │
│  │  │  └─ Update ACP session ID                           │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  SESSIONSTORE UPDATE                                        │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  1. store.addUserMessage()                          │  │  │
│  │  │     └─ Push to messages array                       │  │  │
│  │  │                                                       │  │  │
│  │  │  2. store.addTurnMessages()                         │  │  │
│  │  │     └─ Push tools + agent response                  │  │  │
│  │  │                                                       │  │  │
│  │  │  3. Enforce MAX_MESSAGES_PER_SESSION                │  │  │
│  │  │     └─ Truncate if > 300 messages                   │  │  │
│  │  │                                                       │  │  │
│  │  │  4. Update timestamps                               │  │  │
│  │  │     └─ updatedAt = Date.now()                       │  │  │
│  │  │                                                       │  │  │
│  │  │  5. Call persist()                                  │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  PERSIST TO WORKSPACE STATE                                 │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  workspaceState.update(SESSIONS_KEY, sessions)      │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  VS CODE PERSISTS TO DISK                                   │  │
│  │  └─ Stored in: ~/.vscode-data/                              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. Hermes/ACP Integration

### 7.1 Session ID Linking

```
┌──────────────────────────────────────────────────────────────────┐
│                    Session ID Linking Architecture                │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  LOCAL SESSION (VS Code)                                    │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  ChatSession {                                        │  │  │
│  │  │    id: "s1234567890"                                  │  │  │
│  │  │    title: "Debug authentication"                     │  │  │
│  │  │    messages: [...]                                    │  │  │
│  │  │                                                        │  │  │
│  │  │    // ── CRITICAL LINK ──                             │  │  │
│  │  │    acpSessionId: "acp-abc123def456"                  │  │  │
│  │  │    // ↑ Points to Hermes ACP session                  │  │  │
│  │  │    ───────────────────────────────────────────────── │  │  │
│  │  │                                                        │  │  │
│  │  │    apiTimeMs: 12340                                  │  │  │
│  │  │    toolTimeMs: 5678                                  │  │  │
│  │  │    peakMemoryBytes: 134217728                        │  │  │
│  │  │    tags: ["debug", "authentication"]                 │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼ (via acpSessionId)                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  HERMES ACP SESSION (Server)                                │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  ACPSession {                                         │  │  │
│  │  │    id: "acp-abc123def456"                             │  │  │
│  │  │    title: "Debug authentication"                      │  │  │
│  │  │    preview: "..."                                     │  │  │
│  │  │    updated_at: "2026-05-06T02:01:46Z"                 │  │  │
│  │  │    message_count: 42                                  │  │  │
│  │  │                                                        │  │  │
│  │  │    // ── SESSION STATE ──                             │  │  │
│  │  │    state: SessionState {                              │  │  │
│  │  │      cwd: "/home/user/project"                        │  │  │
│  │  │      messages: [...]                                  │  │  │
│  │  │      todo_state: { ... }                              │  │  │
│  │  │    }                                                  │  │  │
│  │  │                                                        │  │  │
│  │  │    // ── AIAGENT ──                                    │  │  │
│  │  │    agent: AIAgent {                                    │  │  │
│  │  │      model: "llama-3.1-8b-instruct"                   │  │  │
│  │  │      context_window: 8192                             │  │  │
│  │  │    }                                                  │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 ACP Adapter Session Operations

```typescript
// src/vendor/hermes-agent/acp_adapter/session.py (Python)

class SessionManager:
    """Session manager for Hermes ACP adapter."""
    
    def __init__(self, cwd: str = None):
        self.cwd = self._normalize_cwd_for_compare(cwd)
        self._sessions: Dict[str, SessionState] = {}
        self._db = Database()  # SQLite for persistence
    
    def create_session(self, cwd: str) -> SessionState:
        """Create a new session with unique ID and AIAgent."""
        session_id = self._generate_id()
        agent = self._create_agent()
        state = SessionState(session_id, cwd, agent)
        self._sessions[session_id] = state
        return state
    
    def get_session(self, session_id: str) -> Optional[SessionState]:
        """Return session by ID."""
        return self._sessions.get(session_id)
    
    def remove_session(self, session_id: str) -> bool:
        """Remove session from memory and database."""
        if session_id not in self._sessions:
            return False
        
        # Remove from memory
        del self._sessions[session_id]
        
        # Remove from database
        self._db.remove_session(session_id)
        return True
    
    def fork_session(self, session_id: str, cwd: str) -> Optional[SessionState]:
        """Deep-copy session history to new session."""
        original = self.get_session(session_id)
        if not original:
            return None
        
        # Create new agent with same model
        agent = AIAgent(model=original.agent.model)
        
        # Fork session state
        new_state = SessionState(
            self._generate_id(),
            self._normalize_cwd_for_compare(cwd),
            agent,
            original.messages.copy()
        )
        
        self._sessions[new_state.id] = new_state
        return new_state
    
    def list_sessions(self, cwd: str = None) -> List[Dict]:
        """Return lightweight info for all sessions."""
        result = []
        for session in self._sessions.values():
            result.append({
                'session_id': session.id,
                'title': session.title,
                'created_at': session.created_at,
                'updated_at': session.updated_at,
                'messages': session.messages,
                'api_time_ms': session.api_time_ms,
                'tool_time_ms': session.tool_time_ms,
                'peak_memory_bytes': session.peak_memory_bytes,
                'tags': session.tags,
            })
        return result
    
    def update_cwd(self, session_id: str, cwd: str) -> Optional[SessionState]:
        """Update working directory for session."""
        session = self.get_session(session_id)
        if session:
            session.cwd = self._normalize_cwd_for_compare(cwd)
            return session
        return None
    
    def cleanup(self):
        """Remove all sessions."""
        self._sessions.clear()
        self._db.cleanup()
```

---

## Quick Reference

### Navigation Commands

| Command | Description |
|---------|-------------|
| `sessionPicker` | Open/close session picker menu |
| `switchSession` | Switch to a specific session |
| `deleteSession` | Delete a session |
| `renameSession` | Rename a session |

### Key Constants

```typescript
const SESSIONS_KEY = 'hermes.sessions';
const MAX_SESSIONS = 20;
const MAX_MESSAGES_PER_SESSION = 300;
```

---

**Document Version:** 1.0  
**Generated:** 2026-05-06  
**Status:** Complete