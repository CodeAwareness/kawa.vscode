# CLAUDE.md — kawa.vscode

Guidance for Claude Code when working in this repository. Behavior rules only — see [README.md](./README.md) for user-facing docs.

**kawa.vscode** is the VSCode extension for Kawa Code. It surfaces peer code intersections, conflict highlights, and a "Peer Diffs" SCM view in the editor by talking to the Kawa Code desktop app over Unix sockets / Windows named pipes.

Published as `vscode-huggin` (publisher: `CodeAwareness`).

---

## Workflow — run on every non-trivial turn

Follow the standard Kawa Code workflow defined in the parent [Odin CLAUDE.md](../CLAUDE.md):

1. `check_active_intent` (kawa-intents MCP) — resume if one exists.
2. `get_relevant_context` with a task description.
3. Now explore code, read files, plan.
4. Create an intent when transitioning to actual code changes.
5. Before commit — `record_decision` for significant decisions.
6. After commit — `complete_intent` with the commit SHA and `status: "committed"`.

Use `repoOrigin: git@github.com:CodeAwareness/caw.vscode.git` and `repoPath: /Users/markvasile/Code/CodeAwareness/Odin/kawa.vscode`.

---

## Build & Development

```bash
yarn watch-web         # webpack --watch (development)
yarn compile-web       # one-shot dev build
yarn package           # production .vsix (runs prepare-prod.sh + webpack --mode production)
yarn lint              # eslint src --ext ts
yarn test              # vscode-test-web in headless Chromium
```

The extension is built with **webpack as a web extension** — both `main` and `browser` entry points resolve to `dist/web/extension.js`. Do not introduce Node-only APIs in `src/web/extension.ts` or any module it imports synchronously; the bundle must run in a browser worker.

`prepare-prod.sh` runs before production packaging. Inspect it before changing build outputs.

---

## Architecture

### Entry point
- `src/web/extension.ts` — VSCode `activate()` / `deactivate()` lifecycle. Registers commands, views, and the SCM provider.

### Library modules (`src/lib/`)
- `caw.ipc.ts` / `ipc.ts` — IPC client to Kawa Code desktop (Muninn). Newline-delimited JSON, platform-aware socket path discovery.
- `caw.editor.ts` — active editor tracking, sends file path changes to Muninn.
- `caw.deco.ts` — decoration manager (peer highlights, conflict overlays).
- `caw.scm.ts` — SCM provider (`scmProvider == cΩ`), drives the "Peer Diffs" view.
- `caw.tdp.ts` — TreeDataProvider for the explorer view.
- `caw.panel.ts` — webview panel host.
- `caw.repo.ts` / `caw.workspace.ts` — repo + workspace state.
- `caw.events.ts` — event dispatch wiring.
- `caw.store.ts` — in-memory state store.
- `i18n.ipc.ts` — IPC channel for the i18n extension domain.
- `locale.ts`, `settings.ts`, `logger.ts` — utilities.

### Commands (registered in `src/vscode/commands.ts`)
All commands are namespaced `caw.*` (e.g. `caw.toggle`, `caw.nextPeer`, `caw.openPeerFile`, `caw.translateToLanguage`). Keybindings live in `package.json` under `contributes.keybindings`.

---

## Socket / IPC discovery

The extension discovers Muninn's socket path in this order on macOS:
1. `~/.kawa-code/sockets/muninn` (current default, all platforms)
2. App Sandbox container (`~/Library/Containers/com.codeawareness.muninn/Data/Library/Application Support/Kawa Code/sockets`) — App Store builds
3. `~/Library/Application Support/Kawa Code/sockets` — non-sandboxed dev builds

Windows uses named pipes (`\\.\pipe\`). Linux uses `~/.kawa-code/sockets`.

When changing socket discovery, mirror changes to **kawa.emacs**, **kawa.vim**, and **kawa.intellij** — they all need the same fallback order.

---

## IPC message shape

All messages follow:
```ts
{
  flow: 'req' | 'res' | 'err' | 'brdc',
  domain: string,
  action: string,
  caw: string,        // client GUID
  data: any,
  _msgId?: string
}
```

Delimiter: `\n` (Huginn IPC server expects newline-delimited messages).

---

## Localization

- `package.nls.json` — default English strings.
- `package.nls.ja.json` — Japanese.
- Strings used in `package.json` are referenced as `%key%` and resolved by VSCode at runtime.

---

## Naming conventions

Outside `kawa.muninn` and `kawa.api`, refer to the desktop app as **"Kawa Code"** in user-facing strings, README, and command titles. `Muninn` is internal terminology.

The legacy command/extension namespace is `caw` (CodeAwareness) — keep using it; renaming would break user keybindings and SCM integration.

---

## Gotchas

- **Web extension constraint**: no `fs`, no `child_process`, no Node networking in `src/web/extension.ts` or its sync import graph. The IPC layer in `src/lib/ipc.ts` is the single allowed exception (loaded lazily / via the extension host bridge).
- **`activationEvents: onStartupFinished`**: the extension activates eagerly. Don't add heavy work to `activate()` — defer it.
- **`extensionKind: workspace`**: in remote / dev-container scenarios, the extension runs on the workspace host, not the local machine. IPC must reach Muninn on whichever side the user runs Kawa Code.
- **`.vsix` artifacts**: the repo contains historical `vscode-huggin-*.vsix` files. Don't commit new ones; let CI / `yarn package` produce them.
