//! Per-window buffer storage with the underlying map encapsulated.
//!
//! `WindowBuffers` wraps the `HashMap<BufferId, EditorState>` that
//! used to be a `pub` field on `Window`. The inner map is private to
//! this module — meaning *no other code in the crate*, including
//! other `impl Window` blocks across `window/mod.rs`,
//! `window_actions.rs`, and the various `impl Editor` blocks that
//! reach in via `self.windows.get_mut(&id)`, can mutate the storage
//! except through the methods below. That funnels every add / remove
//! through one auditable surface, which is the prerequisite for
//! enforcing invariants like "every `BufferId` reachable from the
//! split tree is present in `WindowBuffers`" (issue #1939 root cause).
//!
//! The API is deliberately narrow. Reads and writes against a single
//! `BufferId` go through [`get`](WindowBuffers::get) /
//! [`get_mut`](WindowBuffers::get_mut) / [`insert`](WindowBuffers::insert) /
//! [`remove`](WindowBuffers::remove). Bulk iteration uses
//! `IntoIterator` for `&WindowBuffers` and `&mut WindowBuffers`.
//! Everything else — searches over the keyspace, summary statistics,
//! domain rollups like "every open file path" or "every distinct
//! language" — is exposed as a semantic method rather than letting
//! callers reach for `keys()` / `values()` / `iter()` chains. That
//! keeps the surface small (callers describe intent, not storage
//! shape) and gives us one place to add invariants as they're needed.

use fresh_core::BufferId;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use crate::state::EditorState;

/// Per-window storage of live `EditorState`s, keyed by `BufferId`.
pub struct WindowBuffers {
    map: HashMap<BufferId, EditorState>,
}

impl WindowBuffers {
    pub fn new() -> Self {
        Self {
            map: HashMap::new(),
        }
    }

    // -- single-buffer access --------------------------------------------

    pub fn get(&self, id: &BufferId) -> Option<&EditorState> {
        self.map.get(id)
    }

    pub fn get_mut(&mut self, id: &BufferId) -> Option<&mut EditorState> {
        self.map.get_mut(id)
    }

    pub fn insert(&mut self, id: BufferId, state: EditorState) -> Option<EditorState> {
        self.map.insert(id, state)
    }

    pub fn remove(&mut self, id: &BufferId) -> Option<EditorState> {
        self.map.remove(id)
    }

    pub fn contains_key(&self, id: &BufferId) -> bool {
        self.map.contains_key(id)
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn iter(&self) -> std::collections::hash_map::Iter<'_, BufferId, EditorState> {
        self.map.iter()
    }

    // -- keyspace queries -------------------------------------------------

    /// Snapshot of every buffer id, useful when the caller needs an
    /// owned set so it can mutate `self` while iterating.
    pub fn ids(&self) -> Vec<BufferId> {
        self.map.keys().copied().collect()
    }

    /// First `BufferId` whose state satisfies `predicate`, or `None`.
    /// Iteration order is unspecified; pass a `|_, _| true` predicate
    /// to grab any live buffer (the defensive fallback in
    /// `Window::effective_active_pair`).
    pub fn find_id<F>(&self, mut predicate: F) -> Option<BufferId>
    where
        F: FnMut(BufferId, &EditorState) -> bool,
    {
        self.map
            .iter()
            .find(|(id, state)| predicate(**id, state))
            .map(|(id, _)| *id)
    }

    /// Count of buffers whose state satisfies `predicate`.
    pub fn count_where<F>(&self, mut predicate: F) -> usize
    where
        F: FnMut(BufferId, &EditorState) -> bool,
    {
        self.map
            .iter()
            .filter(|(id, state)| predicate(**id, state))
            .count()
    }

    // -- domain rollups ---------------------------------------------------

    /// Owned paths of every file-backed buffer in this window. Used
    /// by auto-revert to decide which files to poll.
    pub fn paths(&self) -> Vec<PathBuf> {
        self.map
            .values()
            .filter_map(|state| state.buffer.file_path().map(PathBuf::from))
            .collect()
    }

    /// Distinct language identifiers across every buffer. Used by the
    /// universal-LSP reattach path to drive a per-language reopen.
    pub fn languages(&self) -> HashSet<String> {
        self.map
            .values()
            .map(|state| state.language.clone())
            .collect()
    }

    /// Whether any buffer's semantic-highlight debounce window has
    /// elapsed and is asking for a redraw. The whole "iterate every
    /// state looking for a needs-redraw signal" pattern lives here so
    /// callers don't reach in for the iterator.
    pub fn any_needs_semantic_redraw(&self) -> bool {
        self.map.values().any(|state| {
            state
                .reference_highlight_overlay
                .needs_redraw()
                .is_some_and(|remaining| remaining.is_zero())
        })
    }
}

impl Default for WindowBuffers {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a> IntoIterator for &'a WindowBuffers {
    type Item = (&'a BufferId, &'a EditorState);
    type IntoIter = std::collections::hash_map::Iter<'a, BufferId, EditorState>;
    fn into_iter(self) -> Self::IntoIter {
        self.map.iter()
    }
}

impl<'a> IntoIterator for &'a mut WindowBuffers {
    type Item = (&'a BufferId, &'a mut EditorState);
    type IntoIter = std::collections::hash_map::IterMut<'a, BufferId, EditorState>;
    fn into_iter(self) -> Self::IntoIter {
        self.map.iter_mut()
    }
}
