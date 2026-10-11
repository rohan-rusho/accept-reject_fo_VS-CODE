import * as vscode from 'vscode';
import { ChangeManager } from '../core/ChangeManager';
import { ChangeItemNode } from '../providers/ChangeTreeProvider';

export async function executeAcceptChange(
  manager: ChangeManager,
  arg1?: any,
  arg2?: any
): Promise<void> {
  let groupId: string | undefined;
  let uri: vscode.Uri | undefined;

  if (arg1 instanceof ChangeItemNode) {
    groupId = arg1.group.id;
    uri = arg1.uri;
  } else if (arg1 instanceof vscode.Uri) {
    uri = arg1;
    if (typeof arg2 === 'string') {
      groupId = arg2;
    }
  } else if (typeof arg1 === 'string') {
    groupId = arg1;
    if (arg2 instanceof vscode.Uri) {
      uri = arg2;
    } else if (typeof arg2 === 'string') {
      uri = vscode.Uri.parse(arg2);
    } else if (arg2 && (arg2.fsPath || arg2.path)) {
      uri = vscode.Uri.file(arg2.fsPath || arg2.path);
    }
  }

  if (!uri) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      uri = editor.document.uri;
    }
  }

  if (uri && uri.scheme === 'reviewflow-baseline') {
    uri = vscode.Uri.parse(uri.query || uri.path);
  }

  if (!uri) {
    vscode.window.showWarningMessage('ReviewFlow: No active editor to accept change.');
    return;
  }

  const groups = manager.getTracker().getGroupsForUri(uri);
  if (!groupId) {
    const editor = vscode.window.activeTextEditor;
    const currentLine = editor ? editor.selection.active.line : 0;
    const match = groups.find((g) => currentLine >= g.startLine && currentLine <= g.endLine);
    if (match) {
      groupId = match.id;
    } else if (groups.length > 0) {
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
