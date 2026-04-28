# CONTINUE_SESSIONS.md

## Session Management Enhancement Plan
### Replicating Cline's Chat Session Features

---

## 1. Overview

### Current State
Our implementation has basic session storage in `src/sessionStore.ts` using VS Code's `workspaceState`. Sessions contain:
- `id` (string)
- `title` (string)
- `createdAt` (number)
- `messages` (StoredMessage[])
- `acpSessionId` (string | undefined)

### Target State (Cline)
Cline's implementation includes:
- Rich session metadata with timestamps
- Performance tracking (API time, tool time, memory)
- Session search and pagination
- JSON-based persistence (not just workspaceState)
- Auto-title from user messages
- Session statistics per-session

---

## 2. Required Changes

### 2.1 Enhance ChatSession Interface

**File: `src/types.ts`**

Add new properties to `ChatSession`:

```typescript
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  
  // Message storage
  messages: StoredMessage[];
  
  // Cline-style metadata
  acpSessionId: string | undefined;
  
  // Performance tracking (Cline style)
  apiTimeMs: number;           // Total API call time
  toolTimeMs: number;          // Total tool execution time
  peakMemoryBytes: number;     // Peak RSS memory
  
  // Optional: session tags for filtering
  tags: string[];
}
```

---

### 2.2 Enhance StoredMessage Interface

**File: `src/types.ts`**

Add metadata to messages for better filtering:

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

### 2.3 Update SessionStore Class

**File: `src/sessionStore.ts`**

#### 2.3.1 Update constructor

```typescript
export class SessionStore {
  private sessions: ChatSession[] = [];
  private activeSessionId = '';
  
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager
  ) {
    // Load from workspaceState, initialize if empty
    const saved = context.workspaceState.get<ChatSession[]>(SESSIONS_KEY);
    
    if (saved && saved.length > 0) {
      // Rehydrate session stats from SessionManager
      this.sessions = saved.map(s => ({
        ...s,
        messages: s.messages ?? [],
        // Restore stats from session manager if available
        apiTimeMs: s.apiTimeMs ?? 0,
        toolTimeMs: s.toolTimeMs ?? 0,
        peakMemoryBytes: s.peakMemoryBytes ?? 0,
      }));
      this.activeSessionId = this.sessions[this.sessions.length - 1].id;
    } else {
      // Auto-create first session
      this.createSession('new session');
    }
  }
```

#### 2.3.2 Update createSession

```typescript
createSession(title: string): string {
  const id = `s${Date.now()}`;
  
  const newSession: ChatSession = {
    id,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    acpSessionId: undefined,
    apiTimeMs: 0,
    toolTimeMs: 0,
    peakMemoryBytes: 0,
    tags: [],
  };
  
  this.sessions.push(newSession);
  this.activeSessionId = id;
  
  // Enforce max sessions
  if (this.sessions.length > MAX_SESSIONS) {
    // Remove oldest (not most recent)
    this.sessions = this.sessions.filter(s => s.createdAt > newSession.createdAt);
  }
  
  this.persist();
  return id;
}
```

#### 2.3.3 Add search and filter methods

```typescript
// Search sessions by title or tag
searchSessions(query: string): ChatSession[] {
  if (!query.trim()) return this.sessions;
  const lowerQuery = query.toLowerCase();
  return this.sessions.filter(s => 
    s.title.toLowerCase().includes(lowerQuery) ||
    s.tags.some(t => t.toLowerCase().includes(lowerQuery))
  );
}

// Filter sessions by date range
filterSessionsByDate(from?: Date, to?: Date): ChatSession[] {
  const now = Date.now();
  return this.sessions.filter(s => {
    const ts = s.createdAt;
    if (from && ts < from.getTime()) return false;
    if (to && ts > to.getTime()) return false;
    return true;
  });
}

// Sort sessions by various criteria
sortSessions(options: { by: 'date' | 'title' | 'activity'; desc?: boolean }): ChatSession[] {
  const copy = [...this.sessions];
  copy.sort((a, b) => {
    switch (options.by) {
      case 'date':
        return options.desc ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
      case 'title':
        return options.desc ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title);
      case 'activity':
        // Most active first (by message count)
        return options.desc 
          ? b.messages.length - a.messages.length 
          : a.messages.length - b.messages.length;
    }
  });
  return copy;
}

// Pagination
getPagination(offset: number, limit: number, sortOptions: { by: 'date' | 'title' | 'activity' }): {
  sessions: ChatSession[];
  total: number;
  hasMore: boolean;
} {
  const sorted = this.sortSessions(sortOptions);
  const paginated = sorted.slice(offset, offset + limit);
  return {
    sessions: paginated,
    total: sorted.length,
    hasMore: offset + limit < sorted.length
  };
}
```

