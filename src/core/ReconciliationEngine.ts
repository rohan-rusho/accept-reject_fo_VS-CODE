import { ChangeGroup, HunkStatus, ChangeOwnership } from '../models/ChangeGroup';
import { DiffUtils } from '../utils/DiffUtils';

export class ReconciliationEngine {
  /**
   * Reconciles a list of pending hunks against the current document content (BASE, PROPOSED, CURRENT).
   *
   * Following the Antigravity reconciliation model:
   * 1. AGENT_PRESENT -> status: 'PENDING', ownership: 'AGENT'
   * 2. USER_NON_OVERLAPPING -> status: 'PENDING', relocated dynamically
   * 3. USER_OVERLAPPING -> status: 'OVERRIDDEN', ownership: 'USER' (user edit wins)
   * 4. AGENT_REMOVED -> status: 'REJECTED'
   * 5. CONFLICT -> status: 'CONFLICT'
   */
  public static reconcileHunks(
    hunks: ChangeGroup[],
    baseText: string,
    currentText: string
  ): ChangeGroup[] {
    if (!hunks || hunks.length === 0) {
      return [];
    }

    const currLines = DiffUtils.splitLines(currentText);
    const baseLines = DiffUtils.splitLines(baseText);

    return hunks.map((hunk) => {
      // If already accepted or rejected by user action, preserve status
      if (hunk.status === 'ACCEPTED' || hunk.status === 'REJECTED') {
        return hunk;
      }

      const located = this.locateHunkInCurrent(hunk, currLines, baseLines);

      if (located.state === 'AGENT_PRESENT') {
        return {
          ...hunk,
          startLine: located.startLine,
          endLine: located.endLine,
          currentText: located.matchedText,
          status: 'PENDING',
          ownership: 'AGENT',
          isConflict: false,
          conflictReason: undefined
        };
      }

      if (located.state === 'USER_OVERLAPPING') {
        // Section 15 & 20: User modified the same region. User's edit wins.
        return {
          ...hunk,
          startLine: located.startLine,
          endLine: located.endLine,
          currentText: located.matchedText,
          status: 'OVERRIDDEN',
          ownership: 'USER',
          isConflict: false,
          conflictReason: 'Modified by user edit (user change preserved)'
        };
      }

      if (located.state === 'AGENT_REMOVED') {
        // Section 20 Case B: User restored baseline content in this region.
        return {
          ...hunk,
          startLine: located.startLine,
          endLine: located.endLine,
          currentText: located.matchedText,
          status: 'REJECTED',
          ownership: 'USER',
          isConflict: false
        };
      }

      // If not located via anchors or diff, check if baseText in that region exists
      return {
        ...hunk,
        startLine: Math.min(hunk.startLine, Math.max(0, currLines.length - 1)),
        endLine: Math.min(hunk.endLine, Math.max(0, currLines.length - 1)),
        status: hunk.status || 'PENDING'
      };
    });
  }

  /**
   * Locates a hunk inside current lines using exact matching, context anchors, and diff fallback.
   */
  private static locateHunkInCurrent(
    hunk: ChangeGroup,
    currLines: string[],
    baseLines: string[]
  ): {
    startLine: number;
    endLine: number;
    matchedText: string;
    state: 'AGENT_PRESENT' | 'USER_OVERLAPPING' | 'AGENT_REMOVED' | 'NOT_FOUND';
  } {
    const proposed = (hunk.proposedText !== undefined ? hunk.proposedText : hunk.currentText).replace(/\r\n/g, '\n');
    const base = hunk.originalText.replace(/\r\n/g, '\n');
    const proposedLines = DiffUtils.splitLines(proposed);
    const baseHunkLines = DiffUtils.splitLines(base);

    // 1. Check exact current range
    if (hunk.startLine < currLines.length) {
      const candidateEnd = Math.min(hunk.startLine + proposedLines.length - 1, currLines.length - 1);
      const textAtRange = currLines.slice(hunk.startLine, candidateEnd + 1).join('\n');

      if (textAtRange === proposed) {
        return {
          startLine: hunk.startLine,
          endLine: candidateEnd,
          matchedText: textAtRange,
          state: 'AGENT_PRESENT'
        };
      }

      if (textAtRange === base && base.length > 0) {
        return {
          startLine: hunk.startLine,
          endLine: candidateEnd,
          matchedText: textAtRange,
          state: 'AGENT_REMOVED'
        };
      }
    }

    // 2. Search for exact proposedText anywhere in the file (handles line shifting / formatting above)
    if (proposed.length > 0) {
      for (let i = 0; i <= currLines.length - proposedLines.length; i++) {
        const slice = currLines.slice(i, i + proposedLines.length).join('\n');
        if (slice === proposed) {
          return {
            startLine: i,
            endLine: i + proposedLines.length - 1,
            matchedText: slice,
            state: 'AGENT_PRESENT'
          };
        }
      }
    }

    // 3. Anchor Search: look for beforeContext and afterContext (handles formatting and user edits)
    if (hunk.beforeContext || hunk.afterContext) {
      const beforeAnchor = hunk.beforeContext ? DiffUtils.splitLines(hunk.beforeContext).pop()?.trim() : '';
      const afterAnchor = hunk.afterContext ? DiffUtils.splitLines(hunk.afterContext)[0]?.trim() : '';

      for (let i = 0; i < currLines.length; i++) {
        const lineTrim = currLines[i].trim();
        if (beforeAnchor && lineTrim === beforeAnchor) {
          // Look ahead for afterAnchor
          for (let j = i + 1; j < Math.min(currLines.length, i + 30); j++) {
            if (!afterAnchor || currLines[j].trim() === afterAnchor) {
              const regionStart = i + 1;
              const regionEnd = j - 1;
              if (regionStart <= regionEnd) {
                const regionText = currLines.slice(regionStart, regionEnd + 1).join('\n');
                if (regionText === proposed) {
                  return { startLine: regionStart, endLine: regionEnd, matchedText: regionText, state: 'AGENT_PRESENT' };
                }
                if (regionText === base) {
                  return { startLine: regionStart, endLine: regionEnd, matchedText: regionText, state: 'AGENT_REMOVED' };
                }
                // Overlapping user edit!
                return { startLine: regionStart, endLine: regionEnd, matchedText: regionText, state: 'USER_OVERLAPPING' };
              }
            }
          }
        }
      }
    }

    // 4. Overlap fallback check: If line range was edited and differs from proposed and base
    if (hunk.startLine < currLines.length) {
      const candidateEnd = Math.min(hunk.endLine, currLines.length - 1);
      const textAtRange = currLines.slice(hunk.startLine, candidateEnd + 1).join('\n');
      if (textAtRange !== proposed && textAtRange !== base) {
        return {
          startLine: hunk.startLine,
          endLine: candidateEnd,
          matchedText: textAtRange,
          state: 'USER_OVERLAPPING'
        };
      }
    }

    return {
      startLine: hunk.startLine,
      endLine: hunk.endLine,
      matchedText: hunk.currentText,
      state: 'NOT_FOUND'
    };
  }
}
