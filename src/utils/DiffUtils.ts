import { DiffHunk, ChangeType } from '../models/Change';

export interface DiffOp {
  type: 'keep' | 'delete' | 'insert';
  line: string;
  originalIndex?: number;
  currentIndex?: number;
}

/** A single span of changed characters within a line. */
export interface WordDiffSpan {
  /** Character offset in the original line where this span begins. */
  originalStart: number;
  /** Character offset in the original line where this span ends (exclusive). */
  originalEnd: number;
  /** Character offset in the current line where this span begins. */
  currentStart: number;
  /** Character offset in the current line where this span ends (exclusive). */
  currentEnd: number;
}

/** Maps paired original/current lines within a modification hunk for word-level diffing. */
export interface LinePairing {
  /** Index into the hunk's originalLines array (-1 if pure insertion). */
  originalIndex: number;
  /** Index into the hunk's currentLines array (-1 if pure deletion). */
  currentIndex: number;
  /** Word-level diff spans (empty if lines are identical or unpaired). */
  wordDiffs: WordDiffSpan[];
}

export class DiffUtils {
  /**
   * Normalize newlines into standard \n and split into lines array.
   */
  public static splitLines(text: string): string[] {
    if (!text) {
      return [];
    }
    // Preserving empty lines
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  }

  /**
   * Myers diff algorithm on lines of code.
   * Compares originalLines (A) to currentLines (B).
   */
  public static computeLineDiff(originalText: string, currentText: string): DiffHunk[] {
    const a = this.splitLines(originalText);
    const b = this.splitLines(currentText);

    // If identical, return no hunks
    if (originalText === currentText) {
      return [];
    }

    const ops = this.myersDiff(a, b);
    return this.opsToHunks(ops);
  }

  /**
   * Implementation of Myers O(ND) greedy diff algorithm.
   */
  public static myersDiff(a: string[], b: string[]): DiffOp[] {
    const N = a.length;
    const M = b.length;

    // Handle edge cases
    if (N === 0 && M === 0) {
      return [];
    }
    if (N === 0) {
      return b.map((line, idx) => ({ type: 'insert', line, currentIndex: idx }));
    }
    if (M === 0) {
      return a.map((line, idx) => ({ type: 'delete', line, originalIndex: idx }));
    }

    const MAX = N + M;
    const v: { [k: number]: number } = { 1: 0 };
    const trace: { [k: number]: number }[] = [];

    let foundD = -1;
    for (let d = 0; d <= MAX; d++) {
      trace.push({ ...v });
      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (k === -d || (k !== d && (v[k - 1] ?? 0) < (v[k + 1] ?? 0))) {
          x = v[k + 1] ?? 0;
        } else {
          x = (v[k - 1] ?? 0) + 1;
        }
        let y = x - k;

        while (x < N && y < M && a[x] === b[y]) {
          x++;
          y++;
        }

        v[k] = x;

        if (x >= N && y >= M) {
          foundD = d;
          break;
        }
      }
      if (foundD !== -1) {
        break;
      }
    }

    // Backtrack to find the optimal edit script
    const ops: DiffOp[] = [];
    let x = N;
    let y = M;

    for (let d = trace.length - 1; d >= 0; d--) {
      const vPrev = trace[d];
      const k = x - y;

      let prevK: number;
      if (k === -d || (k !== d && (vPrev[k - 1] ?? 0) < (vPrev[k + 1] ?? 0))) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }

      const prevX = vPrev[prevK] ?? 0;
      const prevY = prevX - prevK;

      while (x > prevX && y > prevY) {
        x--;
        y--;
        ops.unshift({ type: 'keep', line: a[x], originalIndex: x, currentIndex: y });
      }

