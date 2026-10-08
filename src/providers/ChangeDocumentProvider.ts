import * as vscode from 'vscode';
import { ChangeTracker } from '../core/ChangeTracker';

export class ChangeDocumentProvider implements vscode.TextDocumentContentProvider {
  public static readonly SCHEME = 'reviewflow-baseline';

  private tracker: ChangeTracker;
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

  constructor(tracker: ChangeTracker) {
    this.tracker = tracker;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    // The query or path points to the original file URI
    const targetUri = vscode.Uri.parse(uri.query || uri.path);
    return this.tracker.getBaseline(targetUri) ?? '';
  }

  public refresh(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }
}
