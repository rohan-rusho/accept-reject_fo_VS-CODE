# Change Log

All notable changes to the "reviewflow" extension will be documented in this file.

## [0.1.0] - 2026-10-08

### Added
- **Core Change Tracking**: Baseline tracking engine comparing active documents and detecting insertions, deletions, and modifications.
- **Intelligent Change Grouping**: Myers line diff with proximity clustering to group consecutive and nearby edits into logical change blocks.
- **Three Levels of Acceptance**:
  - Individual change acceptance/rejection (`Accept` / `Reject`)
  - File-level acceptance/rejection (`Accept File` / `Reject File`)
  - Workspace-wide acceptance/rejection (`Accept All` / `Reject All`)
- **Undo After Accept**: LIFO reversible operation stack preserving file snapshots and baselines for safe rollbacks.
- **Inline Review UI**:
  - Native CodeLens controls directly above change blocks (`[✓ Accept] [✕ Reject] [Diff]`)
  - Subtle, non-intrusive green line decorations for additions and red markers for deletions
  - Rich interactive Markdown hover cards with diff preview and one-click actions
- **Review Sidebar & TreeView**:
  - Dedicated Activity Bar icon with pending changes grouped by file
  - Click-to-navigate with range selection and centered editor view
  - Context menu and title bar actions for batch operations
- **Explorer Badging**: File decoration provider showing pending change count badges in the file tree.
- **Status Bar Indicator**: Real-time counter of pending changes and files with direct review menu access.
- **Diff Preview**: Side-by-side comparison using a virtual document provider (`reviewflow-baseline`).
- **Conflict Resolver**: Safety verification preventing accidental overwrites when documents are edited concurrently.
- **Range Tracker**: Dynamic offset recalculation adjusting pending blocks upon manual user edits.
- **Keyboard Shortcuts & Commands**: Complete command suite with ergonomic shortcuts.