      if (d > 0) {
        if (x === prevX) {
          y--;
          ops.unshift({ type: 'insert', line: b[y], currentIndex: y });
        } else if (y === prevY) {
          x--;
          ops.unshift({ type: 'delete', line: a[x], originalIndex: x });
        }
      }
    }

    return ops;
  }

  /**
   * Convert diff operations into structured DiffHunk blocks.
   */
  private static opsToHunks(ops: DiffOp[]): DiffHunk[] {
    const hunks: DiffHunk[] = [];

    let origLine = 0;
    let currLine = 0;

    let i = 0;
    while (i < ops.length) {
      if (ops[i].type === 'keep') {
        origLine++;
        currLine++;
        i++;
        continue;
      }

      const startOrig = origLine;
      const startCurr = currLine;
      const deletedLines: string[] = [];
      const insertedLines: string[] = [];

      while (i < ops.length && ops[i].type !== 'keep') {
        if (ops[i].type === 'delete') {
          deletedLines.push(ops[i].line);
          origLine++;
        } else if (ops[i].type === 'insert') {
          insertedLines.push(ops[i].line);
          currLine++;
        }
        i++;
      }

      let type: ChangeType = 'modify';
      if (deletedLines.length === 0) {
        type = 'insert';
      } else if (insertedLines.length === 0) {
        type = 'delete';
      }

      hunks.push({
        originalStartLine: startOrig,
        originalLineCount: deletedLines.length,
        originalLines: deletedLines,
        currentStartLine: startCurr,
        currentLineCount: insertedLines.length,
        currentLines: insertedLines,
        type
      });
    }

    return hunks;
  }

  /**
   * Compute character-level / word-level diff range between two lines.
   * Returns the single contiguous changed region (prefix/suffix match).
   */
  public static computeWordDiff(
    origLine: string,
    currLine: string
  ): { originalStart: number; originalEnd: number; currentStart: number; currentEnd: number } | undefined {
    if (!origLine && !currLine) {
      return undefined;
    }
    if (origLine === currLine) {
      return undefined;
    }

    let prefix = 0;
    while (
      prefix < origLine.length &&
      prefix < currLine.length &&
      origLine[prefix] === currLine[prefix]
    ) {
      prefix++;
    }

    let origEnd = origLine.length;
    let currEnd = currLine.length;
    while (
      origEnd > prefix &&
      currEnd > prefix &&
      origLine[origEnd - 1] === currLine[currEnd - 1]
    ) {
      origEnd--;
      currEnd--;
    }

    return {
      originalStart: prefix,
      originalEnd: origEnd,
      currentStart: prefix,
      currentEnd: currEnd
    };
  }

  /**
   * Compute multiple word-level diff spans between two lines using
   * character-level Myers diff. Returns all individual changed spans
   * rather than one contiguous region, providing GitHub-style highlighting.
   */
  public static computeMultiSpanWordDiff(
    origLine: string,
    currLine: string
  ): WordDiffSpan[] {
    if (!origLine && !currLine) {
      return [];
    }
    if (origLine === currLine) {
      return [];
    }

    // Use character-level Myers diff for precise multi-span results
    const origChars = origLine.split('');
    const currChars = currLine.split('');
    const charOps = this.myersDiff(origChars, currChars);

    const spans: WordDiffSpan[] = [];
    let origIdx = 0;
    let currIdx = 0;
    let i = 0;

    while (i < charOps.length) {
      if (charOps[i].type === 'keep') {
        origIdx++;
        currIdx++;
        i++;
        continue;
      }

      // Start of a changed region
      const spanOrigStart = origIdx;
      const spanCurrStart = currIdx;

      while (i < charOps.length && charOps[i].type !== 'keep') {
        if (charOps[i].type === 'delete') {
          origIdx++;
        } else if (charOps[i].type === 'insert') {
          currIdx++;
        }
        i++;
      }

      spans.push({
        originalStart: spanOrigStart,
        originalEnd: origIdx,
        currentStart: spanCurrStart,
        currentEnd: currIdx
      });
    }

    return spans;
  }

  /**
   * Compute a similarity score between two strings (0.0 = completely different, 1.0 = identical).
   * Uses Levenshtein distance normalized by the longer string's length.
   */
  public static lineSimilarity(a: string, b: string): number {
    if (a === b) {
      return 1.0;
    }
    if (a.length === 0 || b.length === 0) {
      return 0.0;
    }

    const maxLen = Math.max(a.length, b.length);

    // For very long lines, use the simple prefix/suffix approach for performance
    if (maxLen > 500) {
      let prefix = 0;
      while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
        prefix++;
      }
      let suffix = 0;
      while (
        suffix < (a.length - prefix) &&
        suffix < (b.length - prefix) &&
        a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
      ) {
        suffix++;
      }
      const commonChars = prefix + suffix;
      return commonChars / maxLen;
    }

    // Standard Levenshtein DP (two-row optimization)
    const m = a.length;
    const n = b.length;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);

    for (let j = 0; j <= n; j++) {
      prev[j] = j;
    }

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          curr[j] = prev[j - 1];
        } else {
          curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
        }
      }
      [prev, curr] = [curr, prev];
    }

    const distance = prev[n];
    return 1.0 - distance / maxLen;
  }

  /**
   * Pair deleted and inserted lines within a modification hunk.
   * Uses similarity scoring to optimally match lines and produce
   * word-level diff spans for each paired line.
   *
   * Unmatched deleted lines produce pairings with currentIndex = -1.
   * Unmatched inserted lines produce pairings with originalIndex = -1.
   */
  public static computeLinePairings(
    originalLines: string[],
    currentLines: string[]
  ): LinePairing[] {
    const pairings: LinePairing[] = [];

    if (originalLines.length === 0) {
      // Pure insertions
      for (let j = 0; j < currentLines.length; j++) {
        pairings.push({ originalIndex: -1, currentIndex: j, wordDiffs: [] });
      }
      return pairings;
    }

    if (currentLines.length === 0) {
      // Pure deletions
      for (let i = 0; i < originalLines.length; i++) {
        pairings.push({ originalIndex: i, currentIndex: -1, wordDiffs: [] });
      }
      return pairings;
    }

    // Build similarity matrix
    const m = originalLines.length;
    const n = currentLines.length;
    const sim: number[][] = [];
    for (let i = 0; i < m; i++) {
      sim[i] = [];
      for (let j = 0; j < n; j++) {
        sim[i][j] = this.lineSimilarity(originalLines[i], currentLines[j]);
      }
    }

    // Greedy order-preserving matching with a minimum similarity threshold
    const SIMILARITY_THRESHOLD = 0.3;
    const matchedOrig = new Set<number>();
    const matchedCurr = new Set<number>();
    const matches: Array<{ origIdx: number; currIdx: number; score: number }> = [];

    // Collect all candidate pairs above threshold
    const candidates: Array<{ origIdx: number; currIdx: number; score: number }> = [];
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (sim[i][j] >= SIMILARITY_THRESHOLD) {
          candidates.push({ origIdx: i, currIdx: j, score: sim[i][j] });
        }
      }
    }

    // Sort by score descending, then by positional proximity for ties
    candidates.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.001) {
        return b.score - a.score;
      }
      return Math.abs(a.origIdx - a.currIdx) - Math.abs(b.origIdx - b.currIdx);
    });

    // Greedy matching: pick best pairs while maintaining order
    for (const cand of candidates) {
      if (matchedOrig.has(cand.origIdx) || matchedCurr.has(cand.currIdx)) {
        continue;
      }

      // Check order preservation: no existing match should cross this one
      let orderOk = true;
      for (const existing of matches) {
        if (
          (cand.origIdx < existing.origIdx && cand.currIdx > existing.currIdx) ||
          (cand.origIdx > existing.origIdx && cand.currIdx < existing.currIdx)
        ) {
          orderOk = false;
          break;
        }
      }

      if (orderOk) {
        matches.push(cand);
        matchedOrig.add(cand.origIdx);
        matchedCurr.add(cand.currIdx);
      }
    }

    // Sort matches by original index for output
    matches.sort((a, b) => a.origIdx - b.origIdx);

    // Build output: interleave unmatched lines with matched pairs
    let origPtr = 0;
    let currPtr = 0;

    for (const match of matches) {
      // Emit unmatched original lines before this match
      while (origPtr < match.origIdx) {
        pairings.push({ originalIndex: origPtr, currentIndex: -1, wordDiffs: [] });
        origPtr++;
      }
      // Emit unmatched current lines before this match
      while (currPtr < match.currIdx) {
        pairings.push({ originalIndex: -1, currentIndex: currPtr, wordDiffs: [] });
        currPtr++;
      }

      // Emit the matched pair with word-level diffs
      const wordDiffs = this.computeMultiSpanWordDiff(
        originalLines[match.origIdx],
        currentLines[match.currIdx]
      );
      pairings.push({
        originalIndex: match.origIdx,
        currentIndex: match.currIdx,
        wordDiffs
      });
      origPtr = match.origIdx + 1;
      currPtr = match.currIdx + 1;
    }

    // Emit remaining unmatched lines
    while (origPtr < m) {
      pairings.push({ originalIndex: origPtr, currentIndex: -1, wordDiffs: [] });
      origPtr++;
    }
    while (currPtr < n) {
      pairings.push({ originalIndex: -1, currentIndex: currPtr, wordDiffs: [] });
      currPtr++;
    }

    return pairings;
  }

  /**
   * Format diff as readable unified diff snippet.
   */
  public static formatDiffSnippet(originalLines: string[], currentLines: string[]): string {
    const result: string[] = [];
    for (const line of originalLines) {
      result.push(`- ${line}`);
    }
    for (const line of currentLines) {
      result.push(`+ ${line}`);
    }
    return result.join('\n');
  }
}
