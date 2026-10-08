import * as vscode from 'vscode';
import * as path from 'path';
import { ChangeTracker } from './core/ChangeTracker';
import { ChangeHistory } from './core/ChangeHistory';
import { ChangeManager } from './core/ChangeManager';
import { ChangeCodeLensProvider } from './providers/ChangeCodeLensProvider';
import { ChangeHoverProvider } from './providers/ChangeHoverProvider';
import { FileDecorationProvider } from './providers/FileDecorationProvider';
import { ChangeDocumentProvider } from './providers/ChangeDocumentProvider';
import { ChangeDecorations } from './ui/ChangeDecorations';
import { StatusBar } from './ui/StatusBar';
import { ReviewPanel } from './ui/ReviewPanel';
import { executeAcceptChange } from './commands/AcceptChangeCommand';
import { executeRejectChange } from './commands/RejectChangeCommand';
import { executeAcceptFile } from './commands/AcceptFileCommand';
import { executeRejectFile } from './commands/RejectFileCommand';
import { executeAcceptAll } from './commands/AcceptAllCommand';
import { executeRejectAll } from './commands/RejectAllCommand';
import { executeUndoChange } from './commands/UndoChangeCommand';
import { executeNextChange, executePrevChange, navigateToChange } from './commands/NavigateChangeCommand';
import { executeDiffPreview, executeInlineDiffPreview } from './commands/DiffPreviewCommand';
import { ChangeWebviewViewProvider } from './providers/ChangeWebviewViewProvider';

