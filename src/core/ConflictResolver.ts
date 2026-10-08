import * as vscode from 'vscode';
import { ChangeGroup } from '../models/ChangeGroup';
import { RangeUtils } from '../utils/RangeUtils';

export interface ConflictValidationResult {
  valid: boolean;
  reason?: string;
}

export class ConflictResolver {
  /**
   * Validate whether a pending change group can be safely applied/rejected on the document.
   */
  public static validate(group: ChangeGroup, document: vscode.TextDocument): ConflictValidationResult {
    // Boundary check
    if (group.startLine < 0 || group.startLine >= document.lineCount) {
      return {
        valid: false,
        reason: `Target line ${group.startLine + 1} is outside the document boundaries (line count: ${document.lineCount}).`
      };
    }

    // Extract current content in that range
    const range = RangeUtils.createLineRange(group.startLine, group.endLine, document);
    const documentTextInRange = document.getText(range).replace(/\r\n/g, '\n');
    const expectedCurrentText = group.currentText.replace(/\r\n/g, '\n');

    // If the hunk is an insertion, the current text must match the inserted lines
    if (group.type === 'insert' || group.type === 'modify') {
      if (documentTextInRange !== expectedCurrentText) {
        return {
          valid: false,
          reason: 'The content in this range was modified after the change was tracked.'
        };
      }
    }

    return { valid: true };
  }

  /**
   * Show a graceful conflict prompt to the user.
   */
  public static async promptConflict(
    group: ChangeGroup,
    reason: string
  ): Promise<'dismiss' | 'review' | 'cancel'> {
    const choice = await vscode.window.showWarningMessage(
      `ReviewFlow: Unable to apply change at ${RangeUtils.formatLineRange(group.startLine, group.endLine)}. ${reason}`,
      { modal: false },
      'Review Conflict',
      'Dismiss'
    );

    if (choice === 'Review Conflict') {
      return 'review';
    } else if (choice === 'Dismiss') {
      return 'dismiss';
    }
    return 'cancel';
  }
}
