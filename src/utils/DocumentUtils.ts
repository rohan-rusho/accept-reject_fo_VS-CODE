import * as vscode from 'vscode';

export class DocumentUtils {
  /**
   * Get the full Range of an entire document.
   */
  public static getFullRange(document: vscode.TextDocument): vscode.Range {
    const firstLine = 0;
    const lastLine = Math.max(0, document.lineCount - 1);
    const lastLineLength = document.lineAt(lastLine).text.length;
    return new vscode.Range(
      new vscode.Position(firstLine, 0),
      new vscode.Position(lastLine, lastLineLength)
    );
  }

  /**
   * Detect line ending style from text content.
   */
  public static detectLineEnding(text: string): '\r\n' | '\n' {
    return text.includes('\r\n') ? '\r\n' : '\n';
  }

  /**
   * Normalize lines to the specified line ending.
   */
  public static normalizeLineEndings(lines: string[], eol: '\r\n' | '\n'): string {
    return lines.join(eol);
  }

  /**
   * Safely apply a text edit to an open document or document by URI.
   */
  public static async replaceRange(
    uri: vscode.Uri,
    range: vscode.Range,
    newText: string
  ): Promise<boolean> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, newText);
    return await vscode.workspace.applyEdit(edit);
  }

  /**
   * Safely replace full document text.
   */
  public static async replaceDocumentText(
    uri: vscode.Uri,
    newText: string
  ): Promise<boolean> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const fullRange = this.getFullRange(doc);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullRange, newText);
    return await vscode.workspace.applyEdit(edit);
  }
}
