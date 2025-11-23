/// <reference path="../types/fresh.d.ts" />

/**
 * Git Blame Plugin - Magit-style Git Blame Interface
 *
 * Provides an interactive git blame view with:
 * - Header lines above every block of text showing the origin commit
 * - 'b' to go back in history (show blame at parent commit)
 * - 'q' to close the virtual buffer
 *
 * Inspired by magit's git-blame-additions feature.
 */

// =============================================================================
// Types and Interfaces
// =============================================================================

interface BlameLine {
  hash: string;
  shortHash: string;
  author: string;
  authorTime: string;      // Unix timestamp
  relativeDate: string;
  summary: string;
  lineNumber: number;      // Original line number
  finalLineNumber: number; // Final line number in the file
  content: string;
}

interface BlameBlock {
  hash: string;
  shortHash: string;
  author: string;
  relativeDate: string;
  summary: string;
  lines: BlameLine[];
  startLine: number;
  endLine: number;
}

interface BlameState {
  isOpen: boolean;
  bufferId: number | null;
  splitId: number | null;
  sourceBufferId: number | null;  // The buffer that was open before blame
  sourceFilePath: string | null;  // Path to the file being blamed
  currentCommit: string | null;   // Current commit being viewed (null = HEAD)
  commitStack: string[];          // Stack of commits for navigation
  blocks: BlameBlock[];
  cachedContent: string;
}

// =============================================================================
// State Management
// =============================================================================

const blameState: BlameState = {
  isOpen: false,
  bufferId: null,
  splitId: null,
  sourceBufferId: null,
  sourceFilePath: null,
  currentCommit: null,
  commitStack: [],
  blocks: [],
  cachedContent: "",
};

// =============================================================================
// Color Definitions
// =============================================================================

const colors = {
  hash: [255, 180, 50] as [number, number, number],        // Yellow/Orange
  author: [100, 200, 255] as [number, number, number],     // Cyan
  date: [150, 255, 150] as [number, number, number],       // Green
  summary: [200, 200, 200] as [number, number, number],    // Light gray
  header: [180, 140, 220] as [number, number, number],     // Purple for headers
  headerBg: [40, 35, 50] as [number, number, number],      // Dark purple bg
  content: [220, 220, 220] as [number, number, number],    // White-ish
  separator: [80, 80, 80] as [number, number, number],     // Dark gray
};

// =============================================================================
// Mode Definition
// =============================================================================

editor.defineMode(
  "git-blame",
  "normal", // inherit from normal mode for cursor movement
  [
    ["b", "git_blame_go_back"],
    ["q", "git_blame_close"],
    ["Escape", "git_blame_close"],
    ["y", "git_blame_copy_hash"],
  ],
  true // read-only
);

// =============================================================================
// Git Blame Parsing
// =============================================================================

/**
 * Parse git blame --porcelain output
 * Format:
 *   <hash> <orig-line> <final-line> [num-lines]
 *   author <name>
 *   author-mail <email>
 *   author-time <timestamp>
 *   author-tz <tz>
 *   committer <name>
 *   committer-mail <email>
 *   committer-time <timestamp>
 *   committer-tz <tz>
 *   summary <commit message>
 *   [previous <hash> <filename>]
 *   filename <filename>
 *   \t<content>
 */
