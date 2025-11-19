# Fresh Plugin Development

Welcome to the Fresh plugin development guide! This document will walk you through the process of creating your own plugins for Fresh.

## Introduction

Fresh plugins are written in **TypeScript** and run in a sandboxed Deno environment. This provides a safe and modern development experience with access to a powerful set of APIs for extending the editor.

For the complete API reference, see **[Plugin API Reference](plugin-api.md)**.

## Getting Started: "Hello, World!"

Let's start by creating a simple "Hello, World!" plugin.

1.  **Create a new file:** Create a new TypeScript file in the `plugins/` directory (e.g., `my_plugin.ts`).
2.  **Add the following code:**

    ```typescript
    /// <reference path="../types/fresh.d.ts" />

    // Register a command that inserts text at the cursor
    globalThis.my_plugin_say_hello = function(): void {
      editor.insertAtCursor("Hello from my new plugin!\n");
      editor.setStatus("My plugin says hello!");
    };

    editor.registerCommand(
      "my_plugin_say_hello",
      "Inserts a greeting from my plugin",
      "my_plugin_say_hello",
      "normal"
    );

    editor.setStatus("My first plugin loaded!");
    ```

3.  **Run Fresh:**
    ```bash
    cargo run
    ```
4.  **Open the command palette:** Press `Ctrl+P` and search for "my_plugin_say_hello".
5.  **Run the command:** You should see the text "Hello from my new plugin!" inserted into the buffer.

## Core Concepts

### Plugin Lifecycle

Plugins are loaded automatically when Fresh starts. There is no explicit activation step. All `.ts` files in the `plugins/` directory are executed in the Deno environment.

### The `editor` Object

The global `editor` object is the main entry point for the Fresh plugin API. It provides methods for:
- Registering commands
- Reading and modifying buffers
- Adding visual overlays
- Spawning external processes
- Subscribing to editor events

### Commands

Commands are actions that can be triggered from the command palette or bound to keys. Register them with `editor.registerCommand()`:

```typescript
globalThis.my_action = function(): void {
  // Do something
};

editor.registerCommand(
  "my_command_name",      // Internal command name
  "Human readable desc",   // Description for command palette
  "my_action",            // Global function to call
  "normal"                // Context: "normal", "insert", "prompt", etc.
);
```

### Asynchronous Operations

Many API calls return `Promise`s. Use `async/await` to work with them:

```typescript
globalThis.search_files = async function(): Promise<void> {
  const result = await editor.spawnProcess("rg", ["TODO", "."]);
  if (result.exit_code === 0) {
    editor.setStatus(`Found matches`);
  }
};
```

### Event Handlers

Subscribe to editor events with `editor.on()`. Handlers must be global functions:

```typescript
globalThis.onSave = function(data: { buffer_id: number, path: string }): void {
  editor.debug(`Saved: ${data.path}`);
};

editor.on("buffer_save", "onSave");
```

**Available Events:**
- `buffer_save` - After a buffer is saved
- `buffer_closed` - When a buffer is closed
- `cursor_moved` - When cursor position changes
- `render_start` - Before screen renders
- `lines_changed` - When visible lines change (batched)

## Common Patterns

### Highlighting Text

Use overlays to highlight text without modifying content:

```typescript
globalThis.highlight_word = function(): void {
  const bufferId = editor.getActiveBufferId();
  const cursor = editor.getCursorPosition();

  // Highlight 5 bytes starting at cursor with yellow background
  editor.addOverlay(
    bufferId,
    "my_highlight:1",  // Unique ID (use prefix for batch removal)
    cursor,
    cursor + 5,
    255, 255, 0,       // RGB color
    false              // underline
  );
};

// Later, remove all highlights with the prefix
editor.removeOverlaysByPrefix(bufferId, "my_highlight:");
```

### Creating Results Panels

Display search results, diagnostics, or other structured data in a virtual buffer:

