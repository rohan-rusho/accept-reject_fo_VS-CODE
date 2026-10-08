import { DiffHunk, ChangeType } from '../models/Change';
import { ChangeGroup } from '../models/ChangeGroup';
import { ChangeSource } from '../models/ChangeSource';
import { DiffUtils } from '../utils/DiffUtils';

export class ChangeGrouper {
  /**
   * Group consecutive and nearby diff hunks into unified ChangeGroup blocks.
   *
   * @param hunks List of raw diff hunks from DiffUtils.
   * @param fileUri Target file URI string.
   * @param originalText Baseline text of the file.
   * @param currentText Current text of the file.
   * @param groupingDistance Max unchanged lines between hunks to merge (default 3).
   * @param source Detected change source.
   */
  public static groupHunks(
    hunks: DiffHunk[],
    fileUri: string,
    originalText: string,
    currentText: string,
    groupingDistance: number = 0,
    source: ChangeSource = ChangeSource.UNKNOWN,
    proposalId?: string
  ): ChangeGroup[] {
    if (!hunks || hunks.length === 0) {
      return [];
    }

    const pId = proposalId || `prop_${Date.now()}`;
    const origLines = DiffUtils.splitLines(originalText);
    const currLines = DiffUtils.splitLines(currentText);

    // First, convert individual hunks to raw group objects
    const rawGroups: ChangeGroup[] = hunks.map((hunk, index) => {
      const origStart = hunk.originalStartLine;
      const origEnd = hunk.originalLineCount > 0
        ? hunk.originalStartLine + hunk.originalLineCount - 1
        : hunk.originalStartLine;

      const currStart = hunk.currentStartLine;
      const currEnd = hunk.currentLineCount > 0
        ? hunk.currentStartLine + hunk.currentLineCount - 1
        : hunk.currentStartLine;

      const hunkOrigText = hunk.originalLines.join('\n');
      const hunkCurrText = hunk.currentLines.join('\n');

      const beforeStart = Math.max(0, currStart - 3);
      const beforeContext = currLines.slice(beforeStart, currStart).join('\n');
      const afterEnd = Math.min(currLines.length, currEnd + 4);
      const afterContext = currLines.slice(currEnd + 1, afterEnd).join('\n');

      return {
        id: `${fileUri}#${index}_${currStart}-${currEnd}_${Date.now()}`,
        proposalId: pId,
        fileUri,
        startLine: currStart,
        endLine: currEnd,
        originalStartLine: origStart,
        originalEndLine: origEnd,
        originalText: hunkOrigText,
        proposedText: hunkCurrText,
        currentText: hunkCurrText,
        beforeContext,
        afterContext,
        addedLineCount: hunk.currentLineCount,
        deletedLineCount: hunk.originalLineCount,
        type: hunk.type,
        source,
        status: 'PENDING',
        ownership: 'AGENT',
        timestamp: Date.now()
      };
    });

    if (rawGroups.length <= 1) {
      return rawGroups;
    }

    // Merge adjacent / nearby groups within groupingDistance
    const merged: ChangeGroup[] = [];
    let current = { ...rawGroups[0] };

    for (let i = 1; i < rawGroups.length; i++) {
      const next = rawGroups[i];

      // Calculate distance between current and next in current lines
      const currDistance = next.startLine > current.endLine
        ? next.startLine - current.endLine - 1
        : 0;

      // Calculate distance in original lines
      const origDistance = next.originalStartLine > current.originalEndLine
        ? next.originalStartLine - current.originalEndLine - 1
        : 0;

      if (currDistance <= groupingDistance && origDistance <= groupingDistance) {
        // Merge next into current
        const newCurrEnd = Math.max(current.endLine, next.endLine);
        const newOrigEnd = Math.max(current.originalEndLine, next.originalEndLine);

        // Slice exact text from current and original line arrays to capture intermediate unchanged lines
        const combinedCurrLines = currLines.slice(current.startLine, newCurrEnd + 1);
        const combinedOrigLines = origLines.slice(current.originalStartLine, newOrigEnd + 1);

        current.endLine = newCurrEnd;
        current.originalEndLine = newOrigEnd;
        current.currentText = combinedCurrLines.join('\n');
        current.proposedText = combinedCurrLines.join('\n');
        current.originalText = combinedOrigLines.join('\n');
        current.afterContext = next.afterContext;
        current.addedLineCount = current.addedLineCount + next.addedLineCount;
        current.deletedLineCount = current.deletedLineCount + next.deletedLineCount;
        current.type = 'modify';
        current.status = 'PENDING';
        current.ownership = 'AGENT';
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);

    // Re-index IDs so they are sequential and stable
    return merged.map((group, idx) => ({
      ...group,
      id: `${fileUri}#block_${idx + 1}_${group.startLine}-${group.endLine}`
    }));
  }
}