async function fetchGitBlame(filePath: string, commit: string | null): Promise<BlameLine[]> {
  const args = ["blame", "--porcelain"];

  if (commit) {
    args.push(commit);
  }

  args.push("--", filePath);

  const result = await editor.spawnProcess("git", args);

  if (result.exit_code !== 0) {
    editor.setStatus(`Git blame error: ${result.stderr}`);
    return [];
  }

  const lines: BlameLine[] = [];
  const output = result.stdout;
  const outputLines = output.split("\n");

  let currentHash = "";
  let currentAuthor = "";
  let currentAuthorTime = "";
  let currentSummary = "";
  let currentOrigLine = 0;
  let currentFinalLine = 0;

  // Cache for commit info to avoid redundant parsing
  const commitInfo: Map<string, { author: string; authorTime: string; summary: string }> = new Map();

  for (let i = 0; i < outputLines.length; i++) {
    const line = outputLines[i];

    // Check for commit line: <hash> <orig-line> <final-line> [num-lines]
    const commitMatch = line.match(/^([a-f0-9]{40}) (\d+) (\d+)/);
    if (commitMatch) {
      currentHash = commitMatch[1];
      currentOrigLine = parseInt(commitMatch[2], 10);
      currentFinalLine = parseInt(commitMatch[3], 10);

      // Check cache for this commit's info
      const cached = commitInfo.get(currentHash);
      if (cached) {
        currentAuthor = cached.author;
        currentAuthorTime = cached.authorTime;
        currentSummary = cached.summary;
      }
      continue;
    }

    // Parse header fields
    if (line.startsWith("author ")) {
      currentAuthor = line.slice(7);
      continue;
    }
    if (line.startsWith("author-time ")) {
      currentAuthorTime = line.slice(12);
      continue;
    }
    if (line.startsWith("summary ")) {
      currentSummary = line.slice(8);
      // Cache this commit's info
      commitInfo.set(currentHash, {
        author: currentAuthor,
        authorTime: currentAuthorTime,
        summary: currentSummary,
      });
      continue;
    }

    // Content line (starts with tab)
    if (line.startsWith("\t")) {
      const content = line.slice(1);

      // Calculate relative date from author-time
      const relativeDate = formatRelativeDate(parseInt(currentAuthorTime, 10));

      lines.push({
        hash: currentHash,
        shortHash: currentHash.slice(0, 7),
        author: currentAuthor,
        authorTime: currentAuthorTime,
        relativeDate: relativeDate,
        summary: currentSummary,
        lineNumber: currentOrigLine,
        finalLineNumber: currentFinalLine,
        content: content,
      });
    }
  }

  return lines;
}

/**
 * Format a unix timestamp as a relative date string
 */
function formatRelativeDate(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) {
    return "just now";
  } else if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    return `${mins} minute${mins > 1 ? "s" : ""} ago`;
  } else if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  } else if (diff < 604800) {
    const days = Math.floor(diff / 86400);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  } else if (diff < 2592000) {
    const weeks = Math.floor(diff / 604800);
    return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  } else if (diff < 31536000) {
    const months = Math.floor(diff / 2592000);
    return `${months} month${months > 1 ? "s" : ""} ago`;
  } else {
    const years = Math.floor(diff / 31536000);
    return `${years} year${years > 1 ? "s" : ""} ago`;
  }
}

/**
 * Group blame lines into blocks by commit
 */
