# Change Log

## [1.0.4] - 2026-04-02

Security and stability hardening release.

### Security
- Require trusted-workspace behavior before launching Hermes
- Ignore workspace-scoped `hermes.path` overrides and constrain the setting to machine scope
- Prompt before launching a new Hermes binary path and remember approved binaries
- Replace blanket permission auto-approval with explicit per-request prompts
- Restrict webview local resource access to the extension media cache instead of `~` and `/tmp`
- Reduce default log exposure by turning diagnostic logging off by default and trimming prompt payload logging
- Escape model menu content and remove HTML string insertion for skill/session/file-chip UI built from local metadata

### UI
- Normalize bottom-toolbar button sizing and focus styles
- Tighten toolbar layout for narrow sidebars
- Keep attachment chips and dropdown labels consistent without HTML injection glitches

## [1.0.0] - 2026-04-02

Initial public release of the Hermes AI Agent extension for VS Code.

### Chat & Streaming
- Sidebar chat panel with streaming markdown rendering and DOMPurify sanitization
- Extended thinking display (gold italic status line)
- Inline image rendering via Hermes `MEDIA:/path` protocol
- Copy buttons on all code blocks (hover to reveal)
- Queued prompts with interrupt mode — new messages cancel the current turn
- Logo pulses gold and input border glows while agent is working

### Tool Integration
- Claude Code-style tool call display with bold kind labels (Read, Edit, Bash, Search, Fetch)
- Tool status icons: `✓` green (done), `⋯` gold (running), `✗` red (error)
- Tool calls rendered in monospace code-block frames
- Live file integration — edited files auto-open in VS Code editor; reads open as preview tabs
- Tool kind and file paths extracted from ACP `locations[]` field

### Context & Attachments
- IDE context awareness — active file, selection, and open tabs sent with each message
- File attachment via ⊞ button, drag & drop from explorer, or clipboard paste (Ctrl+V)
- Multiple file attachments accumulate as chips, cleared after send
- Files sent as path references — Hermes reads on demand via its file tools
- Context annotations shown in user message bubble after send (⊕ files, ✦ skills)

### Skills
- Dynamic skills picker (✦ button) loads 100+ skills from `~/.hermes/skills/`
- Skills grouped alphabetically by category with multi-select toggles
- Selected skills injected as advisory prefix in the prompt

### Sessions
- Persistent sessions stored in VS Code workspaceState (survive reloads)
- Session picker with rename (✎ → VS Code input box + `/title` sync), delete (✕), switch
- Auto-titled from first user message
- ACP session ID persistence for context resume across restarts

### Models
- Multi-provider model switching: Anthropic Claude + OpenAI Codex
- Grouped model picker with `provider:model` syntax for seamless provider changes
- Dynamic catalog from `~/.hermes/models_dev_cache.json` with hard-coded fallbacks

### Token Tracking
- Live token counter with gold current value and progress bar
- Color-coded warnings: gold at 70%, red at 90% context usage
- Context window size from Hermes `_meta.contextLength`

### Todo Overlay
- Persistent task checklist below status bar when Hermes uses its todo tool
- Status icons: □ pending, ■ in-progress (gold), ✓ completed (green), ✗ cancelled
- Live task counts header

### UI
- SVG activity bar icon (winged sandal, theme-adaptive)
- Gold winged sandal logo with ☤ Hermes brand and version below
- Bottom toolbar: attach, skills, model picker, slash command buttons (≡ ⤓ ↺ ?)
- Top status bar: session name (gold, bold) + token counter fill full width
- Draggable input area resize handle
- Session management: picker, rename, delete from dropdown

### Technical
- ACP (Agent Client Protocol) over JSON-RPC 2.0 stdio subprocess
- Runs on workspace/server side for VS Code Remote SSH
- Auto-resolves hermes binary from `~/.local/bin`, `/usr/local/bin`
- Streaming text deduplication (exact, prefix, suffix match)
- CSP with DOMPurify for all agent-generated content
- `extensionKind: ["workspace"]` for remote compatibility
