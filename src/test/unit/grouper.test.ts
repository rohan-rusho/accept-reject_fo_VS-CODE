import * as assert from 'assert';
import { DiffUtils } from '../../utils/DiffUtils';
import { ChangeGrouper } from '../../core/ChangeGrouper';
import { ChangeSource } from '../../models/ChangeSource';

describe('ChangeGrouper', () => {
  const fileUri = 'file:///workspace/test.ts';

  it('should group consecutive line changes into a single ChangeGroup', () => {
    const orig = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    const curr = 'Line 1\nLine 2 mod\nLine 3 mod\nLine 4 mod\nLine 5';

    const hunks = DiffUtils.computeLineDiff(orig, curr);
    const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 3, ChangeSource.AGENT);

    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].startLine, 1);
    assert.strictEqual(groups[0].endLine, 3);
    assert.strictEqual(groups[0].addedLineCount, 3);
    assert.strictEqual(groups[0].deletedLineCount, 3);
  });

  it('should separate edits when an unchanged line is left between them (groupingDistance 0)', () => {
    // Line 1 changed, Line 2 UNCHANGED, Line 3 changed -> MUST BE 2 SEPARATE GROUPS!
    const orig = 'Line 1\nLine 2\nLine 3';
    const curr = 'Line 1_MOD\nLine 2\nLine 3_MOD';

    const hunks = DiffUtils.computeLineDiff(orig, curr);
    assert.strictEqual(hunks.length, 2);

    const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.USER);
    assert.strictEqual(groups.length, 2, 'Non-continuous edits must be separate phases/blocks');
    assert.strictEqual(groups[0].startLine, 0);
    assert.strictEqual(groups[0].endLine, 0);
    assert.strictEqual(groups[1].startLine, 2);
    assert.strictEqual(groups[1].endLine, 2);
  });

  it('should group strictly continuous/consecutive line edits into one phase', () => {
    // Line 1 changed, Line 2 changed consecutively -> ONE GROUP
    const orig = 'Line 1\nLine 2\nLine 3';
    const curr = 'Line 1_MOD\nLine 2_MOD\nLine 3';

    const hunks = DiffUtils.computeLineDiff(orig, curr);
    const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.USER);
    assert.strictEqual(groups.length, 1, 'Continuous edits must be grouped together');
    assert.strictEqual(groups[0].startLine, 0);
    assert.strictEqual(groups[0].endLine, 1);
  });

  it('should keep separated changes as separate groups when distance exceeds threshold', () => {
    // 10 unchanged lines between edits
    const orig = 'START\n' + 'unchanged\n'.repeat(10) + 'END';
    const curr = 'START_MOD\n' + 'unchanged\n'.repeat(10) + 'END_MOD';

    const hunks = DiffUtils.computeLineDiff(orig, curr);
    assert.strictEqual(hunks.length, 2);

    const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 3, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 2, 'Separated changes beyond threshold 3 must remain distinct groups');
    assert.strictEqual(groups[0].startLine, 0);
    assert.strictEqual(groups[1].startLine, 11);
  });
});