let tracker: ChangeTracker | undefined;
let manager: ChangeManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('ReviewFlow extension is activating...');

  const history = new ChangeHistory(50, context);
  tracker = new ChangeTracker(context);
  manager = new ChangeManager(tracker, history);

  // 1. Virtual document provider for diff comparison
  const docProvider = new ChangeDocumentProvider(tracker);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(ChangeDocumentProvider.SCHEME, docProvider)
  );

  // 1b. Source Control Quick Diff provider (enables native gutter diff markers and inline diff peek)
  const scm = vscode.scm.createSourceControl('reviewflow', 'ReviewFlow');
  scm.quickDiffProvider = {
    provideOriginalResource(uri: vscode.Uri) {
      if (tracker && tracker.hasPendingChanges(uri)) {
        return vscode.Uri.from({
          scheme: ChangeDocumentProvider.SCHEME,
          path: uri.path,
          query: uri.toString()
        });
      }
      return undefined;
    }
  };
  context.subscriptions.push(scm);

  // Configure diff editor to prefer unified inline view and enable code lenses
  try {
    const diffConfig = vscode.workspace.getConfiguration('diffEditor');
    if (diffConfig.get<boolean>('renderSideBySide') !== false) {
      diffConfig.update('renderSideBySide', false, vscode.ConfigurationTarget.Global);
    }
    if (diffConfig.get<boolean>('codeLens') !== true) {
      diffConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);
    }
  } catch {
    // Ignore if global configuration is restricted
  }

  // 2. CodeLens provider for inline actions
  const codeLensProvider = new ChangeCodeLensProvider(tracker);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
  );

  // 3. Hover provider for detailed change inspect card
  const hoverProvider = new ChangeHoverProvider(tracker);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider)
  );

  // 4. Sidebar View provider (Global review card matching Image 1)
  const webviewProvider = new ChangeWebviewViewProvider(tracker, manager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChangeWebviewViewProvider.VIEW_ID,
      webviewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // 5. Explorer File decoration provider
  const fileDecoProvider = new FileDecorationProvider(tracker);
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileDecoProvider)
  );

  // 6. Inline editor line decorations (with gutter icons and word diffs)
  const decorations = new ChangeDecorations(tracker, context.extensionUri);
  context.subscriptions.push(decorations);

  // 7. Status bar item
  const statusBar = new StatusBar(tracker);
  context.subscriptions.push(statusBar);

  // 8. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('reviewflow.acceptChange', (arg1, arg2) =>
      executeAcceptChange(manager!, arg1, arg2)
    ),
    vscode.commands.registerCommand('reviewflow.rejectChange', (arg1, arg2) =>
      executeRejectChange(manager!, arg1, arg2)
    ),
    vscode.commands.registerCommand('reviewflow.acceptFile', (arg) =>
      executeAcceptFile(manager!, arg)
    ),
    vscode.commands.registerCommand('reviewflow.rejectFile', (arg) =>
      executeRejectFile(manager!, arg)
    ),
    vscode.commands.registerCommand('reviewflow.acceptAll', () =>
      executeAcceptAll(manager!)
    ),
    vscode.commands.registerCommand('reviewflow.rejectAll', () =>
      executeRejectAll(manager!)
    ),
    vscode.commands.registerCommand('reviewflow.undoLastChange', () =>
      executeUndoChange(manager!)
    ),
    vscode.commands.registerCommand('reviewflow.nextChange', () =>
      executeNextChange(manager!)
    ),
    vscode.commands.registerCommand('reviewflow.prevChange', () =>
      executePrevChange(manager!)
    ),
    vscode.commands.registerCommand('reviewflow.navigateToChange', (uri, group) =>
      navigateToChange(uri, group)
    ),
    vscode.commands.registerCommand('reviewflow.previewDiff', (arg1, arg2) =>
      executeDiffPreview(arg1, arg2)
    ),
    vscode.commands.registerCommand('reviewflow.openInlineDiff', (arg1, arg2) =>
      executeInlineDiffPreview(arg1, arg2)
    ),
    vscode.commands.registerCommand('reviewflow.openReviewPanel', () =>
      ReviewPanel.show(manager!)
    ),
    vscode.commands.registerCommand('reviewflow.clearHistory', () => {
      manager!.getHistory().clear();
      vscode.window.showInformationMessage('ReviewFlow: Change history cleared.');
    }),
    vscode.commands.registerCommand('reviewflow.refresh', () => {
      webviewProvider.updateContent();
      statusBar.update();
    })
  );

  let isAutoSwitching = false;

  async function handleAutoShowDiff(uri: vscode.Uri): Promise<void> {
    if (!tracker) {
      return;
    }
    const config = vscode.workspace.getConfiguration('reviewflow');
    if (!config.get<boolean>('autoShowInlineDiff', true)) {
      return;
    }
    if (isAutoSwitching) {
      return;
    }

    const groups = tracker.getGroupsForUri(uri);
    const activeEditor = vscode.window.activeTextEditor;
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    const isAlreadyDiff = activeTab?.input instanceof vscode.TabInputTextDiff;

    if (groups.length > 0) {
      // If active editor is on this file and not yet in diff editor, open unified inline diff automatically
      if (activeEditor && activeEditor.document.uri.toString() === uri.toString() && !isAlreadyDiff) {
        isAutoSwitching = true;
        try {
          await executeInlineDiffPreview(uri);
        } finally {
          isAutoSwitching = false;
        }
      }
    } else if (groups.length === 0 && isAlreadyDiff) {
      // All hunks in this file resolved (accepted/rejected)! Return to normal text editor seamlessly
      const diffInput = activeTab?.input as vscode.TabInputTextDiff;
      if (diffInput && diffInput.modified.toString() === uri.toString()) {
        isAutoSwitching = true;
        try {
          await vscode.window.showTextDocument(uri, { preview: false });
          vscode.window.setStatusBarMessage(
            `✓ All changes reviewed in ${path.basename(uri.fsPath)}`,
            4000
          );
        } finally {
          isAutoSwitching = false;
        }
      }
    }
  }

  // Live diff updates and automatic review diff presentation
  context.subscriptions.push(
    tracker.onDidChangePendingChanges(async (e) => {
      if (e.uri) {
        const baselineUri = vscode.Uri.from({
          scheme: ChangeDocumentProvider.SCHEME,
          path: e.uri.path,
          query: e.uri.toString()
        });
        docProvider.refresh(baselineUri);
        await handleAutoShowDiff(e.uri);
      }
      webviewProvider.updateContent();
      statusBar.update();
    })
  );

  // When switching between editor tabs, auto-show diff if target file has pending changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor && editor.document.uri.scheme === 'file') {
        await handleAutoShowDiff(editor.document.uri);
      }
    })
  );

  // 9. Document lifecycle listeners
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      tracker!.initializeDocument(doc);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      tracker!.handleDocumentChange(e);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (tracker!.isNewFile(doc.uri)) {
        tracker!.recalculateDiffForDocument(doc);
      }
    }),
    vscode.workspace.onDidCreateFiles((e) => {
      for (const uri of e.files) {
        tracker!.handleFileCreated(uri);
      }
    })
  );

  // 10. File system watcher for external changes
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    watcher.onDidCreate((uri) => {
      tracker!.handleFileCreated(uri);
    }),
    watcher.onDidChange((uri) => {
      tracker!.recalculateDiffForUri(uri);
    }),
    watcher.onDidDelete((uri) => {
      tracker!.clearDocument(uri);
    }),
    watcher
  );

  // Initialize any currently open documents
  vscode.workspace.textDocuments.forEach((doc) => {
    tracker!.initializeDocument(doc);
  });

  context.subscriptions.push(tracker, manager);
  console.log('ReviewFlow extension is active.');
}

export function deactivate() {
  if (tracker) {
    tracker.dispose();
  }
  if (manager) {
    manager.dispose();
  }
}
