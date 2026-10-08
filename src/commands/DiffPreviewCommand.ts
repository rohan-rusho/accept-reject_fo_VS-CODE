import * as vscode from 'vscode';
import * as path from 'path';
import { ChangeDocumentProvider } from '../providers/ChangeDocumentProvider';
import { ChangeItemNode, FileItemNode } from '../providers/ChangeTreeProvider';

export async function executeDiffPreview(
  arg1?: string | vscode.Uri | ChangeItemNode | FileItemNode,
  arg2?: vscode.Uri
): Promise<void> {
  let targetUri: vscode.Uri | undefined;

  if (arg1 instanceof FileItemNode) {
    targetUri = arg1.uri;
  } else if (arg1 instanceof ChangeItemNode) {
    targetUri = arg1.uri;
  } else if (arg2 instanceof vscode.Uri) {
    targetUri = arg2;
  } else if (arg1 instanceof vscode.Uri) {
    targetUri = arg1;
  } else {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      targetUri = editor.document.uri;
    }
  }

  if (!targetUri) {
    vscode.window.showWarningMessage('ReviewFlow: No active file for diff preview.');
    return;
  }

  if (targetUri.scheme === ChangeDocumentProvider.SCHEME) {
    targetUri = vscode.Uri.parse(targetUri.query || targetUri.path);
  }

  const reviewConfig = vscode.workspace.getConfiguration('reviewflow');
  if (reviewConfig.get<boolean>('preferInlineDiff', true)) {
    const diffConfig = vscode.workspace.getConfiguration('diffEditor');
    if (diffConfig.get<boolean>('renderSideBySide') !== false) {
      try {
        await diffConfig.update('renderSideBySide', false, vscode.ConfigurationTarget.Global);
      } catch {
        // Fallback if permission/workspace restricts global update
      }
    }
    if (diffConfig.get<boolean>('codeLens') !== true) {
      try {
        await diffConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);
      } catch {
        // Fallback
      }
    }
  }

  const baselineUri = vscode.Uri.from({
    scheme: ChangeDocumentProvider.SCHEME,
    path: targetUri.path,
    query: targetUri.toString()
  });

  const fileName = path.basename(targetUri.fsPath);
  const title = `${fileName} (Baseline 🔴 ↔ Modified 🟢)`;

  const showOptions: vscode.TextDocumentShowOptions = {
    preview: true
  };

  if (arg1 instanceof ChangeItemNode) {
    showOptions.selection = new vscode.Range(
      arg1.group.startLine,
      0,
      arg1.group.endLine,
      0
    );
  }

  await vscode.commands.executeCommand('vscode.diff', baselineUri, targetUri, title, showOptions);
}

export async function executeInlineDiffPreview(
  arg1?: string | vscode.Uri | ChangeItemNode | FileItemNode,
  arg2?: vscode.Uri
): Promise<void> {
  const diffConfig = vscode.workspace.getConfiguration('diffEditor');
  if (diffConfig.get<boolean>('renderSideBySide') !== false) {
    try {
      await diffConfig.update('renderSideBySide', false, vscode.ConfigurationTarget.Global);
    } catch {
      // Ignore
    }
  }
  await executeDiffPreview(arg1, arg2);
}

