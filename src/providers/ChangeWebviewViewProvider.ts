import * as vscode from 'vscode';
import * as path from 'path';
import { ChangeTracker } from '../core/ChangeTracker';
import { ChangeManager } from '../core/ChangeManager';
import { executeDiffPreview } from '../commands/DiffPreviewCommand';

export class ChangeWebviewViewProvider implements vscode.WebviewViewProvider {
  public static readonly VIEW_ID = 'reviewflow.pendingChangesView';

  private view?: vscode.WebviewView;
  private tracker: ChangeTracker;
  private manager: ChangeManager;

  constructor(tracker: ChangeTracker, manager: ChangeManager) {
    this.tracker = tracker;
    this.manager = manager;

    this.tracker.onDidChangePendingChanges(() => {
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
          if (message.uri) {
            const uri = vscode.Uri.parse(message.uri);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            const groups = this.tracker.getGroupsForUri(uri);
            if (groups.length > 0) {
              const range = new vscode.Range(groups[0].startLine, 0, groups[0].endLine, 0);
              editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }
          }
          break;

        case 'openDiff':
          if (message.uri) {
            const uri = vscode.Uri.parse(message.uri);
            await executeDiffPreview(uri);
          }
          break;

        case 'acceptFile':
          if (message.uri) {
            await this.manager.acceptFile(vscode.Uri.parse(message.uri));
          }
          break;

        case 'rejectFile':
          if (message.uri) {
            await this.manager.rejectFile(vscode.Uri.parse(message.uri));
          }
          break;

        case 'acceptAll':
          await this.manager.acceptAll();
          break;

        case 'rejectAll':
          await this.manager.rejectAll();
          break;

        case 'undo':
          await this.manager.undoLastChange();
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

    const filesData = trackedUris.map((uri) => {
      const groups = this.tracker.getGroupsForUri(uri);
      let totalAdded = 0;
      let totalDeleted = 0;
      let isNewFile = this.tracker.isNewFile(uri);

      for (const g of groups) {
        totalAdded += g.addedLineCount;
        totalDeleted += g.deletedLineCount;
        if (g.deletedLineCount === 0 && g.originalText === '') {
          isNewFile = true;
        }
      }

      return {
        uri: uri.toString(),
        fileName: path.basename(uri.fsPath),
        filePath: uri.fsPath,
        changeCount: groups.length,
        totalAdded,
        totalDeleted,
        isNewFile
      };
    });

    this.view.webview.html = this.getHtml(filesData, canUndo);
  }

  private getHtml(
    files: Array<{
      uri: string;
      fileName: string;
      filePath: string;
      changeCount: number;
      totalAdded: number;
      totalDeleted: number;
      isNewFile: boolean;
    }>,
    canUndo: boolean
  ): string {
    const fileCount = files.length;

    const fileRows = files
      .map((f) => {
        const iconBadge = f.isNewFile
          ? `<span class="file-icon new-file">⊞</span>`
          : `<span class="file-icon mod-file">⊡</span>`;

        const deletedClass = f.totalDeleted > 0 ? 'del-stat' : 'zero-stat';

        return `
        <div class="file-row" onclick="sendMsg('openFile', '${f.uri}')">
          <div class="row-left">
            ${iconBadge}
            <span class="stat-badge add-stat">+${f.totalAdded}</span>
            <span class="stat-badge ${deletedClass}">-${f.totalDeleted}</span>
            <span class="file-name">${this.escape(f.fileName)}</span>
            <span class="file-path" title="${this.escape(f.filePath)}">${this.escape(f.filePath)}</span>
          </div>
          <div class="row-actions" onclick="event.stopPropagation()">
            <button class="icon-btn diff-btn" title="Inspect Diff" onclick="sendMsg('openDiff', '${f.uri}')">⇋</button>
            <button class="icon-btn accept-btn" title="Accept File" onclick="sendMsg('acceptFile', '${f.uri}')">✓</button>
            <button class="icon-btn reject-btn" title="Reject File" onclick="sendMsg('rejectFile', '${f.uri}')">✕</button>
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
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 12px);
      color: var(--vscode-foreground, #cccccc);
      background-color: var(--vscode-sideBar-background, #18181b);
      padding: 10px;
      user-select: none;
    }

    .card-container {
      background-color: #1e1e20;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    }

    .file-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px;
      max-height: calc(100vh - 120px);
      overflow-y: auto;
    }

    .file-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .file-row:hover {
      background-color: rgba(255, 255, 255, 0.06);
    }

    .row-left {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      white-space: nowrap;
      flex: 1;
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
      display: none;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      margin-left: 6px;
    }

    .file-row:hover .row-actions {
      display: flex;
    }

    .icon-btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
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
      background: rgba(255, 255, 255, 0.15);
    }

    .accept-btn:hover {
      background: #238636;
      color: #ffffff;
      border-color: #2ea043;
    }

    .reject-btn:hover {
      background: #da3633;
      color: #ffffff;
      border-color: #f85149;
    }

    .diff-btn:hover {
      background: #0078d4;
      color: #ffffff;
      border-color: #106ebe;
    }

    .footer-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background-color: #18181b;
    }

    .footer-left {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #c9d1d9;
      font-size: 11.5px;
      font-weight: 500;
    }

    .footer-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-reject-all {
      background: transparent;
      border: none;
      color: #8b949e;
      font-size: 11.5px;
      font-weight: 500;
      padding: 5px 8px;
      border-radius: 5px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-reject-all:hover {
      color: #f85149;
      background: rgba(248, 81, 73, 0.1);
    }

    .btn-accept-all {
      background: #0078d4;
      color: #ffffff;
      border: none;
      font-size: 11.5px;
      font-weight: 600;
      padding: 5px 12px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }

    .btn-accept-all:hover {
      background: #106ebe;
      box-shadow: 0 0 10px rgba(0, 120, 212, 0.4);
    }

    .empty-state {
      padding: 24px 16px;
      text-align: center;
      color: #8b949e;
      font-size: 12px;
    }

    .empty-icon {
      font-size: 24px;
      color: #3fb950;
      margin-bottom: 8px;
    }

    .undo-bar {
      margin-top: 8px;
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
    ${
      fileCount > 0
        ? `
      <div class="file-list">
        ${fileRows}
      </div>
      <div class="footer-bar">
        <div class="footer-left">
          <span>←</span>
          <span>📄</span>
          <span>${fileCount} File${fileCount > 1 ? 's' : ''} With Changes</span>
        </div>
        <div class="footer-right">
          <button class="btn-reject-all" onclick="sendMsg('rejectAll')">Reject all</button>
          <button class="btn-accept-all" onclick="sendMsg('acceptAll')">Accept all</button>
        </div>
      </div>
    `
        : `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <div>No pending changes. Workspace is clean.</div>
      </div>
    `
    }
  </div>

  ${
    canUndo
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
    function sendMsg(type, uri) {
      vscode.postMessage({ type, uri });
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
