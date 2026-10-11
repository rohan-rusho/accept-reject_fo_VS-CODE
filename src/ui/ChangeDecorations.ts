import * as vscode from 'vscode';
import { ChangeTracker } from '../core/ChangeTracker';
import { RangeUtils } from '../utils/RangeUtils';
import { DiffUtils } from '../utils/DiffUtils';

export class ChangeDecorations implements vscode.Disposable {
  private tracker: ChangeTracker;

  private additionDecorationType: vscode.TextEditorDecorationType;
  private wordAdditionDecorationType: vscode.TextEditorDecorationType;
  private wordDeletionDecorationType: vscode.TextEditorDecorationType;
  private deletionIndicatorType: vscode.TextEditorDecorationType;
  private deletionBoundaryType: vscode.TextEditorDecorationType;
  private deletedTextDecorationType: vscode.TextEditorDecorationType;
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

    // Bright green character/word-level diff highlight for added text
    this.wordAdditionDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(46, 160, 67, 0.50)'
    });

    // Bright red character/word-level diff highlight for deleted text (shown as before-decoration)
    this.wordDeletionDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(248, 81, 73, 0.50)'
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

    // Red top border boundary when lines were deleted on top of modified lines, with - in gutter
    this.deletionBoundaryType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderWidth: '2px 0 0 0',
      borderColor: '#f85149',
      borderStyle: 'solid',
      gutterIconPath: minusIcon,
      gutterIconSize: 'contain',
      overviewRulerColor: '#f85149',
      overviewRulerLane: vscode.OverviewRulerLane.Right
    });

    // Deleted text decoration to render the removed line content in red
    this.deletedTextDecorationType = vscode.window.createTextEditorDecorationType({
      color: '#ff7b72',
      fontStyle: 'normal'
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
    const deletionRanges: vscode.DecorationOptions[] = [];
    const deletionBoundaryRanges: vscode.DecorationOptions[] = [];
    const deletedTextDecorations: vscode.DecorationOptions[] = [];
    const conflictRanges: vscode.Range[] = [];

    for (const group of groups) {
      if (group.isConflict) {
        const range = RangeUtils.createLineRange(group.startLine, group.endLine, editor.document);
        conflictRanges.push(range);
        continue;
      }

      const origLines = DiffUtils.splitLines(group.originalText);
      const currLines = DiffUtils.splitLines(group.currentText);

      // Compute line pairings for accurate word-level diffs
      const pairings = DiffUtils.computeLinePairings(origLines, currLines);

      // If lines were deleted, show a deletion indicator
      if (group.deletedLineCount > 0) {
        const boundaryLine = Math.min(group.startLine, editor.document.lineCount - 1);
        const nonEmptyOrigLines = origLines.filter((l) => l.trim().length > 0);

        const hoverMsg = new vscode.MarkdownString(
          `### 🔴 Deleted from Baseline (-${group.deletedLineCount} line${group.deletedLineCount > 1 ? 's' : ''})\n\n` +
          `\`\`\`diff\n${DiffUtils.formatDiffSnippet(nonEmptyOrigLines, [])}\n\`\`\`\n\n` +
          `[📊 Open in Unified Diff View](command:reviewflow.openInlineDiff?${encodeURIComponent(JSON.stringify([group.id, editor.document.uri]))})`
        );
        hoverMsg.isTrusted = true;

        const decoOpt: vscode.DecorationOptions = {
          range: new vscode.Range(boundaryLine, 0, boundaryLine, 0),
          hoverMessage: hoverMsg
        };

        if (group.addedLineCount > 0) {
          deletionBoundaryRanges.push(decoOpt);
        } else {
          deletionRanges.push(decoOpt);
        }

        // Only show inline text preview badge if explicitly configured (avoids horizontal code collision)
        if (config.get<boolean>('showDeletionInlinePreview', false)) {
          let preview = '';
          if (nonEmptyOrigLines.length === 1) {
            preview = nonEmptyOrigLines[0].trim();
            if (preview.length > 30) {
              preview = preview.substring(0, 27) + '...';
            }
          } else if (nonEmptyOrigLines.length > 1) {
            preview = `${group.deletedLineCount} lines`;
          }

          deletedTextDecorations.push({
            range: new vscode.Range(boundaryLine, 0, boundaryLine, 0),
            renderOptions: {
              after: {
                contentText: ` ⇋ -${group.deletedLineCount}${preview ? `: ${preview}` : ''} `,
                color: 'rgba(255, 123, 114, 0.8)',
                backgroundColor: 'rgba(248, 81, 73, 0.12)',
                border: '1px solid rgba(248, 81, 73, 0.3)',
                margin: '0 0 0 12px'
              }
            },
            hoverMessage: hoverMsg
          });
        }
      }

      // Add green additions with word-level highlighting
      if (group.addedLineCount > 0) {
        const range = RangeUtils.createLineRange(group.startLine, group.endLine, editor.document);
        additionRanges.push(range);

        // Use line pairings to compute word-level diffs
        for (const pairing of pairings) {
          // We only highlight on current (added) lines
          if (pairing.currentIndex < 0) {
            continue;
          }

          const docLine = group.startLine + pairing.currentIndex;
          if (docLine >= editor.document.lineCount) {
            break;
          }

          if (pairing.originalIndex >= 0 && pairing.wordDiffs.length > 0) {
            // Paired modification: highlight only the changed spans
            for (const span of pairing.wordDiffs) {
              if (span.currentEnd > span.currentStart) {
                wordAdditionRanges.push(
                  new vscode.Range(docLine, span.currentStart, docLine, span.currentEnd)
                );
              }
            }
          } else if (pairing.originalIndex < 0) {
            // Pure insertion (no matching original line): highlight the entire line content
            const lineText = editor.document.lineAt(docLine).text;
            if (lineText.length > 0) {
              wordAdditionRanges.push(
                new vscode.Range(docLine, 0, docLine, lineText.length)
              );
            }
          }
          // If originalIndex >= 0 and wordDiffs is empty, lines are identical — no highlight needed
        }
      }
    }

    editor.setDecorations(this.additionDecorationType, additionRanges);
    editor.setDecorations(this.wordAdditionDecorationType, wordAdditionRanges);
    editor.setDecorations(this.deletionIndicatorType, deletionRanges);
    editor.setDecorations(this.deletionBoundaryType, deletionBoundaryRanges);
    editor.setDecorations(this.deletedTextDecorationType, deletedTextDecorations);
    editor.setDecorations(this.conflictDecorationType, conflictRanges);
  }

  public clearEditor(editor: vscode.TextEditor): void {
    editor.setDecorations(this.additionDecorationType, []);
    editor.setDecorations(this.wordAdditionDecorationType, []);
    editor.setDecorations(this.deletionIndicatorType, []);
    editor.setDecorations(this.deletionBoundaryType, []);
    editor.setDecorations(this.deletedTextDecorationType, []);
    editor.setDecorations(this.conflictDecorationType, []);
  }

  public dispose(): void {
    this.additionDecorationType.dispose();
    this.wordAdditionDecorationType.dispose();
    this.wordDeletionDecorationType.dispose();
    this.deletionIndicatorType.dispose();
    this.deletionBoundaryType.dispose();
    this.deletedTextDecorationType.dispose();
    this.conflictDecorationType.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