```typescript
globalThis.show_results = async function(): Promise<void> {
  // Define keybindings for the results panel
  editor.defineMode("my-results", "special", [
    ["Return", "my_goto_result"],
    ["q", "close_buffer"]
  ], true);

  // Create the panel with embedded metadata
  await editor.createVirtualBufferInSplit({
    name: "*Results*",
    mode: "my-results",
    read_only: true,
    entries: [
      {
        text: "src/main.rs:42: found match\n",
        properties: { file: "src/main.rs", line: 42 }
      },
      {
        text: "src/lib.rs:100: another match\n",
        properties: { file: "src/lib.rs", line: 100 }
      }
    ],
    ratio: 0.3,           // Panel takes 30% of height
    panel_id: "my-results" // Reuse panel if it exists
  });
};

// Handle "go to" when user presses Enter
globalThis.my_goto_result = function(): void {
  const bufferId = editor.getActiveBufferId();
  const props = editor.getTextPropertiesAtCursor(bufferId);

  if (props.length > 0 && props[0].file) {
    editor.openFile(props[0].file, props[0].line, 0);
  }
};

editor.registerCommand("my_goto_result", "Go to result", "my_goto_result", "my-results");
```

### Running External Commands

Use `spawnProcess` to run shell commands:

```typescript
globalThis.run_tests = async function(): Promise<void> {
  editor.setStatus("Running tests...");

  const result = await editor.spawnProcess("cargo", ["test"], null);

  if (result.exit_code === 0) {
    editor.setStatus("Tests passed!");
  } else {
    editor.setStatus(`Tests failed: ${result.stderr.split('\n')[0]}`);
  }
};
```

### File System Operations

Read and write files, check paths:

```typescript
globalThis.process_file = async function(): Promise<void> {
  const path = editor.getBufferPath(editor.getActiveBufferId());

  if (editor.fileExists(path)) {
    const content = await editor.readFile(path);
    const modified = content.replace(/TODO/g, "DONE");
    await editor.writeFile(path + ".processed", modified);
  }
};
```

## Example Plugins

The `plugins/` directory contains several example plugins:

- **`welcome.ts`** - Simple command registration and status messages
- **`todo_highlighter.ts`** - Uses overlays and hooks to highlight keywords efficiently
- **`git_grep.ts`** - Spawns external process and displays results in a virtual buffer

Study these examples to learn common patterns for Fresh plugin development.

## Plugin Utilities Library

The `plugins/lib/` directory provides reusable utilities that abstract common plugin patterns. Import them with:

```typescript
import { PanelManager, NavigationController, VirtualBufferFactory } from "@plugins/lib";
```

### PanelManager

Manages the lifecycle of result panels (open, close, update, toggle):

```typescript
import { PanelManager } from "@plugins/lib";

const panel = new PanelManager({
  name: "*Search Results*",
  mode: "search-results",
  panelId: "search",
  ratio: 0.3,
  keybindings: [
    ["Return", "search_goto"],
    ["q", "close_buffer"]
  ]
});

// Show results
await panel.open(entries);

// Update with new results
await panel.update(newEntries);

// Toggle visibility
await panel.toggle(entries);

// Check state
if (panel.isOpen()) { ... }
```

### NavigationController

Handles list navigation with selection tracking and visual highlighting:

```typescript
import { NavigationController } from "@plugins/lib";

const nav = new NavigationController({
  bufferId: myBufferId,
  highlightPrefix: "mylist",
  color: { r: 100, g: 100, b: 255 }
});

// Move selection
nav.moveUp();
nav.moveDown();
nav.moveToTop();
nav.moveToBottom();

// Get current selection
const index = nav.getSelectedIndex();
const location = nav.getSelectedLocation();

// Cleanup
nav.clearHighlights();
```

### VirtualBufferFactory

Simplified creation of virtual buffers with less boilerplate:

```typescript
import { VirtualBufferFactory } from "@plugins/lib";

const bufferId = await VirtualBufferFactory.create({
  name: "*Output*",
  mode: "output-mode",
  entries: [
    { text: "Line 1\n", properties: { id: 1 } },
    { text: "Line 2\n", properties: { id: 2 } }
  ],
  readOnly: true,
  ratio: 0.25,
  panelId: "output"
});
```

### Types

The library also exports common types:

```typescript
import type { RGB, Location, PanelOptions, NavigationOptions } from "@plugins/lib";
```

See the source files in `plugins/lib/` for full API details.

## Tips

- **Use TypeScript types**: Reference `types/fresh.d.ts` for autocomplete and type checking
- **Prefix overlay IDs**: Use `"myplugin:something"` format for easy batch removal
- **Handle errors**: Wrap async operations in try/catch
- **Be efficient**: Use batched events like `lines_changed` instead of per-keystroke handlers
- **Test incrementally**: Use `editor.debug()` to log values during development
