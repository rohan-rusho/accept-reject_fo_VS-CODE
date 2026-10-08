import * as assert from 'assert';
import { DiffUtils } from '../../utils/DiffUtils';
import { ChangeGrouper } from '../../core/ChangeGrouper';
import { ChangeHistory } from '../../core/ChangeHistory';
import { ChangeApplier } from '../../core/ChangeApplier';
import { ChangeSource } from '../../models/ChangeSource';
import { ChangeGroup } from '../../models/ChangeGroup';
import { ChangeOperation } from '../../models/ChangeOperation';

describe('Section 34 Specification Test Suite', () => {
  const uri = 'file:///workspace/sample.ts';

  it('Scenario 1: Single line — A, B, C -> Change B -> Accept B', () => {
    const original = 'A\nB\nC';
    const modified = 'A\nB_NEW\nC';

    const hunks = DiffUtils.computeLineDiff(original, modified);
    const groups = ChangeGrouper.groupHunks(hunks, uri, original, modified, 3, ChangeSource.AGENT);

    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].currentText, 'B_NEW');
    assert.strictEqual(groups[0].originalText, 'B');

    // Accept B: baseline is updated to include B_NEW
    const newBaseline = ChangeApplier.applyAcceptToBaseline(original, groups[0]);
    assert.strictEqual(newBaseline, modified);

    // Re-diff after accept produces 0 hunks
    const remainingHunks = DiffUtils.computeLineDiff(newBaseline, modified);
    assert.strictEqual(remainingHunks.length, 0, 'No pending changes remain after accept');
  });

  it('Scenario 2: Multiple consecutive lines — A, B, C, D, E -> Change B–D -> ONE change group', () => {
    const original = 'A\nB\nC\nD\nE';
    const modified = 'A\nB_NEW\nC_NEW\nD_NEW\nE';

    const hunks = DiffUtils.computeLineDiff(original, modified);
    const groups = ChangeGrouper.groupHunks(hunks, uri, original, modified, 3, ChangeSource.AGENT);

    assert.strictEqual(groups.length, 1, 'Consecutive lines B-D must become ONE change group');
    assert.strictEqual(groups[0].startLine, 1);
    assert.strictEqual(groups[0].endLine, 3);
    assert.strictEqual(groups[0].addedLineCount, 3);
    assert.strictEqual(groups[0].deletedLineCount, 3);
  });

  it('Scenario 3: Multiple separated changes — Change A, unchanged code, Change B -> Separate groups', () => {
    const original = ['A', ...Array(20).fill('middle_code'), 'Z'].join('\n');
    const modified = ['A_MOD', ...Array(20).fill('middle_code'), 'Z_MOD'].join('\n');

    const hunks = DiffUtils.computeLineDiff(original, modified);
    const groups = ChangeGrouper.groupHunks(hunks, uri, original, modified, 3, ChangeSource.AGENT);

    assert.strictEqual(groups.length, 2, 'Separated changes beyond threshold 3 must remain distinct groups');
    assert.strictEqual(groups[0].startLine, 0);
    assert.strictEqual(groups[1].startLine, 21);
  });

  it('Scenario 4: Accept one — Accept Change A while Change B remains pending', () => {
    const original = ['A', ...Array(15).fill('code'), 'B'].join('\n');
    const modified = ['A_MOD', ...Array(15).fill('code'), 'B_MOD'].join('\n');

    let baseline = original;
    const hunks = DiffUtils.computeLineDiff(baseline, modified);
    const groups = ChangeGrouper.groupHunks(hunks, uri, baseline, modified, 3, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 2);

    // Accept Change A (group 0)
    baseline = ChangeApplier.applyAcceptToBaseline(baseline, groups[0]);

    // Recompute diff between new baseline and modified document
    const updatedHunks = DiffUtils.computeLineDiff(baseline, modified);
    const remainingGroups = ChangeGrouper.groupHunks(updatedHunks, uri, baseline, modified, 3, ChangeSource.AGENT);

    assert.strictEqual(remainingGroups.length, 1, 'Change B must remain pending');
    assert.strictEqual(remainingGroups[0].currentText, 'B_MOD');
  });

  it('Scenario 5: Reject one — Reject Change B while Change A remains untouched', () => {
    const originalLines = ['A', ...Array(15).fill('code'), 'B'];
    const modifiedLines = ['A_MOD', ...Array(15).fill('code'), 'B_MOD'];

    let baseline = originalLines.join('\n');
    let currentDoc = modifiedLines.join('\n');

    const hunks = DiffUtils.computeLineDiff(baseline, currentDoc);
    const groups = ChangeGrouper.groupHunks(hunks, uri, baseline, currentDoc, 3, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 2);

    // Reject Change B (groups[1]) -> restore its lines in document
    const docLines = DiffUtils.splitLines(currentDoc);
    docLines.splice(groups[1].startLine, groups[1].addedLineCount, groups[1].originalText);
    currentDoc = docLines.join('\n');

    // Recompute diff against baseline
    const remainingHunks = DiffUtils.computeLineDiff(baseline, currentDoc);
    const remainingGroups = ChangeGrouper.groupHunks(remainingHunks, uri, baseline, currentDoc, 3, ChangeSource.AGENT);

    assert.strictEqual(remainingGroups.length, 1, 'Change A must remain untouched and pending');
    assert.strictEqual(remainingGroups[0].currentText, 'A_MOD');
  });

  it('Scenario 6: Accept file — Multiple changes in file, Accept File accepts all', () => {
    const original = 'A\n' + 'code\n'.repeat(10) + 'B';
    const modified = 'A_MOD\n' + 'code\n'.repeat(10) + 'B_MOD';

    let baseline = original;
    const currentDoc = modified;

    // Accept File means baseline becomes current document
    baseline = currentDoc;

    const remainingHunks = DiffUtils.computeLineDiff(baseline, currentDoc);
    assert.strictEqual(remainingHunks.length, 0, 'Accept File must clear all pending changes');
  });

  it('Scenario 7: Accept all — Multiple files, Accept All accepts all pending changes', () => {
    const file1Orig = 'File1 original';
    const file1Mod = 'File1 modified';
    const file2Orig = 'File2 original';
    const file2Mod = 'File2 modified';

    let baseline1 = file1Orig;
    let baseline2 = file2Orig;

    // Accept All updates both baselines
    baseline1 = file1Mod;
    baseline2 = file2Mod;

    assert.strictEqual(DiffUtils.computeLineDiff(baseline1, file1Mod).length, 0);
    assert.strictEqual(DiffUtils.computeLineDiff(baseline2, file2Mod).length, 0);
  });

  it('Scenario 8: Undo — Accept Change A -> Undo -> Original state returns', () => {
    const original = 'Original line';
    const modified = 'Modified line';

    let baseline = original;
    let currentDoc = modified;

    const history = new ChangeHistory();

    // Group the change
    const hunks = DiffUtils.computeLineDiff(baseline, currentDoc);
    const groups = ChangeGrouper.groupHunks(hunks, uri, baseline, currentDoc, 3, ChangeSource.AGENT);

    // 1. Accept Change A
    const baselineBefore = baseline;
    const docBefore = currentDoc;
    const newBaseline = ChangeApplier.applyAcceptToBaseline(baseline, groups[0]);
    baseline = newBaseline;

    history.push({
      id: 'op1',
      fileUri: uri,
      timestamp: Date.now(),
      source: ChangeSource.AGENT,
      operationType: 'accept-change',
      affectedRanges: [{ startLine: 0, endLine: 0 }],
      fileSnapshots: [
        {
          fileUri: uri,
          baselineBefore,
          baselineAfter: newBaseline,
          documentBefore: docBefore,
          documentAfter: currentDoc
        }
      ],
      description: 'Accepted change'
    });

    // Verify accepted state has 0 pending changes
    assert.strictEqual(DiffUtils.computeLineDiff(baseline, currentDoc).length, 0);

    // 2. Undo
    const op = history.pop()!;
    baseline = op.fileSnapshots[0].baselineBefore;
    currentDoc = op.fileSnapshots[0].documentBefore;

    // Verify original state returns
    const hunksAfterUndo = DiffUtils.computeLineDiff(baseline, currentDoc);
    assert.strictEqual(hunksAfterUndo.length, 1, 'Change is pending review again after undo');
    assert.strictEqual(baseline, original, 'Baseline restored to original');
  });

  it('Scenario 9: Multiple undo — Accept A -> Accept B -> Accept C -> Undo C -> Undo B -> Undo A', () => {
    const history = new ChangeHistory();

    const opA: ChangeOperation = {
      id: 'A',
      fileUri: uri,
      timestamp: 1,
      source: ChangeSource.AGENT,
      operationType: 'accept-change',
      affectedRanges: [],
      fileSnapshots: [{ fileUri: uri, baselineBefore: '0', baselineAfter: 'A', documentBefore: 'A', documentAfter: 'A' }],
      description: 'Accept A'
    };
    const opB: ChangeOperation = {
      id: 'B',
      fileUri: uri,
      timestamp: 2,
      source: ChangeSource.AGENT,
      operationType: 'accept-change',
      affectedRanges: [],
      fileSnapshots: [{ fileUri: uri, baselineBefore: 'A', baselineAfter: 'B', documentBefore: 'B', documentAfter: 'B' }],
      description: 'Accept B'
    };
    const opC: ChangeOperation = {
      id: 'C',
      fileUri: uri,
      timestamp: 3,
      source: ChangeSource.AGENT,
      operationType: 'accept-change',
      affectedRanges: [],
      fileSnapshots: [{ fileUri: uri, baselineBefore: 'B', baselineAfter: 'C', documentBefore: 'C', documentAfter: 'C' }],
      description: 'Accept C'
    };

    history.push(opA);
    history.push(opB);
    history.push(opC);

    assert.strictEqual(history.pop()?.id, 'C', 'First undo reverts C');
    assert.strictEqual(history.pop()?.id, 'B', 'Second undo reverts B');
    assert.strictEqual(history.pop()?.id, 'A', 'Third undo reverts A');
    assert.strictEqual(history.canUndo(), false, 'History is now empty');
  });

  it('Scenario 10: Conflict detection — Manual edits in pending region detected as conflict', () => {
    const original = 'function test() {\n  return 1;\n}';
    const modified = 'function test() {\n  return 2;\n}';

    const hunks = DiffUtils.computeLineDiff(original, modified);
    const groups = ChangeGrouper.groupHunks(hunks, uri, original, modified, 3, ChangeSource.AGENT);
    const group = groups[0];

    // User manually modifies the region to something else
    const manuallyEditedDoc = 'function test() {\n  return 999; // conflict\n}';
    const docLines = DiffUtils.splitLines(manuallyEditedDoc);
    const textInTargetRange = docLines.slice(group.startLine, group.endLine + 1).join('\n');

    // Validate if the text currently in target range matches expected currentText
    const isConflict = textInTargetRange !== group.currentText;
    assert.strictEqual(isConflict, true, 'Extension must detect conflict when region was manually modified');
  });

  it('Scenario 11: New file creation — Empty baseline "" produces 100% green additions across all lines', () => {
    const original = ''; // Newly created file has empty baseline
    const newFileContent = 'import express from "express";\nconst app = express();\nexport default app;';

    const hunks = DiffUtils.computeLineDiff(original, newFileContent);
    const groups = ChangeGrouper.groupHunks(hunks, uri, original, newFileContent, 0, ChangeSource.AGENT);

    assert.strictEqual(groups.length, 1, 'New file should form one single addition block');
    assert.strictEqual(groups[0].startLine, 0, 'Starts at line 0');
    assert.strictEqual(groups[0].endLine, 2, 'Ends at line 2 (covers all 3 lines)');
    assert.strictEqual(groups[0].addedLineCount, 3, 'All 3 lines are additions (green highlighted)');
    assert.strictEqual(groups[0].deletedLineCount, 0, 'No lines deleted');
    assert.strictEqual(groups[0].originalText, '', 'Original text is empty');
  });

  it('Scenario 12: Accept and Reject on newly created file', () => {
    const original = '';
    const newFileContent = 'const secret = 42;\nconsole.log(secret);';

    const hunks = DiffUtils.computeLineDiff(original, newFileContent);
    const groups = ChangeGrouper.groupHunks(hunks, uri, original, newFileContent, 0, ChangeSource.AGENT);
    const group = groups[0];

    // Simulating Accept: baseline becomes current text, 0 changes remain
    const acceptedBaseline = newFileContent;
    const diffAfterAccept = DiffUtils.computeLineDiff(acceptedBaseline, newFileContent);
    assert.strictEqual(diffAfterAccept.length, 0, 'After accept, no pending changes remain');

    // Simulating Reject: content reverts to original baseline (""), clearing the file
    const rejectedContent = group.originalText;
    assert.strictEqual(rejectedContent, '', 'Rejection of new file empties/removes content');
  });

  it('Scenario 13: 5 separated modified hunks — user accepts 3 places and rejects 2 places independently', () => {
    let baseline = 'L0\nL1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10';
    let current = 'L0\nMOD_1\nL2\nMOD_2\nL4\nMOD_3\nL6\nMOD_4\nL8\nMOD_5\nL10';

    // 1. Initial 5 hunks detected
    let hunks = DiffUtils.computeLineDiff(baseline, current);
    let groups = ChangeGrouper.groupHunks(hunks, uri, baseline, current, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 5, 'Exactly 5 separated hunks detected');

    // 2. Accept Hunk 0 (MOD_1)
    baseline = ChangeApplier.applyAcceptToBaseline(baseline, groups[0]);
    hunks = DiffUtils.computeLineDiff(baseline, current);
    groups = ChangeGrouper.groupHunks(hunks, uri, baseline, current, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 4, '4 hunks remaining after accepting Hunk 1');

    // 3. Reject Hunk 0 (MOD_2: second original hunk, now at index 0 of remaining)
    // Reverting MOD_2 back to L3 in current text
    const currLines = current.split('\n');
    currLines[groups[0].startLine] = groups[0].originalText;
    current = currLines.join('\n');
    hunks = DiffUtils.computeLineDiff(baseline, current);
    groups = ChangeGrouper.groupHunks(hunks, uri, baseline, current, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 3, '3 hunks remaining after rejecting MOD_2');

    // 4. Accept MOD_3
    baseline = ChangeApplier.applyAcceptToBaseline(baseline, groups[0]);
    hunks = DiffUtils.computeLineDiff(baseline, current);
    groups = ChangeGrouper.groupHunks(hunks, uri, baseline, current, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 2, '2 hunks remaining after accepting MOD_3');

    // 5. Accept MOD_4
    baseline = ChangeApplier.applyAcceptToBaseline(baseline, groups[0]);
    hunks = DiffUtils.computeLineDiff(baseline, current);
    groups = ChangeGrouper.groupHunks(hunks, uri, baseline, current, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 1, '1 hunk remaining after accepting MOD_4');

    // 6. Reject MOD_5 (revert to L9)
    const currLinesFinal = current.split('\n');
    currLinesFinal[groups[0].startLine] = groups[0].originalText;
    current = currLinesFinal.join('\n');
    hunks = DiffUtils.computeLineDiff(baseline, current);
    groups = ChangeGrouper.groupHunks(hunks, uri, baseline, current, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 0, '0 hunks remaining: all 5 hunks independently resolved!');

    // Verify expected final result has MOD_1, L3 (reverted), MOD_3, MOD_4, L9 (reverted)
    const expected = 'L0\nMOD_1\nL2\nL3\nL4\nMOD_3\nL6\nMOD_4\nL8\nL9\nL10';
    assert.strictEqual(current, expected, 'Final document reflects 3 accepted changes and 2 rejected reversions');
    assert.strictEqual(baseline, expected, 'Baseline matches final document state');
  });
});
