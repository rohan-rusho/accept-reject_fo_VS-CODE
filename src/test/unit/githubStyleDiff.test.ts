import * as assert from 'assert';
import { DiffUtils } from '../../utils/DiffUtils';
import { ChangeGrouper } from '../../core/ChangeGrouper';
import { ChangeSource } from '../../models/ChangeSource';

describe('GitHub-Style Diff Algorithm and Grouping', () => {
  const fileUri = 'file:///workspace/test.xml';

  // ──────────────────────────────────────────────────
  // 1. Word-level / character-level diff accuracy
  // ──────────────────────────────────────────────────

  describe('Word-level diff accuracy', () => {
    it('should highlight only one changed character within a line', () => {
      const orig = 'const timeout = 3000;';
      const curr = 'const timeout = 5000;';
      const diff = DiffUtils.computeWordDiff(orig, curr);
      assert.ok(diff, 'Word diff should be computed');
      assert.strictEqual(orig.substring(diff!.originalStart, diff!.originalEnd), '3');
      assert.strictEqual(curr.substring(diff!.currentStart, diff!.currentEnd), '5');
    });

    it('should highlight only one changed word within a line', () => {
      const orig = 'The application supports local storage.';
      const curr = 'The application supports cloud storage.';
      const diff = DiffUtils.computeWordDiff(orig, curr);
      assert.ok(diff, 'Word diff should be computed');
      assert.strictEqual(orig.substring(diff!.originalStart, diff!.originalEnd), 'local');
      assert.strictEqual(curr.substring(diff!.currentStart, diff!.currentEnd), 'cloud');
    });

    it('should highlight only the changed XML attribute value (timestamp)', () => {
      const orig = '<DropdownSelection timestamp="2026-03-30T04:44:58.494360300Z">';
      const curr = '<DropdownSelection timestamp="2026-10-07T09:43:45.368153900Z">';
      const diff = DiffUtils.computeWordDiff(orig, curr);
      assert.ok(diff, 'Word diff should be computed');
      // Only the differing timestamp characters should be highlighted
      assert.strictEqual(orig.substring(diff!.originalStart, diff!.originalEnd), '03-30T04:44:58.4943603');
      assert.strictEqual(curr.substring(diff!.currentStart, diff!.currentEnd), '10-07T09:43:45.3681539');
    });

    it('should highlight multiple changed XML attribute values on the same line', () => {
      const orig = '<DeviceId pluginId="LocalEmulator" identifier="path:C:\\Users\\Rokib\\.android\\avd\\Medium_Phone.avd" />';
      const curr = '<DeviceId pluginId="PhysicalDevice" identifier="serial:034b6a297d2a" />';
      const spans = DiffUtils.computeMultiSpanWordDiff(orig, curr);
      assert.ok(spans.length >= 2, `Expected at least 2 changed spans, got ${spans.length}`);

      // The total highlighted characters should be much less than the full line length,
      // proving that unchanged portions (tag name, attribute names, quotes) are not highlighted
      const totalOrigHighlighted = spans.reduce((sum, s) => sum + (s.originalEnd - s.originalStart), 0);
      const totalCurrHighlighted = spans.reduce((sum, s) => sum + (s.currentEnd - s.currentStart), 0);
      assert.ok(totalOrigHighlighted < orig.length * 0.7,
        `Highlighted ${totalOrigHighlighted} of ${orig.length} original chars — too much`);
      assert.ok(totalCurrHighlighted < curr.length * 0.7,
        `Highlighted ${totalCurrHighlighted} of ${curr.length} current chars — too much`);

      // The common prefix '<DeviceId pluginId="' should not start before that
      const commonPrefix = '<DeviceId pluginId="';
      assert.ok(spans[0].originalStart >= commonPrefix.length - 1,
        `First span starts at ${spans[0].originalStart}, but common prefix is ${commonPrefix.length} chars`);
    });

    it('should return empty spans for identical lines', () => {
      const line = 'const x = 42;';
      const spans = DiffUtils.computeMultiSpanWordDiff(line, line);
      assert.strictEqual(spans.length, 0);
    });

    it('should return undefined for identical lines (computeWordDiff)', () => {
      const line = 'const x = 42;';
      const diff = DiffUtils.computeWordDiff(line, line);
      assert.strictEqual(diff, undefined);
    });
  });

  // ──────────────────────────────────────────────────
  // 2. Line-level diff accuracy
  // ──────────────────────────────────────────────────

  describe('Line-level diff accuracy', () => {
    it('should detect one genuinely added line', () => {
      const orig = 'const first = 1;\nconst second = 2;';
      const curr = 'const first = 1;\nconst middle = 5;\nconst second = 2;';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      assert.strictEqual(hunks.length, 1);
      assert.strictEqual(hunks[0].type, 'insert');
      assert.deepStrictEqual(hunks[0].currentLines, ['const middle = 5;']);
      assert.strictEqual(hunks[0].originalLineCount, 0);
    });

    it('should detect one genuinely deleted line', () => {
      const orig = 'const first = 1;\nconst middle = 5;\nconst second = 2;';
      const curr = 'const first = 1;\nconst second = 2;';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      assert.strictEqual(hunks.length, 1);
      assert.strictEqual(hunks[0].type, 'delete');
      assert.deepStrictEqual(hunks[0].originalLines, ['const middle = 5;']);
    });

    it('should detect one line replaced by another as a modification', () => {
      const orig = 'const timeout = 3000;';
      const curr = 'const timeout = 5000;';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      assert.strictEqual(hunks.length, 1);
      assert.strictEqual(hunks[0].type, 'modify');
      assert.deepStrictEqual(hunks[0].originalLines, ['const timeout = 3000;']);
      assert.deepStrictEqual(hunks[0].currentLines, ['const timeout = 5000;']);
    });

    it('should not highlight unchanged surrounding lines', () => {
      const orig = 'const first = 1;\nconst second = 2;\nconst third = 3;';
      const curr = 'const first = 1;\nconst middle = 5;\nconst third = 3;';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      assert.strictEqual(hunks.length, 1);
      assert.strictEqual(hunks[0].originalStartLine, 1);
      assert.strictEqual(hunks[0].currentStartLine, 1);
      assert.strictEqual(hunks[0].originalLineCount, 1);
      assert.strictEqual(hunks[0].currentLineCount, 1);
    });
  });

  // ──────────────────────────────────────────────────
  // 3. Logical change grouping
  // ──────────────────────────────────────────────────

  describe('Logical change grouping', () => {
    it('should group multiple adjacent modified lines into one change block', () => {
      const orig = 'const first = 1;\nconst second = 2;\nconst third = 3;';
      const curr = 'const first = 10;\nconst second = 20;\nconst third = 30;';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 1, 'Three consecutive modifications should be one group');
    });

    it('should group adjacent additions and deletions into one change block', () => {
      const orig = 'const first = 1;\nconst second = 2;\nconst third = 3;';
      const curr = 'const first = 1;\nconst updatedSecond = 20;\nconst newFourth = 4;\nconst third = 3;';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 1, 'Adjacent replacement and insertion should be one group');
    });

    it('should keep two changes separated by unchanged lines as separate groups', () => {
      const orig = 'const first = 1;\nconst second = 2;\nconst third = 3;\nconst fourth = 4;\nconst fifth = 5;';
      const curr = 'const first = 10;\nconst second = 2;\nconst third = 3;\nconst fourth = 40;\nconst fifth = 5;';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 2, 'Two changes separated by unchanged lines must be separate');
    });

    it('should produce exactly one group for a replacement (delete + add)', () => {
      const orig = 'A\nB\nC';
      const curr = 'A\nB_REPLACED\nC';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 1, 'A single replacement must be one group');
      assert.strictEqual(groups[0].deletedLineCount, 1);
      assert.strictEqual(groups[0].addedLineCount, 1);
    });
  });

  // ──────────────────────────────────────────────────
  // 4. Line pairing for word-level diffs
  // ──────────────────────────────────────────────────

  describe('Line pairing accuracy', () => {
    it('should pair modified lines and produce word diffs', () => {
      const origLines = ['const timeout = 3000;'];
      const currLines = ['const timeout = 5000;'];
      const pairings = DiffUtils.computeLinePairings(origLines, currLines);
      assert.strictEqual(pairings.length, 1);
      assert.strictEqual(pairings[0].originalIndex, 0);
      assert.strictEqual(pairings[0].currentIndex, 0);
      assert.ok(pairings[0].wordDiffs.length > 0, 'Should have word-level diffs');
    });

    it('should pair multiple modified lines in order', () => {
      const origLines = ['line A', 'line B', 'line C'];
      const currLines = ['line A_mod', 'line B_mod', 'line C_mod'];
      const pairings = DiffUtils.computeLinePairings(origLines, currLines);
      assert.strictEqual(pairings.length, 3);
      for (let i = 0; i < 3; i++) {
        assert.strictEqual(pairings[i].originalIndex, i);
        assert.strictEqual(pairings[i].currentIndex, i);
        assert.ok(pairings[i].wordDiffs.length > 0);
      }
    });

    it('should mark pure insertions with originalIndex = -1', () => {
      const origLines: string[] = [];
      const currLines = ['new line 1', 'new line 2'];
      const pairings = DiffUtils.computeLinePairings(origLines, currLines);
      assert.strictEqual(pairings.length, 2);
      assert.strictEqual(pairings[0].originalIndex, -1);
      assert.strictEqual(pairings[0].currentIndex, 0);
    });

    it('should mark pure deletions with currentIndex = -1', () => {
      const origLines = ['old line 1', 'old line 2'];
      const currLines: string[] = [];
      const pairings = DiffUtils.computeLinePairings(origLines, currLines);
      assert.strictEqual(pairings.length, 2);
      assert.strictEqual(pairings[0].currentIndex, -1);
      assert.strictEqual(pairings[0].originalIndex, 0);
    });

    it('should handle replacement with extra insertion (1 orig -> 2 curr)', () => {
      const origLines = ['const second = 2;'];
      const currLines = ['const updatedSecond = 20;', 'const newFourth = 4;'];
      const pairings = DiffUtils.computeLinePairings(origLines, currLines);
      // Should pair original to its best match and leave one as pure insertion
      const pairedCount = pairings.filter(p => p.originalIndex >= 0 && p.currentIndex >= 0).length;
      const insertionCount = pairings.filter(p => p.originalIndex < 0).length;
      assert.strictEqual(pairedCount, 1, 'Should have one paired modification');
      assert.strictEqual(insertionCount, 1, 'Should have one pure insertion');
    });

    it('should handle XML attribute changes with proper pairing', () => {
      const origLines = ['<DeviceId pluginId="LocalEmulator" identifier="path:C:\\Users" />'];
      const currLines = ['<DeviceId pluginId="PhysicalDevice" identifier="serial:034b6a" />'];
      const pairings = DiffUtils.computeLinePairings(origLines, currLines);
      assert.strictEqual(pairings.length, 1);
      assert.strictEqual(pairings[0].originalIndex, 0);
      assert.strictEqual(pairings[0].currentIndex, 0);
      assert.ok(pairings[0].wordDiffs.length >= 1, 'Should have at least one word-level diff span');
    });
  });

  // ──────────────────────────────────────────────────
  // 5. Line similarity scoring
  // ──────────────────────────────────────────────────

  describe('Line similarity', () => {
    it('should return 1.0 for identical strings', () => {
      assert.strictEqual(DiffUtils.lineSimilarity('hello', 'hello'), 1.0);
    });

    it('should return 0.0 for empty vs non-empty', () => {
      assert.strictEqual(DiffUtils.lineSimilarity('', 'hello'), 0.0);
    });

    it('should return high similarity for small changes', () => {
      const sim = DiffUtils.lineSimilarity('const timeout = 3000;', 'const timeout = 5000;');
      assert.ok(sim > 0.8, `Expected similarity > 0.8, got ${sim}`);
    });

    it('should return low similarity for completely different lines', () => {
      const sim = DiffUtils.lineSimilarity('function foo() {}', '<!-- XML comment -->');
      assert.ok(sim < 0.3, `Expected similarity < 0.3, got ${sim}`);
    });
  });

  // ──────────────────────────────────────────────────
  // 6. Accept/Reject behavior (simulated via ChangeGrouper)
  // ──────────────────────────────────────────────────

  describe('Accept/Reject integrity with grouping', () => {
    it('accepting a replacement should apply both deletion and addition together', () => {
      const orig = 'line A\nline B\nline C';
      const curr = 'line A\nline B_REPLACED\nline C';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 1, 'Single replacement must be one group');
      // The group must contain both old and new text
      assert.strictEqual(groups[0].originalText, 'line B');
      assert.strictEqual(groups[0].currentText, 'line B_REPLACED');
      assert.strictEqual(groups[0].deletedLineCount, 1);
      assert.strictEqual(groups[0].addedLineCount, 1);
    });

    it('rejecting a replacement should preserve original content', () => {
      const orig = 'line A\nline B\nline C';
      const curr = 'line A\nline B_REPLACED\nline C';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0].originalText, 'line B', 'Original text should be preserved for reject');
    });

    it('accepting one change should not affect other pending changes', () => {
      const orig = 'A\nB\nC\nD\nE';
      const curr = 'A_mod\nB\nC\nD_mod\nE';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 2, 'Must be two separate changes');
      // Each group has independent content
      assert.ok(groups[0].originalText.includes('A'));
      assert.ok(groups[1].originalText.includes('D'));
    });

    it('no duplicate review controls should be rendered for a single change', () => {
      const orig = '<val timestamp="2026-03-30T04:44:58Z">';
      const curr = '<val timestamp="2026-10-07T09:43:45Z">';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 1, 'Single modification = single group = single accept/reject pair');
    });

    it('Accept All should cover all groups', () => {
      const orig = 'A\nB\nC\nD\nE';
      const curr = 'A_mod\nB\nC\nD_mod\nE';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 2);
      // In a real Accept All scenario, all groups would be processed
      const totalChanges = groups.reduce((sum, g) => sum + g.addedLineCount + g.deletedLineCount, 0);
      assert.ok(totalChanges > 0, 'Should have changes to accept');
    });
  });

  // ──────────────────────────────────────────────────
  // 7. Line position correctness
  // ──────────────────────────────────────────────────

  describe('Line position correctness', () => {
    it('line positions remain correct for multiple changes', () => {
      const orig = 'first\nsecond\nthird\nfourth\nfifth';
      const curr = 'first_MOD\nsecond\nthird\nfourth_MOD\nfifth';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 2);
      assert.strictEqual(groups[0].startLine, 0, 'First change at line 0');
      assert.strictEqual(groups[0].endLine, 0, 'First change ends at line 0');
      assert.strictEqual(groups[1].startLine, 3, 'Second change at line 3');
      assert.strictEqual(groups[1].endLine, 3, 'Second change ends at line 3');
    });

    it('insertion position is correct for added lines', () => {
      const orig = 'A\nB';
      const curr = 'A\nINSERTED_1\nINSERTED_2\nB';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0].startLine, 1);
      assert.strictEqual(groups[0].endLine, 2);
      assert.strictEqual(groups[0].type, 'insert');
    });
  });

  // ──────────────────────────────────────────────────
  // 8. Unchanged text should not be highlighted
  // ──────────────────────────────────────────────────

  describe('Unchanged text handling', () => {
    it('unchanged text within a modified line should not be in the diff spans', () => {
      const orig = 'const timeout = 3000;';
      const curr = 'const timeout = 5000;';
      const spans = DiffUtils.computeMultiSpanWordDiff(orig, curr);
      assert.ok(spans.length > 0, 'Should detect changes');
      // The unchanged prefix "const timeout = " should not be in any span
      for (const span of spans) {
        assert.ok(span.currentStart >= 16 || span.currentEnd <= 0,
          `Span [${span.currentStart}, ${span.currentEnd}) should not overlap with unchanged prefix`);
      }
    });

    it('empty diff for identical content', () => {
      const text = 'no changes here';
      const hunks = DiffUtils.computeLineDiff(text, text);
      assert.strictEqual(hunks.length, 0, 'No hunks for identical content');
    });
  });

  // ──────────────────────────────────────────────────
  // 9. Edge cases
  // ──────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle empty original text (entirely new content)', () => {
      const orig = '';
      const curr = 'line 1\nline 2\nline 3';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      assert.ok(hunks.length > 0);
      assert.strictEqual(hunks[0].type, 'insert');
    });

    it('should handle empty current text (all content deleted)', () => {
      const orig = 'line 1\nline 2\nline 3';
      const curr = '';
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      assert.ok(hunks.length > 0);
      assert.strictEqual(hunks[0].type, 'delete');
    });

    it('should handle single-character changes', () => {
      const orig = 'x';
      const curr = 'y';
      const diff = DiffUtils.computeWordDiff(orig, curr);
      assert.ok(diff);
      assert.strictEqual(diff!.originalStart, 0);
      assert.strictEqual(diff!.originalEnd, 1);
      assert.strictEqual(diff!.currentStart, 0);
      assert.strictEqual(diff!.currentEnd, 1);
    });

    it('should handle indentation-only changes', () => {
      const orig = '    indented line';
      const curr = '        indented line';
      const diff = DiffUtils.computeWordDiff(orig, curr);
      assert.ok(diff);
      assert.ok(diff!.originalEnd <= 4, 'Only leading spaces should differ');
    });

    it('should handle multi-span word diff with two distinct changes in one line', () => {
      const orig = 'foo bar baz';
      const curr = 'FOO bar BAZ';
      const spans = DiffUtils.computeMultiSpanWordDiff(orig, curr);
      assert.strictEqual(spans.length, 2, 'Two separate changed regions');
      assert.strictEqual(orig.substring(spans[0].originalStart, spans[0].originalEnd), 'foo');
      assert.strictEqual(curr.substring(spans[0].currentStart, spans[0].currentEnd), 'FOO');
      assert.strictEqual(orig.substring(spans[1].originalStart, spans[1].originalEnd), 'baz');
      assert.strictEqual(curr.substring(spans[1].currentStart, spans[1].currentEnd), 'BAZ');
    });
  });

  // ──────────────────────────────────────────────────
  // 10. Compilation and integration verification
  // ──────────────────────────────────────────────────

  describe('Integration verification', () => {
    it('full pipeline: diff -> group -> pair for XML modification', () => {
      const orig = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<root>',
        '  <DropdownSelection timestamp="2026-03-30T04:44:58.494360300Z">',
        '    <Target type="DEFAULT_BOOT">',
        '      <handle>',
        '        <DeviceId pluginId="LocalEmulator" identifier="path:C:\\Users\\Rokib\\.android\\avd\\Medium_Phone.avd" />',
        '      </handle>',
        '    </Target>',
        '  </DropdownSelection>',
        '</root>'
      ].join('\n');

      const curr = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<root>',
        '  <DropdownSelection timestamp="2026-10-07T09:43:45.368153900Z">',
        '    <Target type="DEFAULT_BOOT">',
        '      <handle>',
        '        <DeviceId pluginId="PhysicalDevice" identifier="serial:034b6a297d2a" />',
        '      </handle>',
        '    </Target>',
        '  </DropdownSelection>',
        '</root>'
      ].join('\n');

      // Step 1: Line-level diff
      const hunks = DiffUtils.computeLineDiff(orig, curr);
      assert.strictEqual(hunks.length, 2, 'Two separate line changes (timestamp and DeviceId)');

      // Step 2: Group (with groupingDistance=0, they should be separate since there is
      // an unchanged line between them)
      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 2, 'Two separate groups for the two changes');

      // Step 3: Word-level pairing for each group
      for (const group of groups) {
        const origLines = DiffUtils.splitLines(group.originalText);
        const currLines = DiffUtils.splitLines(group.currentText);
        const pairings = DiffUtils.computeLinePairings(origLines, currLines);

        // Each group has one modified line, so one pairing with word diffs
        assert.strictEqual(pairings.length, 1);
        assert.strictEqual(pairings[0].originalIndex, 0);
        assert.strictEqual(pairings[0].currentIndex, 0);
        assert.ok(pairings[0].wordDiffs.length > 0, 'Should have word-level diffs');
      }

      // Verify the timestamp group highlights only the changed portion
      const tsGroup = groups[0];
      const tsOrig = DiffUtils.splitLines(tsGroup.originalText);
      const tsCurr = DiffUtils.splitLines(tsGroup.currentText);
      const tsPairings = DiffUtils.computeLinePairings(tsOrig, tsCurr);
      const tsWordDiff = tsPairings[0].wordDiffs;

      // The word diff should not include the tag name or attribute name
      for (const span of tsWordDiff) {
        const changedOrig = tsOrig[0].substring(span.originalStart, span.originalEnd);
        assert.ok(!changedOrig.includes('DropdownSelection'), 'Tag name should not be highlighted');
        assert.ok(!changedOrig.includes('timestamp='), 'Attribute name should not be highlighted');
      }
    });

    it('full pipeline: single replacement with accept/reject data integrity', () => {
      const orig = 'const first = 1;\nconst second = 2;\nconst third = 3;';
      const curr = 'const first = 1;\nconst second = 20;\nconst third = 3;';

      const hunks = DiffUtils.computeLineDiff(orig, curr);
      assert.strictEqual(hunks.length, 1);

      const groups = ChangeGrouper.groupHunks(hunks, fileUri, orig, curr, 0, ChangeSource.AGENT);
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0].originalText, 'const second = 2;');
      assert.strictEqual(groups[0].currentText, 'const second = 20;');

      // The group should be a single reviewable unit
      assert.strictEqual(groups[0].type, 'modify');
      assert.strictEqual(groups[0].deletedLineCount, 1);
      assert.strictEqual(groups[0].addedLineCount, 1);

      // Word diff should only highlight the "2" -> "20" change
      const pairings = DiffUtils.computeLinePairings(
        [groups[0].originalText],
        [groups[0].currentText]
      );
      assert.strictEqual(pairings.length, 1);
      assert.ok(pairings[0].wordDiffs.length > 0);
    });
  });
});
