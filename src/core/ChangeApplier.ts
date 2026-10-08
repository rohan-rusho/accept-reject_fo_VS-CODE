import * as vscode from 'vscode';
import { ChangeGroup } from '../models/ChangeGroup';
import { RangeUtils } from '../utils/RangeUtils';
import { DocumentUtils } from '../utils/DocumentUtils';

export class ChangeApplier {
  /**
   * Rejects a change group by reverting the document text to originalText.
   */
  public static async rejectGroup(
    document: vscode.TextDocument,
    group: ChangeGroup
  ): Promise<boolean> {
    const edit = new vscode.WorkspaceEdit();

    // Pure insertion rejection: remove the inserted lines entirely
    if (group.deletedLineCount === 0 && group.addedLineCount > 0) {
      if (group.endLine < document.lineCount - 1) {
        // Delete from start of first line to start of next line
        const range = new vscode.Range(
          new vscode.Position(group.startLine, 0),
          new vscode.Position(group.endLine + 1, 0)
        );
        edit.delete(document.uri, range);
      } else if (group.startLine > 0) {
        // At the end of file, delete from end of previous line to end of last line
        const prevLine = group.startLine - 1;
        const prevLineLength = document.lineAt(prevLine).text.length;
        const range = new vscode.Range(
          new vscode.Position(prevLine, prevLineLength),
          new vscode.Position(group.endLine, document.lineAt(group.endLine).text.length)
        );
        edit.delete(document.uri, range);
      } else {
        // Entire document was this insertion
        const range = DocumentUtils.getFullRange(document);
        edit.replace(document.uri, range, '');
      }
    } else if (group.addedLineCount === 0 && group.deletedLineCount > 0) {
      // Pure deletion rejection: re-insert the deleted lines
      const insertPos = new vscode.Position(Math.min(group.startLine, document.lineCount), 0);
      const eol = DocumentUtils.detectLineEnding(document.getText());
      edit.insert(document.uri, insertPos, group.originalText + eol);
    } else {
      // Modification: replace current lines with original lines
      const range = RangeUtils.createLineRange(group.startLine, group.endLine, document);
      edit.replace(document.uri, range, group.originalText);
    }

    return await vscode.workspace.applyEdit(edit);
  }

  /**
   * Rejects all changes in a document by restoring the full baseline text.
   */
  public static async rejectEntireDocument(
    document: vscode.TextDocument,
    baselineText: string
  ): Promise<boolean> {
    return await DocumentUtils.replaceDocumentText(document.uri, baselineText);
  }

  /**
   * Replaces a specific region in the baseline text to mark a group as accepted.
   */
  public static applyAcceptToBaseline(
    baselineText: string,
    group: ChangeGroup
  ): string {
    const baselineLines = baselineText.replace(/\r\n/g, '\n').split('\n');
    const currentLines = group.currentText.replace(/\r\n/g, '\n').split('\n');

    const start = Math.max(0, group.originalStartLine);
    const deleteCount = group.deletedLineCount;

    // Splice in the accepted lines
    baselineLines.splice(start, deleteCount, ...currentLines);

    const eol = DocumentUtils.detectLineEnding(baselineText);
    return baselineLines.join(eol);
  }
}
