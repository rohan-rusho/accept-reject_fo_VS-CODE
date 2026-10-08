import * as vscode from 'vscode';
import { ChangeManager } from '../core/ChangeManager';
import { ChangeItemNode } from '../providers/ChangeTreeProvider';

export async function executeAcceptChange(
  manager: ChangeManager,
  arg1?: string | ChangeItemNode,
  arg2?: vscode.Uri
): Promise<void> {
  let groupId: string | undefined;
  let uri: vscode.Uri | undefined;

  if (arg1 instanceof ChangeItemNode) {
    groupId = arg1.group.id;
    uri = arg1.uri;
  } else if (typeof arg1 === 'string' && arg2 instanceof vscode.Uri) {
    groupId = arg1;
    uri = arg2;
  } else {
    // Invoked from keybinding or command palette: resolve from active editor and cursor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('ReviewFlow: No active editor to accept change.');
      return;
    }
    uri = editor.document.uri;
    if (uri.scheme === 'reviewflow-baseline') {
      uri = vscode.Uri.parse(uri.query || uri.path);
    }
    const currentLine = editor.selection.active.line;
    const groups = manager.getTracker().getGroupsForUri(uri);

    const match = groups.find((g) => currentLine >= g.startLine && currentLine <= g.endLine);
    if (match) {
      groupId = match.id;
    } else if (groups.length > 0) {
      // If cursor is not inside a block, accept the first pending change in the file
      groupId = groups[0].id;
    } else {
      vscode.window.showInformationMessage('ReviewFlow: No pending changes in current file.');
      return;
    }
  }

  if (groupId && uri) {
    await manager.acceptChange(groupId, uri);
  }
}
