import * as vscode from 'vscode';
import * as path from 'path';
import { ChangeTracker } from '../core/ChangeTracker';
import { ChangeManager } from '../core/ChangeManager';
import { DiffUtils } from '../utils/DiffUtils';
import { DiffHunk } from '../models/Change';
import { ChangeDocumentProvider } from './ChangeDocumentProvider';

interface ChangeHunkData {
  id: string;
  index: number;
  lineLabel: string;
  type: string;
  added: number;
  deleted: number;
  summary: string;
  snippet: string;
}

interface FileData {
  uri: string;
  fileName: string;
  filePath: string;
  changeCount: number;
  totalAdded: number;
  totalDeleted: number;
  isNewFile: boolean;
  hunks: ChangeHunkData[];
}

interface ReviewedFileData {
  uri: string;
  fileName: string;
  filePath: string;
  snapKey: string;
  totalAdded: number;
  totalDeleted: number;
  hunks: ChangeHunkData[];
}

export class ChangeWebviewViewProvider implements vscode.WebviewViewProvider {
  public static readonly VIEW_ID = 'reviewflow.pendingChangesView';

  private view?: vscode.WebviewView;
  private tracker: ChangeTracker;
  private manager: ChangeManager;
  private activeTab: 'pending' | 'reviewed' = 'pending';

  constructor(tracker: ChangeTracker, manager: ChangeManager) {
    this.tracker = tracker;
    this.manager = manager;

    this.tracker.onDidChangePendingChanges(() => {
      if (this.tracker.getTotalPendingCount() > 0 && this.activeTab === 'reviewed') {
        // Automatically surface new pending changes
        this.activeTab = 'pending';
      }
      this.updateContent();
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'openFile':
        case 'openDiff':
          if (message.uri) {
            const uri = vscode.Uri.parse(message.uri);
            await vscode.commands.executeCommand('reviewflow.openInlineDiff', uri);
          }
          break;

        case 'openDiffHunk':
          if (message.uri && message.groupId) {
            const uri = vscode.Uri.parse(message.uri);
            await vscode.commands.executeCommand('reviewflow.openInlineDiff', message.groupId, uri);
          }
          break;

        case 'openReviewedDiff':
          if (message.uri && message.snapKey) {
            const targetUri = vscode.Uri.parse(message.uri);
            const baselineUri = vscode.Uri.from({
              scheme: ChangeDocumentProvider.SNAPSHOT_SCHEME,
              path: targetUri.path,
              query: message.snapKey
            });
            const fileName = path.basename(targetUri.fsPath);
            await vscode.commands.executeCommand(
              'vscode.diff',
              baselineUri,
              targetUri,
              `${fileName} (Accepted Changes)`
            );
          }
          break;

        case 'acceptChange':
          if (message.uri && message.groupId) {
            await this.manager.acceptChange(message.groupId, vscode.Uri.parse(message.uri));
          }
          break;

        case 'rejectChange':
          if (message.uri && message.groupId) {
            await this.manager.rejectChange(message.groupId, vscode.Uri.parse(message.uri));
          }
          break;

        case 'acceptFile':
          if (message.uri) {
            await this.manager.acceptFile(vscode.Uri.parse(message.uri));
            if (this.tracker.getTotalPendingCount() === 0) {
              this.activeTab = 'reviewed';
            }
            this.updateContent();
          }
          break;

        case 'rejectFile':
          if (message.uri) {
            await this.manager.rejectFile(vscode.Uri.parse(message.uri));
            this.updateContent();
          }
          break;

        case 'acceptAll':
          await this.manager.acceptAll();
          this.activeTab = 'reviewed';
          this.updateContent();
          break;

        case 'rejectAll':
          await this.manager.rejectAll();
          this.updateContent();
          break;

        case 'undo':
          await this.manager.undoLastChange();
          this.activeTab = 'pending';
          this.updateContent();
          break;

        case 'switchTab':
          if (message.tab) {
            this.activeTab = message.tab;
            this.updateContent();
          }
          break;
      }
    });

