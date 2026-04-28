# Session Implementation Issue Documentation

## Date: April 23, 2026
## Time: 7:55 PM EDT

---

## What Went Wrong

### Original Request
The user asked for **visual session management icons in the top right corner** (like Cline/Continue), NOT slash commands.

### My Mistake
I incorrectly implemented **slash commands** (`/new`, `/compact`, `/save`) instead of the requested **visual top-right icons**.

---

## What the User Actually Wants

### Cline/Continue Style Session Picker

```
┌─────────────────────────────────────────────────────────┐
│  Hermes                    [☰ Session Menu ▼]  [➕]     │
└─────────────────────────────────────────────────────────┘
```

**Top-right corner elements:**
- **Session Menu Icon** (☰ or hamburger) - Opens session dropdown
- **New Session Icon** (➕) - Quick create new session
- **Session Dropdown** - Shows all sessions, search, switch

---

## Correct Implementation Plan

### 1. Backend Changes (Extension)

#### Update `src/webview/state.ts`
```typescript
export interface WebviewState {
  // ... existing properties
  showSessionMenu: boolean;
  showNewSessionButton: boolean;
  sessionMenuWidth: number;
}
```

#### Update `src/webview/main.ts`
```typescript
// Add session menu button to header
const sessionMenuBtn = document.createElement('button');
sessionMenuBtn.className = 'session-menu-btn';
sessionMenuBtn.innerHTML = '☰';
sessionMenuBtn.addEventListener('click', () => {
  state.showSessionMenu = !state.showSessionMenu;
  vscode.postMessage({ type: 'toggleSessionMenu', open: state.showSessionMenu });
});

// Add new session button
const newSessionBtn = document.createElement('button');
newSessionBtn.className = 'new-session-btn';
newSessionBtn.innerHTML = '➕';
newSessionBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'newSession' });
});
```

#### Update `src/main.tsx` (Extension)
```typescript
case 'toggleSessionMenu':
  state.showSessionMenu = msg.open;
  broadcastSessionMenu();
  break;

case 'newSession':
  const id = sessionStore.createSession('new session');
  sessionManager.switchTo(id);
  break;
```

### 2. Frontend Changes (Webview)

#### Update `src/chatPanel.ts`
```typescript
private showSessionMenu(): void {
  this.webview.postMessage({
    type: 'showSessionMenu',
    sessions: sessionStore.allSessionsReversed().map(s => ({
      id: s.id,
      title: s.title,
      messageCount: s.messages.length,
      lastMessageAt: s.updatedAt,
    })),
    activeSessionId: sessionStore.activeId,
    showNewButton: true,
  });
}
```

#### Add CSS for session menu
```css
.session-menu {
  position: absolute;
  top: 12px;
  right: 12px;
  background: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  min-width: 280px;
  z-index: 1000;
}

.session-menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid #3c3c3c;
}

.session-menu-search {
  width: 100%;
  padding: 8px 12px;
  margin: 8px 12px;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  background: #1e1e1e;
  color: #e6e6e6;
}

.session-menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
}

.session-menu-item.active {
  background: #2d2d2d;
}

.session-menu-item:hover:not(.active) {
  background: #252526;
}

.session-menu-actions {
  display: flex;
  gap: 4px;
}

.session-menu-action-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px;
}

.session-menu-action-btn:hover {
  color: #e6e6e6;
}
```

### 3. Slash Commands → Convert to Menu Items

The slash commands I added should be converted to **menu actions** instead:

| Slash Command | Menu Action |
|---------------|-------------|
| `/new` | New Session Button |
| `/compact` | "Compact Session" menu item |
| `/save` | "Save Session" menu item |

---

## Files to Modify

1. **`src/webview/state.ts`** - Add session menu UI state
2. **`src/webview/main.ts`** - Render session menu with icons
3. **`src/chatPanel.ts`** - Show session menu, handle menu actions
4. **`src/types.ts`** - Add new message types for menu
5. **`src/main.tsx`** - Handle menu toggle, new session
6. **`src/htmlTemplate.ts`** - Session menu HTML/CSS (optional)

---

## Next Steps

1. Revert all slash command changes from `src/extension.ts`
2. Remove `/new`, `/compact`, `/save` from slash command handler
3. Implement visual session menu with top-right icons
4. Add "Compact Session" and "Save Session" as menu actions
5. Style the session menu to match Cline/Continue aesthetic

---

## Notes

- User wants **visual icons**, not text commands
- Session menu should be **compact and unobtrusive**
- Style should match **Cline/Continue** - minimal, clean, top-right
- Icons should be simple (☰, ➕, or SVG equivalents)