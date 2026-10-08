import * as vscode from 'vscode';
import { ChangeTracker } from '../core/ChangeTracker';
import { RangeUtils } from '../utils/RangeUtils';

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

    groups.forEach((group) => {
      const line = Math.max(0, Math.min(group.startLine, document.lineCount - 1));
      const range = new vscode.Range(line, 0, line, 0);
      const isNew = this.tracker.isNewFile(document.uri);

      // 1. Accept Lens (Upper floating in green)
      lenses.push(
        new vscode.CodeLens(range, {
          title: isNew ? '✅ Accept New File (Alt+Enter)' : '✅ Accept (Alt+Enter)',
          tooltip: isNew
            ? 'Accept newly created file into workspace (Alt+Enter)'
            : 'Accept this change block (Alt+Enter)',
          command: isNew ? 'reviewflow.acceptFile' : 'reviewflow.acceptChange',
          arguments: isNew ? [document.uri] : [group.id, document.uri]
        })
      );

      // 2. Reject Lens (Upper floating in red)
      lenses.push(
        new vscode.CodeLens(range, {
          title: isNew ? '❌ Reject New File (Shift+Alt+Backspace)' : '❌ Reject (Shift+Alt+Backspace)',
          tooltip: isNew
            ? 'Reject and remove newly created file (Shift+Alt+Backspace)'
            : 'Reject and revert this change block (Shift+Alt+Backspace)',
          command: isNew ? 'reviewflow.rejectFile' : 'reviewflow.rejectChange',
          arguments: isNew ? [document.uri] : [group.id, document.uri]
        })
      );

      // 3. Diff View
      lenses.push(
        new vscode.CodeLens(range, {
          title: '📊 Inline Diff',
          tooltip:
            'Inspect diff in unified inline view (deleted lines in red on top, added lines in green)',
          command: 'reviewflow.openInlineDiff',
          arguments: [group.id, document.uri]
        })
      );

      if (isNew) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '📄 [New File]',
            tooltip: 'This is a newly created file pending review',
            command: 'reviewflow.openInlineDiff',
            arguments: [group.id, document.uri]
          })
        );
      }
    });

    return lenses;
  }
}
