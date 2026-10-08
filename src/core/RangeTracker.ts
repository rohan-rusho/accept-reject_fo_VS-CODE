import * as vscode from 'vscode';
import { ChangeGroup } from '../models/ChangeGroup';
import { DiffUtils } from '../utils/DiffUtils';

export class RangeTracker {
  /**
   * Adjust pending change groups in response to a document content change event.
   */
  public static adjustRangesOnContentChange(
    groups: ChangeGroup[],
    contentChanges: readonly vscode.TextDocumentContentChangeEvent[]
  ): ChangeGroup[] {
    if (!groups || groups.length === 0 || !contentChanges || contentChanges.length === 0) {
      return groups;
    }

    // Sort content changes in descending line order so line shifts don't affect subsequent calculations
    const sortedChanges = [...contentChanges].sort(
      (a, b) => b.range.start.line - a.range.start.line
    );

    let updatedGroups = [...groups];

    for (const change of sortedChanges) {
      const changeStartLine = change.range.start.line;
      const changeEndLine = change.range.end.line;
      const linesAdded = DiffUtils.splitLines(change.text).length - 1;
      const linesRemoved = changeEndLine - changeStartLine;
      const lineDelta = linesAdded - linesRemoved;

      updatedGroups = updatedGroups.map((group) => {
        // Case 1: Edit occurs completely after this group -> no line shift for this group
        if (changeStartLine > group.endLine) {
          return group;
        }

        // Case 2: Edit occurs completely before this group -> shift this group by lineDelta
        if (changeEndLine < group.startLine) {
          const newStart = Math.max(0, group.startLine + lineDelta);
          const newEnd = Math.max(newStart, group.endLine + lineDelta);
          return {
            ...group,
            startLine: newStart,
            endLine: newEnd
          };
        }

        // Case 3: Edit intersects with this group -> mark conflict and update range boundaries
        const newStart = Math.min(group.startLine, changeStartLine);
        const newEnd = Math.max(newStart, group.endLine + lineDelta);
        return {
          ...group,
          startLine: newStart,
          endLine: newEnd,
          isConflict: true,
          conflictReason: 'File was manually edited in this region while change was pending.'
        };
      });
    }

    return updatedGroups;
  }

  /**
   * Adjust subsequent change groups after a specific group is rejected and replaced.
   */
  public static adjustGroupsAfterReplacement(
    groups: ChangeGroup[],
    appliedGroupId: string,
    lineDelta: number
  ): ChangeGroup[] {
    const appliedGroup = groups.find((g) => g.id === appliedGroupId);
    if (!appliedGroup || lineDelta === 0) {
      return groups.filter((g) => g.id !== appliedGroupId);
    }

    const appliedEndLine = appliedGroup.endLine;

    return groups
      .filter((g) => g.id !== appliedGroupId)
      .map((group) => {
        if (group.startLine > appliedEndLine) {
          return {
            ...group,
            startLine: Math.max(0, group.startLine + lineDelta),
            endLine: Math.max(0, group.endLine + lineDelta)
          };
        }
        return group;
      });
  }
}