    this.updateContent();
  }

  public updateContent(): void {
    if (!this.view) {
      return;
    }

    const trackedUris = this.tracker.getTrackedUris();
    const canUndo = this.manager.getHistory().canUndo();

    const pendingFiles: FileData[] = trackedUris.map((uri) => {
      const groups = this.tracker.getGroupsForUri(uri);
      let totalAdded = 0;
      let totalDeleted = 0;
      let isNewFile = this.tracker.isNewFile(uri);

      const hunks: ChangeHunkData[] = groups.map((g, idx) => {
        totalAdded += g.addedLineCount;
        totalDeleted += g.deletedLineCount;
        if (g.deletedLineCount === 0 && g.originalText === '') {
          isNewFile = true;
        }

        const lineLabel = g.startLine === g.endLine
          ? `L${g.startLine + 1}`
          : `L${g.startLine + 1}–${g.endLine + 1}`;

        let summary = '';
        if (g.type === 'modify') {
          summary = `Modify (${lineLabel})`;
        } else if (g.type === 'insert') {
          summary = `Insert (${lineLabel})`;
        } else if (g.type === 'delete') {
          summary = `Delete (${lineLabel})`;
        }

        let snippet = '';
        if (g.originalText && g.originalText.trim().length > 0) {
          const firstLine = g.originalText.trim().split('\n')[0];
          snippet = firstLine.length > 28 ? firstLine.substring(0, 25) + '...' : firstLine;
        } else if (g.currentText && g.currentText.trim().length > 0) {
          const firstLine = g.currentText.trim().split('\n')[0];
          snippet = firstLine.length > 28 ? firstLine.substring(0, 25) + '...' : firstLine;
        }

        return {
          id: g.id,
          index: idx + 1,
          lineLabel,
          type: g.type,
          added: g.addedLineCount,
          deleted: g.deletedLineCount,
          summary,
          snippet
        };
      });

      return {
        uri: uri.toString(),
        fileName: path.basename(uri.fsPath),
        filePath: uri.fsPath,
        changeCount: groups.length,
        totalAdded,
        totalDeleted,
        isNewFile,
        hunks
      };
    });

    // Extract reviewed changes from history
    const reviewedFiles: ReviewedFileData[] = this.getReviewedFilesFromHistory();

    // If there are no pending changes, but reviewed changes exist, automatically show reviewed
    if (pendingFiles.length === 0 && reviewedFiles.length > 0 && this.activeTab === 'pending') {
      this.activeTab = 'reviewed';
    }

    this.view.webview.html = this.getHtml(pendingFiles, reviewedFiles, canUndo);
  }

  private getReviewedFilesFromHistory(): ReviewedFileData[] {
    const historyOps = this.manager.getHistory().getAll();
    if (!historyOps || historyOps.length === 0) {
      return [];
    }

    const reviewedMap = new Map<string, ReviewedFileData>();

    // Process operations in reverse chronological order
    for (let i = historyOps.length - 1; i >= 0; i--) {
      const op = historyOps[i];
      if (!op.fileSnapshots || op.fileSnapshots.length === 0) {
        continue;
      }

      for (const snap of op.fileSnapshots) {
        if (!snap.fileUri || snap.fileUri === 'workspace') {
          continue;
        }
        if (reviewedMap.has(snap.fileUri)) {
          continue; // Keep most recent review record for this file
        }

        const snapKey = `snap_${op.id}_${encodeURIComponent(snap.fileUri)}`;
        ChangeDocumentProvider.setSnapshot(snapKey, snap.baselineBefore);

        // Compute diff between baselineBefore and documentBefore
        const hunks: DiffHunk[] = DiffUtils.computeLineDiff(snap.baselineBefore || '', snap.documentBefore || '');
        let totalAdded = 0;
        let totalDeleted = 0;

        const hunkDataList: ChangeHunkData[] = hunks.map((h: DiffHunk, idx: number) => {
          totalAdded += h.currentLineCount;
          totalDeleted += h.originalLineCount;

          const lineLabel = h.currentLineCount <= 1
            ? `L${h.currentStartLine + 1}`
            : `L${h.currentStartLine + 1}–${h.currentStartLine + h.currentLineCount}`;

          let snippet = '';
          if (h.currentLines.length > 0 && h.currentLines[0].trim().length > 0) {
            const first = h.currentLines[0].trim();
            snippet = first.length > 28 ? first.substring(0, 25) + '...' : first;
          } else if (h.originalLines.length > 0 && h.originalLines[0].trim().length > 0) {
            const first = h.originalLines[0].trim();
            snippet = first.length > 28 ? first.substring(0, 25) + '...' : first;
          }

          return {
            id: `hunk_${idx}_${h.currentStartLine}`,
            index: idx + 1,
            lineLabel,
            type: h.type,
            added: h.currentLineCount,
            deleted: h.originalLineCount,
            summary: `${h.type} (${lineLabel})`,
            snippet
          };
        });

        let parsedUri: vscode.Uri;
        try {
          parsedUri = vscode.Uri.parse(snap.fileUri);
        } catch {
          parsedUri = vscode.Uri.file(snap.fileUri);
        }

        reviewedMap.set(snap.fileUri, {
          uri: snap.fileUri,
          fileName: path.basename(parsedUri.fsPath),
          filePath: parsedUri.fsPath,
          snapKey,
          totalAdded,
          totalDeleted,
          hunks: hunkDataList
        });
      }
    }

    return Array.from(reviewedMap.values());
  }

  private getHtml(
    pendingFiles: FileData[],
    reviewedFiles: ReviewedFileData[],
    canUndo: boolean
  ): string {
    const pendingCount = pendingFiles.length;
    const reviewedCount = reviewedFiles.length;

    const totalPendingAdded = pendingFiles.reduce((sum, f) => sum + f.totalAdded, 0);
    const totalPendingDeleted = pendingFiles.reduce((sum, f) => sum + f.totalDeleted, 0);

    const totalRevAdded = reviewedFiles.reduce((sum, f) => sum + f.totalAdded, 0);
    const totalRevDeleted = reviewedFiles.reduce((sum, f) => sum + f.totalDeleted, 0);

    const activeTab = this.activeTab;

    // Build Pending File Cards
    const pendingFileRows = pendingFiles
      .map((f, idx) => {
        const iconBadge = f.isNewFile
          ? `<span class="file-icon new-file">⊞</span>`
          : `<span class="file-icon mod-file">⊡</span>`;

        const deletedClass = f.totalDeleted > 0 ? 'del-stat' : 'zero-stat';

        const hunksHtml = f.hunks
          .map((h) => {
            const tagClass = h.type === 'modify' ? 'tag-mod' : h.type === 'insert' ? 'tag-add' : 'tag-del';
            const tagText = h.type === 'modify' ? '± mod' : h.type === 'insert' ? '+ add' : '- del';

            return `
            <div class="hunk-row" onclick="event.stopPropagation(); sendMsg('openDiffHunk', '${f.uri}', '${h.id}')">
              <div class="hunk-left">
                <span class="hunk-tag ${tagClass}">${tagText}</span>
                <span class="hunk-label">${this.escape(h.lineLabel)}</span>
                ${h.added > 0 ? `<span class="stat-badge add-stat">+${h.added}</span>` : ''}
                ${h.deleted > 0 ? `<span class="stat-badge del-stat">-${h.deleted}</span>` : ''}
                ${h.snippet ? `<span class="hunk-snippet" title="${this.escape(h.snippet)}">${this.escape(h.snippet)}</span>` : ''}
              </div>
              <div class="hunk-actions" onclick="event.stopPropagation()">
                <button class="hunk-diff-btn" title="Open Diff View for this modify part" onclick="sendMsg('openDiffHunk', '${f.uri}', '${h.id}')">
                  ⇋ Diff View
                </button>
                <button class="icon-btn accept-btn" title="Accept change" onclick="sendMsg('acceptChange', '${f.uri}', '${h.id}')">✓</button>
                <button class="icon-btn reject-btn" title="Reject change" onclick="sendMsg('rejectChange', '${f.uri}', '${h.id}')">✕</button>
              </div>
            </div>
          `;
          })
          .join('');

        return `
        <div class="file-card">
          <div class="file-row" onclick="toggleHunks('pen-', '${idx}')">
            <div class="row-left">
              <span class="file-number">${idx + 1}.</span>
              <span class="chevron" id="pen-chev-${idx}">▾</span>
              ${iconBadge}
              <span class="stat-badge add-stat">+${f.totalAdded}</span>
              <span class="stat-badge ${deletedClass}">-${f.totalDeleted}</span>
              <span class="file-name">${this.escape(f.fileName)}</span>
              <span class="file-path" title="${this.escape(f.filePath)}">${this.escape(f.filePath)}</span>
            </div>
            <div class="row-actions" onclick="event.stopPropagation()">
              <button class="icon-btn diff-btn" title="Open Diff View" onclick="sendMsg('openDiff', '${f.uri}')">⇋</button>
              <button class="icon-btn accept-btn" title="Accept File" onclick="sendMsg('acceptFile', '${f.uri}')">✓</button>
              <button class="icon-btn reject-btn" title="Reject File" onclick="sendMsg('rejectFile', '${f.uri}')">✕</button>
            </div>
          </div>
          <div class="hunks-container" id="pen-hunks-${idx}">
            ${hunksHtml}
          </div>
        </div>
      `;
      })
      .join('');

    // Build Reviewed File Cards
    const reviewedFileRows = reviewedFiles
      .map((f, idx) => {
        const deletedClass = f.totalDeleted > 0 ? 'del-stat' : 'zero-stat';

        const hunksHtml = f.hunks
          .map((h) => {
            const tagClass = h.type === 'modify' ? 'tag-mod' : h.type === 'insert' ? 'tag-add' : 'tag-del';
            const tagText = h.type === 'modify' ? '± mod' : h.type === 'insert' ? '+ add' : '- del';

            return `
            <div class="hunk-row" onclick="event.stopPropagation(); sendMsg('openReviewedDiff', '${f.uri}', '${h.id}', '${f.snapKey}')">
              <div class="hunk-left">
                <span class="hunk-tag ${tagClass}">${tagText}</span>
                <span class="hunk-label">${this.escape(h.lineLabel)}</span>
                ${h.added > 0 ? `<span class="stat-badge add-stat">+${h.added}</span>` : ''}
                ${h.deleted > 0 ? `<span class="stat-badge del-stat">-${h.deleted}</span>` : ''}
                ${h.snippet ? `<span class="hunk-snippet" title="${this.escape(h.snippet)}">${this.escape(h.snippet)}</span>` : ''}
              </div>
              <div class="hunk-actions" onclick="event.stopPropagation()">
                <button class="hunk-diff-btn" title="View Accepted Diff" onclick="sendMsg('openReviewedDiff', '${f.uri}', '${h.id}', '${f.snapKey}')">
                  ⇋ Diff View
                </button>
              </div>
            </div>
          `;
          })
          .join('');

        return `
        <div class="file-card reviewed-card">
          <div class="file-row" onclick="toggleHunks('rev-', '${idx}')">
            <div class="row-left">
              <span class="file-number">${idx + 1}.</span>
              <span class="chevron" id="rev-chev-${idx}">▾</span>
              <span class="file-icon accept-file">✓</span>
              <span class="stat-badge add-stat">+${f.totalAdded}</span>
              <span class="stat-badge ${deletedClass}">-${f.totalDeleted}</span>
              <span class="file-name">${this.escape(f.fileName)}</span>
              <span class="file-path" title="${this.escape(f.filePath)}">${this.escape(f.filePath)}</span>
            </div>
            <div class="row-actions" onclick="event.stopPropagation()">
              <button class="icon-btn diff-btn" title="View Accepted Diff" onclick="sendMsg('openReviewedDiff', '${f.uri}', '', '${f.snapKey}')">⇋</button>
            </div>
          </div>
          <div class="hunks-container" id="rev-hunks-${idx}">
            ${hunksHtml}
          </div>
        </div>
      `;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      box-sizing: border-box;
    }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 12px);
      color: var(--vscode-foreground, #cccccc);
      background-color: var(--vscode-sideBar-background, #18181b);
      padding: 8px;
      user-select: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
      height: 100vh;
    }

    .card-container {
      background-color: #1e1e20;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      height: 100%;
    }

    /* Tabs Bar */
    .tabs-bar {
      display: flex;
      align-items: center;
      background: #161618;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 4px 8px;
      gap: 6px;
      flex-shrink: 0;
    }

    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: #8b949e;
      padding: 4px 10px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }

    .tab-btn:hover {
      color: #f0f6fc;
      background: rgba(255, 255, 255, 0.05);
    }

    .tab-btn.active {
      color: #58a6ff;
      background: rgba(56, 139, 253, 0.12);
      border-color: rgba(56, 139, 253, 0.3);
      font-weight: 600;
    }

    .tab-badge {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.08);
      color: inherit;
    }

    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background-color: #1b1b1e;
      flex-shrink: 0;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #f0f6fc;
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.2px;
    }

    .header-icon {
      font-size: 13px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .banner-note {
      padding: 6px 12px;
      background: rgba(56, 139, 253, 0.08);
      border-bottom: 1px solid rgba(56, 139, 253, 0.15);
      color: #79c0ff;
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .file-list {
      display: block !important;
      padding: 8px;
      flex: 1 1 auto;
      min-height: 0;
      max-height: none;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      box-sizing: border-box;
    }

    .file-list::-webkit-scrollbar {
      width: 6px;
    }
    .file-list::-webkit-scrollbar-track {
      background: transparent;
    }
    .file-list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.18);
      border-radius: 3px;
    }
    .file-list::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.35);
    }

    .file-card {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      margin-bottom: 6px !important;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      transition: background 0.15s ease, border-color 0.15s ease;
      height: auto !important;
      min-height: 32px !important;
      overflow: visible !important;
    }

    .file-card:last-child {
      margin-bottom: 0 !important;
    }

    .file-card:hover {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.10);
    }

    .reviewed-card {
      border-color: rgba(46, 160, 67, 0.18);
      background: rgba(46, 160, 67, 0.02);
    }

    .file-row {
      display: flex !important;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      cursor: pointer;
      user-select: none;
      min-height: 32px !important;
      height: 32px !important;
      box-sizing: border-box !important;
    }

    .file-row:hover {
      background-color: rgba(255, 255, 255, 0.04);
    }

    .row-left {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      white-space: nowrap;
      flex: 1;
    }

    .chevron {
      font-size: 9px;
      color: #8b949e;
      width: 12px;
      height: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease;
      cursor: pointer;
    }

    .chevron.collapsed {
      transform: rotate(-90deg);
    }

    .file-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      font-size: 11px;
      border-radius: 3px;
      font-weight: bold;
      flex-shrink: 0;
    }

    .new-file {
      color: #3fb950;
      border: 1px solid #238636;
      background: rgba(35, 134, 54, 0.15);
    }

    .mod-file {
      color: #d29922;
      border: 1px solid #9e6a03;
      background: rgba(210, 153, 34, 0.15);
    }

    .accept-file {
      color: #3fb950;
      border: 1px solid #238636;
      background: rgba(35, 134, 54, 0.2);
    }

    .stat-badge {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .add-stat {
      color: #3fb950;
    }

    .del-stat {
      color: #f85149;
    }

    .zero-stat {
      color: #6e7681;
    }

    .file-name {
      color: #f0f6fc;
      font-weight: 500;
      flex-shrink: 0;
      margin-left: 2px;
    }

    .file-path {
      color: #8b949e;
      font-size: 10.5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      direction: rtl;
      text-align: left;
      flex: 1;
    }

    .row-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      margin-left: 6px;
    }

    .icon-btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #c9d1d9;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 11px;
      transition: all 0.12s ease;
    }

    .icon-btn:hover {
      background: rgba(255, 255, 255, 0.18);
    }

    .accept-btn {
      background: rgba(46, 160, 67, 0.15);
      border: 1px solid rgba(46, 160, 67, 0.35);
      color: #3fb950;
    }

    .accept-btn:hover {
      background: #238636;
      color: #ffffff;
      border-color: #2ea043;
      box-shadow: 0 0 8px rgba(46, 160, 67, 0.4);
    }

    .reject-btn {
      background: rgba(248, 81, 73, 0.12);
      border: 1px solid rgba(248, 81, 73, 0.35);
      color: #ff7b72;
    }

    .reject-btn:hover {
      background: #da3633;
      color: #ffffff;
      border-color: #f85149;
      box-shadow: 0 0 8px rgba(248, 81, 73, 0.4);
    }

    .diff-btn {
      color: #58a6ff;
      border-color: rgba(0, 120, 212, 0.35);
    }

    .diff-btn:hover {
      background: #0078d4;
      color: #ffffff;
      border-color: #106ebe;
    }

    .hunks-container {
      display: block !important;
      padding: 6px 8px 10px 18px !important;
      border-top: 1px solid rgba(255, 255, 255, 0.03);
      background: rgba(0, 0, 0, 0.14);
      height: auto !important;
      min-height: fit-content !important;
      overflow: visible !important;
      box-sizing: border-box !important;
    }

    .hunks-container.hidden {
      display: none !important;
    }

    .hunk-row {
      display: flex !important;
      align-items: center;
      justify-content: space-between;
      padding: 4px 6px;
      margin-bottom: 3px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.12s ease;
      min-height: 28px !important;
      height: auto !important;
      box-sizing: border-box !important;
    }

    .hunk-row:last-child {
      margin-bottom: 0;
    }

    .hunk-row:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .hunk-left {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      white-space: nowrap;
      flex: 1;
    }

    .hunk-tag {
      font-size: 9.5px;
      font-weight: 600;
      padding: 1px 4px;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .tag-mod {
      background: rgba(210, 153, 34, 0.2);
      color: #e3b341;
      border: 1px solid rgba(210, 153, 34, 0.4);
    }

    .tag-add {
      background: rgba(46, 160, 67, 0.2);
      color: #56d364;
      border: 1px solid rgba(46, 160, 67, 0.4);
    }

    .tag-del {
      background: rgba(248, 81, 73, 0.2);
      color: #ff7b72;
      border: 1px solid rgba(248, 81, 73, 0.4);
    }

    .hunk-label {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      color: #c9d1d9;
      font-weight: 500;
    }

    .hunk-snippet {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10.5px;
      color: #8b949e;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .hunk-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .hunk-diff-btn {
      background: rgba(0, 120, 212, 0.18);
      border: 1px solid rgba(0, 120, 212, 0.4);
      color: #58a6ff;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      transition: all 0.15s ease;
    }

    .hunk-diff-btn:hover {
      background: #0078d4;
      color: #ffffff;
      border-color: #106ebe;
      box-shadow: 0 0 8px rgba(0, 120, 212, 0.35);
    }

    .file-number {
      color: #8b949e;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      font-weight: 600;
      min-width: 16px;
      flex-shrink: 0;
    }

    .footer-bar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      padding: 10px 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background-color: #18181b;
      flex-shrink: 0;
    }

    /* Antigravity button styling */
    .btn-reject-all {
      background: rgba(248, 81, 73, 0.10);
      border: 1px solid rgba(248, 81, 73, 0.35);
      color: #ff7b72;
      font-size: 11.5px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }

    .btn-reject-all:hover {
      background: rgba(248, 81, 73, 0.22);
      border-color: #f85149;
      color: #ffffff;
      box-shadow: 0 0 10px rgba(248, 81, 73, 0.35);
      transform: translateY(-1px);
    }

    .btn-accept-all {
      background: linear-gradient(180deg, #1f6feb 0%, #0969da 100%);
      border: 1px solid rgba(56, 139, 253, 0.5);
      color: #ffffff;
      font-size: 11.5px;
      font-weight: 600;
      padding: 6px 16px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      box-shadow: 0 2px 6px rgba(0, 120, 212, 0.35);
      transition: all 0.15s ease;
    }

    .btn-accept-all:hover {
      background: linear-gradient(180deg, #388bfd 0%, #1f6feb 100%);
      border-color: #79c0ff;
      box-shadow: 0 0 14px rgba(9, 105, 218, 0.5);
      transform: translateY(-1px);
    }

    .btn-undo-all {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #f0f6fc;
      font-size: 11.5px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }

    .btn-undo-all:hover {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.35);
      color: #ffffff;
      transform: translateY(-1px);
    }

    .clean-badge {
      color: #3fb950;
      font-size: 11px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .empty-state {
      padding: 32px 16px;
      text-align: center;
      color: #8b949e;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }

    .empty-icon {
      font-size: 28px;
      color: #3fb950;
    }

    .btn-view-reviewed {
      background: rgba(56, 139, 253, 0.12);
      border: 1px solid rgba(56, 139, 253, 0.3);
      color: #58a6ff;
      font-size: 11.5px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      margin-top: 6px;
      transition: all 0.15s ease;
    }

    .btn-view-reviewed:hover {
      background: rgba(56, 139, 253, 0.22);
      border-color: #58a6ff;
      color: #ffffff;
    }

    .undo-bar {
      flex-shrink: 0;
      margin-top: 0;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
    }

    .btn-undo {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #f0f6fc;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    }

    .btn-undo:hover {
      background: rgba(255, 255, 255, 0.15);
    }
  </style>
</head>
<body>

  <div class="card-container">
    <!-- Tabs Bar -->
    <div class="tabs-bar">
      <button class="tab-btn ${activeTab === 'pending' ? 'active' : ''}" onclick="switchTab('pending')">
        <span>📋 Pending</span>
        <span class="tab-badge">${pendingCount}</span>
      </button>
      <button class="tab-btn ${activeTab === 'reviewed' ? 'active' : ''}" onclick="switchTab('reviewed')">
        <span>✓ Reviewed</span>
        <span class="tab-badge">${reviewedCount}</span>
      </button>
    </div>

    ${
      activeTab === 'pending'
        ? pendingCount > 0
          ? `
        <div class="header-bar">
          <div class="header-left">
            <span class="header-icon">📄</span>
            <span class="header-text">${pendingCount} File${pendingCount > 1 ? 's' : ''} With Changes</span>
          </div>
          <div class="header-right">
            ${totalPendingAdded > 0 ? `<span class="stat-badge add-stat">+${totalPendingAdded}</span>` : ''}
            ${totalPendingDeleted > 0 ? `<span class="stat-badge del-stat">-${totalPendingDeleted}</span>` : ''}
          </div>
        </div>
        <div class="file-list">
          ${pendingFileRows}
        </div>
        <div class="footer-bar">
          <button class="btn-reject-all" title="Reject all changes" onclick="sendMsg('rejectAll')">
            <span class="btn-icon">✕</span> Reject all
          </button>
          <button class="btn-accept-all" title="Accept all changes" onclick="sendMsg('acceptAll')">
            <span class="btn-icon">✓</span> Accept all
          </button>
        </div>
      `
          : `
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          <div>No pending changes. Workspace is clean.</div>
          ${
            reviewedCount > 0
              ? `<button class="btn-view-reviewed" onclick="switchTab('reviewed')">View Reviewed Changes (${reviewedCount}) →</button>`
              : ''
          }
        </div>
      `
        : reviewedCount > 0
        ? `
        <div class="header-bar">
          <div class="header-left">
            <span class="header-icon">✓</span>
            <span class="header-text">${reviewedCount} File${reviewedCount > 1 ? 's' : ''} Reviewed & Accepted</span>
          </div>
          <div class="header-right">
            ${totalRevAdded > 0 ? `<span class="stat-badge add-stat">+${totalRevAdded}</span>` : ''}
            ${totalRevDeleted > 0 ? `<span class="stat-badge del-stat">-${totalRevDeleted}</span>` : ''}
          </div>
        </div>
        <div class="banner-note">
          <span>ℹ</span>
          <span>All accepted changes are preserved. Click Diff View to inspect any file's reviewed diff.</span>
        </div>
        <div class="file-list">
          ${reviewedFileRows}
        </div>
        <div class="footer-bar">
          ${
            canUndo
              ? `<button class="btn-undo-all" title="Undo the last review acceptance" onclick="sendMsg('undo')">↺ Undo Acceptance</button>`
              : ''
          }
          <div class="clean-badge">Workspace clean ✓</div>
        </div>
      `
        : `
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          <div>No reviewed changes recorded yet.</div>
          <button class="btn-view-reviewed" onclick="switchTab('pending')">← Back to Pending (${pendingCount})</button>
        </div>
      `
    }
  </div>

  ${
    canUndo && activeTab === 'pending'
      ? `
    <div class="undo-bar">
      <span>Last change recorded in history</span>
      <button class="btn-undo" onclick="sendMsg('undo')">↺ Undo</button>
    </div>
  `
      : ''
  }

  <script>
    const vscode = acquireVsCodeApi();

    function sendMsg(type, uri, groupId, snapKey) {
      vscode.postMessage({ type, uri, groupId, snapKey });
    }

    function switchTab(tab) {
      vscode.postMessage({ type: 'switchTab', tab });
    }

    function toggleHunks(prefix, idx) {
      const el = document.getElementById(prefix + 'hunks-' + idx);
      const chev = document.getElementById(prefix + 'chev-' + idx);
      if (el) {
        el.classList.toggle('hidden');
        if (chev) {
          chev.classList.toggle('collapsed');
        }
      }
    }
  </script>
</body>
</html>`;
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