#### 2.3.4 Add auto-title enhancement

```typescript
/**
 * Auto-title the active session from the first user message.
 * Returns the new title or null if already titled.
 */
autoTitle(text: string): string | null {
  const session = this.active();
  if (!session) return null;
  
  // Skip if already has user messages (already titled)
  if (session.messages.some(m => m.role === 'user')) {
    return null;
  }
  
  // Generate title from user message
  let title = text.slice(0, 38).replace(/\s+/g, ' ').trim();
  
  // Truncate with ellipsis if needed
  if (text.length > 38) {
    title = title.slice(0, 35) + '…';
  }
  
  // Update session
  session.title = title;
  session.updatedAt = Date.now();
  
  this.persist();
  return title;
}
```

---

### 2.4 Add Session Statistics Manager

**File: `src/sessionManager.ts`**

```typescript
/**
 * Session Manager — tracks per-session statistics
 * 
 * Mirrors Cline's Session class but adapted for Hermes architecture.
 */

import { nanoid } from 'nanoid';
import { ChatSession } from './types';

interface ToolCallRecord {
  name: string;
  success?: boolean;
  startTime: number;
  lastUpdateTime: number;
}

interface ResourceUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  userCpuMs: number;
  systemCpuMs: number;
}

interface SessionStats {
  sessionId: string;
  totalToolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  sessionStartTime: number;
  apiTimeMs: number;
  toolTimeMs: number;
  resources: ResourceUsage;
  peakMemoryBytes: number;
}

export class SessionManager {
  private static instance: SessionManager | null = null;
  
  private sessionId: string;
  private sessionStartTime: number;
  private toolCalls: ToolCallRecord[] = [];
  private apiTimeMs: number = 0;
  private toolTimeMs: number = 0;
  
  // Track in-flight operations
  private currentApiCallStart: number | null = null;
  private inFlightToolCalls: Map<string, ToolCallRecord> = new Map();
  
  // Resource tracking
  private initialCpuUsage: NodeJS.CpuUsage;
  private peakMemoryBytes: number = 0;
  
  private constructor() {
    this.sessionId = nanoid(10);
    this.sessionStartTime = Date.now();
    this.initialCpuUsage = process.cpuUsage();
    this.updatePeakMemory();
  }
  
  private updatePeakMemory(): void {
    const memUsage = process.memoryUsage();
    if (memUsage.rss > this.peakMemoryBytes) {
      this.peakMemoryBytes = memUsage.rss;
    }
  }
  
  private getResourceUsage(): ResourceUsage {
    this.updatePeakMemory();
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(this.initialCpuUsage);
    
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      userCpuMs: cpuUsage.user / 1000,
      systemCpuMs: cpuUsage.system / 1000,
    };
  }
  
  static get(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }
  
  static reset(): SessionManager {
    SessionManager.instance = new SessionManager();
    return SessionManager.instance;
  }
  
  getSessionId(): string {
    return this.sessionId;
  }
  
  startApiCall(): void {
    this.currentApiCallStart = Date.now();
  }
  
  endApiCall(): void {
    if (this.currentApiCallStart !== null) {
      this.apiTimeMs += Date.now() - this.currentApiCallStart;
      this.currentApiCallStart = null;
    }
  }
  
  updateToolCall(callId: string, toolName: string, success?: boolean): void {
    const now = Date.now();
    const existing = this.inFlightToolCalls.get(callId);
    
    if (existing) {
      existing.lastUpdateTime = now;
      if (success !== undefined) {
        existing.success = success;
      }
      return;
    }
    
    this.inFlightToolCalls.set(callId, {
      name: toolName,
      startTime: now,
      lastUpdateTime: now,
    });
  }
  
  finalizeRequest(): void {
    for (const [callId, record] of this.inFlightToolCalls) {
      const duration = record.lastUpdateTime - record.startTime;
      this.toolTimeMs += duration;
      this.toolCalls.push({
        name: record.name,
        success: record.success,
        startTime: record.startTime,
        lastUpdateTime: record.lastUpdateTime,
      });
      this.inFlightToolCalls.delete(callId);
    }
  }
  
  getStats(): SessionStats {
    this.finalizeRequest();
    
    const allToolCalls = this.toolCalls;
    const successful = allToolCalls.filter((t) => t.success === true).length;
    const failed = allToolCalls.filter((t) => t.success === false).length;
    
    return {
      sessionId: this.sessionId,
      totalToolCalls: allToolCalls.length,
      successfulToolCalls: successful,
      failedToolCalls: failed,
      sessionStartTime: this.sessionStartTime,
      apiTimeMs: this.apiTimeMs,
      toolTimeMs: this.toolTimeMs,
      resources: this.getResourceUsage(),
      peakMemoryBytes: this.peakMemoryBytes,
    };
  }
  
  getWallTimeMs(): number {
    return Date.now() - this.sessionStartTime;
  }
  
  getStartTime(): Date {
    return new Date(this.sessionStartTime);
  }
  
  getEndTime(): Date {
    return new Date();
  }
  
  formatTime(date: Date): string {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  }
  
  getAgentActiveTimeMs(): number {
    const stats = this.getStats();
    return this.apiTimeMs + stats.toolTimeMs;
  }
  
  getSuccessRate(): number {
    const stats = this.getStats();
    if (stats.totalToolCalls === 0) {
      return 0;
    }
    return (stats.successfulToolCalls / stats.totalToolCalls) * 100;
  }
  
  // Update session in SessionStore with stats
  updateSession(session: ChatSession): void {
    session.apiTimeMs = this.apiTimeMs;
    session.toolTimeMs = this.toolTimeMs;
    session.peakMemoryBytes = this.peakMemoryBytes;
    session.updatedAt = Date.now();
  }
}
```

