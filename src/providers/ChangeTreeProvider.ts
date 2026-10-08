import * as vscode from 'vscode';
import * as path from 'path';
import { ChangeTracker } from '../core/ChangeTracker';
import { ChangeGroup } from '../models/ChangeGroup';
import { RangeUtils } from '../utils/RangeUtils';

export type ReviewTreeNode = FileItemNode | ChangeItemNode;

export class FileItemNode extends vscode.TreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly changeCount: number
  ) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Expanded);
    this.resourceUri = uri;
    this.contextValue = 'fileItem';
    this.description = `${changeCount} change${changeCount > 1 ? 's' : ''}`;
    this.tooltip = `${uri.fsPath}\n${changeCount} pending changes`;
    this.iconPath = vscode.ThemeIcon.File;
  }
}

export class ChangeItemNode extends vscode.TreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly group: ChangeGroup,
    public readonly index: number
  ) {
    const rangeText = RangeUtils.formatLineRange(group.startLine, group.endLine);
    super(`Change ${index + 1}`, vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'changeItem';
    this.description = `${rangeText}   🟢 +${group.addedLineCount}  🔴 -${group.deletedLineCount}`;
    this.tooltip = `Lines ${group.startLine + 1}–${group.endLine + 1}\nAdded: ${group.addedLineCount}, Deleted: ${group.deletedLineCount}`;

    if (group.isConflict) {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
      this.description += ' [Conflict]';
    } else if (group.type === 'insert') {
      this.iconPath = new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    } else if (group.type === 'delete') {
      this.iconPath = new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    }

    // Command to navigate to the exact line
    this.command = {
      command: 'reviewflow.navigateToChange',
      title: 'Navigate to Change',
      arguments: [uri, group]
    };
  }
}

export class ChangeTreeProvider implements vscode.TreeDataProvider<ReviewTreeNode> {
  private tracker: ChangeTracker;
  private _onDidChangeTreeData = new vscode.EventEmitter<ReviewTreeNode | undefined | void>();
  public readonly onDidChangeTreeData: vscode.Event<ReviewTreeNode | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(tracker: ChangeTracker) {
    this.tracker = tracker;
    this.tracker.onDidChangePendingChanges(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: ReviewTreeNode): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ReviewTreeNode): Promise<ReviewTreeNode[]> {
    if (!element) {
      // Root level: return all files with pending changes
      const uris = this.tracker.getTrackedUris();
      const nodes: FileItemNode[] = [];

      for (const uri of uris) {
        const groups = this.tracker.getGroupsForUri(uri);
        if (groups.length > 0) {
          nodes.push(new FileItemNode(uri, groups.length));
        }
      }

      return nodes;
    }

    if (element instanceof FileItemNode) {
      // File level: return all changes for this file
      const groups = this.tracker.getGroupsForUri(element.uri);
      return groups.map((group, index) => new ChangeItemNode(element.uri, group, index));
    }

    return [];
  }
}
