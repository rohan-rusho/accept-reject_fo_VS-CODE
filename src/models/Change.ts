import { ChangeSource } from './ChangeSource';

export type ChangeType = 'insert' | 'delete' | 'modify';

export interface DiffHunk {
  originalStartLine: number;
  originalLineCount: number;
  originalLines: string[];
  currentStartLine: number;
  currentLineCount: number;
  currentLines: string[];
  type: ChangeType;
}

export interface LineChange {
  lineNumber: number;
  originalContent?: string;
  currentContent?: string;
  type: ChangeType;
}
