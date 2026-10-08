import * as vscode from 'vscode';
import * as path from 'path';
import { ChangeManager } from '../core/ChangeManager';
import { RangeUtils } from '../utils/RangeUtils';

export class ReviewPanel {
  public static async show(manager: ChangeManager): Promise<void> {
    const tracker = manager.getTracker();
    const history = manager.getHistory();
    const trackedUris = tracker.getTrackedUris();
    const totalCount = tracker.getTotalPendingCount();

    if (totalCount === 0 && !history.canUndo()) {
      vscode.window.showInformationMessage('ReviewFlow: No pending changes and no changes to undo.');
      return;
    }

    interface ReviewQuickPickItem extends vscode.QuickPickItem {
      action?: 'accept-all' | 'reject-all' | 'undo' | 'select-change';
      uri?: vscode.Uri;
      groupId?: string;
    }

    const items: ReviewQuickPickItem[] = [];

    // Global actions
    if (totalCount > 0) {
      items.push({
        label: '$(check-all) Accept All Changes',
        description: `${totalCount} changes across ${trackedUris.length} file(s)`,
        action: 'accept-all'
      });
      items.push({
        label: '$(clear-all) Reject All Changes',
        description: `Revert all ${totalCount} changes across workspace`,
        action: 'reject-all'
      });
    }

    if (history.canUndo()) {
      const lastOp = history.peek();
      items.push({
        label: '$(discard) Undo Last Change',
        description: lastOp ? lastOp.description : '',
        action: 'undo'
      });
    }

    if (totalCount > 0) {
      items.push({
        label: 'PENDING CHANGES',
        kind: vscode.QuickPickItemKind.Separator
      });

      for (const uri of trackedUris) {
        const groups = tracker.getGroupsForUri(uri);
        const fileName = path.basename(uri.fsPath);

        groups.forEach((group, index) => {
          const rangeStr = RangeUtils.formatLineRange(group.startLine, group.endLine);
          items.push({
            label: `$(diff) ${fileName}: Change #${index + 1}`,
            description: `${rangeStr}   🟢 +${group.addedLineCount}   🔴 -${group.deletedLineCount}`,
            detail: group.currentText.substring(0, 80).replace(/\n/g, ' '),
            action: 'select-change',
            uri,
            groupId: group.id
          });
        });
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'ReviewFlow: Select a change or workspace action',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (!selected || !selected.action) {
      return;
    }

    switch (selected.action) {
      case 'accept-all':
        await manager.acceptAll();
        break;
      case 'reject-all':
        await manager.rejectAll();
        break;
      case 'undo':
        await manager.undoLastChange();
        break;
      case 'select-change':
        if (selected.uri && selected.groupId) {
          await this.showChangeActionMenu(manager, selected.uri, selected.groupId);
        }
        break;
    }
  }

  private static async showChangeActionMenu(
    manager: ChangeManager,
    uri: vscode.Uri,
    groupId: string
  ): Promise<void> {
    const tracker = manager.getTracker();
    const groups = tracker.getGroupsForUri(uri);
    const group = groups.find((g) => g.id === groupId);
    if (!group) {
      return;
    }

    // Reveal the change in editor
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    const range = RangeUtils.createLineRange(group.startLine, group.endLine, doc);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(range.start, range.end);

    const action = await vscode.window.showQuickPick(
      [
        { label: '✅ Accept Change', description: 'Keep new code', value: 'accept' },
        { label: '❌ Reject Change', description: 'Revert to original', value: 'reject' },
        { label: '📊 Side-by-Side Diff', description: 'Open GitHub Desktop-style comparison', value: 'diff' }
      ],
      { placeHolder: `Action for Change at ${RangeUtils.formatLineRange(group.startLine, group.endLine)}` }
    );

    if (action?.value === 'accept') {
      await manager.acceptChange(group.id, uri);
    } else if (action?.value === 'reject') {
      await manager.rejectChange(group.id, uri);
    } else if (action?.value === 'diff') {
      await vscode.commands.executeCommand('reviewflow.previewDiff', group.id, uri);
    }
  }
}