function groupIntoBlocks(lines: BlameLine[]): BlameBlock[] {
  const blocks: BlameBlock[] = [];
  let currentBlock: BlameBlock | null = null;

  for (const line of lines) {
    // Check if we need to start a new block
    if (!currentBlock || currentBlock.hash !== line.hash) {
      // Save previous block
      if (currentBlock && currentBlock.lines.length > 0) {
        blocks.push(currentBlock);
      }

      // Start new block
      currentBlock = {
        hash: line.hash,
        shortHash: line.shortHash,
        author: line.author,
        relativeDate: line.relativeDate,
        summary: line.summary,
        lines: [],
        startLine: line.finalLineNumber,
        endLine: line.finalLineNumber,
      };
    }

    currentBlock.lines.push(line);
    currentBlock.endLine = line.finalLineNumber;
  }

  // Don't forget the last block
  if (currentBlock && currentBlock.lines.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks;
}

// =============================================================================
// View Building
// =============================================================================

/**
 * Format a header line for a blame block
 */
function formatBlockHeader(block: BlameBlock): string {
  // Truncate summary if too long
  const maxSummaryLen = 60;
  const summary = block.summary.length > maxSummaryLen
    ? block.summary.slice(0, maxSummaryLen - 3) + "..."
    : block.summary;

  return `── ${block.shortHash} (${block.author}, ${block.relativeDate}) "${summary}" ──\n`;
}

/**
 * Build text property entries for the blame view
 */
function buildBlameEntries(): TextPropertyEntry[] {
  const entries: TextPropertyEntry[] = [];

  // Title header
  const fileName = blameState.sourceFilePath
    ? editor.pathBasename(blameState.sourceFilePath)
    : "file";
  const commitRef = blameState.currentCommit
    ? blameState.currentCommit.slice(0, 7)
    : "HEAD";

  entries.push({
    text: `Git Blame: ${fileName} @ ${commitRef}\n`,
    properties: { type: "title" },
  });

  entries.push({
    text: `\n`,
    properties: { type: "blank" },
  });

  if (blameState.blocks.length === 0) {
    entries.push({
      text: "  No blame information available\n",
      properties: { type: "empty" },
    });
  } else {
    // Add each block with header
    for (const block of blameState.blocks) {
      // Add header line for this block
      entries.push({
        text: formatBlockHeader(block),
        properties: {
          type: "block-header",
          hash: block.hash,
          shortHash: block.shortHash,
          author: block.author,
          relativeDate: block.relativeDate,
          summary: block.summary,
        },
      });

      // Add each content line
      for (const line of block.lines) {
        entries.push({
          text: `${line.content}\n`,
          properties: {
            type: "content",
            hash: line.hash,
            lineNumber: line.finalLineNumber,
          },
        });
      }
    }
  }

  // Footer with help
  entries.push({
    text: `\n`,
    properties: { type: "blank" },
  });

  const stackDepth = blameState.commitStack.length;
  const backInfo = stackDepth > 0 ? ` | depth: ${stackDepth}` : "";
  entries.push({
    text: `${blameState.blocks.length} blocks | ↑/↓/j/k: navigate | b: blame at parent | y: yank hash | q: close${backInfo}\n`,
    properties: { type: "footer" },
  });

  return entries;
}

/**
 * Helper to extract content string from entries
 */
function entriesToContent(entries: TextPropertyEntry[]): string {
  return entries.map(e => e.text).join("");
}

/**
 * Apply syntax highlighting to the blame view
 */
function applyBlameHighlighting(): void {
  if (blameState.bufferId === null) return;

  const bufferId = blameState.bufferId;
  editor.clearNamespace(bufferId, "gitblame");

  const content = blameState.cachedContent;
  if (!content) return;

  const lines = content.split("\n");
  let byteOffset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineStart = byteOffset;
    const lineEnd = byteOffset + line.length;

    // Highlight title line
    if (lineIdx === 0 && line.startsWith("Git Blame:")) {
      editor.addOverlay(
        bufferId,
        "gitblame",
        lineStart,
        lineEnd,
        colors.header[0],
        colors.header[1],
        colors.header[2],
        true,  // underline
        true,  // bold
        false  // italic
      );
      byteOffset += line.length + 1;
      continue;
    }

    // Highlight block headers (lines starting with ──)
    if (line.startsWith("──")) {
      // Header background/style
      editor.addOverlay(
        bufferId,
        "gitblame",
        lineStart,
        lineEnd,
        colors.header[0],
        colors.header[1],
        colors.header[2],
        false,  // underline
        true,   // bold
        false   // italic
      );

      // Try to highlight individual parts
      // Format: ── <hash> (<author>, <date>) "<summary>" ──
      const hashMatch = line.match(/── ([a-f0-9]{7})/);
      if (hashMatch) {
        const hashStart = lineStart + line.indexOf(hashMatch[1]);
        editor.addOverlay(
          bufferId,
          "gitblame",
          hashStart,
          hashStart + 7,
          colors.hash[0],
          colors.hash[1],
          colors.hash[2],
          false,
          true,
          false
        );
      }

      // Highlight author name (between ( and ,)
      const authorMatch = line.match(/\(([^,]+),/);
      if (authorMatch) {
        const authorStart = lineStart + line.indexOf("(" + authorMatch[1]) + 1;
        editor.addOverlay(
          bufferId,
          "gitblame",
          authorStart,
          authorStart + authorMatch[1].length,
          colors.author[0],
          colors.author[1],
          colors.author[2],
          false,
          false,
          false
        );
      }

      // Highlight summary (text in quotes)
      const summaryMatch = line.match(/"([^"]+)"/);
      if (summaryMatch) {
        const summaryStart = lineStart + line.indexOf('"' + summaryMatch[1]) + 1;
        editor.addOverlay(
          bufferId,
          "gitblame",
          summaryStart,
          summaryStart + summaryMatch[1].length,
          colors.summary[0],
          colors.summary[1],
          colors.summary[2],
          false,
          false,
          true  // italic for summary
        );
      }

      byteOffset += line.length + 1;
      continue;
    }

    // Footer highlighting
    if (line.includes("| ↑/↓/j/k:")) {
      editor.addOverlay(
        bufferId,
        "gitblame",
        lineStart,
        lineEnd,
        colors.separator[0],
        colors.separator[1],
        colors.separator[2],
        false,
        false,
        true
      );
    }

    byteOffset += line.length + 1;
  }
}

