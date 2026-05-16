# Implementation Guide: "Add File to Chat" Right-Click Context Menu

This guide provides a comprehensive breakdown of how to implement a "Add File to Chat" right-click contextual menu feature, based on the implementation found in the vscode-copilot-chat module.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites & Dependencies](#prerequisites--dependencies)
3. [Core Functions](#core-functions)
4. [Package.json Configuration](#packagejson-configuration)
5. [TypeScript Implementation](#typescript-implementation)
6. [Data Flow](#data-flow)
7. [Testing](#testing)
8. [Complete Example](#complete-example)

---

## Architecture Overview

The implementation consists of three main components:

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌─────────────────────────────────┐  │
│  │  package.json    │  │  TypeScript Code                │  │
│  │  (Menu Reg.)     │  │                                 │  │
│  └────────┬─────────┘  └──────────────┬──────────────────┘  │
│           │                           │                      │
│           ▼                           ▼                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Command Handler (addFileReference)           │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Session Manager / HTTP Server                │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│           ┌───────────────┴───────────────┐                  │
│           ▼                               ▼                  │
│  ┌─────────────────┐           ┌─────────────────┐          │
│  │  CLI Session    │           │  Session Store  │          │
│  │  Tracker        │           │                 │          │
│  └─────────────────┘           └─────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites & Dependencies

### Required TypeScript Interfaces

```typescript
// Session Tracker Interface
export interface ICopilotCLISessionTracker {
  asTracker(): ICopilotCLISessionTracker;
  getConnectedSessionIds(): string[];
  setConnectedSessionIds(ids: string[]): void;
  getSessions(): Map<string, { sessionId: string; name: string }>;
  getSessionName(sessionId: string): string;
  setSessionName(sessionId: string, name: string): void;
}

// Session Info Interface
export interface CopilotCLISessionInfo {
  sessionId: string;
  name: string;
}

// Logger Interface
export interface ILogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
}

// HTTP Server Interface
export interface InProcHttpServer {
  sendNotification(
    sessionId: string,
    notificationName: string,
    data: Record<string, unknown>
  ): void;
  setConnectedSessionIds(ids: string[]): void;
}
```

---

## Core Functions

### 1. File Reference Data Interface

```typescript
/**
 * Represents the file reference data to be sent to a CLI session.
 */
export interface FileReferenceInfo {
  filePath: string;
  fileUrl: string;
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null;
  selectedText: string | null;
}
```

### 2. Selection Info Helper

```typescript
/**
 * Retrieves selection information from the active text editor.
 */
export function getSelectionInfo(editor: vscode.TextEditor): {
  filePath: string;
  fileUrl: string;
  selection: vscode.Range;
  text: string;
} {
  const uri = editor.document.uri;
  const selection = editor.selection;
  const text = editor.document.getText(selection);
  
  return {
    filePath: uri.fsPath,
    fileUrl: uri.toString(),
    selection,
    text,
  };
}
```

### 3. URI Scheme Validator

```typescript
/**
 * URI schemes that represent real file-system files and can be sent to CLI sessions.
 */
const ALLOWED_SCHEMES = new Set(['file']);

/**
 * Validates URI scheme and shows warning if not allowed.
 * Returns true if allowed, false otherwise.
 */
export function validateScheme(logger: ILogger, uri: vscode.Uri): boolean {
  if (ALLOWED_SCHEMES.has(uri.scheme)) {
    return true;
  }
  logger.debug(`Unsupported URI scheme: ${uri.scheme}`);
  vscode.window.showWarningMessage(l10n.t('Cannot send virtual files to Copilot CLI.'));
  return false;
}
```

### 4. Session Picker

```typescript
/**
 * Picks a session (if needed) and returns the selected session ID.
 */
export async function pickSession(
  logger: ILogger,
  httpServer: InProcHttpServer,
  sessionTracker: ICopilotCLISessionTracker
): Promise<string | undefined> {
  const connectedSessions = httpServer.getConnectedSessionIds();
  
  if (connectedSessions.length === 0) {
    vscode.window.showWarningMessage(l10n.t('No Copilot CLI sessions are connected.'));
    return undefined;
  }
  
  if (connectedSessions.length === 1) {
    return connectedSessions[0];
  }
  
  const sessions = connectedSessions.map((id) => {
    const session = sessionTracker.getSessions().get(id);
    const name = session?.name || id;
    return {
      label: name,
      description: id,
      sessionId: id,
    };
  });
  
  const selected = await vscode.window.showQuickPick(sessions, {
    placeHolder: 'Select a Copilot CLI session',
  });
  
  return selected?.sessionId;
}
```

### 5. Send to Session

```typescript
/**
 * Picks a session (if needed) and sends a file reference notification.
 */
export async function sendToSession(
  logger: ILogger,
  httpServer: InProcHttpServer,
  sessionTracker: ICopilotCLISessionTracker,
  fileReferenceInfo: FileReferenceInfo
): Promise<void> {
  const sessionId = await pickSession(logger, httpServer, sessionTracker);
  if (!sessionId) {
    return;
  }
  
  logger.info(`Sending context to session ${sessionId}: ${fileReferenceInfo.filePath}`);
  httpServer.sendNotification(
    sessionId,
    'add_file_reference',
    fileReferenceInfo as unknown as Record<string, unknown>
  );
}
```

### 6. Send URI to Session (Explorer Context Menu)

```typescript
/**
 * Sends a file reference (from explorer URI) to a CLI session.
 */
export async function sendUriToSession(
  logger: ILogger,
  httpServer: InProcHttpServer,
  sessionTracker: ICopilotCLISessionTracker,
  uri: vscode.Uri
): Promise<void> {
  if (!validateScheme(logger, uri)) {
    return;
  }
  
  await sendToSession(logger, httpServer, sessionTracker, {
    filePath: uri.fsPath,
    fileUrl: uri.toString(),
    selection: null,
    selectedText: null,
  });
}
```

### 7. Send Editor Context to Session

```typescript
/**
 * Sends editor context (file + optional selection) to a CLI session.
 */
export async function sendEditorContextToSession(
  logger: ILogger,
  httpServer: InProcHttpServer,
  sessionTracker: ICopilotCLISessionTracker
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    logger.debug('No active editor');
    vscode.window.showWarningMessage(l10n.t('No active editor. Open a file to add a reference.'));
    return;
  }
  
  if (!validateScheme(logger, editor.document.uri)) {
    return;
  }
  
  const selectionInfo = getSelectionInfo(editor);
  
  await sendToSession(logger, httpServer, sessionTracker, {
    filePath: selectionInfo.filePath,
    fileUrl: selectionInfo.fileUrl,
    selection: selectionInfo.selection.isEmpty
      ? null
      : {
          start: selectionInfo.selection.start,
          end: selectionInfo.selection.end,
        },
    selectedText: selectionInfo.selection.isEmpty ? null : selectionInfo.text,
  });
}
```

---

## Package.json Configuration

### Menu Registration (setContextCommand)

```json
{
  "contributes": {
    "commands": [
      {
        "command": "github.copilot.chat.copilotCLI.addFileReference",
        "title": "Add File to Copilot CLI",
        "category": "GitHub Copilot"
      }
    ],
    "menus": {
      "setContextCommand": [
        {
          "key": "ctrl+shift+.",
          "command": "github.copilot.chat.copilotCLI.addFileReference",
          "args": [
            {
              "contextKey": "file",
              "contextKeyScopes": [
                { "contextKey": "filesExplorer", "contextKeyValue": true },
                { "contextKey": "filesExplorerFocus", "contextKeyValue": true }
              ]
            },
            {
              "contextKey": "file",
              "contextKeyScopes": [
                { "contextKey": "filesExplorer", "contextKeyValue": true },
                { "contextKey": "filesExplorerFocus", "contextKeyValue": true }
              ]
            }
          ],
          "title": "%github.copilot.command.chat.copilotCLI.addFileReference%",
          "enablement": "github.copilot.chat.copilotCLI.hasSession"
        }
      ]
    }
  }
}
```

### Context Menu Group (Alternative Registration)

```json
{
  "menus": {
    "context": [
      {
        "command": "github.copilot.chat.copilotCLI.addFileReference",
        "when": "resourceExplorerFocus && github.copilot.chat.copilotCLI.hasSession",
        "group": "copilot@1"
      },
      {
        "command": "github.copilot.chat.copilotCLI.addFileReference",
        "when": "editorHasSelection && github.copilot.chat.copilotCLI.hasSession",
        "group": "copilot@2"
      },
      {
        "command": "github.copilot.chat.copilotCLI.addFileReference",
        "when": "editorTextFocus && !editorHasSelection && github.copilot.chat.copilotCLI.hasSession",
        "group": "copilot@3"
      }
    ]
  }
}
```

### Translation (package.nls.json)

```json
{
  "github.copilot.command.cli.openInCopilotCLI": "Open in GitHub Copilot CLI",
  "github.copilot.command.chat.copilotCLI.addFileReference": "Add File to Copilot CLI",
  "github.copilot.command.chat.copilotCLI.addSelection": "Add Selection to Copilot CLI",
  "github.copilot.command.chat.copilotCLI.addFile": "Add File to Copilot CLI",
  "github.copilot.command.chat.copilotCLI.addFileWithSelection": "Add File with Selection to Copilot CLI"
}
```

---

## TypeScript Implementation

### Main Command Registration

```typescript
/**
 * Registers the Add File Reference command.
 */
export function registerAddFileReferenceCommand(
  logger: ILogger,
  httpServer: InProcHttpServer,
  sessionTracker: ICopilotCLISessionTracker
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'github.copilot.chat.copilotCLI.addFileReference',
    async (uri?: vscode.Uri) => {
      logger.debug('Add file reference command executed');

      if (uri) {
        await sendUriToSession(logger, httpServer, sessionTracker, uri);
      } else {
        await sendEditorContextToSession(logger, httpServer, sessionTracker);
      }
    }
  );
}
```

### Extension Entry Point (Partial)

```typescript
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger();
  const httpServer = new InProcHttpServer();
  const sessionTracker = new CopilotCLISessionTracker();
  
  // Register the add file reference command
  const addFileDisposable = registerAddFileReferenceCommand(
    logger,
    httpServer,
    sessionTracker
  );
  
  context.subscriptions.push(addFileDisposable);
  
  // ... other command registrations
}
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          User Action                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. User Right-Clicks File in Explorer                                   │
│     │                                                                    │
│     ▼                                                                    │
│  2. VS Code Shows Context Menu                                           │
│     │                                                                    │
│     ▼                                                                    │
│  3. User Selects "Add File to Copilot CLI"                              │
│     │                                                                    │
│     ▼                                                                    │
│  4. Command Triggered: github.copilot.chat.copilotCLI.addFileReference  │
│     │                                                                    │
│     └──────────► (uri: vscode.Uri passed as argument)                    │
│     │                                                                    │
│     ▼                                                                    │
│  5. Command Handler Executed                                            │
│     │                                                                    │
│     └──► uri ? sendUriToSession() : sendEditorContextToSession()        │
│     │                                                                    │
│     ▼                                                                    │
│  6. sendUriToSession() Called                                           │
│     │                                                                    │
│     ├──► validateScheme() ✓                                             │
│     │                                                                    │
│     └──► sendToSession()                                                │
│         │                                                                │
│         ├──► pickSession()                                              │
│         │   │                                                            │
│         │   ├──► 0 sessions ─► showWarningMessage()                     │
│         │   │                                                            │
│         │   ├──► 1 session ─► return session ID                         │
│         │   │                                                            │
│         │   └──► >1 sessions ─► showQuickPick()                         │
│         │                                                                    │
│         └──► httpServer.sendNotification(sessionId, ...)                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Testing

### Unit Test Example

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendUriToSession, validateScheme } from './sendContext';
import { InProcHttpServer } from '../inProcHttpServer';

describe('sendUriToSession', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
  
  const mockHttpServer = {
    sendNotification: vi.fn(),
    setConnectedSessionIds: vi.fn(),
  };
  
  const mockSessionTracker = {
    getConnectedSessionIds: vi.fn(),
    getSessions: vi.fn(),
    getSessionName: vi.fn(),
    setSessionName: vi.fn(),
  };
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should send file reference from URI (explorer context menu)', async () => {
    const uri = {
      fsPath: '/test/explorer-file.ts',
      scheme: 'file',
      toString: () => 'file:///test/explorer-file.ts',
    };
    
    await sendUriToSession(mockLogger, mockHttpServer, mockSessionTracker, uri);
    
    expect(mockHttpServer.sendNotification).toHaveBeenCalledWith(
      'session-1',
      'add_file_reference',
      expect.objectContaining({
        filePath: '/test/explorer-file.ts',
        fileUrl: 'file:///test/explorer-file.ts',
        selection: null,
        selectedText: null,
      })
    );
  });
  
  it('should show warning when no active editor and no URI', async () => {
    // Test case for sendEditorContextToSession
    // When no editor and no URI is provided
  });
  
  it('should include selection info when text is selected', async () => {
    // Test case with editor selection
    // Verify selection is included in notification
  });
});
```

---

## Complete Example

### File: `src/extension/chatSessions/copilotcli/vscode-node/commands/addFileReference.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogger } from '../../../../../platform/log/common/logService';
import { ICopilotCLISessionTracker } from '../copilotCLISessionTracker';
import { InProcHttpServer } from '../inProcHttpServer';
import { sendEditorContextToSession, sendUriToSession } from './sendContext';

export const ADD_FILE_REFERENCE_COMMAND = 'github.copilot.chat.copilotCLI.addFileReference';

export function registerAddFileReferenceCommand(
  logger: ILogger,
  httpServer: InProcHttpServer,
  sessionTracker: ICopilotCLISessionTracker
): vscode.Disposable {
  return vscode.commands.registerCommand(ADD_FILE_REFERENCE_COMMAND, async (uri?: vscode.Uri) => {
    logger.debug('Add file reference command executed');

    if (uri) {
      await sendUriToSession(logger, httpServer, sessionTracker, uri);
    } else {
      await sendEditorContextToSession(logger, httpServer, sessionTracker);
    }
  });
}
```

### File: `src/extension/chatSessions/copilotcli/vscode-node/commands/sendContext.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ILogger } from '../../../../../platform/log/common/logService';
import { Schemas } from '../../../../../util/vs/base/common/network';
import { ICopilotCLISessionTracker } from '../copilotCLISessionTracker';
import { InProcHttpServer } from '../inProcHttpServer';
import { getSelectionInfo } from '../tools';
import { pickSession } from './pickSession';

export interface FileReferenceInfo {
  filePath: string;
  fileUrl: string;
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null;
  selectedText: string | null;
}

export const ADD_FILE_REFERENCE_NOTIFICATION = 'add_file_reference';

/**
 * URI schemes that represent real file-system files and can be sent to CLI sessions.
 */
const ALLOWED_SCHEMES = new Set([Schemas.file]);

/**
 * Validates URI scheme and shows warning if not allowed.
 * Returns true if allowed, false otherwise.
 */
function validateScheme(logger: ILogger, uri: vscode.Uri): boolean {
  if (ALLOWED_SCHEMES.has(uri.scheme)) {
    return true;
  }
  logger.debug(`Unsupported URI scheme: ${uri.scheme}`);
  vscode.window.showWarningMessage(l10n.t('Cannot send virtual files to Copilot CLI.'));
  return false;
}

/**
 * Picks a session (if needed) and sends a file reference notification.
 */
export async function sendToSession(
  logger: ILogger,
  httpServer: InProcHttpServer,
  sessionTracker: ICopilotCLISessionTracker,
  fileReferenceInfo: FileReferenceInfo
): Promise<void> {
  const sessionId = await pickSession(logger, httpServer, sessionTracker);
  if (!sessionId) {
    return;
  }

  logger.info(`Sending context to session ${sessionId}: ${fileReferenceInfo.filePath}`);
  httpServer.sendNotification(sessionId, ADD_FILE_REFERENCE_NOTIFICATION, fileReferenceInfo as unknown as Record<string, unknown>);
}

/**
 * Sends a file reference (from explorer URI) to a CLI session.
 */
export async function sendUriToSession(
  logger: ILogger,
  httpServer: InProcHttpServer,
  sessionTracker: ICopilotCLISessionTracker,
  uri: vscode.Uri
): Promise<void> {
  if (!validateScheme(logger, uri)) {
    return;
  }

  await sendToSession(logger, httpServer, sessionTracker, {
    filePath: uri.fsPath,
    fileUrl: uri.toString(),
    selection: null,
    selectedText: null,
  });
}

/**
 * Sends editor context (file + optional selection) to a CLI session.
 */
export async function sendEditorContextToSession(
  logger: ILogger,
  httpServer: InProcHttpServer,
  sessionTracker: ICopilotCLISessionTracker
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    logger.debug('No active editor');
    vscode.window.showWarningMessage(l10n.t('No active editor. Open a file to add a reference.'));
    return;
  }

  if (!validateScheme(logger, editor.document.uri)) {
    return;
  }

  const selectionInfo = getSelectionInfo(editor);

  await sendToSession(logger, httpServer, sessionTracker, {
    filePath: selectionInfo.filePath,
    fileUrl: selectionInfo.fileUrl,
    selection: selectionInfo.selection.isEmpty
      ? null
      : {
          start: selectionInfo.selection.start,
          end: selectionInfo.selection.end,
        },
    selectedText: selectionInfo.selection.isEmpty ? null : selectionInfo.text,
  });
}
```

---

## Key Concepts Summary

| Concept | Description |
|---------|-------------|
| `setContextCommand` | VS Code API for registering context menu items via commands |
| `contextKeyScopes` | Conditions under which the menu item appears |
| `args` | Optional arguments passed to the command based on context |
| `enablement` | Expression that determines when the command is enabled |
| `pickSession` | Helper to select a session when multiple are connected |
| `validateScheme` | Ensures only real files (not virtual) are sent |

---

## Quick Start Checklist

1. ✅ Create TypeScript files for command handlers
2. ✅ Register commands in extension entry point
3. ✅ Define menu items in `package.json` using `setContextCommand`
4. ✅ Add translations in `package.nls.json`
5. ✅ Implement session tracking logic
6. ✅ Add unit tests for all functions
7. ✅ Test with multiple sessions connected
8. ✅ Verify menu appears in Files Explorer context menu

---

## Notes

- This implementation requires a backend server (CLI session) to receive the file references
- The `pickSession` function handles multiple session selection
- Virtual files (output, debug, etc.) are blocked by scheme validation
- The menu item shows in Files Explorer when at least one CLI session is connected