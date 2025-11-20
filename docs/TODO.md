## Clangd LSP Support Research

### VS Code `clangd` extension highlights

- **Command/feature layer** – commands like `clangd.restart`, `clangd.shutdown`, `clangd.projectConfig`, and `clangd.userConfig` mirror the restart and config workflows we already surface in Fresh (`Restart LSP Server` command exists, but there is no quick way to edit `.clangd` yet). In VS Code the extension also crowdsources status feedback (`clangd.openOutputPanel`, file-status via `textDocument/clangd.fileStatus`, `clangd.memoryUsage`, `clangd.typeHierarchy`, switch source/header) and installs the binary when missing (`@clangd/install` wrapper).
- **User-media features** – the extension registers hooks for `clangd.inactiveRegions`, `clangd.inlayHints` (falling back to custom request if the server is older), and exposes workarounds for completion ranking (filterText rewrites, commitCharacters removal). It also watches compile command files (`ConfigFileWatcherFeature`) to restart clangd when `compile_commands.json` changes.
- **Side panels** – tree views for memory usage and type hierarchy are driven by custom LSP requests (`$/memoryUsage`, `textDocument/typeHierarchy` + `typeHierarchy/resolve`). The file-status notification updates a status bar item on file switch, and there is a “switch source/header” command implemented through `textDocument/switchSourceHeader`.

### Fresh baseline

- Core: `config.rs` already maps `c`/`cpp` to `clangd` + empty args; `AsyncBridge` and `LspAsync` implement diagnostics, hover, completion, code actions, inlay hints (3.17) requests, progress, etc. `commands.rs` exposes diagnostics/navigation/rename/restart actions referenced by tests in `tests/`. The main loop renders a combined `lsp_status` string in `ui/status_bar.rs`.
- Plugins: Fresh supports TypeScript plugins per `docs/PLUGIN_DEVELOPMENT.md`. There is no TypeScript plugin yet that understands additional clangd notifications (file-status, type hierarchy, config watch) or exposes new UI elements beyond overlays/virtual buffers.

### Identified gaps (Fresh vs. VS Code extension)

1. **File-status / diagnostics UI** – clangd sends `textDocument/clangd.fileStatus`, but Fresh only shows diagnostics; no per-file status data is surfaced. We could treat this as a lightweight status indicator or even emit new control events for plugins to listen to (cf. `control_event.rs` events for `containers`).
2. **Config watcher + restart prompt** – VS Code watches `compile_commands.json`/`compile_flags.txt`. Fresh already has restart plumbing, so a plugin that registers file-system watchers (using `editor.spawnProcess` or Deno FS ops) could prompt or auto-restart LSP when compile database files change.
3. **Type hierarchy & memory usage** – Both are tree views backed by custom clangd extensions. Fresh doesn’t yet expose tree panels, but plugins can create virtual buffers/modes with `plugins/lib/PanelManager`. A new plugin could issue custom LSP requests via a new API hook (we’d need to extend Async bridge to route those from plugin commands to the LSP manager).
4. **Switch source/header** – VS Code uses `textDocument/switchSourceHeader`. Fresh already tracks buffer paths, so supporting a command (with plugin or core action) that requests this custom RPC and opens the returned URI would provide parity.
5. **Inactive regions & inlay hint fallbacks** – Not all clangd servers support the standard `textDocument/inlayHint` yet. Fresh already implements LSP 3.17 inlay hints, but we might need an escape hatch (custom request) for older clangd releases, similar to VS Code’s plugin, to maintain inlay hint support on servers that only expose `clangd/inlayHints`.
6. **Binary management & config editing** – VS Code wraps `@clangd/install`. For Fresh, the `config.json` allows overriding the command, but we could still offer a plugin command to open `.clangd` or warn when `clangd` is missing. Watchers could help detect missing compile databases.
7. **Completion ranking workaround** – VS Code’s middleware rewrites `filterText`, removes commit characters, and triggers parameter hints after snippet completion. Fresh doesn’t need re-ranking but should ensure we suppress problematic commit characters; investigating our LSP completion middleware (if any) is still needed.

### Research conclusions & next checkpoints

1. **Document new plugin targets** – Fresh’s plugin API is strong enough to mimic file-status indicators (status bar overlays), config watchers (FS watchers via `editor.readDir`/`readFile` + events), switch source/header (issue new LSP request via core command), and type hierarchy/memory usage views (virtual buffers + custom commands). `docs/PLUGIN_DEVELOPMENT.md` and `plugins/examples` provide the scaffolding for panel management and keybindings.
2. **Specify core IPC hooks** – To call new clangd-specific requests (`textDocument/switchSourceHeader`, `textDocument/typeHierarchy`, `$/memoryUsage`, `textDocument/clangd.fileStatus`, config-change notifications) we must extend `lsp_async.rs`/`async_bridge.rs` to forward those responses as `AsyncMessage` variants. Those variants can then be consumed by the editor or plugin layer (via new control events or plugin hooks).
3. **Plan for plugin vs core split** – Keep status bar rendering, restart command, and LSP restarts in core, but implement features requiring extra UI (memory tree, type hierarchy, config opening) as TypeScript plugins hosted in `plugins/`. Plugins can reuse `plugins/lib/` utilities (panels, navigation). Start by prototyping a `plugins/clangd_status.ts` that listens for new events exposed by the core and registers commands such as `clangd.switchHeader`/`clangd.openConfig`.
4. **Testing & docs** – Extend LSP tests (tests/e2e/lsp.rs) to cover new async messages (file status, switch header). Document the plugin(s) and new config knobs in `docs/USER_GUIDE.md`. Mention new CLI commands (for plugin commands) in `docs/TODO.md`.

### Next steps (once implementation begins)

- Extend `lsp_async.rs` and `async_bridge.rs` to support the additional clangd notification/request flavors.
- Add editor-side commands (similar to `commands.rs` entries) that plugin(s) can invoke.
- Build the TypeScript plugin(s) under `plugins/`, referencing `plugins/README.md` and existing examples for panels and overlays.
- Update docs (e.g., `docs/USER_GUIDE.md`) with usage notes for the new clangd features and plugin commands.