/**
 * Update the blame view
 */
function updateBlameView(): void {
  if (blameState.bufferId !== null) {
    const entries = buildBlameEntries();
    blameState.cachedContent = entriesToContent(entries);
    editor.setVirtualBufferContent(blameState.bufferId, entries);
    applyBlameHighlighting();
  }
}

// =============================================================================
// Public Commands
// =============================================================================

/**
 * Show git blame for the current file
 */
globalThis.show_git_blame = async function(): Promise<void> {
  if (blameState.isOpen) {
    editor.setStatus("Git blame already open");
    return;
  }

  // Get current file path
  const activeBufferId = editor.getActiveBufferId();
  const filePath = editor.getBufferPath(activeBufferId);
  if (!filePath || filePath === "") {
    editor.setStatus("No file open to blame");
    return;
  }

  editor.setStatus("Loading git blame...");

  // Store state before opening blame
  blameState.splitId = editor.getActiveSplitId();
  blameState.sourceBufferId = editor.getActiveBufferId();
  blameState.sourceFilePath = filePath;
  blameState.currentCommit = null;
  blameState.commitStack = [];

  // Fetch blame data
  const blameLines = await fetchGitBlame(filePath, null);

  if (blameLines.length === 0) {
    editor.setStatus("No blame information available (not a git file or error)");
    blameState.splitId = null;
    blameState.sourceBufferId = null;
    blameState.sourceFilePath = null;
    return;
  }

  // Group into blocks
  blameState.blocks = groupIntoBlocks(blameLines);

  // Build entries and cache content
  const entries = buildBlameEntries();
  blameState.cachedContent = entriesToContent(entries);

  // Create virtual buffer in the current split
  const bufferId = await editor.createVirtualBufferInExistingSplit({
    name: "*Git Blame*",
    mode: "git-blame",
    read_only: true,
    entries: entries,
    split_id: blameState.splitId!,
    show_line_numbers: false,
    show_cursors: true,
    editing_disabled: true,
  });

  if (bufferId !== null) {
    blameState.isOpen = true;
    blameState.bufferId = bufferId;
    applyBlameHighlighting();

    editor.setStatus(`Git blame: ${blameState.blocks.length} blocks | b: blame at parent | q: close`);
    editor.debug("Git blame panel opened");
  } else {
    blameState.splitId = null;
    blameState.sourceBufferId = null;
    blameState.sourceFilePath = null;
    editor.setStatus("Failed to open git blame panel");
  }
};

/**
 * Close the git blame view
 */
globalThis.git_blame_close = function(): void {
  if (!blameState.isOpen) {
    return;
  }

  // Restore the original buffer in the split
  if (blameState.splitId !== null && blameState.sourceBufferId !== null) {
    editor.setSplitBuffer(blameState.splitId, blameState.sourceBufferId);
  }

  // Close the blame buffer
  if (blameState.bufferId !== null) {
    editor.closeBuffer(blameState.bufferId);
  }

  blameState.isOpen = false;
  blameState.bufferId = null;
  blameState.splitId = null;
  blameState.sourceBufferId = null;
  blameState.sourceFilePath = null;
  blameState.currentCommit = null;
  blameState.commitStack = [];
  blameState.blocks = [];
  blameState.cachedContent = "";

  editor.setStatus("Git blame closed");
};

