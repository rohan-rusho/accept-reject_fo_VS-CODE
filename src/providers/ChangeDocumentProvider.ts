import * as vscode from 'vscode';
import { ChangeTracker } from '../core/ChangeTracker';

export class ChangeDocumentProvider implements vscode.TextDocumentContentProvider {
  public static readonly SCHEME = 'reviewflow-baseline';
  public static readonly SNAPSHOT_SCHEME = 'reviewflow-snapshot';

  private tracker: ChangeTracker;
  private static snapshotStore = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

  public static setSnapshot(key: string, content: string): void {
    this.snapshotStore.set(key, content);
  }

  public static getSnapshot(key: string): string | undefined {
    return this.snapshotStore.get(key);
  }

  constructor(tracker: ChangeTracker) {
    this.tracker = tracker;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    if (uri.scheme === ChangeDocumentProvider.SNAPSHOT_SCHEME) {
      const snapKey = uri.query || uri.path;
      return ChangeDocumentProvider.snapshotStore.get(snapKey) ?? '';
    }
    // The query or path points to the original file URI
    const targetUri = vscode.Uri.parse(uri.query || uri.path);
    return this.tracker.getBaseline(targetUri) ?? '';
  }

  public refresh(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }
}
