import * as vscode from 'vscode';
import { ChangeManager } from '../core/ChangeManager';
import { FileItemNode } from '../providers/ChangeTreeProvider';

export async function executeAcceptFile(
  manager: ChangeManager,
  arg?: vscode.Uri | FileItemNode
): Promise<void> {
  let uri: vscode.Uri | undefined;

  if (arg instanceof FileItemNode) {
    uri = arg.uri;
  } else if (arg instanceof vscode.Uri) {
    uri = arg;
  } else {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      uri = editor.document.uri;
    }
  }

  if (!uri) {
    vscode.window.showWarningMessage('ReviewFlow: No active file to accept.');
    return;
  }

  if (uri.scheme === 'reviewflow-baseline') {
    uri = vscode.Uri.parse(uri.query || uri.path);
  }

  await manager.acceptFile(uri);
}