/**
 * Get the commit hash at the current cursor position
 */
function getCommitAtCursor(): string | null {
  if (blameState.bufferId === null) return null;

  const props = editor.getTextPropertiesAtCursor(blameState.bufferId);

  if (props.length > 0) {
    const hash = props[0].hash as string | undefined;
    if (hash) {
      return hash;
    }
  }

  return null;
}

/**
 * Navigate to blame at the parent commit of the current line's commit
 * This allows drilling down through history
 */
globalThis.git_blame_go_back = async function(): Promise<void> {
  if (!blameState.isOpen || !blameState.sourceFilePath) {
    return;
  }

  const currentHash = getCommitAtCursor();
  if (!currentHash) {
    editor.setStatus("Move cursor to a blame line first");
    return;
  }

  // Skip if this is the "not committed yet" hash (all zeros)
  if (currentHash === "0000000000000000000000000000000000000000") {
    editor.setStatus("This line is not yet committed");
    return;
  }

  editor.setStatus(`Loading blame at ${currentHash.slice(0, 7)}^...`);

  // Get the parent commit
  const parentCommit = `${currentHash}^`;

  // Push current state to stack for potential future navigation
  if (blameState.currentCommit) {
    blameState.commitStack.push(blameState.currentCommit);
  } else {
    blameState.commitStack.push("HEAD");
  }

  // Fetch blame at parent commit
  const blameLines = await fetchGitBlame(blameState.sourceFilePath, parentCommit);

  if (blameLines.length === 0) {
    // Pop the stack since we couldn't navigate
    blameState.commitStack.pop();
    editor.setStatus(`Cannot get blame at ${currentHash.slice(0, 7)}^ (may be initial commit or file didn't exist)`);
    return;
  }

  // Update state
  blameState.currentCommit = parentCommit;
  blameState.blocks = groupIntoBlocks(blameLines);

  // Update view
  updateBlameView();

  const depth = blameState.commitStack.length;
  editor.setStatus(`Git blame at ${currentHash.slice(0, 7)}^ | depth: ${depth} | b: go deeper | q: close`);
};

/**
 * Copy the commit hash at cursor to clipboard
 */
globalThis.git_blame_copy_hash = function(): void {
  if (!blameState.isOpen) return;

  const hash = getCommitAtCursor();
  if (!hash) {
    editor.setStatus("Move cursor to a blame line first");
    return;
  }

  // Skip if this is the "not committed yet" hash
  if (hash === "0000000000000000000000000000000000000000") {
    editor.setStatus("This line is not yet committed");
    return;
  }

  // Use spawn to copy to clipboard
  editor.spawnProcess("sh", ["-c", `echo -n "${hash}" | xclip -selection clipboard 2>/dev/null || echo -n "${hash}" | pbcopy 2>/dev/null || echo -n "${hash}" | xsel --clipboard 2>/dev/null`])
    .then(() => {
      editor.setStatus(`Copied: ${hash.slice(0, 7)} (${hash})`);
    })
    .catch(() => {
      editor.setStatus(`Hash: ${hash}`);
    });
};

// =============================================================================
// Command Registration
// =============================================================================

editor.registerCommand(
  "Git Blame",
  "Show git blame for current file (magit-style)",
  "show_git_blame",
  "normal"
);

editor.registerCommand(
  "Git Blame: Close",
  "Close the git blame panel",
  "git_blame_close",
  "normal"
);

editor.registerCommand(
  "Git Blame: Go Back",
  "Show blame at parent commit of current line",
  "git_blame_go_back",
  "normal"
);

// =============================================================================
// Plugin Initialization
// =============================================================================

editor.setStatus("Git Blame plugin loaded (magit-style)");
editor.debug("Git Blame plugin initialized - Use 'Git Blame' command to open");
