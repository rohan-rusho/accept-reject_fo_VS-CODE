import * as assert from 'assert';
import { RangeTracker } from '../../core/RangeTracker';
import { ChangeGroup } from '../../models/ChangeGroup';
import { ChangeSource } from '../../models/ChangeSource';
import * as vscode from 'vscode';

describe('RangeTracker', () => {
  const uri = 'file:///workspace/test.ts';

  function createDummyGroup(id: string, startLine: number, endLine: number): ChangeGroup {
    return {
      id,
      fileUri: uri,
      startLine,
      endLine,
      originalStartLine: startLine,
      originalEndLine: endLine,
      originalText: 'orig',
      currentText: 'curr',
      addedLineCount: endLine - startLine + 1,
      deletedLineCount: 1,
      type: 'modify',
      source: ChangeSource.AGENT,
      timestamp: Date.now()
    };
  }

  it('should shift pending groups downwards when lines are inserted before them', () => {
    const groupA = createDummyGroup('gA', 20, 25);
    const contentChanges: vscode.TextDocumentContentChangeEvent[] = [
      {
        range: new vscode.Range(new vscode.Position(5, 0), new vscode.Position(5, 0)),
        rangeOffset: 50,
        rangeLength: 0,
        text: 'newLine 1\nnewLine 2\nnewLine 3\n' // 3 lines added at line 5
      }
    ];

    const adjusted = RangeTracker.adjustRangesOnContentChange([groupA], contentChanges);
    assert.strictEqual(adjusted[0].startLine, 23);
    assert.strictEqual(adjusted[0].endLine, 28);
  });

  it('should not alter pending groups when edits happen after them', () => {
    const groupA = createDummyGroup('gA', 10, 15);
    const contentChanges: vscode.TextDocumentContentChangeEvent[] = [
      {
        range: new vscode.Range(new vscode.Position(30, 0), new vscode.Position(30, 0)),
        rangeOffset: 300,
        rangeLength: 0,
        text: 'newLine\n'
      }
    ];

    const adjusted = RangeTracker.adjustRangesOnContentChange([groupA], contentChanges);
    assert.strictEqual(adjusted[0].startLine, 10);
    assert.strictEqual(adjusted[0].endLine, 15);
  });

  it('should flag conflict when edit intersects with a pending group', () => {
    const groupA = createDummyGroup('gA', 10, 15);
    const contentChanges: vscode.TextDocumentContentChangeEvent[] = [
      {
        range: new vscode.Range(new vscode.Position(12, 0), new vscode.Position(13, 0)),
        rangeOffset: 120,
        rangeLength: 10,
        text: 'manual edit\n'
      }
    ];

    const adjusted = RangeTracker.adjustRangesOnContentChange([groupA], contentChanges);
    assert.strictEqual(adjusted[0].isConflict, true);
    assert.ok(adjusted[0].conflictReason?.includes('manually edited'));
  });

  it('should adjust subsequent groups after a group is replaced with different line count', () => {
    const group1 = createDummyGroup('g1', 10, 15); // 6 lines in current document
    const group2 = createDummyGroup('g2', 30, 35); // comes after group 1

    // Suppose group 1 was replaced with original text that only had 2 lines (lineDelta = -4)
    const adjusted = RangeTracker.adjustGroupsAfterReplacement([group1, group2], 'g1', -4);

    assert.strictEqual(adjusted.length, 1);
    assert.strictEqual(adjusted[0].id, 'g2');
    assert.strictEqual(adjusted[0].startLine, 26, 'Group 2 startLine should shift up by 4 lines');
    assert.strictEqual(adjusted[0].endLine, 31, 'Group 2 endLine should shift up by 4 lines');
  });
});
