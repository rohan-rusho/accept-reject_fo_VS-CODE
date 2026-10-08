import * as vscode from 'vscode';

export class RangeUtils {
  /**
   * Convert startLine and endLine (0-indexed, inclusive) to a vscode.Range.
   */
  public static createLineRange(startLine: number, endLine: number, document: vscode.TextDocument): vscode.Range {
    const safeStartLine = Math.max(0, Math.min(startLine, document.lineCount - 1));
    const safeEndLine = Math.max(safeStartLine, Math.min(endLine, document.lineCount - 1));

    const startPos = new vscode.Position(safeStartLine, 0);
    const endLineLength = document.lineAt(safeEndLine).text.length;
    const endPos = new vscode.Position(safeEndLine, endLineLength);

    return new vscode.Range(startPos, endPos);
  }

  /**
   * Format line range as user-friendly string (1-indexed for human display).
   */
  public static formatLineRange(startLine: number, endLine: number): string {
    const humanStart = startLine + 1;
    const humanEnd = endLine + 1;
    if (humanStart === humanEnd) {
      return `Line ${humanStart}`;
    }
    return `Lines ${humanStart}–${humanEnd}`;
  }

  /**
   * Check if two line ranges are overlapping or within a distance threshold.
   */
  public static isWithinDistance(
    range1: { startLine: number; endLine: number },
    range2: { startLine: number; endLine: number },
    maxDistance: number
  ): boolean {
    if (range1.endLine < range2.startLine) {
      return (range2.startLine - range1.endLine - 1) <= maxDistance;
    }
    if (range2.endLine < range1.startLine) {
      return (range1.startLine - range2.endLine - 1) <= maxDistance;
    }
    // They overlap
    return true;
  }
}
