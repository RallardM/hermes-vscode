# Hermes VS Code Extension — Code Quality Review

Scope: `package.json`, `tsconfig.json`, `webpack.config.js`, and the TypeScript sources under `src/`.

This is a quality-focused review only. I am not applying changes here.

## Executive summary

The extension has a solid practical shape: a thin VS Code entrypoint, a separate ACP client, a session manager, and a webview UI bundle. The strongest parts are the clear separation between the host process and the browser-side webview, the security-aware launch gating, and the explicit protocol bridging.

The main weakness is concentration of complexity. `src/chatPanel.ts` and `src/webview/main.ts` are both doing too much: state, rendering, persistence, protocol handling, and UI behavior all live in single files. That makes the code harder to reason about, harder to test, and easier to regress when one part changes.

Overall judgment: practical and good enough to ship, but not yet especially maintainable. The biggest wins are modularization, stronger typed boundaries, and less ad hoc parsing.

---

## Cross-cutting observations

- The architecture is sensible: VS Code extension host → ACP client → Hermes subprocess → webview UI.
- There is a lot of implicit state, especially in the webview. A more explicit state model would simplify future work.
- Several places rely on manual parsing of semi-structured text or JSON-in-text. Those are fragile and would benefit from dedicated parsers or typed payloads.
- Error handling generally fails safely, but often silently. That is okay for a user-facing UI, less good for maintaining the codebase.
- The webview file is the main technical debt hotspot. It has grown into a monolith with multiple responsibilities.

---

## File-by-file review

### `package.json`

#### What is good
- Clean manifest structure.
- Minimal activation events, which is good for startup cost.
- Configuration surface is small and understandable.
- The extension contributes only one view and a small command set, which keeps the UX focused.

#### Concerns
- `hermes.path` is declared `machine-overridable`, but the code later ignores workspace-scoped overrides. That is a policy mismatch between manifest and implementation.
- `hermes.debugLogs` is useful, but there is no obvious path for more granular logging levels or structured logging.
- There is no test script or lint command in `scripts`, which makes maintainability weaker than it needs to be.

#### Refactoring suggestions
- Align config scope and runtime policy. If workspace overrides are intentionally forbidden, the manifest should reflect that more clearly.
- Add `lint` and `test` scripts, even if they start small.
- Consider adding a separate setting for the trusted Hermes binary path versus a runtime-discovered fallback.

---

### `tsconfig.json`

#### What is good
- `strict: true` is the right choice.
- The split between `src/` and `src/webview/` is clean.
- `sourceMap: true` is appropriate for extension debugging.

#### Concerns
- The compiler config is quite permissive beyond strict null checks. There is room for stronger safety settings.
- The separate webview tsconfig is fine, but the project currently depends on convention rather than stronger type boundaries.

#### Refactoring suggestions
- Consider enabling additional strictness flags gradually, especially if the codebase keeps growing:
  - `noImplicitReturns`
  - `noFallthroughCasesInSwitch`
  - `noUncheckedIndexedAccess`
- If the webview keeps expanding, consider a stronger boundary between host and browser types, possibly generated from a shared schema.

---

### `webpack.config.js`

#### What is good
- Two-bundle setup is correct: Node target for the extension host, web target for the webview.
- Using a dedicated `tsconfig` for the webview is a good separation.
- The config is short and readable.

#### Concerns
- There is repeated boilerplate between the two webpack entries.
- The config is intentionally simple, but that also means future extension of the build pipeline may become awkward.
- There is no explicit development-vs-production tuning beyond `mode`.

#### Refactoring suggestions
- Extract shared webpack fragments for `resolve` and `ts-loader` setup.
- Consider adding explicit `devtool` settings for dev builds to make debugging less painful.
- If build times become a problem, consider whether the webview bundle can be split further or whether caching can be enabled more aggressively.

---

### `src/extension.ts`

#### What is good
- Good entrypoint discipline: configuration, trust checks, binary resolution, and UI wiring are separated into helper functions.
- The binary trust check is a strong security practice.
- The code reads top-down reasonably well.
- Status bar handling is straightforward and easy to follow.

#### Concerns
- `activate()` is doing a lot of orchestration. It is not bad, but it is close to becoming a kitchen sink.
- `extractModelFromHermesConfig()` is a hand-rolled parser for YAML-like content. That will be brittle if the config format grows or changes.
- `resolveHermesBinary()` is platform-sensitive and currently relies on shelling out to `which`; that is pragmatic, but not the most robust approach.
- `ensureConnected()` mixes security policy, path resolution, approval gating, UI messaging, and process startup in one function.
- Error handling is user-facing but not deeply structured. That is okay for now, but it limits future diagnostics.

#### Refactoring suggestions
- Split `activate()` into smaller setup functions:
  - configuration/bootstrap
  - security/trust
  - command registration
  - client wiring
  - UI wiring
