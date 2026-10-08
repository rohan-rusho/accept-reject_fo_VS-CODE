import * as vscode from 'vscode';
import { ChangeManager } from '../core/ChangeManager';
import { ChangeGroup } from '../models/ChangeGroup';
import { RangeUtils } from '../utils/RangeUtils';

export async function navigateToChange(uri: vscode.Uri, group: ChangeGroup): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const range = RangeUtils.createLineRange(group.startLine, group.endLine, doc);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  editor.selection = new vscode.Selection(range.start, range.end);
}

export async function executeNextChange(manager: ChangeManager): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const activeUri = editor?.document.uri;
  const currentLine = editor?.selection.active.line;

  const next = manager.getNextChange(activeUri, currentLine);
  if (!next) {
    vscode.window.showInformationMessage('ReviewFlow: No pending changes to navigate to.');
    return;
  }

  await navigateToChange(next.uri, next.group);
}

export async function executePrevChange(manager: ChangeManager): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const activeUri = editor?.document.uri;
  const currentLine = editor?.selection.active.line;

  const prev = manager.getPrevChange(activeUri, currentLine);
  if (!prev) {
    vscode.window.showInformationMessage('ReviewFlow: No pending changes to navigate to.');
    return;
  }

  await navigateToChange(prev.uri, prev.group);
}
