import * as vscode from 'vscode';
import { ChangeOperation } from '../models/ChangeOperation';

export class ChangeHistory {
  private stack: ChangeOperation[] = [];
  private maxDepth: number = 50;
  private context?: vscode.ExtensionContext;
  private readonly STORAGE_KEY = 'reviewflow.persistedHistory';

  constructor(maxDepth: number = 50, context?: vscode.ExtensionContext) {
    this.maxDepth = maxDepth;
    this.context = context;
    if (context) {
      const saved = context.workspaceState.get<ChangeOperation[]>(this.STORAGE_KEY);
      if (saved && Array.isArray(saved)) {
        this.stack = saved;
      }
    }
  }

  private persist(): void {
    if (this.context) {
      this.context.workspaceState.update(this.STORAGE_KEY, this.stack);
    }
  }

  /**
   * Push a new operation to the history stack.
   */
  public push(operation: ChangeOperation): void {
    this.stack.push(operation);
    if (this.stack.length > this.maxDepth) {
      this.stack.shift();
    }
    this.persist();
  }

  /**
   * Pop and return the most recent operation.
   */
  public pop(): ChangeOperation | undefined {
    const val = this.stack.pop();
    this.persist();
    return val;
  }

  /**
   * Peek at the most recent operation without removing it.
   */
  public peek(): ChangeOperation | undefined {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
  }

  /**
   * Check if there are any operations available to undo.
   */
  public canUndo(): boolean {
    return this.stack.length > 0;
  }

  /**
   * Get the count of operations in the undo stack.
   */
  public get length(): number {
    return this.stack.length;
  }

  /**
   * Get all operations in chronological order.
   */
  public getAll(): ReadonlyArray<ChangeOperation> {
    return [...this.stack];
  }

  /**
   * Clear all history.
   */
  public clear(): void {
    this.stack = [];
    this.persist();
  }
}