- Replace manual config parsing with a dedicated config reader if the format is expected to evolve.
- Return richer error types from the Hermes launch path instead of relying on string matching.
- Consider a lightweight lifecycle controller object for startup/shutdown rather than letting `activate()` coordinate everything directly.

---

### `src/acpClient.ts`

#### What is good
- This is one of the cleaner files in the project.
- The ACP transport boundary is well isolated.
- Buffering newline-delimited JSON is a sensible implementation choice for stdio protocol traffic.
- The separation between notifications, requests, and responses is clear.
- Logging hooks are useful and not overcomplicated.

#### Concerns
- The class is still doing several jobs: process management, protocol framing, response correlation, and logging.
- The `dispatch()` logic is readable, but it is increasingly protocol-specific and will get harder to extend as ACP features expand.
- The code trusts the message shapes fairly aggressively. That is okay for a controlled subprocess, but it leaves room for confusing failures if the wire format drifts.
- `stop()` is minimal. There is no graceful shutdown path beyond killing the child process.

#### Refactoring suggestions
- Introduce a small typed message model for ACP frames instead of using `Record<string, unknown>` widely.
- Extract a parser/decoder layer from the process manager layer.
- Track the originating method name in `PendingRequest` so errors can mention which request failed.
- Consider a graceful shutdown or terminate-with-timeout sequence instead of immediate kill semantics.
- Add unit tests for:
  - split JSON line framing
  - response correlation
  - incoming request handling
  - malformed line tolerance

---

### `src/sessionManager.ts`

#### What is good
- This file captures the heart of the agent/session interaction.
- The deduplication logic is thoughtful and shows the code has been pressure-tested in real use.
- Cancelling prompts immediately, rather than waiting for backend acknowledgment, is good UX.
- The event translation layer from ACP updates to extension-level events is a sensible design.

#### Concerns
- This file is significantly more complex than it first appears.
- `handleUpdate()` has become a large protocol switchboard and is doing too much at once.
- There is a lot of protocol knowledge embedded directly inside the switch cases. That makes it harder to extend safely.
- `ensureSession()` currently assumes stored session IDs are valid without verifying them. That may be fine in the happy path, but it is a weak point if session persistence drifts.
- `tool_call_update` parsing mixes multiple fallback formats and ad hoc JSON sniffing. That is fragile.
- The `accumulated` deduplication behavior is clever, but it is not easy to reason about without reading the comments very carefully.

#### Refactoring suggestions
- Split update handling into per-event helpers:
  - `handleAgentMessageChunk`
  - `handleThoughtChunk`
  - `handleToolCall`
  - `handleToolCallUpdate`
  - `handleUsageUpdate`
  - `handleSessionInfoUpdate`
- Replace the large `switch` with a smaller dispatcher plus specialized helpers.
- Extract todo parsing into a named helper with tests.
- Give the deduplication logic a dedicated test suite; it is important enough to deserve it.
- Consider an explicit session state object instead of a few mutable fields spread across the class.
- If resume behavior matters, verify a stored session ID rather than assuming it is still valid.

---

### `src/chatPanel.ts`

#### What is good
- The file has a clear purpose: it bridges the host extension and the webview panel.
- Security-sensitive operations like media path conversion are handled thoughtfully.
- Session persistence and history restoration are useful UX features.
- The file already carries several small helpers, which is better than stuffing everything into one method.

#### Concerns
- This is the largest maintainability problem in the repo.
- `ChatPanelProvider` currently owns too many responsibilities:
  - webview HTML generation
  - session persistence
  - prompt orchestration
  - file attachment handling
  - skills/model menu logic
  - history rendering
  - IDE context collection
  - tool/file-open side effects
- `buildHtml()` is a giant embedded document. It is hard to diff, hard to test, and hard to reason about.
- The file mixes domain logic, UI state, and raw HTML/CSS/JS template generation.
- There are multiple mutable state buckets (`busy`, `messageQueue`, `lastTurnText`, `lastTurnTools`, `sessions`, `selectedSkills`, `attachedFiles`, `toolCallLocations`) that are coordinated manually. That increases the chance of state drift.
- The 150ms delayed initial state emission is a race workaround, not a strong lifecycle contract.

#### Refactoring suggestions
- Split this file first. That is the highest-value refactor in the project.
- Candidate modules:
  - session store / persistence
  - prompt lifecycle controller
  - attachment controller
  - skill selection state
  - history/session view model
  - webview HTML template builder
- Replace the `setTimeout(..., 150)` initialization shim with an explicit ready handshake from the webview.
- Move the HTML/CSS/JS template out into separate files or at least separate template builders.
- Introduce a single composer state object instead of many scattered fields.
- Separate rendering concerns from side-effect concerns; right now they are intertwined.
- Consider more explicit types for tool call data and attachment state.

