import { ChangeSource } from './ChangeSource';
import { ChangeType } from './Change';

export type HunkStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'OVERRIDDEN' | 'CONFLICT';
export type ChangeOwnership = 'AGENT' | 'USER' | 'MIXED';

export interface ChangeGroup {
  id: string;
  proposalId?: string;
  fileUri: string;
  startLine: number; // 0-indexed start line in current document
  endLine: number;   // 0-indexed end line in current document (inclusive)
  originalStartLine: number; // 0-indexed start line in baseline document
  originalEndLine: number;   // 0-indexed end line in baseline document (inclusive)
  originalText: string;      // Exact BASE text
  proposedText?: string;     // Exact PROPOSED text by agent
  currentText: string;       // CURRENT live text in document
  beforeContext?: string;    // Context anchor before change
  afterContext?: string;     // Context anchor after change
  addedLineCount: number;
  deletedLineCount: number;
  type: ChangeType;
  source: ChangeSource;
  timestamp: number;
  status?: HunkStatus;
  ownership?: ChangeOwnership;
  isConflict?: boolean;
  conflictReason?: string;
}

