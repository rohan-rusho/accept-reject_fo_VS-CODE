import * as vscode from 'vscode';
import { ChangeGroup } from '../models/ChangeGroup';
import { ChangeSource } from '../models/ChangeSource';
import { DiffUtils } from '../utils/DiffUtils';
import { ChangeGrouper } from './ChangeGrouper';
import { RangeTracker } from './RangeTracker';
import { ReconciliationEngine } from './ReconciliationEngine';

export interface TrackerChangeEvent {
  uri?: vscode.Uri;
  totalPendingCount: number;
}

export class ChangeTracker implements vscode.Disposable {
  private baselines: Map<string, string> = new Map();
  private pendingGroups: Map<string, ChangeGroup[]> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private disposables: vscode.Disposable[] = [];
  private isApplyingReviewOperation: boolean = false;

  private _onDidChangePendingChanges = new vscode.EventEmitter<TrackerChangeEvent>();
  public readonly onDidChangePendingChanges: vscode.Event<TrackerChangeEvent> =
    this._onDidChangePendingChanges.event;

  private context?: vscode.ExtensionContext;
  private readonly STORAGE_KEY = 'reviewflow.persistedBaselines';
  private readonly STORAGE_KEY_NEW_FILES = 'reviewflow.persistedNewFiles';
  private newFiles: Set<string> = new Set();

  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
    if (context) {
      this.restorePersistedBaselines();
    }
  }

  public setApplyingReviewOperation(val: boolean): void {
    this.isApplyingReviewOperation = val;
  }

  public getApplyingReviewOperation(): boolean {
    return this.isApplyingReviewOperation;
  }

  public isNewFile(uri: vscode.Uri): boolean {
    return this.newFiles.has(uri.toString());
  }

  public markNewFile(uri: vscode.Uri): void {
    const key = uri.toString();
    this.newFiles.add(key);
    this.baselines.set(key, '');
    this.persistBaselines();
  }

  public unmarkNewFile(uri: vscode.Uri): void {
    this.newFiles.delete(uri.toString());
    this.persistBaselines();
  }

  /**
   * Handle when a brand new file is created in the workspace.
   */
  public async handleFileCreated(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== 'file') {
      return;
    }
    const fsPath = uri.fsPath;
    if (
      fsPath.includes('\\.git\\') ||
      fsPath.includes('/.git/') ||
      fsPath.includes('\\node_modules\\') ||
      fsPath.includes('/node_modules/') ||
      fsPath.includes('\\.vscode\\') ||
      fsPath.includes('/.vscode/') ||
      fsPath.endsWith('.vsix')
    ) {
      return;
    }

    const key = uri.toString();
    this.newFiles.add(key);
    this.baselines.set(key, '');
    this.pendingGroups.set(key, []);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      this.recalculateDiffForDocument(doc, ChangeSource.AGENT);
    } catch {
      await this.recalculateDiffForUri(uri);
    }
  }

  /**
   * Initialize baseline for a document when opened if none exists.
   */
  public initializeDocument(document: vscode.TextDocument): void {
    if (document.uri.scheme !== 'file') {
      return;
    }
    const key = document.uri.toString();
    if (!this.baselines.has(key)) {
      if (this.newFiles.has(key) || document.isUntitled) {
        this.baselines.set(key, '');
        this.newFiles.add(key);
        this.recalculateDiffForDocument(document, ChangeSource.AGENT);
      } else {
        this.baselines.set(key, document.getText());
        this.pendingGroups.set(key, []);
      }
      this.persistBaselines();
    } else {
      // Baseline was restored from persisted session or set!
      // Immediately calculate diff against current live document content
      this.recalculateDiffForDocument(document);
    }
  }

  /**
   * Handle text document change event from VS Code.
   */
  public handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    if (document.uri.scheme !== 'file') {
      return;
    }

    // Section 18 & 43: If internal review operation is applying, ignore event
    if (this.isApplyingReviewOperation) {
      return;
    }

    const key = document.uri.toString();
    const config = vscode.workspace.getConfiguration('reviewflow');
    const isEnabled = config.get<boolean>('enabled', true);
    if (!isEnabled) {
      return;
    }

    // If no baseline was stored yet, initialize it with previous text before this edit
    if (!this.baselines.has(key)) {
      this.initializeDocument(document);
      return;
    }

    // Heuristically detect change source and determine debounce delay
    let source = ChangeSource.USER;
    let delay = config.get<number>('debounceMs', 300);

    const isMultiChange = event.contentChanges.length > 1;
    const totalChars = event.contentChanges.reduce((sum, c) => sum + c.text.length, 0);
    const hasNewlines = event.contentChanges.some((c) => c.text.includes('\n'));

    if (isMultiChange || totalChars > 40 || hasNewlines) {
      source = ChangeSource.AGENT;
      // Fast review response for agent / bulk / paste modifications
      delay = Math.min(delay, 100);
    }

    // First, immediately shift existing pending ranges using RangeTracker so CodeLens doesn't jump
    const currentPending = this.pendingGroups.get(key) || [];
    if (currentPending.length > 0) {
      const adjusted = RangeTracker.adjustRangesOnContentChange(currentPending, event.contentChanges);
      this.pendingGroups.set(key, adjusted);
    }

    // Clear any pending debounce timer for this file
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule re-diffing and consolidation
    const timer = setTimeout(() => {
      this.recalculateDiffForDocument(document, source);
      this.debounceTimers.delete(key);
    }, delay);

    this.debounceTimers.set(key, timer);
  }

  /**
   * Recalculate diff between baseline and current document content using 3-state reconciliation.
   */
  public recalculateDiffForDocument(
    document: vscode.TextDocument,
    source: ChangeSource = ChangeSource.UNKNOWN
  ): void {
    const key = document.uri.toString();
    const baseline = this.baselines.get(key);
    if (baseline === undefined) {
      return;
    }

    const currentText = document.getText();
    const config = vscode.workspace.getConfiguration('reviewflow');
    const groupingDistance = config.get<number>('groupingDistance', 0);

    // Compute raw hunks using Myers line diff
    const hunks = DiffUtils.computeLineDiff(baseline, currentText);

    // Group hunks into change blocks
    const rawGroups = ChangeGrouper.groupHunks(
      hunks,
      key,
      baseline,
      currentText,
      groupingDistance,
      source
    );

    // Run Antigravity 3-way reconciliation (BASE, PROPOSED, CURRENT)
    const prevGroups = this.pendingGroups.get(key) || [];
    const reconciled = ReconciliationEngine.reconcileHunks(rawGroups, baseline, currentText);

    // Preserve any user-overridden markers from previous state if user edited overlapping region
    for (const r of reconciled) {
      const match = prevGroups.find(
        (p) =>
          p.originalStartLine === r.originalStartLine ||
          (p.beforeContext && r.beforeContext && p.beforeContext === r.beforeContext)
      );
      if (match && match.status === 'OVERRIDDEN') {
        r.status = 'OVERRIDDEN';
        r.ownership = 'USER';
      }
    }

    this.pendingGroups.set(key, reconciled);
    this.persistBaselines();
    this._onDidChangePendingChanges.fire({
      uri: document.uri,
      totalPendingCount: this.getTotalPendingCount()
    });
  }

  /**
   * Re-diff for a URI directly (opens doc if needed).
   */
  public async recalculateDiffForUri(uri: vscode.Uri): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      this.recalculateDiffForDocument(doc);
    } catch {
      // Document might have been closed or removed
    }
  }

  public getGroupsForUri(uri: vscode.Uri): ChangeGroup[] {
    return this.pendingGroups.get(uri.toString()) || [];
  }

  public hasPendingChanges(uri: vscode.Uri): boolean {
    const groups = this.getGroupsForUri(uri);
    return groups.length > 0;
  }

  public getAllGroups(): Map<string, ChangeGroup[]> {
    return new Map(this.pendingGroups);
  }

  public getTotalPendingCount(): number {
    let total = 0;
    for (const groups of this.pendingGroups.values()) {
      total += groups.length;
    }
    return total;
  }

  public getTrackedUris(): vscode.Uri[] {
    const uris: vscode.Uri[] = [];
    for (const [key, groups] of this.pendingGroups.entries()) {
      if (groups.length > 0) {
        uris.push(vscode.Uri.parse(key));
      }
    }
    return uris;
  }

  public getBaseline(uri: vscode.Uri): string | undefined {
    return this.baselines.get(uri.toString());
  }

  public setBaseline(uri: vscode.Uri, text: string): void {
    this.baselines.set(uri.toString(), text);
    this.persistBaselines();
  }

  public clearDocument(uri: vscode.Uri): void {
    const key = uri.toString();
    this.baselines.delete(key);
    this.pendingGroups.delete(key);
    this.newFiles.delete(key);
    this.persistBaselines();
    this._onDidChangePendingChanges.fire({
      uri,
      totalPendingCount: this.getTotalPendingCount()
    });
  }

  private persistBaselines(): void {
    if (!this.context) {
      return;
    }
    const config = vscode.workspace.getConfiguration('reviewflow');
    if (!config.get<boolean>('persistPendingChanges', true)) {
      return;
    }

    const data: Record<string, string> = {};
    for (const [key, val] of this.baselines.entries()) {
      // Only persist if there are pending changes
      const groups = this.pendingGroups.get(key);
      if (groups && groups.length > 0) {
        data[key] = val;
      }
    }
    this.context.workspaceState.update(this.STORAGE_KEY, data);
    this.context.workspaceState.update(this.STORAGE_KEY_NEW_FILES, Array.from(this.newFiles));
  }

  private restorePersistedBaselines(): void {
    if (!this.context) {
      return;
    }
    const savedNewFiles = this.context.workspaceState.get<string[]>(this.STORAGE_KEY_NEW_FILES);
    if (savedNewFiles) {
      this.newFiles = new Set(savedNewFiles);
    }

    const saved = this.context.workspaceState.get<Record<string, string>>(this.STORAGE_KEY);
    if (!saved) {
      return;
    }

    for (const [key, val] of Object.entries(saved)) {
      this.baselines.set(key, val);
      // Trigger async diff recalculation
      const uri = vscode.Uri.parse(key);
      this.recalculateDiffForUri(uri);
    }
  }

  public dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.persistBaselines();
    this._onDidChangePendingChanges.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
