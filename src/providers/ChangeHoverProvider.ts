import * as vscode from 'vscode';
import { ChangeTracker } from '../core/ChangeTracker';
import { RangeUtils } from '../utils/RangeUtils';
import { DiffUtils } from '../utils/DiffUtils';

export class ChangeHoverProvider implements vscode.HoverProvider {
  private tracker: ChangeTracker;

  constructor(tracker: ChangeTracker) {
    this.tracker = tracker;
  }

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | undefined {
    const groups = this.tracker.getGroupsForUri(document.uri);
    if (!groups || groups.length === 0) {
      return undefined;
    }

    const matchingIndex = groups.findIndex(
      (g) => position.line >= g.startLine && position.line <= g.endLine
    );

    if (matchingIndex === -1) {
      return undefined;
    }

    const group = groups[matchingIndex];
    const range = RangeUtils.createLineRange(group.startLine, group.endLine, document);

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    md.appendMarkdown(`### ⚡ ReviewFlow: Change #${matchingIndex + 1}\n\n`);
    md.appendMarkdown(
      `**Range:** ${RangeUtils.formatLineRange(group.startLine, group.endLine)}  •  ` +
      `**Stats:** 🟢 \`+${group.addedLineCount}\`  🔴 \`-${group.deletedLineCount}\`  •  ` +
      `**Source:** \`${group.source}\`\n\n`
    );

    if (group.isConflict) {
      md.appendMarkdown(`> ⚠️ **Conflict:** ${group.conflictReason || 'Region modified'}\n\n`);
    }

    const origLines = DiffUtils.splitLines(group.originalText);
    const currLines = DiffUtils.splitLines(group.currentText);
    const diffSnippet = DiffUtils.formatDiffSnippet(origLines, currLines);

    if (diffSnippet) {
      md.appendCodeblock(diffSnippet, 'diff');
    }

    const acceptArgs = encodeURIComponent(JSON.stringify([group.id, document.uri]));
    const rejectArgs = encodeURIComponent(JSON.stringify([group.id, document.uri]));
    const previewArgs = encodeURIComponent(JSON.stringify([group.id, document.uri]));

    md.appendMarkdown(
      `[✅ Accept](command:reviewflow.acceptChange?${acceptArgs}) &nbsp;&nbsp;|&nbsp;&nbsp; ` +
      `[❌ Reject](command:reviewflow.rejectChange?${rejectArgs}) &nbsp;&nbsp;|&nbsp;&nbsp; ` +
      `[📊 Side-by-Side Diff](command:reviewflow.previewDiff?${previewArgs})`
    );

    return new vscode.Hover(md, range);
  }
}
