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
  } else if (typeof arg2 === 'string') {
    try {
      targetUri = vscode.Uri.parse(arg2);
    } catch {
      targetUri = undefined;
    }
  } else if (typeof arg1 === 'string' && (arg1.startsWith('file:') || arg1.startsWith('vscode-userdata:') || arg1.includes('#'))) {
    try {
      targetUri = vscode.Uri.parse(arg1.split('#')[0]);
    } catch {
      targetUri = undefined;
    }
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
    if (diffConfig.get<boolean>('renderIndicators') !== true) {
      try {
        await diffConfig.update('renderIndicators', true, vscode.ConfigurationTarget.Global);
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
  const title = fileName;

  const showOptions: vscode.TextDocumentShowOptions = {
    preview: false
  };

  if (arg1 instanceof ChangeItemNode) {
    showOptions.selection = new vscode.Range(
      arg1.group.startLine,
      0,
      arg1.group.endLine,
      0
    );
  } else if (typeof arg1 === 'string') {
    const rangeMatch = arg1.match(/_(\d+)-(\d+)$/);
    if (rangeMatch) {
      const s = parseInt(rangeMatch[1], 10);
      const e = parseInt(rangeMatch[2], 10);
      showOptions.selection = new vscode.Range(s, 0, e, 0);
    } else {
      const singleMatch = arg1.match(/_(\d+)$/);
      if (singleMatch) {
        const s = parseInt(singleMatch[1], 10);
        showOptions.selection = new vscode.Range(s, 0, s, 0);
      }
    }
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

