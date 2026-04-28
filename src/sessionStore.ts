/**
 * Session persistence layer.
 *
 * Manages ChatSession[] in VS Code workspaceState.
 * Owns: create, delete, rename, auto-title, message storage, ACP ID persistence.
 */

import * as vscode from 'vscode';
import type { AcpClient } from './acpClient';
import type { ChatSession, StoredMessage } from './types';
import { SessionManager } from './sessionManager';

const SESSIONS_KEY = 'hermes.sessions';
const MAX_SESSIONS = 20;
const MAX_MESSAGES_PER_SESSION = 300;

export class SessionStore {
  private readonly acpClient: AcpClient;
  private sessions: ChatSession[] = [];
  private activeSessionId = '';

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly sessionManager: SessionManager,
		acpClient: AcpClient
	) {
		this.acpClient = acpClient;
		// Sync with Hermes sessions on startup
		this.syncSessions();
	}

  // ── Getters ────────────────────────────────────────

  get activeId(): string { return this.activeSessionId; }

  active(): ChatSession | undefined {
    return this.sessions.find(s => s.id === this.activeSessionId);
  }

  allSessions(): ChatSession[] { return this.sessions; }

  allSessionsReversed(): ChatSession[] { return [...this.sessions].reverse(); }

  // ── Create / Switch / Delete ───────────────────────

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
    if (this.sessions.length > MAX_SESSIONS) {
      this.sessions = this.sessions.filter(s => s.createdAt > newSession.createdAt);
    }
    this.persist();
    return id;
  }

  switchTo(sessionId: string): ChatSession | undefined {
    const target = this.sessions.find(s => s.id === sessionId);
    if (!target || target.id === this.activeSessionId) return undefined;
    this.activeSessionId = sessionId;
    this.persist();
    return target;
  }

  deleteSession(sessionId: string): boolean {
    if (sessionId === this.activeSessionId) return false;
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    this.persist();
    return true;
  }

  rename(sessionId: string, newTitle: string): boolean {
    const s = this.sessions.find(s => s.id === sessionId);
    if (!s) return false;
    s.title = newTitle.slice(0, 60);
    s.updatedAt = Date.now();
    this.persist();
    return true;
  }

  /** Auto-title the active session from the first user message. Returns the new title or null. */
  autoTitle(text: string): string | null {
    const s = this.active();
    if (!s) return null;
    if (s.messages.some(m => m.role === 'user')) return null;
    let title = text.slice(0, 38).replace(/\s+/g, ' ').trim();
    if (text.length > 38) title = title.slice(0, 35) + '…';
    s.title = title;
    s.updatedAt = Date.now();
    this.persist();
    return title;
  }

  // ── Message storage ────────────────────────────────

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

  // ── ACP session ID ─────────────────────────────────

  setAcpSessionId(acpId: string): void {
    const s = this.active();
    if (s && s.acpSessionId !== acpId) {
      s.acpSessionId = acpId;
      this.persist();
    }
  }

  getAcpSessionId(): string | undefined {
    return this.active()?.acpSessionId;
  }

  getStats(): { apiTimeMs: number; toolTimeMs: number; peakMemoryBytes: number } {
    const stats = this.sessionManager.getStats();
    return {
      apiTimeMs: stats.apiTimeMs,
      toolTimeMs: stats.toolTimeMs,
      peakMemoryBytes: stats.peakMemoryBytes,
    };
  }

  // ── Ensure first session ───────────────────────────

  ensureSession(): void {
    if (this.sessions.length === 0) {
      this.createSession('new session');
    }
  }

  // ── Search / Filter / Sort ─────────────────────────

  searchSessions(query: string): ChatSession[] {
    if (!query.trim()) return this.sessions;
    const lowerQuery = query.toLowerCase();
    return this.sessions.filter(s =>
      s.title.toLowerCase().includes(lowerQuery) ||
      s.tags.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }

  // ── Hermes Session Sync ─────────────────────────────

  /** Sync local sessions with Hermes session data. */
  async syncSessions(): Promise<void> {
    const hermesSessions = await this.acpClient.listSessions();
    
    for (const hermes of hermesSessions) {
      const hermesId = hermes.id as string;
      const hermesTitle = hermes.title as string;
      const hermesCreatedAt = hermes.createdAt as number;
      const hermesUpdatedAt = hermes.updatedAt as number;
        const hermesMessages = hermes.messages as unknown as Array<Record<string, unknown>>;
      
      const localSession = this.sessions.find(s => s.id === hermesId);
      
      if (localSession) {
        // Update local session with Hermes data
        if (hermesTitle) localSession.title = hermesTitle;
        if (hermesCreatedAt) localSession.createdAt = hermesCreatedAt;
        if (hermesUpdatedAt) localSession.updatedAt = hermesUpdatedAt;
        
        // Sync messages from Hermes
        if (hermesMessages && Array.isArray(hermesMessages)) {
          const syncedMessages: StoredMessage[] = hermesMessages.map((m: Record<string, unknown>) => ({
            role: m.role as 'user' | 'assistant' | 'tool' | 'agent' as 'user' | 'tool',
            text: m.text as string,
            timestamp: m.timestamp as number,
            sessionId: hermesId,
            toolCallId: m.tool_call_id as string | undefined,
            toolName: m.tool_name as string | undefined,
            toolStatus: m.tool_status as 'pending' | 'done' | 'error' | 'completed' | undefined,
            contextAnnotation: m.context_annotation as string | undefined,
          }));
          localSession.messages = syncedMessages;
        }
      } else {
        // Create new session from Hermes data
        this.sessions.push({
          id: hermesId,
          title: hermesTitle || 'new session',
          createdAt: hermesCreatedAt || Date.now(),
          updatedAt: hermesUpdatedAt || Date.now(),
          messages: [],
          acpSessionId: hermesId,
          apiTimeMs: hermes.apiTimeMs || 0,
          toolTimeMs: hermes.toolTimeMs || 0,
          peakMemoryBytes: hermes.peakMemoryBytes || 0,
          tags: hermes.tags ? hermes.tags : [],
        });
      }
    }
    
    this.persist();
  }

  /** Compact a session in Hermes. */
  async compactSession(sessionId: string): Promise<boolean> {
    try {
      await this.acpClient.compactSession(sessionId);
      // Update local session stats
      const s = this.sessions.find(s => s.id === sessionId);
      if (s) {
        s.toolTimeMs = 0;
        s.peakMemoryBytes = 0;
        this.persist();
      }
      return true;
    } catch (err) {
      console.error('Failed to compact session:', err);
      return false;
    }
  }

  /** Save a session in Hermes. */
  async saveSession(sessionId: string): Promise<boolean> {
    try {
      await this.acpClient.saveSession(sessionId);
      return true;
    } catch (err) {
      console.error('Failed to save session:', err);
      return false;
    }
  }

  /** Compact a session locally (compact messages). */
  compactSessionLocal(sessionId: string): boolean {
    const s = this.sessions.find(s => s.id === sessionId);
    if (!s) return false;
    if (s.messages.length > MAX_MESSAGES_PER_SESSION) {
      s.messages = s.messages.slice(-MAX_MESSAGES_PER_SESSION);
      this.persist();
    }
    return true;
  }

  /** Save a session locally (mark as saved). */
  saveSessionLocal(sessionId: string): void {
    const s = this.sessions.find(s => s.id === sessionId);
    if (s) {
      // Mark as saved by adding to tags
      if (!s.tags.includes('saved')) {
        s.tags.push('saved');
      }
      this.persist();
    }
  }

  filterSessionsByDate(from?: Date, to?: Date): ChatSession[] {
    const now = Date.now();
    return this.sessions.filter(s => {
      const ts = s.createdAt;
      if (from && ts < from.getTime()) return false;
      if (to && ts > to.getTime()) return false;
      return true;
    });
  }

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

  // ── Persistence ────────────────────────────────────

  private persist(): void {
    void this.context.workspaceState.update(SESSIONS_KEY, this.sessions);
  }
}