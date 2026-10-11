import * as vscode from 'vscode';
import { ChangeTracker } from '../core/ChangeTracker';
import { RangeUtils } from '../utils/RangeUtils';
import { DiffUtils } from '../utils/DiffUtils';

export class ChangeCodeLensProvider implements vscode.CodeLensProvider {
  private tracker: ChangeTracker;
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor(tracker: ChangeTracker) {
    this.tracker = tracker;
    this.tracker.onDidChangePendingChanges(() => {
      this._onDidChangeCodeLenses.fire();
    });
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration('reviewflow');
    if (!config.get<boolean>('showInlineActions', true)) {
      return [];
    }

    const groups = this.tracker.getGroupsForUri(document.uri);
    if (!groups || groups.length === 0) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const seenGroupIds = new Set<string>();

    const codeLensStyle = config.get<string>('codeLensStyle', 'github');

    for (const group of groups) {
      // Deduplicate by group ID to ensure exactly one toolbar per logical change
      if (seenGroupIds.has(group.id)) {
        continue;
      }
      seenGroupIds.add(group.id);

      const line = Math.max(0, Math.min(group.startLine, document.lineCount - 1));
      const range = new vscode.Range(line, 0, line, 0);
      const isNew = this.tracker.isNewFile(document.uri);
      const isProcessing = this.tracker.isGroupInFlight(group.id);

      // Multi-line change calculation
      let affectedLines = 1;
      if (group.type === 'modify') {
        affectedLines = Math.max(group.addedLineCount, group.deletedLineCount);
      } else if (group.type === 'insert') {
        affectedLines = group.addedLineCount;
      } else if (group.type === 'delete') {
        affectedLines = group.deletedLineCount;
      }

      const multiLineSuffix = affectedLines > 1 ? ` · ${affectedLines} lines` : '';

      // Default: Clean GitHub-style toolbar
      let diffTitle = '⇋ Diff View';
      let acceptTitle = isProcessing
        ? '⏳ Applying...'
        : isNew
        ? '✓ Accept New File'
        : `✓ Accept${multiLineSuffix}`;
      let rejectTitle = isProcessing
        ? '⏳ Applying...'
        : isNew
        ? '× Reject New File'
        : `× Reject${multiLineSuffix}`;

      // Accessible tooltips containing keyboard shortcuts (shortcuts NOT shown inline)
      let acceptTooltip = isNew
        ? 'Accept newly created file into workspace (Alt+Enter)'
        : affectedLines > 1
        ? `Accept ${affectedLines} lines change (Alt+Enter)`
        : 'Accept change (Alt+Enter)';

      let rejectTooltip = isNew
        ? 'Reject and remove newly created file (Shift+Alt+Backspace)'
        : affectedLines > 1
        ? `Reject ${affectedLines} lines change (Shift+Alt+Backspace)`
        : 'Reject change (Shift+Alt+Backspace)';

      let diffTooltip = 'Diff View — Inspect unified diff preview (Alt+D)';

      const isMac = process.platform === 'darwin';
      const acceptShortcut = isMac ? '⌥↵' : 'Alt+↵';
      const rejectShortcut = isMac ? '⇧⌥⌫' : 'Shift+Alt+⌫';

      if (codeLensStyle === 'buttons') {
        diffTitle = '[ ⇋ Diff View ]';
        acceptTitle = isProcessing ? '[ ⏳ Applying... ]' : '[ ✓ ]';
        rejectTitle = isProcessing ? '[ ⏳ Applying... ]' : '[ ✕ ]';
      } else if (codeLensStyle === 'bracketsWithLabels') {
        diffTitle = '[ ⇋ Diff View ]';
        acceptTitle = isProcessing ? '[ ⏳ Applying... ]' : isNew ? '[ ✓ Accept File ]' : '[ ✓ Accept ]';
        rejectTitle = isProcessing ? '[ ⏳ Applying... ]' : isNew ? '[ ✕ Reject File ]' : '[ ✕ Reject ]';
      } else if (codeLensStyle === 'compact') {
        diffTitle = '⇋ Diff';
        acceptTitle = isProcessing ? '⏳' : '✓';
        rejectTitle = isProcessing ? '⏳' : '×';
      } else if (codeLensStyle === 'clean') {
        diffTitle = '⇋ Diff View';
        acceptTitle = isProcessing ? '⏳' : '✓';
        rejectTitle = isProcessing ? '⏳' : '✕';
      } else if (codeLensStyle === 'antigravity') {
        diffTitle = '[ ⇋ Diff View ]';
        acceptTitle = isProcessing
          ? '[ ⏳ Applying... ]'
          : isNew
          ? `[ Accept File ${acceptShortcut} ]`
          : `[ Accept ${acceptShortcut} ]`;
        rejectTitle = isProcessing
          ? '[ ⏳ Applying... ]'
          : isNew
          ? `[ Reject File ${rejectShortcut} ]`
          : `[ Reject ${rejectShortcut} ]`;
      } else if (codeLensStyle === 'verbose') {
        let changeDesc = '';
        if (group.type === 'modify') {
          changeDesc = `(±${affectedLines} line${affectedLines > 1 ? 's' : ''})`;
        } else if (group.type === 'insert') {
          changeDesc = `(+${group.addedLineCount} line${group.addedLineCount > 1 ? 's' : ''})`;
        } else if (group.type === 'delete') {
          changeDesc = `(-${group.deletedLineCount} line${group.deletedLineCount > 1 ? 's' : ''})`;
        }
        acceptTitle = isNew ? '✅ Accept New File (Alt+Enter)' : `✅ Accept ${changeDesc} (Alt+Enter)`;
        rejectTitle = isNew ? '❌ Reject New File (Shift+Alt+Backspace)' : `❌ Reject ${changeDesc} (Shift+Alt+Backspace)`;
        diffTitle = '⇋ Diff View';
      }

      if (!isNew && group.deletedLineCount > 0) {
        diffTooltip = `Inspect in Unified Inline Diff View (🔴 -${group.deletedLineCount} lines deleted from baseline)`;
      } else if (isNew) {
        diffTooltip = 'Inspect new file diff against empty baseline';
      }

      const diffLens = new vscode.CodeLens(range, {
        title: diffTitle,
        tooltip: diffTooltip,
        command: 'reviewflow.openInlineDiff',
        arguments: isNew ? [document.uri] : [group.id, document.uri]
      });

      const acceptLens = new vscode.CodeLens(range, {
        title: acceptTitle,
        tooltip: acceptTooltip,
        command: isNew ? 'reviewflow.acceptFile' : 'reviewflow.acceptChange',
        arguments: isNew ? [document.uri] : [group.id, document.uri]
      });

      const rejectLens = new vscode.CodeLens(range, {
        title: rejectTitle,
        tooltip: rejectTooltip,
        command: isNew ? 'reviewflow.rejectFile' : 'reviewflow.rejectChange',
        arguments: isNew ? [document.uri] : [group.id, document.uri]
      });

      if (codeLensStyle === 'antigravity') {
        // Antigravity style (Accept first, Reject second, Diff third)
        lenses.push(acceptLens, rejectLens, diffLens);
      } else {
        // GitHub / Toolbar style: 1. Diff View, 2. Accept, 3. Reject
        lenses.push(diffLens, acceptLens, rejectLens);
      }
    }

    return lenses;
  }
}
