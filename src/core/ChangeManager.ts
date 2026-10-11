import * as vscode from 'vscode';
import * as path from 'path';
import { ChangeTracker } from './ChangeTracker';
import { ChangeHistory } from './ChangeHistory';
import { ChangeApplier } from './ChangeApplier';
import { ConflictResolver } from './ConflictResolver';
import { ChangeGroup } from '../models/ChangeGroup';
import { ChangeOperation, FileSnapshot } from '../models/ChangeOperation';
import { ChangeSource } from '../models/ChangeSource';
import { RangeUtils } from '../utils/RangeUtils';

export class ChangeManager implements vscode.Disposable {
  private tracker: ChangeTracker;
  private history: ChangeHistory;

  constructor(tracker: ChangeTracker, history: ChangeHistory) {
    this.tracker = tracker;
    this.history = history;
  }

  public getTracker(): ChangeTracker {
    return this.tracker;
  }

  public getHistory(): ChangeHistory {
    return this.history;
  }

  /**
   * Accept an individual change block.
   * If user edited the same region (OVERRIDDEN), the user's version wins and is kept.
   */
  public async acceptChange(groupId: string, uri: vscode.Uri): Promise<boolean> {
    if (this.tracker.isGroupInFlight(groupId)) {
      return false;
    }
    this.tracker.setGroupInFlight(groupId, true);

    const groups = this.tracker.getGroupsForUri(uri);
    let group = groups.find((g) => g.id === groupId);
    if (!group) {
      // Resilient fallback: match by start line encoded in ID or proximity
      const parts = groupId.split('_');
      const startLine = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(startLine)) {
        group = groups.find((g) => Math.abs(g.startLine - startLine) <= 3);
      }
      if (!group && groups.length > 0) {
        group = groups[0];
      }
    }
    if (!group) {
      this.tracker.setGroupInFlight(groupId, false);
      vscode.window.showWarningMessage('ReviewFlow: Change block no longer exists.');
      return false;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const baselineBefore = this.tracker.getBaseline(uri) ?? doc.getText();
    const docBefore = doc.getText();

    this.tracker.setApplyingReviewOperation(true);
    try {
      // Section 15: If user modified the same region (OVERRIDDEN), user's version wins.
      let newBaseline = baselineBefore;
      if (group.status === 'OVERRIDDEN') {
        // Keep the user's live version and align baseline for this range
        newBaseline = ChangeApplier.applyAcceptToBaseline(baselineBefore, {
          ...group,
          currentText: group.currentText
        });
      } else {
        newBaseline = ChangeApplier.applyAcceptToBaseline(baselineBefore, group);
      }

      this.tracker.setBaseline(uri, newBaseline);
      this.tracker.recalculateDiffForDocument(doc);

      // Check if all groups are now accepted
      if (this.tracker.getGroupsForUri(uri).length === 0) {
        this.tracker.unmarkNewFile(uri);
        const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
        if (activeTab?.input instanceof vscode.TabInputTextDiff) {
          const diffInput = activeTab.input as vscode.TabInputTextDiff;
          if (diffInput.modified.toString() === uri.toString()) {
            await vscode.window.showTextDocument(uri, { preview: false });
          }
        }
      }

      // Record operation in undo history
      const op: ChangeOperation = {
        id: `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        fileUri: uri.toString(),
        timestamp: Date.now(),
        source: group.source,
        operationType: 'accept-change',
        transactionType: 'ACCEPT_CHANGE',
        changeIds: [group.id],
        affectedRanges: [{ startLine: group.startLine, endLine: group.endLine }],
        fileSnapshots: [
          {
            fileUri: uri.toString(),
            baselineBefore,
            baselineAfter: newBaseline,
            documentBefore: docBefore,
            documentAfter: doc.getText()
          }
        ],
        description: `Accepted change at ${RangeUtils.formatLineRange(group.startLine, group.endLine)} in ${path.basename(uri.fsPath)}`
      };

      this.history.push(op);
      vscode.window.setStatusBarMessage(`✓ Change accepted in ${path.basename(uri.fsPath)}`, 3000);
      return true;
    } finally {
      this.tracker.setApplyingReviewOperation(false);
      this.tracker.setGroupInFlight(groupId, false);
    }
  }

  /**
   * Reject an individual change block and remove ONLY the agent's contribution.
   * If user edited the same region (OVERRIDDEN), do not overwrite user content.
   */
  public async rejectChange(groupId: string, uri: vscode.Uri): Promise<boolean> {
    if (this.tracker.isGroupInFlight(groupId)) {
      return false;
    }
    this.tracker.setGroupInFlight(groupId, true);

    const groups = this.tracker.getGroupsForUri(uri);
    let group = groups.find((g) => g.id === groupId);
    if (!group) {
      // Resilient fallback: match by start line encoded in ID or proximity
      const parts = groupId.split('_');
      const startLine = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(startLine)) {
        group = groups.find((g) => Math.abs(g.startLine - startLine) <= 3);
      }
      if (!group && groups.length > 0) {
        group = groups[0];
      }
    }
    if (!group) {
      this.tracker.setGroupInFlight(groupId, false);
      vscode.window.showWarningMessage('ReviewFlow: Change block no longer exists.');
      return false;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const baselineBefore = this.tracker.getBaseline(uri) ?? doc.getText();
    const docBefore = doc.getText();

    this.tracker.setApplyingReviewOperation(true);
    try {
      let docAfter = docBefore;

      if (group.status === 'OVERRIDDEN') {
        // Section 16 & 17: User changed this region. Do not overwrite user content.
        // Update baseline for this range to match user's edit
        const newBaseline = ChangeApplier.applyAcceptToBaseline(baselineBefore, group);
        this.tracker.setBaseline(uri, newBaseline);
      } else {
        // Apply revert edit in the document for this hunk only
        const editSuccess = await ChangeApplier.rejectGroup(doc, group);
        if (!editSuccess) {
          vscode.window.showErrorMessage('ReviewFlow: Failed to apply rejection edit to document.');
          return false;
        }
        docAfter = doc.getText();
      }

      this.tracker.recalculateDiffForDocument(doc);

      // Check if all groups are now resolved
      if (this.tracker.getGroupsForUri(uri).length === 0) {
        this.tracker.unmarkNewFile(uri);
        const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
        if (activeTab?.input instanceof vscode.TabInputTextDiff) {
          const diffInput = activeTab.input as vscode.TabInputTextDiff;
          if (diffInput.modified.toString() === uri.toString()) {
            await vscode.window.showTextDocument(uri, { preview: false });
          }
        }
      }

      // Record in history
      const op: ChangeOperation = {
        id: `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        fileUri: uri.toString(),
        timestamp: Date.now(),
        source: group.source,
        operationType: 'reject-change',
        transactionType: 'REJECT_CHANGE',
        changeIds: [group.id],
        affectedRanges: [{ startLine: group.startLine, endLine: group.endLine }],
        fileSnapshots: [
          {
            fileUri: uri.toString(),
            baselineBefore,
            baselineAfter: baselineBefore,
            documentBefore: docBefore,
            documentAfter: docAfter
          }
        ],
        description: `Rejected change at ${RangeUtils.formatLineRange(group.startLine, group.endLine)} in ${path.basename(uri.fsPath)}`
      };

      this.history.push(op);
      vscode.window.setStatusBarMessage(`✕ Change rejected in ${path.basename(uri.fsPath)}`, 3000);
      return true;
    } finally {
      this.tracker.setApplyingReviewOperation(false);
      this.tracker.setGroupInFlight(groupId, false);
    }
  }

