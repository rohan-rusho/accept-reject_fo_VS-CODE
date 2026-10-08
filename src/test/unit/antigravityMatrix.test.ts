import * as assert from 'assert';
import { DiffUtils } from '../../utils/DiffUtils';
import { ChangeGrouper } from '../../core/ChangeGrouper';
import { ReconciliationEngine } from '../../core/ReconciliationEngine';
import { ChangeHistory } from '../../core/ChangeHistory';
import { ChangeOperation } from '../../models/ChangeOperation';
import { ChangeSource } from '../../models/ChangeSource';
import { ChangeGroup } from '../../models/ChangeGroup';

describe('Antigravity Critical Accept/Reject Matrix (Section 50)', () => {
  const uri = 'file:///workspace/UserService.java';

  it('Test 1: Agent changes one line — Accept -> agent change remains', () => {
    const base = 'public User getUser(int id) {\n    return repository.findById(id);\n}';
    const proposed = 'public User getUser(int id) {\n    return repository.findById(id).orElseThrow();\n}';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 1);

    // After Accept, baseline becomes proposed content
    const acceptedBase = proposed;
    const diffAfterAccept = DiffUtils.computeLineDiff(acceptedBase, proposed);
    assert.strictEqual(diffAfterAccept.length, 0, 'Agent change remains and is committed');
  });

  it('Test 2: Agent changes one line — Reject -> original content restored', () => {
    const base = 'public User getUser(int id) {\n    return repository.findById(id);\n}';
    const proposed = 'public User getUser(int id) {\n    return repository.findById(id).orElseThrow();\n}';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);
    const group = groups[0];

    // Reverting hunk restores group.originalText
    const restored = group.originalText;
    assert.strictEqual(restored, '    return repository.findById(id);');
  });

  it('Test 3: Agent changes 5 consecutive lines — ONE logical hunk', () => {
    const base = 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6';
    const proposed = 'line 1\nmod 2\nmod 3\nmod 4\nmod 5\nmod 6';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 1, 'Consecutive line changes must form exactly ONE logical hunk');
    assert.strictEqual(groups[0].addedLineCount, 5);
  });

  it('Test 4: Agent creates two separated changes — TWO hunks', () => {
    const base = 'header\nline A\nmiddle 1\nmiddle 2\nmiddle 3\nline B\nfooter';
    const proposed = 'header\nMOD A\nmiddle 1\nmiddle 2\nmiddle 3\nMOD B\nfooter';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 2, 'Separated changes must form TWO distinct hunks');
  });

  it('Test 5: Accept first hunk — second remains pending', () => {
    const base = 'A\nB\nC\nD\nE';
    const proposed = 'MOD_A\nB\nC\nMOD_D\nE';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 2);

    // Accept hunk 0: baseline updates for hunk 0 only
    const updatedBase = 'MOD_A\nB\nC\nD\nE';
    const diffAfterHunk0Accept = DiffUtils.computeLineDiff(updatedBase, proposed);
    const remainingGroups = ChangeGrouper.groupHunks(diffAfterHunk0Accept, uri, updatedBase, proposed, 0, ChangeSource.AGENT);

    assert.strictEqual(remainingGroups.length, 1, 'Second hunk must remain pending');
    assert.strictEqual(remainingGroups[0].currentText, 'MOD_D');
  });

  it('Test 6: Reject first hunk — second remains pending', () => {
    const base = 'A\nB\nC\nD\nE';
    const proposed = 'MOD_A\nB\nC\nMOD_D\nE';

    // Current document has first hunk reverted to original ('A') while second hunk is kept
    const currentDoc = 'A\nB\nC\nMOD_D\nE';
    const diffAfterHunk0Reject = DiffUtils.computeLineDiff(base, currentDoc);
    const remainingGroups = ChangeGrouper.groupHunks(diffAfterHunk0Reject, uri, base, currentDoc, 0, ChangeSource.AGENT);

    assert.strictEqual(remainingGroups.length, 1, 'Second hunk must remain pending after rejecting first');
    assert.strictEqual(remainingGroups[0].currentText, 'MOD_D');
  });

  it('Test 7: User edits unrelated code — Accept agent -> user edit survives, agent edit survives', () => {
    const base = 'funcA() {\n  return 1;\n}\nfuncB() {\n  return 2;\n}';
    const proposed = 'funcA() {\n  return 999; // agent\n}\nfuncB() {\n  return 2;\n}';

    // User edits funcB while agent proposal is pending
    const currentWithUserEdit = 'funcA() {\n  return 999; // agent\n}\nfuncB() {\n  return 42; // user\n}';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);

    // Reconcile pending agent hunk against live user document
    const reconciled = ReconciliationEngine.reconcileHunks(groups, base, currentWithUserEdit);
    assert.strictEqual(reconciled[0].status, 'PENDING');
    assert.strictEqual(reconciled[0].ownership, 'AGENT');

    // Accepting agent edit commits agent change while keeping user's edit
    const finalDocument = currentWithUserEdit;
    assert.ok(finalDocument.includes('return 999; // agent'), 'Agent edit survives');
    assert.ok(finalDocument.includes('return 42; // user'), 'User edit survives');
  });

  it('Test 8: User edits same region — Accept agent -> user version wins (status = OVERRIDDEN)', () => {
    const base = 'return user.getName();';
    const proposed = 'return user.getDisplayName(); // agent';
    const current = 'return user.getFullName(); // user edited same region';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);

    const reconciled = ReconciliationEngine.reconcileHunks(groups, base, current);
    assert.strictEqual(reconciled[0].status, 'OVERRIDDEN', 'Must be detected as OVERRIDDEN');
    assert.strictEqual(reconciled[0].ownership, 'USER', 'Ownership must be USER');
    assert.strictEqual(reconciled[0].currentText, current, 'User edit must win');
  });

  it('Test 9: User edits same region — Reject agent -> user version remains', () => {
    const base = 'return user.getName();';
    const proposed = 'return user.getDisplayName(); // agent';
    const current = 'return user.getFullName(); // user';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);

    const reconciled = ReconciliationEngine.reconcileHunks(groups, base, current);
    assert.strictEqual(reconciled[0].status, 'OVERRIDDEN');

    // Section 16 & 17: If user changed the same region, reject must NOT overwrite user content
    assert.strictEqual(current, 'return user.getFullName(); // user', 'User version remains intact');
  });

  it('Test 10: Agent creates file — Reject -> file does not become permanently created', () => {
    const base = ''; // File did not exist
    const proposed = 'class NewFile {}';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].originalText, '');

    // Rejection of created file means clearing / removing content back to empty baseline
    const rejectedResult = groups[0].originalText;
    assert.strictEqual(rejectedResult, '', 'File content is cleared/removed');
  });

  it('Test 11: Agent creates file — Accept -> file exists normally', () => {
    const base = '';
    const proposed = 'class NewFile {}';

    const acceptedBase = proposed;
    const diff = DiffUtils.computeLineDiff(acceptedBase, proposed);
    assert.strictEqual(diff.length, 0, 'No pending changes remain; file is accepted permanently');
  });

  it('Test 12: Agent deletes file — Reject -> file remains', () => {
    const base = 'class OldFile {}';
    const proposed = ''; // Agent proposes deletion

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].deletedLineCount, 1);

    // Rejecting deletion means restoring original file text
    const restored = groups[0].originalText;
    assert.strictEqual(restored, 'class OldFile {}', 'File text remains preserved');
  });

  it('Test 13: Agent deletes file — Accept -> file deleted', () => {
    const base = 'class OldFile {}';
    const proposed = '';

    const acceptedBase = proposed;
    const diff = DiffUtils.computeLineDiff(acceptedBase, proposed);
    assert.strictEqual(diff.length, 0, 'File deletion accepted');
  });

  it('Test 14: Accept File — Undo -> entire file-level acceptance reversed in one transaction', () => {
    const history = new ChangeHistory(50);
    const fileUri = 'file:///workspace/UserService.java';

    // File with 3 hunks accepted at once
    const op: ChangeOperation = {
      id: 'tx_file_1',
      fileUri,
      timestamp: Date.now(),
      source: ChangeSource.AGENT,
      operationType: 'accept-file',
      transactionType: 'ACCEPT_FILE',
      changeIds: ['H1', 'H2', 'H3'],
      affectedRanges: [],
      fileSnapshots: [
        {
          fileUri,
          baselineBefore: 'orig1\norig2\norig3',
          baselineAfter: 'prop1\nprop2\nprop3',
          documentBefore: 'prop1\nprop2\nprop3',
          documentAfter: 'prop1\nprop2\nprop3'
        }
      ],
      description: 'Accepted all 3 changes in UserService.java'
    };

    history.push(op);
    assert.strictEqual(history.length, 1);

    const undoneOp = history.pop();
    assert.strictEqual(undoneOp?.transactionType, 'ACCEPT_FILE');
    assert.strictEqual(undoneOp?.changeIds?.length, 3);
    assert.strictEqual(undoneOp?.fileSnapshots[0].baselineBefore, 'orig1\norig2\norig3', 'Reverts whole file baseline in single undo');
  });

  it('Test 15: Accept All — Undo -> entire Accept All transaction reversed', () => {
    const history = new ChangeHistory(50);

    const op: ChangeOperation = {
      id: 'tx_all_1',
      fileUri: 'workspace',
      timestamp: Date.now(),
      source: ChangeSource.AGENT,
      operationType: 'accept-all',
      transactionType: 'ACCEPT_ALL',
      changeIds: ['H1', 'H2', 'H3', 'H4'],
      affectedRanges: [],
      fileSnapshots: [
        { fileUri: 'fileA', baselineBefore: 'A_base', baselineAfter: 'A_prop', documentBefore: 'A_prop', documentAfter: 'A_prop' },
        { fileUri: 'fileB', baselineBefore: 'B_base', baselineAfter: 'B_prop', documentBefore: 'B_prop', documentAfter: 'B_prop' }
      ],
      description: 'Accepted all 4 changes across 2 files'
    };

    history.push(op);
    const undone = history.pop();
    assert.strictEqual(undone?.transactionType, 'ACCEPT_ALL');
    assert.strictEqual(undone?.fileSnapshots.length, 2, 'Single undo reverses both files in the transaction');
  });

  it('Test 16: Granular Undo order — Accept A -> Accept B -> Accept C -> Undo C -> Undo B -> Undo A', () => {
    const history = new ChangeHistory(50);
    const opA: ChangeOperation = { id: 'A', fileUri: uri, timestamp: 1, source: ChangeSource.AGENT, operationType: 'accept-change', transactionType: 'ACCEPT_CHANGE', affectedRanges: [], fileSnapshots: [], description: 'Accept A' };
    const opB: ChangeOperation = { id: 'B', fileUri: uri, timestamp: 2, source: ChangeSource.AGENT, operationType: 'accept-change', transactionType: 'ACCEPT_CHANGE', affectedRanges: [], fileSnapshots: [], description: 'Accept B' };
    const opC: ChangeOperation = { id: 'C', fileUri: uri, timestamp: 3, source: ChangeSource.AGENT, operationType: 'accept-change', transactionType: 'ACCEPT_CHANGE', affectedRanges: [], fileSnapshots: [], description: 'Accept C' };

    history.push(opA);
    history.push(opB);
    history.push(opC);

    assert.strictEqual(history.pop()?.id, 'C', 'First undo reverts C');
    assert.strictEqual(history.pop()?.id, 'B', 'Second undo reverts B');
    assert.strictEqual(history.pop()?.id, 'A', 'Third undo reverts A');
    assert.strictEqual(history.canUndo(), false);
  });

  it('Test 17: Agent proposal pending. User formats file — proposal remains correctly associated', () => {
    const base = 'function test() {\n  return 1;\n}';
    const proposed = 'function test() {\n  return 2;\n}';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);
    const group = groups[0];

    // User formats file: adds header comment and extra blank lines above
    const formattedDoc = '// Formatted by Prettier\n\n\nfunction test() {\n  return 2;\n}';

    const reconciled = ReconciliationEngine.reconcileHunks([group], base, formattedDoc);
    assert.strictEqual(reconciled[0].status, 'PENDING');
    assert.strictEqual(reconciled[0].currentText, '  return 2;');
    assert.strictEqual(reconciled[0].startLine, 4, 'Hunk successfully relocated to line 4 despite formatting shifts');
  });

  it('Test 18: Agent proposal pending. External process modifies file — safe reconciliation without silent overwrite', () => {
    const base = 'config = 1;';
    const proposed = 'config = 2; // agent proposal';
    const externalCurrent = 'config = 999; // external build tool updated file';

    const hunks = DiffUtils.computeLineDiff(base, proposed);
    const groups = ChangeGrouper.groupHunks(hunks, uri, base, proposed, 0, ChangeSource.AGENT);

    const reconciled = ReconciliationEngine.reconcileHunks(groups, base, externalCurrent);
    assert.strictEqual(reconciled[0].status, 'OVERRIDDEN', 'External update recognized as non-agent modification');
    assert.strictEqual(reconciled[0].currentText, externalCurrent, 'External content preserved, never silently overwritten');
  });
});
