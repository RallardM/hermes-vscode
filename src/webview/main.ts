/**
 * Webview entry point — thin wiring layer.
 * Imports modules, grabs DOM refs, connects event handlers.
 * src\webview\main.ts
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ToWebview, FromWebview, TodoItem, CompactSession, SaveSession } from '../types';
import { createInitialState } from './state';
import {
  renderMarkdown, appendDiv, appendMessage, showWaiting,
  formatToolDisplay, renderTodoOverlay, detectTodoUpdate,
  loadHistory, fmtTok,
} from './renderers';
import {
  closeAllDropdowns, buildSessionPicker, setupSessionPickerHandlers,
  buildSkillsMenu, setupSkillsHandlers, updateStatusBar,
} from './menus';
import type { SessionManagerExport, SessionStoreExport } from '../chatPanelExport';
import type { ChatPanelProvider } from '../chatPanel';

// These are accessed through the provider instance
let sessionMgr: SessionManagerExport;
let store: SessionStoreExport;

export function setSessionManager(sm: SessionManagerExport) { sessionMgr = sm; }
export function setSessionStore(s: SessionStoreExport) { store = s; }
export function getSessionManager(): SessionManagerExport { return sessionMgr; }
export function getSessionStore(): SessionStoreExport { return store; }

declare function acquireVsCodeApi(): { postMessage(msg: FromWebview): void };
const vscode = acquireVsCodeApi();
marked.setOptions({ breaks: true, gfm: true });

// ── State ────────────────────────────────────────────
const S = createInitialState();

// ── DOM refs ─────────────────────────────────────────
const messagesEl       = document.getElementById('messages')!;
const inputEl          = document.getElementById('input') as HTMLTextAreaElement;
const attachBtn        = document.getElementById('attach-btn') as HTMLButtonElement;
const attachChip       = document.getElementById('attach-chip') as HTMLDivElement;
const sendBtn          = document.getElementById('send-btn') as HTMLButtonElement;
const busyBtns         = document.getElementById('busy-btns') as HTMLDivElement;
const stopBtn          = document.getElementById('stop-btn') as HTMLButtonElement;
const queueBtn         = document.getElementById('queue-btn') as HTMLButtonElement;
const queueStatus      = document.getElementById('queue-status') as HTMLDivElement;
const dragHandle       = document.getElementById('input-drag') as HTMLDivElement;
const inputRow         = document.getElementById('input-row') as HTMLDivElement;
const composer         = document.getElementById('composer') as HTMLDivElement;
const statusSessionEl  = document.getElementById('status-session') as HTMLButtonElement;
const statusContextEl  = document.getElementById('status-context')!;
const statusVersionEl  = document.getElementById('status-version')!;
const ctxBarWrap       = document.getElementById('ctx-bar-wrap') as HTMLDivElement;
const ctxBar           = document.getElementById('ctx-bar') as HTMLDivElement;
const ctxBarFresh      = document.getElementById('ctx-bar-fresh') as HTMLDivElement;
const modelBtnHeader   = document.getElementById('model-btn-header') as HTMLButtonElement;
const modelMenu        = document.getElementById('model-menu') as HTMLDivElement;
const overflowBtn      = document.getElementById('overflow-btn') as HTMLButtonElement;
const overflowMenu     = document.getElementById('overflow-menu') as HTMLDivElement;
const emptyState       = document.getElementById('empty-state') as HTMLDivElement;
const sessionPicker    = document.getElementById('session-picker') as HTMLDivElement;
const sessionMenuList  = document.getElementById('session-menu-list') as HTMLDivElement;
const logoMark         = document.getElementById('logo-mark')!;
const todoOverlay      = document.getElementById('todo-overlay')!;
const skillsBtn        = document.getElementById('skills-btn') as HTMLButtonElement;
const skillsMenu       = document.getElementById('skills-menu') as HTMLDivElement;
const cmdArgPopover    = document.getElementById('cmd-arg-popover') as HTMLDivElement;
const cmdArgInput      = document.getElementById('cmd-arg-input') as HTMLInputElement;
const cmdArgLabel      = document.getElementById('cmd-arg-label') as HTMLElement;

// ── History panel DOM refs ────────────────────────────
const historyBtn    = document.getElementById('history-btn') as HTMLButtonElement;
const historyPanel  = document.getElementById('history-panel') as HTMLDivElement;
const historyBack   = document.getElementById('history-back') as HTMLButtonElement;
const historySearch = document.getElementById('history-search') as HTMLInputElement;
const historyList   = document.getElementById('history-list') as HTMLDivElement;

const dropdownEls = { modelMenu, sessionPicker, skillsMenu, overflowMenu, cmdArgPopover };
const statusEls = { statusVersionEl, modelBtnHeader, modelMenu, statusSessionEl, statusContextEl, ctxBarWrap, ctxBar, ctxBarFresh };
const closeFn = () => closeAllDropdowns(dropdownEls);

// ── Helpers ──────────────────────────────────────────
function setBusy(active: boolean, queued = 0): void {
  S.isBusy = active;
  logoMark.classList.toggle('busy', active);
  composer.classList.toggle('busy-glow', active);
  sendBtn.style.display = active ? 'none' : 'block';
  busyBtns.style.display = active ? 'flex' : 'none';
  if (queued > 0) {
    queueStatus.style.display = 'block';
    queueStatus.textContent = `${queued} queued`;
  } else {
    queueStatus.style.display = 'none';
    queueStatus.textContent = '';
  }
  requestAnimationFrame(syncComposerHeight);
}

function syncComposerHeight(): void {
  const target = Math.max(44, inputRow.offsetHeight - 10);
  inputEl.style.height = `${target}px`;
}

// Smart scroll — only auto-scroll if the user is near the bottom of the
// messages pane. If they've scrolled up to read earlier content, don't
// yank them back down. Threshold: within 80px of the bottom.
function shouldAutoScroll(): boolean {
  const el = messagesEl;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
function autoScroll(): void {
  if (shouldAutoScroll()) messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
}

// Render markdown on a short interval (200ms). Each flush accumulates text
// and schedules a render — the timer coalesces bursts of chunks so we don't
// call marked.parse() on every single token, but still render frequently
// enough to avoid the "plaintext then jump to formatted" flash.
function scheduleMarkdownRender(): void {
  if (S.markdownDebounceTimer) return;
  S.markdownDebounceTimer = setTimeout(() => {
    S.markdownDebounceTimer = null;
    if (S.currentAgentEl && S.currentAgentText) {
      renderMarkdown(S.currentAgentEl, S.currentAgentText);
      autoScroll();
    }
  }, 200);
}

function flushPending(): void {
  if (!S.pendingText) { S.flushScheduled = false; return; }
  if (!S.currentAgentEl) {
    document.getElementById('turn-thinking')?.remove();
    document.getElementById('waiting')?.remove();
    S.currentAgentEl = appendDiv(messagesEl, 'msg agent');
  }
  S.currentAgentText += S.pendingText;
  S.pendingText = ''; S.flushScheduled = false;
  // Render markdown directly — no intermediate .textContent flash.
  // scheduleMarkdownRender coalesces at 100ms so rapid chunks don't
  // each trigger a full marked.parse() + innerHTML replacement.
  scheduleMarkdownRender();
}

function scheduleFlush(): void {
  if (!S.flushScheduled) { S.flushScheduled = true; setTimeout(flushPending, 0); }
}

// ── Slash command detection ─────────────────────────
// Hardcoded allowlist mirroring the ACP adapter's _SLASH_COMMANDS dict.
// Keep in sync with ~/.hermes/hermes-agent/acp_adapter/server.py. Commands
// not in this set are treated as prose and go to the LLM normally (so the
// user bubble renders). Matched commands hide the user bubble and the
// response renders as a centered system-style bubble instead of an agent bubble.
const KNOWN_SLASH_COMMANDS = new Set([
  'help', 'model', 'tools', 'context', 'reset', 'compact', 'version',
  'title', 'yolo', 'new', 'retry', 'status', 'usage', 'compress',
  'reasoning', 'save',
]);

function isSlashCommand(text: string): boolean {
  if (!text.startsWith('/')) return false;
  const first = text.slice(1).split(/\s/, 1)[0].toLowerCase();
  return KNOWN_SLASH_COMMANDS.has(first);
}

// ── History Panel ─────────────────────────────────────────────────────────
//
// Architecture: webview cannot call extension-side store directly.
// All session data flows through postMessage:
//
//   openHistoryPanel()
//     → postMessage({ type: 'listSessions' })
//     → chatPanel.ts handles, responds { type: 'sessionsList', sessions, activeId }
//     → case 'sessionsList' below → renderHistoryRows()
//
//   row click (open)
//     → postMessage({ type: 'switchSession', sessionId })
//     → chatPanel.ts switches + sends loadHistory + statusBar
//     → closeHistoryPanel()
//
//   row click (delete)
//     → postMessage({ type: 'deleteSession', sessionId })
//     → chatPanel.ts deletes + sends sessionsList (re-triggers render)
//     → optimistic local filter for instant feedback
//
// ─────────────────────────────────────────────────────────────────────────

// Cache populated by 'sessionsList' message from extension
interface HistorySession {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}
let _historySessions: HistorySession[] = [];
let _historyActiveId = '';

function escHtml(v: string | undefined): string {
  const m: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return (v || '').replace(/[&<>"']/g, c => m[c] || c);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function renderHistoryRows(query = ''): void {
  const q = query.toLowerCase().trim();
  const filtered = q
    ? _historySessions.filter(s => s.title.toLowerCase().includes(q))
    : _historySessions;

  if (filtered.length === 0) {
    historyList.innerHTML = `<div class="history-empty">${_historySessions.length === 0 ? 'No sessions yet' : 'No sessions match your search'}</div>`;
    return;
  }

  // Group by recency
  const now = Date.now();
  const DAY = 86_400_000;
  const groups: [string, HistorySession[]][] = [
    ['Today',     filtered.filter(s => now - s.updatedAt <  DAY)],
    ['Yesterday', filtered.filter(s => now - s.updatedAt >= DAY && now - s.updatedAt < 2 * DAY)],
    ['This week', filtered.filter(s => now - s.updatedAt >= 2 * DAY && now - s.updatedAt < 7 * DAY)],
    ['Older',     filtered.filter(s => now - s.updatedAt >= 7 * DAY)],
  ];

  let html = '';
  for (const [label, sessions] of groups) {
    if (!sessions.length) continue;
    html += `<div class="history-group-label">${label}</div>`;
    for (const s of sessions) {
      const active = s.id === _historyActiveId;
      const count = s.messageCount;
      const del = active ? '' : `<button class="history-row-del" data-id="${escHtml(s.id)}" title="Delete">🗑</button>`;
      html += `
        <div class="history-row${active ? ' is-active' : ''}" data-id="${escHtml(s.id)}">
          <div class="history-row-body">
            <div class="history-row-title">${escHtml(s.title || 'Untitled')}</div>
            <div class="history-row-meta">${count} msg${count !== 1 ? 's' : ''} · ${relativeTime(s.updatedAt)}</div>
          </div>
          ${del}
        </div>`;
    }
  }
  historyList.innerHTML = html;

  // Delegate clicks
  historyList.querySelectorAll<HTMLElement>('.history-row-body').forEach(body => {
    body.addEventListener('click', () => {
      const id = (body.closest('.history-row') as HTMLElement)?.dataset.id;
      if (!id) return;
      if (id === _historyActiveId) {
        // Already active — just close
        closeHistoryPanel();
      } else {
        vscode.postMessage({ type: 'switchSession', sessionId: id });
        closeHistoryPanel();
      }
    });
  });

  historyList.querySelectorAll<HTMLButtonElement>('.history-row-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      // Optimistic: remove from local cache and re-render immediately
      _historySessions = _historySessions.filter(s => s.id !== id);
      renderHistoryRows(historySearch.value);
      // Persist via extension
      vscode.postMessage({ type: 'deleteSession', sessionId: id });
    });
  });
}

function openHistoryPanel(): void {
  historyPanel.style.display = 'flex';
  messagesEl.style.display = 'none';
  historyBtn.classList.add('active');
  historySearch.value = '';
  historyList.innerHTML = '<div class="history-empty">Loading…</div>';
  // Request fresh list from extension (the only source of truth)
  vscode.postMessage({ type: 'listSessions' });
}

function closeHistoryPanel(): void {
  historyPanel.style.display = 'none';
  messagesEl.style.display = '';
  historyBtn.classList.remove('active');
}

historyBtn.addEventListener('click', e => { e.stopPropagation(); openHistoryPanel(); });
historyBack.addEventListener('click', closeHistoryPanel);
historySearch.addEventListener('input', () => renderHistoryRows(historySearch.value));

// ── Send ─────────────────────────────────────────────
function send(): void {
  const text = inputEl.value.trim();
  if (!text) return;
  const isSlash = isSlashCommand(text);
  inputEl.value = '';
  inputEl.style.height = '';
  attachChip.style.display = 'none'; attachChip.innerHTML = '';
  S.selectedSkillNames.clear();
  skillsBtn.classList.remove('has-skills'); skillsBtn.textContent = '✦';
  if (emptyState) emptyState.style.display = 'none';
  if (!S.isBusy) {
    // Slash commands don't reach the LLM — don't render a user bubble.
    // The response from the adapter will be styled as a system bubble on 'done'.
    if (!isSlash) appendMessage(messagesEl, 'user', text);
    S.currentAgentEl = null; S.currentAgentText = ''; S.thinkingStatusEl = null; S.pendingText = '';
    S.pendingSlashResponse = isSlash;
    if (!isSlash) showWaiting(messagesEl);
  } else {
    S.pendingQueuedTexts.push(text);
  }
  vscode.postMessage({ type: 'send', text });
  requestAnimationFrame(syncComposerHeight);
}

// ── Event wiring ─────────────────────────────────────

// Drag handle
let dragActive = false, dragStartY = 0, dragStartH = 0;
dragHandle.addEventListener('mousedown', (e) => {
  dragActive = true; dragStartY = e.clientY; dragStartH = inputEl.offsetHeight;
  document.body.style.userSelect = 'none'; e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!dragActive) return;
  inputEl.style.height = `${Math.max(44, Math.min(400, dragStartH + (dragStartY - e.clientY)))}px`;
});
document.addEventListener('mouseup', () => {
  if (dragActive) { dragActive = false; document.body.style.userSelect = ''; }
});

// Session picker
statusSessionEl.addEventListener('click', (e) => {
  e.stopPropagation(); const open = sessionPicker.style.display !== 'none';
  closeFn(); if (!open) sessionPicker.style.display = 'block';
});

// Compact button
document.getElementById('compact-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!S.isBusy) {
    S.currentAgentEl = null; S.currentAgentText = ''; S.thinkingStatusEl = null; S.pendingText = '';
    showWaiting(messagesEl);
  }
  vscode.postMessage({ type: 'send', text: '/compact' });
});

// Model switcher
modelBtnHeader.addEventListener('click', (e) => {
  e.stopPropagation(); const open = modelMenu.style.display !== 'none';
  closeFn(); if (!open) modelMenu.style.display = 'block';
});
modelMenu.addEventListener('click', (e) => {
  const opt = (e.target as HTMLElement).closest<HTMLElement>('.model-option');
  if (!opt?.dataset.command) return;
  closeFn(); vscode.postMessage({ type: 'switchModel', model: opt.dataset.command });
});

// Slash-command menu
function hideCmdArg(): void {
  cmdArgPopover.style.display = 'none';
  cmdArgInput.value = '';
  cmdArgInput.onkeydown = null;
}

function promptForArg(cmd: string, label: string): void {
  cmdArgLabel.textContent = label;
  cmdArgInput.value = '';
  cmdArgPopover.style.display = 'block';
  setTimeout(() => cmdArgInput.focus(), 0);
  cmdArgInput.onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const arg = cmdArgInput.value.trim();
      hideCmdArg();
      if (arg) vscode.postMessage({ type: 'send', text: `${cmd} ${arg}` });
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      hideCmdArg();
    }
  };
}

overflowBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = overflowMenu.style.display !== 'none';
  closeFn(); hideCmdArg();
  if (!open) overflowMenu.style.display = 'block';
});

overflowMenu.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>('.menu-item[data-cmd]');
  if (!item?.dataset.cmd) return;
  e.stopPropagation();
  const cmd  = item.dataset.cmd;
  const mode = item.dataset.mode ?? 'execute';
  closeFn();
  if (mode === 'execute') {
    vscode.postMessage({ type: 'send', text: cmd });
  } else if (mode === 'confirm') {
    const msg = item.dataset.confirm ?? `Run ${cmd}?`;
    // eslint-disable-next-line no-alert
    if (confirm(msg)) vscode.postMessage({ type: 'send', text: cmd });
  } else if (mode === 'prompt') {
    promptForArg(cmd, item.dataset.argLabel ?? 'Argument');
  }
});

// Empty state prompt chips
emptyState?.addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.prompt-chip');
  if (!chip?.dataset.prompt) return;
  inputEl.value = chip.dataset.prompt;
  send();
});

// File attachment
attachBtn.addEventListener('click', () => vscode.postMessage({ type: 'attachFile' }));
attachChip.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).classList.contains('chip-x')) {
    attachChip.style.display = 'none'; attachChip.innerHTML = '';
    vscode.postMessage({ type: 'clearAttachments' } as any);
  }
});

// Clipboard paste
document.addEventListener('paste', (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      e.preventDefault();
      const blob = items[i].getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      const ext = items[i].type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        vscode.postMessage({ type: 'pasteImage', data: base64, ext } as any);
      };
      reader.readAsDataURL(blob); return;
    }
  }
  const files = e.clipboardData?.files;
  if (files) {
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/')) {
        e.preventDefault();
        const ext = files[i].type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          vscode.postMessage({ type: 'pasteImage', data: base64, ext } as any);
        };
        reader.readAsDataURL(files[i]); return;
      }
    }
  }
});

// Drag & drop
document.body.addEventListener('dragover', (e) => {
  e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  messagesEl.style.outline = '2px dashed rgba(245,197,66,0.5)';
  messagesEl.style.outlineOffset = '-4px';
});
document.body.addEventListener('dragleave', () => {
  messagesEl.style.outline = ''; messagesEl.style.outlineOffset = '';
});
document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  messagesEl.style.outline = ''; messagesEl.style.outlineOffset = '';
  const uriList = e.dataTransfer?.getData('text/uri-list');
  if (uriList) {
    const paths = uriList.split('\n').map(u => u.trim()).filter(Boolean);
    if (paths.length > 0) vscode.postMessage({ type: 'dropFiles', uris: paths } as any);
  }
});

// Skills picker
skillsBtn.addEventListener('click', (e) => {
  e.stopPropagation(); const open = skillsMenu.style.display !== 'none';
  closeFn(); if (!open) { buildSkillsMenu(skillsMenu, S); skillsMenu.style.display = 'block'; }
});
setupSkillsHandlers(skillsMenu, skillsBtn, vscode, S);

// Slash commands
document.querySelectorAll<HTMLButtonElement>('.cmd-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.dataset.cmd; if (!cmd) return;
    if (!S.isBusy) {
      S.currentAgentEl = null; S.currentAgentText = ''; S.thinkingStatusEl = null; S.pendingText = '';
      showWaiting(messagesEl);
    }
    vscode.postMessage({ type: 'send', text: cmd });
  });
});

// Send / stop / queue
stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
queueBtn.addEventListener('click', send);
sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

// Close dropdowns on outside click
document.addEventListener('click', closeFn);

// Resize
window.addEventListener('resize', () => requestAnimationFrame(syncComposerHeight));
requestAnimationFrame(syncComposerHeight);

// ── Escape helpers (used by session menu below) ───────────────────────────
function escapeHtml(value: string | undefined): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return (value || '').replace(/[&<>"']/g, c => map[c] || c);
}

function escapeAttr(value: string | undefined): string {
  return (value || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSessionMenu(searchQuery = ''): void {
  if (!store) return;
  if (!sessionMenuList) return;

  const activeSessionId = store.activeId as string;
  let filtered = store.allSessionsReversed() as any[];
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter((s: any) => (s.title || '').toLowerCase().includes(query));
  }

  const itemsHtml = filtered.map((session: any) => {
    const isActive = session.id === activeSessionId;
    const time = formatSessionTime(session.updatedAt);
    return `
      <div class="session-menu-item ${isActive ? 'active' : ''}" data-session-id="${escapeAttr(session.id)}">
        <div class="item-title">${escapeHtml(session.title)}</div>
        <div class="item-meta">${session.messageCount} messages</div>
        <div class="item-time">${time}</div>
        <div class="session-menu-actions">
          <button class="session-menu-action-btn" title="Compact" data-action="compact" data-session-id="${escapeAttr(session.id)}">✂</button>
          <button class="session-menu-action-btn" title="Save" data-action="save" data-session-id="${escapeAttr(session.id)}">💾</button>
          ${!isActive ? `<button class="session-menu-action-btn delete" title="Delete" data-action="delete" data-session-id="${escapeAttr(session.id)}">×</button>` : ''}
          <button class="session-menu-action-btn add-btn" title="Chat with this session" data-action="chat" data-session-id="${escapeAttr(session.id)}">💬</button>
        </div>
      </div>
    `;
  }).join('');

  const footerHtml = `<div class="session-menu-footer" data-action="new"><span>+ New session</span> <span class="key-hint">Ctrl+L</span></div>`;
  sessionMenuList.innerHTML = itemsHtml + footerHtml;

  sessionMenuList.querySelectorAll('.session-menu-item').forEach((item: Element) => {
    item.addEventListener('click', (ev: Event) => {
      ev.stopPropagation();
      const sessionId = item.getAttribute('data-session-id');
      if (sessionId) { store.activeId = sessionId; store.switchTo(sessionId); renderSessionMenu(); }
    });
  });

  sessionMenuList.querySelectorAll('.session-menu-action-btn').forEach((btn: Element) => {
    btn.addEventListener('click', (ev: Event) => {
      ev.stopPropagation(); ev.preventDefault();
      const action = btn.getAttribute('data-action');
      const sessionId = btn.getAttribute('data-session-id');
      if (action && sessionId) handleSessionAction(action, sessionId);
    });
  });

  sessionMenuList.querySelectorAll('.session-menu-footer').forEach((btn: Element) => {
    btn.addEventListener('click', (ev: Event) => {
      ev.stopPropagation();
      const action = btn.getAttribute('data-action');
      if (action) handleSessionAction(action, null);
    });
  });

  if (sessionMenuList) sessionMenuList.style.display = 'block';
  S.showSessionMenu = true;
}

function handleSessionAction(action: string, sessionId: string | null): void {
  switch (action) {
    case 'newSession':
      vscode.postMessage({ type: 'newSession' });
      S.showSessionMenu = false; renderSessionMenu(); break;
    case 'compact':
      if (sessionId) vscode.postMessage({ type: 'compactSession', sessionId });
      S.showSessionMenu = false; renderSessionMenu(); break;
    case 'save':
      if (sessionId) vscode.postMessage({ type: 'saveSession', sessionId });
      S.showSessionMenu = false; renderSessionMenu(); break;
    case 'delete':
      if (sessionId) {
        vscode.postMessage({ type: 'deleteSession', sessionId });
        S.showSessionMenu = false; renderSessionMenu();
      }
      break;
    case 'chat':
      if (sessionId) {
        store.switchTo(sessionId);
        S.showSessionMenu = false; renderSessionMenu();
      }
      break;
  }
}

function formatSessionTime(timestamp: number | undefined): string {
  const date = new Date(timestamp || Date.now());
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.id === 'new-session-btn' || target.closest('#new-session-btn')) {
    e.stopPropagation();
    S.showSessionMenu = false;
    vscode.postMessage({ type: 'newSession' });
    renderSessionMenu();
  }
  if (target.id === 'compact-btn' || target.closest('#compact-btn')) {
    e.stopPropagation();
    if (!S.isBusy) {
      S.currentAgentEl = null; S.currentAgentText = ''; S.thinkingStatusEl = null; S.pendingText = '';
      showWaiting(messagesEl);
    }
    vscode.postMessage({ type: 'send', text: '/compact' });
  }
}, true);

// ── Message handler ──────────────────────────────────
window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as ToWebview;

  switch (msg.type) {
    case 'append':
      S.pendingText += msg.text ?? '';
      scheduleFlush();
      break;

    case 'thinking':
      if (!S.thinkingStatusEl) {
        document.getElementById('waiting')?.remove();
        S.thinkingStatusEl = appendDiv(messagesEl, 'status-line thinking-status');
        S.thinkingStatusEl.id = 'turn-thinking';
      }
      S.thinkingStatusEl.textContent = msg.text ?? '';
      break;

    case 'toolCall': {
      if (!msg.toolName && msg.toolCallId) {
        const existing = document.querySelector(`[data-tool-id="${msg.toolCallId}"]`);
        if (existing) {
          const isDone = msg.toolStatus === 'done' || msg.toolStatus === 'completed';
          const isError = msg.toolStatus === 'error';
          const statusEl = existing.querySelector('.tool-status');
          if (statusEl) {
            statusEl.textContent = isDone ? '✓' : isError ? '✗' : '⋯';
            statusEl.className = `tool-status${isDone ? ' done' : isError ? ' error' : ''}`;
          }
        }
        break;
      }
      if (S.pendingText) flushPending();
      if (S.currentAgentEl && S.currentAgentText) renderMarkdown(S.currentAgentEl, S.currentAgentText);
      S.currentAgentEl = null; S.currentAgentText = '';
      document.getElementById('waiting')?.remove();
      const isDone = msg.toolStatus === 'done' || msg.toolStatus === 'completed';
      const isError = msg.toolStatus === 'error';
      const statusIcon = isDone ? '✓' : isError ? '✗' : '⋯';
      const statusClass = isDone ? ' done' : isError ? ' error' : '';
      const toolEl = appendDiv(messagesEl, 'msg tool');
      if (msg.toolCallId) toolEl.dataset.toolId = msg.toolCallId;
      const { label, info } = formatToolDisplay(msg.toolName ?? '', msg.toolKind, msg.toolLocations, msg.toolDetail);
      const infoHtml = info ? `<span class="tool-detail">${DOMPurify.sanitize(info)}</span>` : '';
      toolEl.innerHTML = `<span class="tool-status${statusClass}">${statusIcon}</span><span class="tool-name">${label}</span>${infoHtml}`;
      autoScroll();
      break;
    }

    case 'busy': {
      const newQueued = msg.queued ?? 0;
      if (msg.active && newQueued < S.prevQueueCount) {
        if (S.pendingQueuedTexts.length > 0) appendMessage(messagesEl, 'user', S.pendingQueuedTexts.shift()!);
        S.currentAgentEl = null; S.currentAgentText = ''; S.thinkingStatusEl = null; S.pendingText = '';
        showWaiting(messagesEl);
      }
      S.prevQueueCount = newQueued;
      setBusy(msg.active ?? false, newQueued);
      break;
    }

    case 'done':
      if (S.pendingText) flushPending();
      if (S.markdownDebounceTimer) { clearTimeout(S.markdownDebounceTimer); S.markdownDebounceTimer = null; }
      document.getElementById('waiting')?.remove();
      document.getElementById('turn-thinking')?.remove();
      if (S.currentAgentEl && S.currentAgentText) {
        // If this turn was a slash command, restyle the bubble as a centered
        // "system" message instead of a normal agent reply. The content is
        // canned adapter output, not an LLM response — the visual treatment
        // should reflect that.
        if (S.pendingSlashResponse) {
          S.currentAgentEl.classList.remove('agent');
          S.currentAgentEl.classList.add('system');
        } else {
          detectTodoUpdate(S.currentAgentText, todoOverlay);
        }
        renderMarkdown(S.currentAgentEl, S.currentAgentText);
        autoScroll();
      }
      // YOLO state feedback — parse the adapter's /yolo response ("⚡ YOLO mode: ON — ..."
      // or "⚠ YOLO mode: OFF — ...") and toggle the red composer glow. Ground-truth
      // driven: the glow reflects the real HERMES_YOLO_MODE env var inside the
      // adapter subprocess, not an optimistic client guess.
      {
        const m = /YOLO mode:\s*(ON|OFF)/i.exec(S.currentAgentText);
        if (m) composer.classList.toggle('yolo', m[1].toUpperCase() === 'ON');
      }
      S.currentAgentEl = null; S.currentAgentText = ''; S.thinkingStatusEl = null;
      S.pendingSlashResponse = false;
      inputEl.focus();
      break;

    case 'error':
      if (S.pendingText) flushPending();
      if (S.markdownDebounceTimer) { clearTimeout(S.markdownDebounceTimer); S.markdownDebounceTimer = null; }
      document.getElementById('waiting')?.remove();
      document.getElementById('turn-thinking')?.remove();
      appendMessage(messagesEl, 'error', `Error: ${msg.text}`);
      S.currentAgentEl = null; S.currentAgentText = ''; S.thinkingStatusEl = null;
      break;

    case 'status':
      if (msg.status === 'connecting')        appendMessage(messagesEl, 'tool', 'Connecting to Hermes…');
      else if (msg.status === 'connected')    appendMessage(messagesEl, 'tool', 'Connected');
      else if (msg.status === 'disconnected') {
        appendMessage(messagesEl, 'error', 'Hermes disconnected');
        setBusy(false);
      }
      break;

    case 'clear':
      messagesEl.innerHTML = '';
      S.pendingQueuedTexts = []; S.prevQueueCount = 0; S.knownContextSize = 0; S.flushScheduled = false;
      ctxBarWrap.style.display = 'none';
      S.currentAgentEl = null; S.currentAgentText = ''; S.thinkingStatusEl = null; S.pendingText = '';
      setBusy(false);
      statusContextEl.textContent = ''; statusContextEl.className = '';
      break;

    case 'statusBar': {
      updateStatusBar(S, statusEls, msg.model, msg.sessionTitle, msg.contextUsed, msg.contextSize, msg.version, msg.cachedTokens);
      if (msg.skillGroups && msg.skillGroups.length > 0) S.skillGroupsData = msg.skillGroups;
      if (msg.selectedSkills !== undefined) {
        S.selectedSkillNames = new Set(msg.selectedSkills);
        skillsBtn.classList.toggle('has-skills', S.selectedSkillNames.size > 0);
        skillsBtn.textContent = S.selectedSkillNames.size > 0 ? `✦${S.selectedSkillNames.size}` : '✦';
      }
      if (msg.todoState && typeof msg.todoState === 'object') {
        const state = msg.todoState as { todos?: TodoItem[] };
        if (state.todos) renderTodoOverlay(todoOverlay, state.todos);
      }
      if (msg.contextAnnotation) {
        const userMsgs = messagesEl.querySelectorAll('.msg.user');
        const lastUser = userMsgs[userMsgs.length - 1];
        if (lastUser) {
          const anno = document.createElement('div');
          anno.className = 'context-annotation';
          anno.innerHTML = DOMPurify.sanitize(msg.contextAnnotation, {
            ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'],
          });
          lastUser.appendChild(anno);
        }
      }
      if (msg.attachedFiles !== undefined) {
        if (msg.attachedFiles && msg.attachedFiles.length > 0) {
          attachChip.innerHTML = msg.attachedFiles.map((f: {name: string}) =>
            `⊕ <span class="chip-name">${f.name}</span>`
          ).join(' ') + ' <span class="chip-x">✕</span>';
          attachChip.style.display = 'flex';
        } else {
          attachChip.style.display = 'none'; attachChip.innerHTML = '';
        }
      }
      break;
    }

    case 'sessionList':
      if (msg.sessions && msg.activeSessionId !== undefined) {
        buildSessionPicker(sessionPicker, msg.sessions, msg.activeSessionId, statusSessionEl, S);
      }
      break;

    // ── History panel: extension responds to our listSessions request ──────
    case 'sessionsList': {
      // Populate cache — msg.sessions may have updatedAt even if not in the
      // TS interface (chatPanel sends it); cast to access it safely.
      const raw = (msg.sessions ?? []) as any[];
      _historySessions = raw.map(s => ({
        id:           String(s.id ?? ''),
        title:        String(s.title ?? ''),
        messageCount: Number(s.messageCount ?? 0),
        createdAt:    Number(s.createdAt ?? 0),
        updatedAt:    Number(s.updatedAt ?? s.createdAt ?? 0),
      }));
      _historyActiveId = msg.activeId ?? '';
      // Re-render only if panel is currently open
      if (historyPanel.style.display !== 'none') {
        renderHistoryRows(historySearch.value);
      }
      break;
    }

    case 'loadHistory':
      loadHistory(messagesEl, msg.history ?? [], msg.switched ?? false);
      break;

    case 'newSession':
      vscode.postMessage({ type: 'newSession' });
      S.showSessionMenu = false;
      renderSessionMenu();
      break;

    // FIX TS2345: guard msg.sessionId (string | undefined) before passing to switchTo
    case 'switchSession':
      if (!store || !msg.sessionId) break;
      store.switchTo(msg.sessionId);
      break;

    default:
      console.warn('[webview] unknown message type:', msg.type);
      break;
  }
});