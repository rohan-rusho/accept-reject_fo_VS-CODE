import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChangeCodeLensProvider } from '../../providers/ChangeCodeLensProvider';
import { ChangeTracker } from '../../core/ChangeTracker';
import { ChangeGroup } from '../../models/ChangeGroup';
import { ChangeSource } from '../../models/ChangeSource';
import { executeDiffPreview, executeInlineDiffPreview } from '../../commands/DiffPreviewCommand';

describe('Diff View Button & Coverage Tests', () => {
  let tracker: ChangeTracker;
  let codeLensProvider: ChangeCodeLensProvider;
  const testUri = vscode.Uri.file('/test/workspace/file.ts');

  beforeEach(() => {
    tracker = new ChangeTracker();
    codeLensProvider = new ChangeCodeLensProvider(tracker);
  });

  it('should provide Diff View CodeLens for line modification (modify hunk)', () => {
    const group: ChangeGroup = {
      id: `${testUri.toString()}#block_1_5-5`,
      fileUri: testUri.toString(),
      startLine: 5,
      endLine: 5,
      originalStartLine: 5,
      originalEndLine: 5,
      originalText: 'const x = 1;',
      currentText: 'const x = 2;',
      addedLineCount: 1,
      deletedLineCount: 1,
      type: 'modify',
      source: ChangeSource.AGENT,
      timestamp: Date.now()
    };

    (tracker as any).pendingGroups.set(testUri.toString(), [group]);

    const docMock: any = {
      uri: testUri,
      lineCount: 20
    };

    const lenses = codeLensProvider.provideCodeLenses(docMock, {} as any);
    assert.strictEqual(lenses.length, 3, 'Should produce exactly 3 CodeLenses: Accept, Reject, Diff View');

    const diffLens = lenses[0];
    const acceptLens = lenses[1];
    const rejectLens = lenses[2];

    assert.ok(diffLens.command?.title.includes('Diff View'), 'First lens must clearly state Diff View for modify part');
    assert.ok(acceptLens.command?.title.includes('✓') || acceptLens.command?.title.includes('Accept'), 'Second lens should be Accept');
    assert.ok(rejectLens.command?.title.includes('✕') || rejectLens.command?.title.includes('Reject'), 'Third lens should be Reject');
    assert.strictEqual(diffLens.command?.command, 'reviewflow.openInlineDiff');
    assert.deepStrictEqual(diffLens.command?.arguments, [group.id, testUri]);
  });

  it('should provide Diff View CodeLens for pure insertions', () => {
    const group: ChangeGroup = {
      id: `${testUri.toString()}#block_1_10-12`,
      fileUri: testUri.toString(),
      startLine: 10,
      endLine: 12,
      originalStartLine: 10,
      originalEndLine: 10,
      originalText: '',
      currentText: 'line 1\nline 2\nline 3',
      addedLineCount: 3,
      deletedLineCount: 0,
      type: 'insert',
      source: ChangeSource.AGENT,
      timestamp: Date.now()
    };

    (tracker as any).pendingGroups.set(testUri.toString(), [group]);

    const docMock: any = {
      uri: testUri,
      lineCount: 20
    };

    const lenses = codeLensProvider.provideCodeLenses(docMock, {} as any);
    assert.strictEqual(lenses.length, 3);
    const diffLens = lenses[0];
    assert.ok(diffLens.command?.title.includes('Diff View'));
    assert.strictEqual(diffLens.command?.command, 'reviewflow.openInlineDiff');
  });

  it('should provide Diff View CodeLens for newly created files', () => {
    const newUri = vscode.Uri.file('/test/workspace/newfile.ts');
    const group: ChangeGroup = {
      id: `${newUri.toString()}#block_1_0-2`,
      fileUri: newUri.toString(),
      startLine: 0,
      endLine: 2,
      originalStartLine: 0,
      originalEndLine: 0,
      originalText: '',
      currentText: 'hello world',
      addedLineCount: 1,
      deletedLineCount: 0,
      type: 'insert',
      source: ChangeSource.AGENT,
      timestamp: Date.now()
    };

    (tracker as any).pendingGroups.set(newUri.toString(), [group]);
    (tracker as any).newFiles.add(newUri.toString());

    const docMock: any = {
      uri: newUri,
      lineCount: 1
    };

    const lenses = codeLensProvider.provideCodeLenses(docMock, {} as any);
    assert.strictEqual(lenses.length, 3);
    const diffLens = lenses[0];
    assert.ok(diffLens.command?.title.includes('Diff View'));
    assert.strictEqual(diffLens.command?.command, 'reviewflow.openInlineDiff');
  });

  it('should execute Diff View without error when group ID is supplied', async () => {
    let executedCommand = '';
    let commandArgs: any[] = [];

    (vscode.commands as any).executeCommand = async (cmd: string, ...args: any[]) => {
      executedCommand = cmd;
      commandArgs = args;
    };

    const groupId = `${testUri.toString()}#block_1_10-15`;
    await executeInlineDiffPreview(groupId, testUri);

    assert.strictEqual(executedCommand, 'vscode.diff');
    assert.strictEqual(commandArgs[0].scheme, 'reviewflow-baseline');
    assert.strictEqual(commandArgs[1].toString(), testUri.toString());
    assert.ok(commandArgs[3].selection instanceof vscode.Range);
    assert.strictEqual(commandArgs[3].selection.start.line, 10);
    assert.strictEqual(commandArgs[3].selection.end.line, 15);
  });

  it('should format CodeLens as compact GitHub-style review toolbar by default: ⇋ Diff View | ✓ Accept | × Reject', () => {
    const group: ChangeGroup = {
      id: `${testUri.toString()}#block_btn_1`,
      fileUri: testUri.toString(),
      startLine: 2,
      endLine: 2,
      originalStartLine: 2,
      originalEndLine: 2,
      originalText: 'old',
      currentText: 'new',
      addedLineCount: 1,
      deletedLineCount: 1,
      type: 'modify',
      source: ChangeSource.AGENT,
      timestamp: Date.now()
    };
    (tracker as any).pendingGroups.set(testUri.toString(), [group]);

    const lenses = codeLensProvider.provideCodeLenses({ uri: testUri, lineCount: 10 } as any, {} as any);
    assert.strictEqual(lenses.length, 3);
    assert.strictEqual(lenses[0].command?.title, '⇋ Diff View');
    assert.strictEqual(lenses[1].command?.title, '✓ Accept');
    assert.strictEqual(lenses[2].command?.title, '× Reject');
  });

  it('should format CodeLens with multi-line line count when useful (e.g. ✓ Accept · 3 lines)', () => {
    const group: ChangeGroup = {
      id: `${testUri.toString()}#block_multi_3`,
      fileUri: testUri.toString(),
      startLine: 1,
      endLine: 3,
      originalStartLine: 1,
      originalEndLine: 3,
      originalText: 'line 1\nline 2\nline 3',
      currentText: 'mod 1\nmod 2\nmod 3',
      addedLineCount: 3,
      deletedLineCount: 3,
      type: 'modify',
      source: ChangeSource.AGENT,
      timestamp: Date.now()
    };
    (tracker as any).pendingGroups.set(testUri.toString(), [group]);

    const lenses = codeLensProvider.provideCodeLenses({ uri: testUri, lineCount: 10 } as any, {} as any);
    assert.strictEqual(lenses.length, 3);
    assert.strictEqual(lenses[0].command?.title, '⇋ Diff View');
    assert.strictEqual(lenses[1].command?.title, '✓ Accept · 3 lines');
    assert.strictEqual(lenses[2].command?.title, '× Reject · 3 lines');
  });

  it('should show processing state in CodeLens when group is in-flight', () => {
    const group: ChangeGroup = {
      id: `${testUri.toString()}#block_inflight_1`,
      fileUri: testUri.toString(),
      startLine: 1,
      endLine: 1,
      originalStartLine: 1,
      originalEndLine: 1,
      originalText: 'old',
      currentText: 'new',
      addedLineCount: 1,
      deletedLineCount: 1,
      type: 'modify',
      source: ChangeSource.AGENT,
      timestamp: Date.now()
    };
    (tracker as any).pendingGroups.set(testUri.toString(), [group]);
    tracker.setGroupInFlight(group.id, true);

    const lenses = codeLensProvider.provideCodeLenses({ uri: testUri, lineCount: 10 } as any, {} as any);
    assert.strictEqual(lenses.length, 3);
    assert.strictEqual(lenses[1].command?.title, '⏳ Applying...');
    assert.strictEqual(lenses[2].command?.title, '⏳ Applying...');

    tracker.setGroupInFlight(group.id, false);
  });

  it('should support buttons, bracketsWithLabels, clean, and antigravity styles', () => {
    const group: ChangeGroup = {
      id: `${testUri.toString()}#block_btn_2`,
      fileUri: testUri.toString(),
      startLine: 2,
      endLine: 2,
      originalStartLine: 2,
      originalEndLine: 2,
      originalText: 'old',
      currentText: 'new',
      addedLineCount: 1,
      deletedLineCount: 1,
      type: 'modify',
      source: ChangeSource.AGENT,
      timestamp: Date.now()
    };
    (tracker as any).pendingGroups.set(testUri.toString(), [group]);

    const originalGetConfig = vscode.workspace.getConfiguration;

    // Test buttons style
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, defaultValue?: any) => {
        if (key === 'codeLensStyle') return 'buttons';
        return defaultValue;
      }
    });

    let lenses = codeLensProvider.provideCodeLenses({ uri: testUri, lineCount: 10 } as any, {} as any);
    assert.strictEqual(lenses[0].command?.title, '[ ⇋ Diff View ]');
    assert.strictEqual(lenses[1].command?.title, '[ ✓ ]');
    assert.strictEqual(lenses[2].command?.title, '[ ✕ ]');

    // Test bracketsWithLabels
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, defaultValue?: any) => {
        if (key === 'codeLensStyle') return 'bracketsWithLabels';
        return defaultValue;
      }
    });

    lenses = codeLensProvider.provideCodeLenses({ uri: testUri, lineCount: 10 } as any, {} as any);
    assert.strictEqual(lenses[0].command?.title, '[ ⇋ Diff View ]');
    assert.strictEqual(lenses[1].command?.title, '[ ✓ Accept ]');
    assert.strictEqual(lenses[2].command?.title, '[ ✕ Reject ]');

    // Test clean style
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, defaultValue?: any) => {
        if (key === 'codeLensStyle') return 'clean';
        return defaultValue;
      }
    });

    lenses = codeLensProvider.provideCodeLenses({ uri: testUri, lineCount: 10 } as any, {} as any);
    assert.strictEqual(lenses[0].command?.title, '⇋ Diff View');
    assert.strictEqual(lenses[1].command?.title, '✓');
    assert.strictEqual(lenses[2].command?.title, '✕');

    // Test antigravity style (Image 1 order: Accept, Reject, Diff View)
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, defaultValue?: any) => {
        if (key === 'codeLensStyle') return 'antigravity';
        return defaultValue;
      }
    });

    lenses = codeLensProvider.provideCodeLenses({ uri: testUri, lineCount: 10 } as any, {} as any);
    assert.strictEqual(lenses.length, 3);
    assert.ok(lenses[0].command?.title.startsWith('[ Accept'));
    assert.ok(lenses[1].command?.title.startsWith('[ Reject'));
    assert.strictEqual(lenses[2].command?.title, '[ ⇋ Diff View ]');

    // Restore
    (vscode.workspace as any).getConfiguration = originalGetConfig;
  });

  it('should provide snapshot text document content via ChangeDocumentProvider', () => {
    const { ChangeDocumentProvider } = require('../../providers/ChangeDocumentProvider');
    const docProvider = new ChangeDocumentProvider(tracker);
    ChangeDocumentProvider.setSnapshot('test_snap_key', 'line 1\nline 2');

    const snapUri = vscode.Uri.from({
      scheme: ChangeDocumentProvider.SNAPSHOT_SCHEME,
      path: '/test/workspace/file.ts',
      query: 'test_snap_key'
    });

    const content = docProvider.provideTextDocumentContent(snapUri);
    assert.strictEqual(content, 'line 1\nline 2');
  });

  it('should render reviewed changes and Antigravity buttons in webview view provider', () => {
    const { ChangeWebviewViewProvider } = require('../../providers/ChangeWebviewViewProvider');
    const { ChangeManager } = require('../../core/ChangeManager');
    const { ChangeHistory } = require('../../core/ChangeHistory');

    const history = new ChangeHistory();
    const manager = new ChangeManager(tracker, history);
    const provider = new ChangeWebviewViewProvider(tracker, manager);

    let htmlContent = '';
    const webviewViewMock: any = {
      webview: {
        options: {},
        set html(val: string) {
          htmlContent = val;
        },
        get html() {
          return htmlContent;
        },
        onDidReceiveMessage: () => ({ dispose: () => {} })
      }
    };

    provider.resolveWebviewView(webviewViewMock, {} as any, {} as any);
    assert.ok(htmlContent.includes('btn-reject-all'), 'Must contain Antigravity reject button');
    assert.ok(htmlContent.includes('btn-accept-all'), 'Must contain Antigravity accept button');
    assert.ok(htmlContent.includes('tabs-bar'), 'Must contain tabs bar with Pending and Reviewed');
  });
});
