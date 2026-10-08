import * as vscode from 'vscode';
import { ChangeTracker } from '../core/ChangeTracker';

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private tracker: ChangeTracker;
  private disposables: vscode.Disposable[] = [];

  constructor(tracker: ChangeTracker) {
    this.tracker = tracker;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'reviewflow.openReviewPanel';

    this.disposables.push(
      this.tracker.onDidChangePendingChanges(() => {
        this.update();
      })
    );

    this.update();
  }

  public update(): void {
    const config = vscode.workspace.getConfiguration('reviewflow');
    if (!config.get<boolean>('showStatusBar', true)) {
      this.item.hide();
      return;
    }

    const trackedUris = this.tracker.getTrackedUris();
    const fileCount = trackedUris.length;
    const changeCount = this.tracker.getTotalPendingCount();

    if (changeCount === 0) {
      this.item.text = '$(check) No pending changes';
      this.item.tooltip = 'ReviewFlow: All changes reviewed. Workspace clean.';
      this.item.backgroundColor = undefined;
    } else {
      if (fileCount > 1) {
        this.item.text = `$(diff) ${fileCount} Files • ${changeCount} Changes`;
      } else {
        this.item.text = `$(diff) ${changeCount} Change${changeCount > 1 ? 's' : ''}`;
      }
      this.item.tooltip = `ReviewFlow: ${changeCount} pending changes across ${fileCount} files\nClick to review changes`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    this.item.show();
  }

  public dispose(): void {
    this.item.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