  /**
   * Accept all pending changes in a file as a single atomic user transaction.
   * Preserves all user edits made in the file.
   */
  public async acceptFile(uri: vscode.Uri): Promise<boolean> {
    const groups = this.tracker.getGroupsForUri(uri);
    if (groups.length === 0) {
      return true;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const baselineBefore = this.tracker.getBaseline(uri) ?? doc.getText();
    const docCurrent = doc.getText();

    this.tracker.setApplyingReviewOperation(true);
    try {
      this.tracker.setBaseline(uri, docCurrent);
      this.tracker.unmarkNewFile(uri);
      this.tracker.recalculateDiffForDocument(doc);

      const op: ChangeOperation = {
        id: `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        fileUri: uri.toString(),
        timestamp: Date.now(),
        source: ChangeSource.UNKNOWN,
        operationType: 'accept-file',
        transactionType: 'ACCEPT_FILE',
        changeIds: groups.map((g) => g.id),
        affectedRanges: groups.map((g) => ({ startLine: g.startLine, endLine: g.endLine })),
        fileSnapshots: [
          {
            fileUri: uri.toString(),
            baselineBefore,
            baselineAfter: docCurrent,
            documentBefore: docCurrent,
            documentAfter: docCurrent
          }
        ],
        description: `Accepted all ${groups.length} changes in ${path.basename(uri.fsPath)}`
      };

      this.history.push(op);
      vscode.window.showInformationMessage(`ReviewFlow: Accepted all changes in ${path.basename(uri.fsPath)}`);
      return true;
    } finally {
      this.tracker.setApplyingReviewOperation(false);
    }
  }

  /**
   * Reject all pending changes in a file as a single atomic user transaction.
   * Removes ONLY agent contributions. Never wipes out unrelated user edits!
   */
  public async rejectFile(uri: vscode.Uri): Promise<boolean> {
    const isNew = this.tracker.isNewFile(uri);
    const groups = this.tracker.getGroupsForUri(uri);
    if (groups.length === 0 && !isNew) {
      return true;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const baselineBefore = this.tracker.getBaseline(uri) ?? doc.getText();
    const docBefore = doc.getText();

    this.tracker.setApplyingReviewOperation(true);
    try {
      if (isNew) {
        try {
          await vscode.workspace.fs.delete(uri, { useTrash: true });
        } catch {
          await ChangeApplier.rejectEntireDocument(doc, '');
        }
        this.tracker.clearDocument(uri);
      } else {
        // Revert hunks in reverse line order so line shifts do not break preceding hunks
        const sorted = [...groups].sort((a, b) => b.startLine - a.startLine);
        for (const g of sorted) {
          if (g.status === 'OVERRIDDEN') {
            // User modified this region: preserve user edit
            continue;
          }
          await ChangeApplier.rejectGroup(doc, g);
        }
        // Baseline becomes the remaining text (preserving all user changes)
        this.tracker.setBaseline(uri, doc.getText());
        this.tracker.recalculateDiffForDocument(doc);
      }

      const op: ChangeOperation = {
        id: `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        fileUri: uri.toString(),
        timestamp: Date.now(),
        source: ChangeSource.UNKNOWN,
        operationType: isNew ? 'reject-new-file' : 'reject-file',
        transactionType: 'REJECT_FILE',
        changeIds: groups.map((g) => g.id),
        affectedRanges: groups.map((g) => ({ startLine: g.startLine, endLine: g.endLine })),
        fileSnapshots: [
          {
            fileUri: uri.toString(),
            baselineBefore,
            baselineAfter: this.tracker.getBaseline(uri) ?? '',
            documentBefore: docBefore,
            documentAfter: isNew ? '' : doc.getText()
          }
        ],
        description: isNew
          ? `Rejected and removed new file ${path.basename(uri.fsPath)}`
          : `Rejected all ${groups.length} changes in ${path.basename(uri.fsPath)}`
      };

      this.history.push(op);
      vscode.window.showInformationMessage(
        isNew
          ? `ReviewFlow: Removed new file ${path.basename(uri.fsPath)}`
          : `ReviewFlow: Reverted all changes in ${path.basename(uri.fsPath)}`
      );
      return true;
    } finally {
      this.tracker.setApplyingReviewOperation(false);
    }
  }

  /**
   * Accept all pending changes across all files in the workspace as a single transaction.
   */
  public async acceptAll(): Promise<boolean> {
    const uris = this.tracker.getTrackedUris();
    if (uris.length === 0) {
      vscode.window.showInformationMessage('ReviewFlow: No pending changes in workspace.');
      return true;
    }

    const snapshots: FileSnapshot[] = [];
    const changeIds: string[] = [];
    let totalChangeCount = 0;

    this.tracker.setApplyingReviewOperation(true);
    try {
      for (const uri of uris) {
        const groups = this.tracker.getGroupsForUri(uri);
        if (groups.length === 0) {
          continue;
        }
        totalChangeCount += groups.length;
        groups.forEach((g) => changeIds.push(g.id));

        const doc = await vscode.workspace.openTextDocument(uri);
        const baselineBefore = this.tracker.getBaseline(uri) ?? doc.getText();
        const current = doc.getText();

        snapshots.push({
          fileUri: uri.toString(),
          baselineBefore,
          baselineAfter: current,
          documentBefore: current,
          documentAfter: current
        });

        this.tracker.setBaseline(uri, current);
        this.tracker.unmarkNewFile(uri);
        this.tracker.recalculateDiffForDocument(doc);
      }

      const op: ChangeOperation = {
        id: `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        fileUri: 'workspace',
        timestamp: Date.now(),
        source: ChangeSource.UNKNOWN,
        operationType: 'accept-all',
        transactionType: 'ACCEPT_ALL',
        changeIds,
        affectedRanges: [],
        fileSnapshots: snapshots,
        description: `Accepted ${totalChangeCount} changes across ${snapshots.length} files`
      };

      this.history.push(op);
      vscode.window.showInformationMessage(
        `ReviewFlow: Accepted all changes (${totalChangeCount} changes across ${snapshots.length} files).`
      );
      return true;
    } finally {
      this.tracker.setApplyingReviewOperation(false);
    }
  }

  /**
   * Reject all pending changes across all files in the workspace as a single transaction.
   * Removes ONLY agent contributions. Never wipes out unrelated user edits!
   */
  public async rejectAll(): Promise<boolean> {
    const uris = this.tracker.getTrackedUris();
    if (uris.length === 0) {
      vscode.window.showInformationMessage('ReviewFlow: No pending changes in workspace.');
      return true;
    }

    const snapshots: FileSnapshot[] = [];
    const changeIds: string[] = [];
    let totalChangeCount = 0;

    this.tracker.setApplyingReviewOperation(true);
    try {
      for (const uri of uris) {
        const isNew = this.tracker.isNewFile(uri);
        const groups = this.tracker.getGroupsForUri(uri);
        if (groups.length === 0 && !isNew) {
          continue;
        }
        totalChangeCount += groups.length;
        groups.forEach((g) => changeIds.push(g.id));

        const doc = await vscode.workspace.openTextDocument(uri);
        const baselineBefore = this.tracker.getBaseline(uri) ?? doc.getText();
        const docBefore = doc.getText();

        if (isNew) {
          try {
            await vscode.workspace.fs.delete(uri, { useTrash: true });
          } catch {
            await ChangeApplier.rejectEntireDocument(doc, '');
          }
          this.tracker.clearDocument(uri);
        } else {
          const sorted = [...groups].sort((a, b) => b.startLine - a.startLine);
          for (const g of sorted) {
            if (g.status === 'OVERRIDDEN') {
              continue;
            }
            await ChangeApplier.rejectGroup(doc, g);
          }
          this.tracker.setBaseline(uri, doc.getText());
          this.tracker.recalculateDiffForDocument(doc);
        }

        snapshots.push({
          fileUri: uri.toString(),
          baselineBefore,
          baselineAfter: this.tracker.getBaseline(uri) ?? '',
          documentBefore: docBefore,
          documentAfter: isNew ? '' : doc.getText()
        });
      }

      const op: ChangeOperation = {
        id: `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        fileUri: 'workspace',
        timestamp: Date.now(),
        source: ChangeSource.UNKNOWN,
        operationType: 'reject-all',
        transactionType: 'REJECT_ALL',
        changeIds,
        affectedRanges: [],
        fileSnapshots: snapshots,
        description: `Rejected ${totalChangeCount} changes across ${snapshots.length} files`
      };

      this.history.push(op);
      vscode.window.showInformationMessage(
        `ReviewFlow: Reverted all changes across ${snapshots.length} files.`
      );
      return true;
    } finally {
      this.tracker.setApplyingReviewOperation(false);
    }
  }

  /**
   * Revert the most recent accepted or rejected transaction.
   * If last action was Accept All or Accept File, undoes the entire transaction atomically.
   */
  public async undoLastChange(): Promise<boolean> {
    if (!this.history.canUndo()) {
      vscode.window.showInformationMessage('ReviewFlow: No changes to undo.');
      return false;
    }

    const op = this.history.pop();
    if (!op) {
      return false;
    }

    this.tracker.setApplyingReviewOperation(true);
    try {
      for (const snapshot of op.fileSnapshots) {
        const uri = vscode.Uri.parse(snapshot.fileUri);
        try {
          let doc: vscode.TextDocument;
          try {
            doc = await vscode.workspace.openTextDocument(uri);
          } catch {
            // File was deleted (e.g. rejected new file), recreate it
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(uri, encoder.encode(snapshot.documentBefore));
            doc = await vscode.workspace.openTextDocument(uri);
            this.tracker.markNewFile(uri);
          }

          // If document text changed during operation, restore documentBefore
          if (snapshot.documentBefore !== snapshot.documentAfter) {
            await ChangeApplier.rejectEntireDocument(doc, snapshot.documentBefore);
          }

          // Restore baselineBefore
          this.tracker.setBaseline(uri, snapshot.baselineBefore);
          if (snapshot.baselineBefore === '') {
            this.tracker.markNewFile(uri);
          }
          this.tracker.recalculateDiffForDocument(doc);
        } catch (err) {
          console.error(`ReviewFlow: Error restoring file during undo: ${snapshot.fileUri}`, err);
        }
      }

      vscode.window.showInformationMessage(`ReviewFlow: Undid "${op.description}"`);
      return true;
    } finally {
      this.tracker.setApplyingReviewOperation(false);
    }
  }

  /**
   * Find next change relative to active editor and cursor position.
   */
  public getNextChange(
    activeUri?: vscode.Uri,
    currentLine?: number
  ): { uri: vscode.Uri; group: ChangeGroup } | undefined {
    const allItems: { uri: vscode.Uri; group: ChangeGroup }[] = [];
    for (const uri of this.tracker.getTrackedUris()) {
      for (const group of this.tracker.getGroupsForUri(uri)) {
        allItems.push({ uri, group });
      }
    }

    if (allItems.length === 0) {
      return undefined;
    }

    if (!activeUri || currentLine === undefined) {
      return allItems[0];
    }

    const currentFileItems = allItems.filter(
      (item) => item.uri.toString() === activeUri.toString()
    );

    const nextInCurrent = currentFileItems.find((item) => item.group.startLine > currentLine);
    if (nextInCurrent) {
      return nextInCurrent;
    }

    const activeIndex = allItems.findIndex(
      (item) => item.uri.toString() === activeUri.toString()
    );
    const nextIndex = (activeIndex + 1) % allItems.length;
    return allItems[nextIndex];
  }

  /**
   * Find previous change relative to active editor and cursor position.
   */
  public getPrevChange(
    activeUri?: vscode.Uri,
    currentLine?: number
  ): { uri: vscode.Uri; group: ChangeGroup } | undefined {
    const allItems: { uri: vscode.Uri; group: ChangeGroup }[] = [];
    for (const uri of this.tracker.getTrackedUris()) {
      for (const group of this.tracker.getGroupsForUri(uri)) {
        allItems.push({ uri, group });
      }
    }

    if (allItems.length === 0) {
      return undefined;
    }

    if (!activeUri || currentLine === undefined) {
      return allItems[allItems.length - 1];
    }

    const currentFileItems = allItems.filter(
      (item) => item.uri.toString() === activeUri.toString()
    );

    const prevInCurrent = [...currentFileItems]
      .reverse()
      .find((item) => item.group.endLine < currentLine);
    if (prevInCurrent) {
      return prevInCurrent;
    }

    const activeIndex = allItems.findIndex(
      (item) => item.uri.toString() === activeUri.toString()
    );
    const prevIndex = (activeIndex - 1 + allItems.length) % allItems.length;
    return allItems[prevIndex];
  }

  public dispose(): void {
    // Clean up
  }
}
