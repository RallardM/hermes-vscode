# Model Selection System — Complete Reference

This document provides a comprehensive overview of the model selection system in Hermes-vscode, including the dropdown menu, slash commands, and all related code.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [File-by-File Breakdown](#file-by-file-breakdown)
4. [Event Flow](#event-flow)
5. [Dropdown Menu HTML Structure](#dropdown-menu-html-structure)
6. [Model Menu Building Functions](#model-menu-building-functions)
7. [Event Handlers](#event-handlers)
8. [Slash Command Handling](#slash-command-handling)
9. [State Management](#state-management)

---

## Overview

The model selection system consists of:
- **Dropdown Menu**: A visual dropdown triggered by clicking the model name in the header
- **Slash Command**: `/model <model_command>` for quick selection
- **State Management**: Tracks the currently selected model

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Extension                             │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │ chatPanel.ts │◄──►│  htmlTemplate.ts │    │ modelCatalog│ │
│  │              │    │                  │    │            │ │
│  │ 1. Builds    │    │ 2. Renders       │    │ 3. Defines │ │
│  │    model menu│    │    dropdown      │    │    models  │ │
│  └──────────────┘    └──────────────────┘    └────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Webview                                 │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │ main.ts      │    │  protocol.ts     │    │ state.ts   │ │
│  │              │    │                  │    │            │ │
│  │ 4. Event     │    │ 5. Message       │    │ 6. State   │ │
│  │    handlers  │    │    types         │    │    model   │ │
│  └──────────────┘    └──────────────────┘    └────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## File-by-File Breakdown

### 1. `src/modelCatalog.ts` — Model Definitions

**Purpose:** Defines the structure of available models and generates the model menu.

**Key Components:**
- `ModelMenuItem` — Single model option
- `ModelMenuGroup` — Group of models with a label
- `loadHermesModelGroups()` — Main function to build model menu

**Model Groups:**
```
┌─────────────────────────────────────────────────────────────┐
│  Anthropic                                                   │
│  ├─ claude-opus-4-1-20250805  →  Claude Opus 4.1            │
│  ├─ claude-opus-4-20250514    →  Claude Opus 4              │
│  ├─ claude-opus-4-5-20251101  →  Claude Opus 4.5            │
│  ├─ claude-sonnet-4-20250514  →  Claude Sonnet 4            │
│  └─ claude-3-haiku-20240307   →  Claude 3 Haiku             │
│                                                               │
│  OpenAI Codex                                                │
│  ├─ gpt-5.4-mini          →  GPT-5.4 mini                   │
│  ├─ gpt-5.4               →  GPT-5.4                        │
│  ├─ gpt-5.3-codex         →  GPT-5.3 Codex                  │
│  └─ gpt-5.2-codex         →  GPT-5.2 Codex                  │
│                                                               │
│  Custom                                                      │
│  ├─ Qwen3.5-9b           →  Qwen3.5-9b (Llama Server)      │
│  └─ llama-custom         →  Custom Model (llama.cpp)        │
└─────────────────────────────────────────────────────────────┘
```

**Important Functions:**

```typescript
function buildGroup(
  group: string,          // Group name (e.g., "Anthropic")
  commandPrefix: string,  // Prefix for command (e.g., "anthropic")
  ids: readonly string[], // Model IDs
  models?: Record<string, HermesModelRecord>, // Cached model data
): ModelMenuGroup {
  return {
    group,
    items: ids.map((id) => ({
      id,
      label: itemLabel(id, models?.[id]),
      command: `${commandPrefix}:${id}`,  // e.g., "anthropic:claude-opus-4"
    })),
  };
}
```

---

### 2. `src/htmlTemplate.ts` — HTML Rendering

**Purpose:** Generates the HTML template with the model dropdown.

**Key Components:**

```typescript
function buildModelMenuItems(config: TemplateConfig): string {
  // Creates HTML for each model option with data attributes
  return modelGroups.map(group => {
    const items = group.items.map(m => {
      const active = (m.id === initialModel || m.command === initialModel) ? ' active' : '';
      return `<div class="model-option${active}" data-command="${escapeHtml(m.command)}">
        ${escapeHtml(m.label)}${suffix}
      </div>`;
    }).join('');
    return `<div class="model-group-label">${escapeHtml(group.group)}</div>${items}`;
  }).join('<div class="model-sep"></div>');
}
```

**Dropdown HTML Structure:**
```html
<button id="model-btn-header" title="Switch model">
  Model Name ▾
</button>

<div id="model-menu" style="display:none">
  <div class="model-group-label">Anthropic</div>
  <div class="model-option active" data-command="anthropic:claude-opus-4">
    Claude Opus 4
  </div>
  <div class="model-sep"></div>
  <div class="model-group-label">OpenAI Codex</div>
  <div class="model-option" data-command="openai-codex:gpt-5.4">
    GPT-5.4
  </div>
</div>
```

---

### 3. `src/webview/main.ts` — Event Handlers

**Purpose:** Handles user interactions with the model dropdown.

**Key Event Handlers:**

```typescript
// 1. Open dropdown on header button click
modelBtnHeader.addEventListener('click', (e) => {
  e.stopPropagation();
  closeFn();  // Close other dropdowns
  
  if (!modelMenu) return;
  
  const open = (modelMenu as HTMLDivElement).style.display !== 'none';
  
  if (!open) {
    (modelMenu as HTMLDivElement).style.display = 'block';
  }
});

// 2. Select model from dropdown
modelMenu.addEventListener('click', (e) => {
  const opt = (e.target as HTMLElement).closest<HTMLElement>('.model-option');
  if (!opt?.dataset.command) return;
  
  closeFn();
  vscode.postMessage({ 
    type: 'switchModel', 
    model: opt.dataset.command  // e.g., "anthropic:claude-opus-4"
  });
});
```

---

### 4. `src/chatPanel.ts` — Slash Command Handling

**Purpose:** Processes `/model` slash command from user input.

**Key Handler:**
```typescript
} else if (msg.type === 'switchModel' && msg.model) {
  this.log(`[ui] switch model ${msg.model}`);
  const command = `/model ${msg.model}`;
  this.messageQueue = [];
  this.lastTurnText = '';
  this.lastTurnTools = [];
  if (this.busy) {
    await this.session.cancel();
  }
  void this.runPrompt(command);
```

**Slash Command Pattern:**
```typescript
function isSlashCommand(text: string): boolean {
  if (!text.startsWith('/')) return false;
  const first = text.slice(1).split(/\s/, 1)[0].toLowerCase();
  return KNOWN_SLASH_COMMANDS.has(first);
}

const KNOWN_SLASH_COMMANDS = new Set([
  'help', 'model', 'tools', 'context', 'reset', 'compact', 'version',
  'title', 'yolo', 'new', 'retry', 'status', 'usage', 'compress',
  'reasoning', 'save',
]);
```

---

### 5. `src/protocol.ts` — Message Types

**Purpose:** Defines the TypeScript types for webview-protocol communication.

```typescript
export interface FromWebview {
  type: 'send' | 'cancel' | 'switchModel' | 'newSession' | 'switchSession' |
        'attachFile' | 'pasteImage' | 'dropFiles' | 'clearAttachments' |
        'compactSession' | 'saveSession' | 'deleteSession' | 'renameSession' |
        'toggleSkill' | 'llamaRequest';
  
  text?: string;
  model?: string;
  sessionId?: string;
  // ... other properties
}

export interface ToWebview {
  type: 'append' | 'thinking' | 'toolCall' | 'busy' | 'done' | 'error' |
        'status' | 'clear' | 'statusBar' | 'sessionList' | 'loadHistory' |
        'newSession';
  
  model?: string;
  // ... other properties
}
```

---

### 6. `src/extension.ts` — Initialization

**Purpose:** Sets up the extension and provides the initial model.

```typescript
let _model: string | undefined;
let _version: string | undefined;

// Called by extension host
export function setModel(model: string, version: string): void {
  _model = model;
  _version = version;
}

// Extension activation
function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('hermes.selectModel', () => {
      setModel('anthropic:claude-opus-4', '1.0.0');
    }),
  );
  // ...
}
```

---

### 7. `src/webview/state.ts` — State Management

**Purpose:** Manages the model selection state in the webview.

```typescript
export interface ModelState {
  model: string;
  selected: boolean;
}

export function createInitialState(): ModelState {
  return {
    model: '—',  // Default: show dash when model not set
    selected: false,
  };
}
```

---

## Event Flow

### Dropdown Menu Flow

```
User Clicks Model Button
        │
        ▼
main.ts: modelBtnHeader.addEventListener('click')
        │
        ▼
  Close all dropdowns (closeFn)
        │
        ▼
  Check if modelMenu exists
        │
        ▼
  Toggle display: if not open → display = 'block'
        │
        ▼
User Selects Model Option
        │
        ▼
main.ts: modelMenu.addEventListener('click')
        │
        ▼
  Find closest .model-option element
        │
        ▼
  Read data-command attribute
        │
        ▼
  Post message: { type: 'switchModel', model: 'anthropic:claude-opus-4' }
        │
        ▼
chatPanel.ts: handleFromWebview('switchModel')
        │
        ▼
  Build slash command: `/model anthropic:claude-opus-4`
        │
        ▼
  Clear message queue and text
        │
        ▼
  Run prompt with model switch command
        │
        ▼
Hermes Agent processes command
        │
        ▼
  Response: "model switched to: claude-opus-4-5-20251101"
        │
        ▼
  Update status bar with new model
```

### Slash Command Flow

```
User Types: /model claude-opus-4
        │
        ▼
main.ts: inputEl.addEventListener('keydown')
        │
        ▼
  Detect slash command
        │
        ▼
  Post message: { type: 'send', text: '/model claude-opus-4' }
        │
        ▼
chatPanel.ts: handleFromWebview('send')
        │
        ▼
  Run prompt with slash command
        │
        ▼
Hermes Agent processes command
```

---

## Dropdown Menu HTML Structure

```html
<div id="model-menu" style="display:none">
  <!-- Group label -->
  <div class="model-group-label">Anthropic</div>
  
  <!-- Model options -->
  <div class="model-option active" data-command="anthropic:claude-opus-4-5-20251101">
    Claude Opus 4.5
  </div>
  <div class="model-option" data-command="anthropic:claude-opus-4-6">
    Claude Opus 4.6
  </div>
  <div class="model-option" data-command="anthropic:claude-sonnet-4-6">
    Claude Sonnet 4.6
  </div>
  <div class="model-option" data-command="anthropic:claude-3-haiku-20240307">
    Claude 3 Haiku
  </div>
  
  <!-- Separator -->
  <div class="model-sep"></div>
  
  <!-- More groups -->
  <div class="model-group-label">OpenAI Codex</div>
  <div class="model-option" data-command="openai-codex:gpt-5.4-mini">
    GPT-5.4 mini
  </div>
  
  <!-- Custom models -->
  <div class="model-group-label">Custom</div>
  <div class="model-option" data-command="Qwen3.5-9b">
    Qwen3.5-9b (Llama Server)
  </div>
  <div class="model-option" data-command="llama-custom">
    Custom Model (llama.cpp)
  </div>
</div>
```

---

## Model Menu Building Functions

### `buildGroup()` — Creates a model group

```typescript
buildGroup(
  group: string,              // "Anthropic"
  commandPrefix: string,      // "anthropic"
  ids: readonly string[],     // ['claude-opus-4-5-20251101', ...]
  models?: Record<string, HermesModelRecord>
): ModelMenuGroup
```

**Returns:**
```typescript
{
  group: "Anthropic",
  items: [
    {
      id: "claude-opus-4-5-20251101",
      label: "Claude Opus 4.5",
      command: "anthropic:claude-opus-4-5-20251101"
    },
    // ...
  ]
}
```

### `loadHermesModelGroups()` — Main entry point

```typescript
export function loadHermesModelGroups(): ModelMenuGroup[] {
  const cache = readCache();  // Optional: read from ~/.hermes/models_dev_cache.json
  const anthropic = cache?.anthropic?.models;
  const openai = cache?.openai?.models;
  
  return [
    buildGroup('Anthropic', 'anthropic', ANTHROPIC_MODEL_IDS, anthropic),
    buildGroup('OpenAI Codex', 'openai-codex', OPENAI_CODEX_MODEL_IDS, openai),
    {
      group: 'Custom',
      items: [
        {
          id: 'Qwen3.5-9b',
          label: 'Qwen3.5-9b (Llama Server)',
          command: 'Qwen3.5-9b'
        },
        {
          id: 'llama-custom',
          label: 'Custom Model (llama.cpp)',
          command: 'llama-custom'
        },
      ],
    },
  ];
}
```

---

## Event Handlers Summary

| File | Event | Handler | Action |
|------|-------|---------|--------|
| `main.ts` | `modelBtnHeader.click` | Toggle model dropdown | Shows/hides model menu |
| `main.ts` | `modelMenu.click` | Select model option | Posts `switchModel` message |
| `chatPanel.ts` | `send` (slash cmd) | `/model <model>` | Sends model switch command |
| `chatPanel.ts` | `switchModel` | Model switch message | Builds slash command |

---

## Slash Command Syntax

```
/model <model_command>
```

**Examples:**
- `/model claude-opus-4-5-20251101` — Direct model ID
- `/model anthropic:claude-opus-4` — Command prefix + model ID
- `/model openai-codex:gpt-5.4` — Command prefix + model ID

---

## State Management

### Initial State
```typescript
{
  model: '—',  // Default when no model set
  selected: false
}
```

### State Update from Status Bar
```typescript
updateStatusBar(S, statusEls, msg.model, msg.sessionTitle, ...);
```

---

## Key Constants

### Model IDs (from `modelCatalog.ts`)

```typescript
const ANTHROPIC_MODEL_IDS = [
  'claude-opus-4-1-20250805',
  'claude-opus-4-20250514',
  'claude-opus-4-5-20251101',
  'claude-opus-4-6',
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-6',
  'claude-3-haiku-20240307',
  'claude-haiku-4-5-20251001',
];

const OPENAI_CODEX_MODEL_IDS = [
  'gpt-5.4-mini',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.3-codex-spark',
];
```

### Custom Models
```typescript
const LLAMA_SERVER_MODEL = 'Qwen3.5-9b';
```

---

## Summary

The model selection system is a two-part architecture:
1. **Visual Dropdown** — Click the model name in the header to open the dropdown
2. **Slash Command** — Type `/model <model>` to switch models

Both paths converge on the same internal command mechanism, ensuring consistency across the user experience.