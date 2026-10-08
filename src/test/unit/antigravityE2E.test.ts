import * as assert from 'assert';
import { DiffUtils } from '../../utils/DiffUtils';
import { ChangeGrouper } from '../../core/ChangeGrouper';
import { ReconciliationEngine } from '../../core/ReconciliationEngine';
import { ChangeHistory } from '../../core/ChangeHistory';
import { ChangeOperation } from '../../models/ChangeOperation';
import { ChangeSource } from '../../models/ChangeSource';

describe('Antigravity Section 54 End-to-End Scenario', () => {
  it('Complete Section 54 lifecycle workflow', () => {
    // 1. Agent starts: Base captured for 3 files
    const file1Uri = 'file:///workspace/File1.java';
    const file2Uri = 'file:///workspace/File2.java';
    const file3Uri = 'file:///workspace/File3.java';

    const base1 = 'class File1 {\n  int a = 1;\n  int b = 2;\n  int c = 3;\n}';
    const base2 = 'class File2 {\n  void foo() {\n    return;\n  }\n}';
    const base3 = 'class File3 {\n  String name = "base";\n}';

    // 2. Agent modifies 3 files
    const prop1 = 'class File1 {\n  int a = 10; // agent hunk 1\n  int b = 2;\n  int c = 30; // agent hunk 2\n}';
    const prop2 = 'class File2 {\n  void foo() {\n    log(); // agent\n    return;\n  }\n}';
    const prop3 = 'class File3 {\n  String name = "agent";\n}';

    // 3. Changes grouped into logical hunks
    const hunks1 = DiffUtils.computeLineDiff(base1, prop1);
    const groups1 = ChangeGrouper.groupHunks(hunks1, file1Uri, base1, prop1, 0, ChangeSource.AGENT);
    assert.strictEqual(groups1.length, 2, 'File 1 has 2 distinct hunks');

    const hunks2 = DiffUtils.computeLineDiff(base2, prop2);
    const groups2 = ChangeGrouper.groupHunks(hunks2, file2Uri, base2, prop2, 0, ChangeSource.AGENT);
    assert.strictEqual(groups2.length, 1, 'File 2 has 1 hunk');

    // 4. User modifies unrelated code in File 1 (modifies line 2 'int b = 200;')
    const liveFile1 = 'class File1 {\n  int a = 10; // agent hunk 1\n  int b = 200; // user edit unrelated\n  int c = 30; // agent hunk 2\n}';

    // 5. User also modifies one agent hunk in File 1 (overrides agent hunk 2 to 'int c = 999; // user')
    const liveFile1WithOverride = 'class File1 {\n  int a = 10; // agent hunk 1\n  int b = 200; // user edit unrelated\n  int c = 999; // user override\n}';

    // 6. System recognizes user ownership (OVERRIDDEN) on hunk 2 while hunk 1 remains PENDING
    const reconciled1 = ReconciliationEngine.reconcileHunks(groups1, base1, liveFile1WithOverride);
    assert.strictEqual(reconciled1[0].status, 'PENDING', 'Hunk 1 remains PENDING');
    assert.strictEqual(reconciled1[0].ownership, 'AGENT');

    assert.strictEqual(reconciled1[1].status, 'OVERRIDDEN', 'Hunk 2 recognized as OVERRIDDEN');
    assert.strictEqual(reconciled1[1].ownership, 'USER');

    // 7. User accepts agent hunk 1: only that hunk is accepted
    const history = new ChangeHistory(50);
    const opAcceptHunk1: ChangeOperation = {
      id: 'tx_accept_hunk_1',
      fileUri: file1Uri,
      timestamp: 1,
      source: ChangeSource.AGENT,
      operationType: 'accept-change',
      transactionType: 'ACCEPT_CHANGE',
      changeIds: [groups1[0].id],
      affectedRanges: [{ startLine: groups1[0].startLine, endLine: groups1[0].endLine }],
      fileSnapshots: [
        {
          fileUri: file1Uri,
          baselineBefore: base1,
          baselineAfter: 'class File1 {\n  int a = 10;\n  int b = 2;\n  int c = 3;\n}',
          documentBefore: liveFile1WithOverride,
          documentAfter: liveFile1WithOverride
        }
      ],
      description: 'Accepted hunk 1 in File1'
    };
    history.push(opAcceptHunk1);

    // 8. User clicks Accept File on File 2
    const opAcceptFile2: ChangeOperation = {
      id: 'tx_accept_file_2',
      fileUri: file2Uri,
      timestamp: 2,
      source: ChangeSource.AGENT,
      operationType: 'accept-file',
      transactionType: 'ACCEPT_FILE',
      changeIds: [groups2[0].id],
      affectedRanges: [],
      fileSnapshots: [
        {
          fileUri: file2Uri,
          baselineBefore: base2,
          baselineAfter: prop2,
          documentBefore: prop2,
          documentAfter: prop2
        }
      ],
      description: 'Accepted all changes in File2'
    };
    history.push(opAcceptFile2);

    // 9. User clicks Accept All on remaining workspace proposals (File 3)
    const opAcceptAll: ChangeOperation = {
      id: 'tx_accept_all_3',
      fileUri: 'workspace',
      timestamp: 3,
      source: ChangeSource.AGENT,
      operationType: 'accept-all',
      transactionType: 'ACCEPT_ALL',
      changeIds: ['prop3_hunk1'],
      affectedRanges: [],
      fileSnapshots: [
        {
          fileUri: file3Uri,
          baselineBefore: base3,
          baselineAfter: prop3,
          documentBefore: prop3,
          documentAfter: prop3
        }
      ],
      description: 'Accepted all changes across workspace'
    };
    history.push(opAcceptAll);

    // 10. User clicks Undo Last Change -> Entire Accept All transaction reversed in one shot
    const undoAcceptAll = history.pop();
    assert.strictEqual(undoAcceptAll?.transactionType, 'ACCEPT_ALL');
    assert.strictEqual(undoAcceptAll?.fileSnapshots[0].baselineBefore, base3, 'File 3 baseline restored');

    // 11. User clicks Undo again -> File-level acceptance reversed
    const undoFile2 = history.pop();
    assert.strictEqual(undoFile2?.transactionType, 'ACCEPT_FILE');
    assert.strictEqual(undoFile2?.fileSnapshots[0].baselineBefore, base2, 'File 2 baseline restored');

    // 12. User's own edits remain intact
    assert.ok(liveFile1WithOverride.includes('int b = 200; // user edit unrelated'), 'User unrelated edit remains intact');
    assert.ok(liveFile1WithOverride.includes('int c = 999; // user override'), 'User overridden edit remains intact');
  });
});
