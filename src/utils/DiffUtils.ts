import { DiffHunk, ChangeType } from '../models/Change';

export interface DiffOp {
  type: 'keep' | 'delete' | 'insert';
  line: string;
  originalIndex?: number;
  currentIndex?: number;
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
