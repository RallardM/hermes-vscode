/**
 * Export session manager and store from chatPanel.ts
 * These are needed by the webview
 */

import { ChatPanelProvider } from './chatPanel';

// We need to provide these through the ChatPanelProvider instance
// This file provides a type-safe way to access them

export interface SessionStoreExport {
  allSessions(): Array<{ id: string; title: string; messageCount: number; createdAt: number }>;
  allSessionsReversed(): Array<{ id: string; title: string; messageCount: number; createdAt: number }>;
  active(): { id: string; title: string; messages: Array<{ role: string; text: string; timestamp: number }> } | null;
  activeId: string;
  createSession(title: string): string;
  switchTo(sessionId: string): { id: string; title: string; messages: Array<{ role: string; text: string; timestamp: number }> } | null;
  rename(sessionId: string, title: string): boolean;
  deleteSession(sessionId: string): boolean;
  ensureSession(): void;
  autoTitle(text: string): string | null;
}

export interface SessionManagerExport {
  sendPrompt(text: string, cwd: string): Promise<void>;
  reset(): void;
  setStoredSessionId(sessionId: string): void;
  getSessionId(): string;
  onUpdate(callback: (event: any) => void): void;
  cancel(): Promise<void>;
  switchTo(sessionId: string): { id: string; title: string; messages: Array<{ role: string; text: string; timestamp: number }> } | null;
}

// These exports are designed to be accessed through the provider instance
// The webview will get them via the provider's resolveWebviewView call
export { ChatPanelProvider };