#### Efficiency notes
- `broadcastSessions()` and history updates are fine at current scale, but they will get expensive if the stored history grows.
- `workspaceState.update()` is called frequently; batching would reduce churn if prompt volume increases.
- History serialization is likely fine for now, but it could become heavy if sessions approach the current cap consistently.

---

### `src/modelCatalog.ts`

#### What is good
- The file is compact and easy to read.
- Grouping models by provider is a good UX choice.
- Fallback labels are thoughtful and make the UI friendlier.

#### Concerns
- The list of model IDs is hardcoded.
- The cache-driven filtering can silently hide models if the local cache is incomplete.
- The file mixes catalog definition, cache lookup, and menu construction logic.
- There is no visible diagnostics if the cache is stale or malformed.

#### Refactoring suggestions
- Separate model data from rendering logic.
- Make cache behavior explicit in the UI or logs when models are filtered out.
- Consider a generated model registry or a data file rather than hardcoded arrays if the list changes often.
- Add a small fallback test for label resolution.

---

### `src/skillCatalog.ts`

#### What is good
- Simple and easy to understand.
- Alphabetical grouping is predictable.
- The directory scan model matches the on-disk skills structure well.

#### Concerns
- It is fully synchronous filesystem work on activation.
- YAML frontmatter parsing is done with regex, which is brittle.
- Errors are swallowed silently, which makes misconfigured skills hard to diagnose.
- The code assumes only a narrow subset of SKILL.md formatting.

#### Refactoring suggestions
- Consider a small frontmatter parser or a reusable markdown metadata parser.
- Log or surface parse failures in debug mode instead of swallowing everything.
- Cache the skill tree if reload performance starts to matter.
- Add tests for malformed frontmatter and missing descriptions.

---

### `src/webview/main.ts`

#### What is good
- The webview UI is feature-rich and clearly built with real usage in mind.
- `marked` + `DOMPurify` is the right general direction for markdown rendering inside a webview.
- The message handler is explicit and easy to trace.
- The code has enough comments to show the major pieces of state and UI behavior.
- The drag/drop, clipboard image, session picker, model picker, skills picker, and todo overlay features are all integrated into one consistent UI.

#### Concerns
- This is the second major monolith in the repo, and likely the most fragile file overall.
- It mixes:
  - DOM bootstrapping
  - state management
  - event handling
  - markdown rendering
  - menu composition
  - session history rendering
  - attachment handling
  - todo parsing
  - queue/busy state behavior
- There are many global mutable variables coordinating behavior across the whole file.
- The message handling logic has a lot of implicit coupling. It works, but it is difficult to modify safely.
- The code uses both immediate DOM mutation and debounced rendering. That is acceptable, but the control flow becomes hard to reason about under load.
- `detectTodoUpdate()` is a brittle fallback parser that searches for JSON inside arbitrary text.
- There are many direct `innerHTML` assignments, even if sanitized. That is a manageable risk, but still a maintenance burden.
- Non-null assertions on DOM elements are practical here, but they make the file more brittle if the template ever changes.

#### Refactoring suggestions
- Split into smaller browser-side modules:
  - state/store
  - renderers
  - menu builders
  - event handlers
  - markdown utilities
  - attachment utilities
- Move the message handling switch into named handler functions.
- Replace the mutable global state sprawl with a single state object or reducer-style store.
- Prefer explicit render functions over inline DOM manipulation in event handlers.
- Consider a lightweight UI framework only if the file keeps growing; if not, modular plain TypeScript is still fine.
- Replace the todo JSON sniffing with a structured payload if the extension host can provide one.
- Separate “compose state” from “render state.” Right now those are blended together.

#### Efficiency notes
- The current approach is probably fine for small to medium histories.
- Re-rendering markdown repeatedly on append is acceptable, but if conversation turns get long, the UI may become sluggish.
- The session picker and skills menu are rebuilt in full each time; that is fine for current data sizes, but it is not a long-term scaling strategy.

#### Readability notes
- `main.ts` is clear at the local level, but the global flow is hard to hold in your head.
- The code would read much better if each UI concern lived in its own file.
- The amount of shared mutable state is the biggest readability cost.

---

## Highest-priority refactors

If I were triaging refactors by value, I would do them in this order:

1. Split `src/webview/main.ts` into modules.
2. Split `src/chatPanel.ts` into a host-side controller plus smaller helpers.
3. Extract protocol parsing helpers from `src/sessionManager.ts`.
4. Replace manual config/frontmatter parsing with dedicated parsers or small utility helpers.
5. Add tests for the protocol parser and session deduplication logic.

---

## Bottom line

This is not convoluted code, but it is already reaching the point where the two big files are carrying too much responsibility. The design is practical and solid, yet the maintainability ceiling is visible. The next round of improvement should be about decomposition, typed boundaries, and removing brittle parsing logic — not adding more features on top of the current shape.
