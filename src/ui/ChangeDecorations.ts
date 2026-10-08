import * as vscode from 'vscode';
import { ChangeTracker } from '../core/ChangeTracker';
import { RangeUtils } from '../utils/RangeUtils';
import { DiffUtils } from '../utils/DiffUtils';

export class ChangeDecorations implements vscode.Disposable {
  private tracker: ChangeTracker;

  private additionDecorationType: vscode.TextEditorDecorationType;
  private wordAdditionDecorationType: vscode.TextEditorDecorationType;
  private deletionIndicatorType: vscode.TextEditorDecorationType;
  private deletionBoundaryType: vscode.TextEditorDecorationType;
  private conflictDecorationType: vscode.TextEditorDecorationType;

  private disposables: vscode.Disposable[] = [];

  constructor(tracker: ChangeTracker, extensionUri?: vscode.Uri) {
    this.tracker = tracker;

    const plusIcon = extensionUri
      ? vscode.Uri.joinPath(extensionUri, 'resources', 'plus-gutter.svg')
      : undefined;
    const minusIcon = extensionUri
      ? vscode.Uri.joinPath(extensionUri, 'resources', 'minus-gutter.svg')
      : undefined;

    // Green addition line decoration with + in gutter (matching Image 3)
    this.additionDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(46, 160, 67, 0.22)',
      gutterIconPath: plusIcon,
      gutterIconSize: 'contain',
      overviewRulerColor: '#2ea043',
      overviewRulerLane: vscode.OverviewRulerLane.Left
    });

    // Bright green character/word-level diff highlight
    this.wordAdditionDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(46, 160, 67, 0.50)'
    });

    // Red deletion line decoration with - in gutter (matching Image 3)
    this.deletionIndicatorType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(248, 81, 73, 0.22)',
      gutterIconPath: minusIcon,
      gutterIconSize: 'contain',
      overviewRulerColor: '#f85149',
      overviewRulerLane: vscode.OverviewRulerLane.Right
    });

    // Red top border boundary when lines were deleted on top of modified lines
    this.deletionBoundaryType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderWidth: '2px 0 0 0',
      borderColor: '#f85149',
      borderStyle: 'solid'
    });

    // Conflict highlight
    this.conflictDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(239, 68, 68, 0.20)',
      borderWidth: '0 0 0 3px',
      borderColor: 'rgba(239, 68, 68, 0.9)',
      borderStyle: 'solid'
    });

    // Update on active editor change
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateEditor(editor);
        }
      })
    );

    // Update on tracker change
    this.disposables.push(
      this.tracker.onDidChangePendingChanges((event) => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && (!event.uri || activeEditor.document.uri.toString() === event.uri.toString())) {
          this.updateEditor(activeEditor);
        }
      })
    );

    // Initial update
    if (vscode.window.activeTextEditor) {
      this.updateEditor(vscode.window.activeTextEditor);
    }
  }

  public updateEditor(editor: vscode.TextEditor): void {
    const config = vscode.workspace.getConfiguration('reviewflow');
    if (!config.get<boolean>('showDecorations', true)) {
      this.clearEditor(editor);
      return;
    }

    if (editor.document.uri.scheme !== 'file') {
      return;
    }

    const groups = this.tracker.getGroupsForUri(editor.document.uri);
    if (!groups || groups.length === 0) {
      this.clearEditor(editor);
      return;
    }

    const additionRanges: vscode.Range[] = [];
    const wordAdditionRanges: vscode.Range[] = [];
    const deletionRanges: vscode.Range[] = [];
    const deletionBoundaryRanges: vscode.Range[] = [];
    const conflictRanges: vscode.Range[] = [];

    for (const group of groups) {
      if (group.isConflict) {
        const range = RangeUtils.createLineRange(group.startLine, group.endLine, editor.document);
        conflictRanges.push(range);
        continue;
      }

      // If lines were deleted on top of modified new lines
      if (group.deletedLineCount > 0 && group.addedLineCount > 0) {
        const boundaryLine = Math.min(group.startLine, editor.document.lineCount - 1);
        deletionBoundaryRanges.push(new vscode.Range(boundaryLine, 0, boundaryLine, 0));
      }

      // Add green additions
      if (group.addedLineCount > 0) {
        const range = RangeUtils.createLineRange(group.startLine, group.endLine, editor.document);
        additionRanges.push(range);

        // Word-level diff calculation: highlight the exact changed words in bright green
        const origLines = group.originalText.replace(/\r\n/g, '\n').split('\n');
        const currLines = group.currentText.replace(/\r\n/g, '\n').split('\n');
        for (let i = 0; i < currLines.length; i++) {
          const docLine = group.startLine + i;
          if (docLine >= editor.document.lineCount) {
            break;
          }
          const origLine = i < origLines.length ? origLines[i] : '';
          const currLine = currLines[i];
          const wordDiff = DiffUtils.computeWordDiff(origLine, currLine);
          if (wordDiff && wordDiff.currentEnd > wordDiff.currentStart) {
            wordAdditionRanges.push(
              new vscode.Range(docLine, wordDiff.currentStart, docLine, wordDiff.currentEnd)
            );
          }
        }
      } else if (group.deletedLineCount > 0) {
        // Pure deletion at line: clean red line background matching Image 3
        const line = Math.min(group.startLine, editor.document.lineCount - 1);
        const range = new vscode.Range(line, 0, line, 0);
        deletionRanges.push(range);
      }
    }

    editor.setDecorations(this.additionDecorationType, additionRanges);
    editor.setDecorations(this.wordAdditionDecorationType, wordAdditionRanges);
    editor.setDecorations(this.deletionIndicatorType, deletionRanges);
    editor.setDecorations(this.deletionBoundaryType, deletionBoundaryRanges);
    editor.setDecorations(this.conflictDecorationType, conflictRanges);
  }

  public clearEditor(editor: vscode.TextEditor): void {
    editor.setDecorations(this.additionDecorationType, []);
    editor.setDecorations(this.wordAdditionDecorationType, []);
    editor.setDecorations(this.deletionIndicatorType, []);
    editor.setDecorations(this.deletionBoundaryType, []);
    editor.setDecorations(this.conflictDecorationType, []);
  }

  public dispose(): void {
    this.additionDecorationType.dispose();
    this.wordAdditionDecorationType.dispose();
    this.deletionIndicatorType.dispose();
    this.deletionBoundaryType.dispose();
    this.conflictDecorationType.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
