import * as assert from 'assert';
import { DiffUtils } from '../../utils/DiffUtils';

describe('DiffUtils', () => {
  it('should detect identical content with no hunks', () => {
    const text = 'line 1\nline 2\nline 3';
    const hunks = DiffUtils.computeLineDiff(text, text);
    assert.strictEqual(hunks.length, 0);
  });

  it('should detect a single line modification', () => {
    const orig = 'A\nB\nC';
    const curr = 'A\nB_MODIFIED\nC';
    const hunks = DiffUtils.computeLineDiff(orig, curr);

    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].type, 'modify');
    assert.strictEqual(hunks[0].originalStartLine, 1);
    assert.strictEqual(hunks[0].currentStartLine, 1);
    assert.deepStrictEqual(hunks[0].originalLines, ['B']);
    assert.deepStrictEqual(hunks[0].currentLines, ['B_MODIFIED']);
  });

  it('should detect consecutive line modifications as one hunk', () => {
    const orig = 'A\nB\nC\nD\nE';
    const curr = 'A\nB2\nC2\nD2\nE';
    const hunks = DiffUtils.computeLineDiff(orig, curr);

    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].type, 'modify');
    assert.strictEqual(hunks[0].originalStartLine, 1);
    assert.strictEqual(hunks[0].originalLineCount, 3);
    assert.strictEqual(hunks[0].currentLineCount, 3);
  });

  it('should detect pure line insertions', () => {
    const orig = 'A\nB';
    const curr = 'A\nINSERTED_1\nINSERTED_2\nB';
    const hunks = DiffUtils.computeLineDiff(orig, curr);

    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].type, 'insert');
    assert.strictEqual(hunks[0].originalLineCount, 0);
    assert.strictEqual(hunks[0].currentLineCount, 2);
  });

  it('should detect pure line deletions', () => {
    const orig = 'A\nDELETE_ME\nB';
    const curr = 'A\nB';
    const hunks = DiffUtils.computeLineDiff(orig, curr);

    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].type, 'delete');
    assert.strictEqual(hunks[0].originalLineCount, 1);
    assert.strictEqual(hunks[0].currentLineCount, 0);
  });

  it('should detect separated changes as separate hunks', () => {
    const orig = 'A\nB\nC\nD\nE\nF\nG\nH';
    const curr = 'A\nB_MOD\nC\nD\nE\nF_MOD\nG\nH';
    const hunks = DiffUtils.computeLineDiff(orig, curr);

    assert.strictEqual(hunks.length, 2);
    assert.strictEqual(hunks[0].originalStartLine, 1);
    assert.strictEqual(hunks[1].originalStartLine, 5);
  });

  it('should compute exact character-level word diffs for modified lines', () => {
    const orig = '<DropdownSelection timestamp="2026-03-30T04:44:58.494360300Z">';
    const curr = '<DropdownSelection timestamp="2026-10-07T09:43:45.368153900Z">';

    const diff = DiffUtils.computeWordDiff(orig, curr);
    assert.ok(diff);
    assert.strictEqual(orig.substring(diff.originalStart, diff.originalEnd), '03-30T04:44:58.4943603');
    assert.strictEqual(curr.substring(diff.currentStart, diff.currentEnd), '10-07T09:43:45.3681539');
  });

  it('should compute word-level diff for prefix changes', () => {
    const orig = 'etEmail.setError("Please enter your User ID");';
    const curr = 'tilUserEmail.setError("Please enter your User ID");';

    const diff = DiffUtils.computeWordDiff(orig, curr);
    assert.ok(diff);
    assert.strictEqual(orig.substring(diff.originalStart, diff.originalEnd), 'et');
    assert.strictEqual(curr.substring(diff.currentStart, diff.currentEnd), 'tilUser');
  });
});
