/**
 * Shared type definitions for the Hermes VS Code extension.
 * Used by both the extension host (Node.js) and webview (browser).
 */

import type { SkillGroup } from './skillCatalog';

// ── Session & History ────────────────────────────────

// Compact session type for webview (simplified view)
export interface CompactSession {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

// Save session type - includes all data for persistence
export interface SaveSession {
  id: string;
  title: string;
  messages: StoredMessage[];
  acpSessionId?: string;
  apiTimeMs: number;
  toolTimeMs: number;
  peakMemoryBytes: number;
  tags: string[];
}

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

// ── Todo ─────────────────────────────────────────────

export interface TodoItem {
  id?: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  activeForm?: string;
}

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

// ── ACP Session Events ───────────────────────────────

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

export type SessionUpdateHandler = (event: SessionUpdateEvent) => void;

// ── Webview Messages ─────────────────────────────────

// Simplified session type for webview (doesn't need full ChatSession)
interface WebviewSession {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
}

export interface ToWebview {
  type:
    | 'append' | 'thinking' | 'toolCall' | 'done'
    | 'error' | 'status' | 'clear' | 'busy'
    | 'statusBar' | 'sessionList' | 'loadHistory' | 'llamaRequest' | 'sessionPicker' | 'switchSession'
    | 'new' | 'newSession' | 'compact' | 'save';
  text?: string;
  sessionId?: string;
  toolName?: string;
  toolStatus?: string;
  toolCallId?: string;
  toolDetail?: string;
  toolKind?: string;
  toolLocations?: string[];
  todoState?: TodoState;
  status?: string;
  active?: boolean;
  queued?: number;
  model?: string;
  sessionTitle?: string;
  contextUsed?: number;
  contextSize?: number;
  cachedTokens?: number;
  version?: string;
  // Session data (for compact/save) - use simplified type for webview
  sessions?: WebviewSession[];
  activeId?: string;  // Added: session picker active session ID
  activeSessionId?: string;
  history?: StoredMessage[];
  switched?: boolean;
  searchTerm?: string;
  attachedFiles?: { name: string; path: string }[];
  selectedSkills?: string[];
  skillGroups?: SkillGroup[];
  contextAnnotation?: string;
  tags?: string[];  // For save session
  // Session picker
  sessionPicker?: {
    sessions: WebviewSession[];
    activeId: string;
    searchTerm: string;
  };
}

export interface FromWebview {
  type:
    | 'send' | 'switchModel' | 'cancel'
    | 'newSession' | 'switchSession' | 'toggleSessionPicker' | 'renderSessionPicker'
    | 'attachFile' | 'pasteImage' | 'dropFiles' | 'clearAttachments'
    | 'toggleSkill' | 'renameSession' | 'deleteSession' | 'llamaRequest'
    | 'sessionList'
    | 'compactSession' | 'saveSession';
  text?: string;
  sessionId?: string;
  model?: string;
  data?: string;
  ext?: string;
  uris?: string[];
  // Session data for returning updated session lists
  sessions?: WebviewSession[];
  activeSessionId?: string;
  tags?: string[];
}

// ── Attachment ───────────────────────────────────────

export interface AttachedFile {
  name: string;
  path: string;
}