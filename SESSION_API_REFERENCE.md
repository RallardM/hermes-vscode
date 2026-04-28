# Hermes Agent Session API Reference

Comprehensive documentation of the session manipulation APIs in the Hermes Agent submodule.

---

## Table of Contents

1. [Overview](#overview)
2. [SessionManager API](#sessionmanager-api)
3. [SessionStore API](#sessionstore-api)
4. [CLI Commands](#cli-commands)
5. [Usage Examples](#usage-examples)
6. [Important Considerations](#important-considerations)

---

## Overview

Hermes Agent provides two primary session management systems:

### SessionManager (acp_adapter/session.py)
- **Purpose**: ACP session manager — maps ACP sessions to Hermes AIAgent instances
- **Persistence**: Sessions persist to `~/.hermes/state.db` (SQLite)
- **Use Case**: Interactive CLI sessions managed by the Agent Platform (ACP)

### SessionStore (gateway/session.py)
- **Purpose**: Gateway session handling with multi-platform support
- **Storage**: 
  - SQLite database (`~/.hermes/state.db`)
  - Legacy JSONL transcripts (`~/.hermes/sessions/{session_id}.jsonl`)
- **Use Case**: Multi-platform session management (CLI, Gateway, ACP, etc.)

---

## SessionManager API

Located in: `vendor/hermes-agent/acp_adapter/session.py`

### Class: `SessionManager`

Thread-safe manager for ACP sessions backed by Hermes AIAgent instances.

#### Constructor
```python
SessionManager(agent_factory=None, db=None)
```
- `agent_factory`: Optional callable that creates an AIAgent-like object (for tests)
- `db`: Optional SessionDB instance (None → lazy-init default database)

---

### Methods

#### `create_session(cwd: str = ".") -> SessionState`

Create a new session with a unique ID and a fresh AIAgent.

**Parameters:**
- `cwd` (str): Working directory, defaults to "."

**Returns:** `SessionState` object containing:
- `session_id`: Unique session identifier (UUID)
- `agent`: AIAgent instance
- `cwd`: Working directory
- `model`: Model identifier
- `history`: Conversation history list
- `cancel_event`: Threading.Event for cancellation

**Side Effects:**
- Registers task cwd for terminal tool overrides
- Persists session to database

**Example:**
```python
manager = SessionManager()
session = manager.create_session("/path/to/workspace")
session_id = session.session_id  # "550e8400-e29b-41d4-a716-446655440000"
```

---

#### `get_session(session_id: str) -> Optional[SessionState]`

Return the session for *session_id*, or ``None``.

If the session is not in memory but exists in the database (e.g. after a process restart), it is transparently restored.

**Parameters:**
- `session_id` (str): Session identifier

**Returns:** `SessionState` or `None` if not found

**Example:**
```python
session = manager.get_session("some-id")
if session:
    print(session.history)  # Conversation history
```

---

#### `remove_session(session_id: str) -> bool`

Remove a session from memory and database. Returns True if it existed.

**Parameters:**
- `session_id` (str): Session identifier

**Returns:** `bool` - True if session existed (in memory or database)

**Side Effects:**
- Clears task cwd overrides
- Deletes from database

**Example:**
```python
deleted = manager.remove_session("some-id")
print(f"Session removed: {deleted}")
```

---

#### `fork_session(session_id: str, cwd: str = ".") -> Optional[SessionState]`

Deep-copy a session's history into a new session.

**Parameters:**
- `session_id` (str): Source session ID
- `cwd` (str): Working directory for the new session

**Returns:** `SessionState` for the new session, or `None` if source not found

**Example:**
```python
original = manager.get_session("original-id")
forked = manager.fork_session("original-id", "/new/path")
if forked:
    # forked.history is a deep copy of original.history
    print(f"New session: {forked.session_id}")
```

---

#### `list_sessions(cwd: str | None = None) -> List[Dict[str, Any]]`

Return lightweight info dicts for all sessions (memory + database).

**Parameters:**
- `cwd` (str | None): Optional working directory filter

**Returns:** List of dicts with keys:
- `session_id`: Session identifier
- `cwd`: Working directory
- `model`: Model identifier
- `history_len`: Number of messages
- `title`: Session title (explicit, preview, or auto-generated)
- `updated_at`: Last activity timestamp

**Example:**
```python
sessions = manager.list_sessions("/path/to/workspace")
for s in sessions[:5]:
    print(f"{s['title']}: {s['history_len']} messages")
```

---

#### `update_cwd(session_id: str, cwd: str) -> Optional[SessionState]`

Update the working directory for a session and its tool overrides.

**Parameters:**
- `session_id` (str): Session identifier
- `cwd` (str): New working directory

**Returns:** `SessionState` or `None` if session not found

**Example:**
```python
session = manager.update_cwd("session-id", "/new/workspace")
if session:
    print(f"Updated cwd to: {session.cwd}")
```

---

#### `cleanup()`

Remove all sessions (memory and database) and clear task-specific cwd overrides.

**Example:**
```python
manager.cleanup()
```

---

#### `save_session(session_id: str)`

Persist the current state of a session to the database.

**Parameters:**
- `session_id` (str): Session identifier

**Example:**
```python
session = manager.get_session("session-id")
session.history.append({...})
manager.save_session("session-id")
```

---

## SessionStore API

Located in: `vendor/hermes-agent/gateway/session.py`

### Class: `SessionStore`

Gateway session store with SQLite and legacy JSONL transcript support.

#### Constructor
```python
SessionStore(
    sessions_dir: Path,
    db: Optional[SessionDB] = None,
    log_session_to_gateway: bool = True,
    log_messages_to_gateway: bool = True
)
```

---

### Methods

#### `create_session(
    platform: str,
    origin: User,
    display_name: str | None = None,
    chat_type: str | None = None,
    **kwargs
) -> SessionEntry`

Create a new session entry.

**Parameters:**
- `platform` (str): Platform identifier (e.g., "cli", "gateway", "acp")
- `origin` (User): User object containing `user_id`
- `display_name` (str | None): Optional display name
- `chat_type` (str | None): Optional chat type
- `**kwargs`: Additional metadata

**Returns:** `SessionEntry` with session_id, session_key, and metadata

**Example:**
```python
store = SessionStore(sessions_dir=Path.home() / ".hermes/sessions")
new_session = store.create_session(
    platform="cli",
    origin=User(user_id="user-123"),
    display_name="My Workspace"
)
print(f"Created session: {new_session.session_id}")
```

---

#### `reset_session(session_key: str) -> Optional[SessionEntry]`

Reset a session (terminate it).

**Parameters:**
- `session_key` (str): Session key

**Returns:** `SessionEntry` with new session_id

**Example:**
```python
new_entry = store.reset_session("session-key-1")
```

---

#### `switch_session(session_key: str, target_session_id: str) -> Optional[SessionEntry]`

Switch a session key to point at an existing session ID.

Used by ``/resume`` to restore a previously-named session. Ends the current session in SQLite (like reset), but instead of generating a fresh session ID, re-uses ``target_session_id`` so the old transcript is loaded on the next message.

**Parameters:**
- `session_key` (str): Current session key
- `target_session_id` (str): Target session ID to restore

**Returns:** `SessionEntry` or `None` if not found

**Example:**
```python
entry = store.switch_session("my-workspace", "session-id-to-restore")
```

---

#### `list_sessions(active_minutes: Optional[int] = None) -> List[SessionEntry]`

List all sessions, optionally filtered by activity.

**Parameters:**
- `active_minutes` (int | None): Only show sessions updated in the last N minutes

**Returns:** List of `SessionEntry` objects, sorted by updated_at descending

**Example:**
```python
# Show only sessions active in the last 60 minutes
recent = store.list_sessions(active_minutes=60)
for s in recent:
    print(f"{s.session_key}: {s.created_at}")
```

---

#### `get_transcript_path(session_id: str) -> Path`

Get the path to a session's legacy transcript file.

**Returns:** `Path` to `{session_id}.jsonl`

**Example:**
```python
path = store.get_transcript_path("session-id")
print(path)  # ~/.hermes/sessions/session-id.jsonl
```

---

#### `append_to_transcript(session_id: str, message: Dict[str, Any], skip_db: bool = False) -> None`

Append a message to a session's transcript (SQLite + legacy JSONL).

**Parameters:**
- `session_id` (str): Session identifier
- `message` (Dict[str, Any]): Message dict with keys: role, content, tool_name, tool_calls, tool_call_id
- `skip_db` (bool): When True, only write to JSONL (skip SQLite). Used to prevent duplicate writes when the agent already persisted to SQLite.

**Example:**
```python
message = {
    "role": "user",
    "content": "Hello, world!",
}
store.append_to_transcript("session-id", message)
```

---

#### `rewrite_transcript(session_id: str, messages: List[Dict[str, Any]]) -> None`

Replace the entire transcript for a session with new messages.

Used by /retry, /undo, and /compress to persist modified conversation history.

**Parameters:**
- `session_id` (str): Session identifier
- `messages` (List[Dict[str, Any]]): New conversation messages

**Example:**
```python
# Retry with modified messages
new_messages = [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi there! How can I help?"},
]
store.rewrite_transcript("session-id", new_messages)
```

---

#### `load_transcript(session_id: str) -> List[Dict[str, Any]]`

Load all messages from a session's transcript.

**Returns:** List of message dicts

**Example:**
```python
messages = store.load_transcript("session-id")
print(len(messages))  # Total message count
```

---

## CLI Commands

Located in: `vendor/hermes-agent/cli.py`

### Interactive Mode
```bash
python cli.py
```
Starts interactive REPL with all tools enabled.

### Single Query Mode
```bash
python cli.py -q "your question"
```
Runs a single question and exits.

### Toolset Selection
```bash
python cli.py --toolsets web,terminal
```
Starts CLI with only the specified toolsets.

### Skill Selection
```bash
python cli.py --skills hermes-agent-dev,github-auth
```
Enables specific skills.

### List Tools
```bash
python cli.py --list-tools
```
Lists available tools and exits.

### Worktree Mode
```bash
python cli.py --worktree
```
Creates an isolated git worktree for the session.

---

## Usage Examples

### Complete Session Lifecycle

```python
import uuid
from pathlib import Path
from acp_adapter.session import SessionManager

# Initialize session manager
manager = SessionManager()

# Create a new session
session = manager.create_session(cwd="/path/to/workspace")
print(f"Created: {session.session_id}")

# Access the agent
agent = session.agent

# Send a message
result = agent.process_prompt("What are the dependencies in this repo?", cwd="/path/to/workspace")
print(result)

# Update working directory
manager.update_cwd(session.session_id, "/new/workspace")

# List all sessions
sessions = manager.list_sessions()
for s in sessions:
    print(f"{s['title']}: {s['history_len']} messages")

# Fork session for new workspace
forked = manager.fork_session(session.session_id, "/another/workspace")

# Cleanup
manager.cleanup()
```

### Session Persistence

```python
from gateway.session import SessionStore

store = SessionStore(
    sessions_dir=Path.home() / ".hermes/sessions",
    log_session_to_gateway=True
)

# Create session
entry = store.create_session(
    platform="cli",
    origin=User(user_id="user-123")
)

# Append messages to transcript
messages = [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi!"},
]
store.append_to_transcript(entry.session_id, {"role": "user", "content": "Hello"})
store.append_to_transcript(entry.session_id, {"role": "assistant", "content": "Hi!"})

# Load transcript later
reloaded = store.load_transcript(entry.session_id)
```

---

## Important Considerations

### CWD Normalization

The `_normalize_cwd_for_compare()` function normalizes Windows drive paths to WSL mount form for cross-platform consistency:

```
C:\path\to\workspace  →  /mnt/c/path/to/workspace
```

This ensures ACP history filters match the same workspace across Windows and WSL.

### Session ID Format

Session IDs are UUIDs (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

### Persistence

- **SessionManager**: Persists to `~/.hermes/state.db` (SQLite)
- **SessionStore**: Persists to both SQLite and legacy JSONL files

### Thread Safety

`SessionManager` uses a `Lock()` for thread-safe operations on `self._sessions`.

---

## API Compatibility Notes

### SessionManager → SessionStore Migration

- `SessionManager.create_session()` creates ACP sessions stored in SQLite
- `SessionStore.create_session()` creates gateway sessions with platform tracking
- Both use session_id as the primary identifier
- SessionStore provides additional platform awareness (cli, gateway, acp)

### Legacy Support

SessionStore maintains backward compatibility by:
- Supporting both SQLite and legacy JSONL storage
- Providing `get_transcript_path()` for legacy tooling
- Preferring whichever source has more messages during load

---

## File Locations Summary

| Component | File Path |
|-----------|-----------|
| SessionManager | `vendor/hermes-agent/acp_adapter/session.py` |
| SessionStore | `vendor/hermes-agent/gateway/session.py` |
| CLI Interface | `vendor/hermes-agent/cli.py` |
| AIAgent | `vendor/hermes-agent/run_agent.py` |
| Tool Definitions | `vendor/hermes-agent/model_tools.py` |
| Toolsets | `vendor/hermes-agent/toolsets.py` |

---

*Generated: 2024*