---

### 2.5 Update Webview State

**File: `src/webview/state.ts`**

```typescript
export interface WebviewState {
  currentModel: string;
  currentActiveSessionId: string;
  isBusy: boolean;
  knownContextSize: number;
  
  // Streaming state
  currentAgentEl: HTMLElement | null;
  currentAgentText: string;
  thinkingStatusEl: HTMLElement | null;
  pendingText: string;
  flushScheduled: boolean;
  markdownDebounceTimer: ReturnType<typeof setTimeout> | null;
  
  /** True when the next agent 'done' is the response to a slash command */
  pendingSlashResponse: boolean;
  
  // Queue
  pendingQueuedTexts: string[];
  prevQueueCount: number;
  
  // Skills
  selectedSkillNames: Set<string>;
  skillGroupsData: { category: string; skills: { name: string; description: string }[] }[];
  
  // Session management
  sessionList: Array<{
    id: string;
    title: string;
    messageCount: number;
    lastMessageAt: number;
  }>;
}
```

---

### 2.6 Update Webview Message Handler

**File: `src/webview/main.ts`**

Add handling for session-related messages:

```typescript
// In the message handler switch statement:

case 'sessionList':
  if (msg.sessions && msg.activeSessionId !== undefined) {
    buildSessionPicker(sessionPicker, msg.sessions, msg.activeSessionId, statusSessionEl, S);
  }
  break;

case 'loadHistory':
  loadHistory(messagesEl, msg.history ?? [], msg.switched ?? false);
  break;

// Add new cases as needed:
case 'switchSession':
  // Switch to a different session
  vscode.postMessage({ type: 'switchSession', sessionId: msg.sessionId });
  break;

case 'deleteSession':
  // Delete a session
  vscode.postMessage({ type: 'deleteSession', sessionId: msg.sessionId });
  break;

case 'renameSession':
  // Rename a session
  vscode.postMessage({ 
    type: 'renameSession', 
    sessionId: msg.sessionId, 
    title: msg.title 
  });
  break;
```

---

### 2.7 Update Main.tsx

**File: `src/main.tsx`**

Add session switching functionality:

```typescript
// In the message handler:

case 'switchSession':
  sessionManager.switchTo(msg.sessionId);
  // Rebuild session picker and update status
  sessionStore.allSessionsReversed();
  break;

case 'deleteSession':
  const deleted = sessionStore.deleteSession(msg.sessionId);
  if (deleted) {
    // Switch to next available session or create new
    if (sessionStore.allSessions.length > 0) {
      const next = sessionStore.allSessions[sessionStore.allSessions.length - 1];
      sessionManager.switchTo(next.id);
    } else {
      sessionManager.createSession('new session');
    }
  }
  break;

case 'renameSession':
  const renamed = sessionStore.rename(msg.sessionId, msg.title);
  if (renamed) {
    // Rebuild session picker
    sessionStore.allSessionsReversed();
  }
  break;