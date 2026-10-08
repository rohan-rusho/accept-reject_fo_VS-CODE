import * as vscode from 'vscode';
import { ChangeTracker } from '../core/ChangeTracker';

export class FileDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private tracker: ChangeTracker;
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  public readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> =
    this._onDidChangeFileDecorations.event;

  private disposables: vscode.Disposable[] = [];

  constructor(tracker: ChangeTracker) {
    this.tracker = tracker;
    this.disposables.push(
      this.tracker.onDidChangePendingChanges((e) => {
        if (e.uri) {
          this._onDidChangeFileDecorations.fire(e.uri);
        } else {
          this._onDidChangeFileDecorations.fire(undefined);
        }
      })
    );
  }

  public provideFileDecoration(
    uri: vscode.Uri,
    _token: vscode.CancellationToken
  ): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'file') {
      return undefined;
    }

    const isNew = this.tracker.isNewFile(uri);
    const groups = this.tracker.getGroupsForUri(uri);
    if (!groups || groups.length === 0) {
      if (isNew) {
        return {
          badge: 'U',
          tooltip: 'ReviewFlow: New File (Pending Review)',
          color: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')
        };
      }
      return undefined;
    }

    if (isNew) {
      return {
        badge: 'U',
        tooltip: 'ReviewFlow: New File (Pending Review)',
        color: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')
      };
    }

    const count = groups.length;
    return {
      badge: count > 9 ? '9+' : count.toString(),
      tooltip: `ReviewFlow: ${count} pending change${count > 1 ? 's' : ''}`,
      color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
    };
  }

  public dispose(): void {
    this._onDidChangeFileDecorations.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
